// Budżet konta wspólnego, prognoza, stan konta, wydatki cykliczne
import * as db from './db.js';
import { state } from './db.js';
import { view, esc, parseNum, go, back, toast, guard, pills, bindPills, picked, icon } from './ui.js';
import { newBillsCount } from './dodatki.js';
import { r2, fmtMoney, today, monthKey, monthName, addMonth, inGroupCur, fmtDate } from './split.js';

const needSql = () => state.budgetReady ? '' : `<section class="card warn"><b>Brak tabel budżetu.</b> Uruchom <code>schema-budzet.sql</code> w Supabase, potem odśwież.</section>`;
export const wtabs = a => `<div class="subnav"><a href="#wydatki" class="${a === 'lista' ? 'on' : ''}">Lista</a><a href="#budzet" class="${a === 'budzet' ? 'on' : ''}">Budżet</a><a href="#raport" class="${a === 'raport' ? 'on' : ''}">Raport</a><a href="#cykliczne" class="${a === 'cykl' ? 'on' : ''}">Cykliczne</a></div>`;

// ------------------------------------------------------------- cykliczne: terminy
const daysIn = m => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0).getDate(); };
const monthsBetween = (a, b) => { const [y1, m1] = a.split('-').map(Number), [y2, m2] = b.split('-').map(Number); return (y2 - y1) * 12 + (m2 - m1); };
export function dueIn(r, m) {           // data płatności w miesiącu m (YYYY-MM) albo null
  const start = r.start_month.slice(0, 7);
  if (!r.active || m < start || (r.end_month && m > r.end_month.slice(0, 7))) return null;
  if (monthsBetween(start, m) % (r.every_months || 1)) return null;
  return `${m}-${String(Math.min(r.day_of_month, daysIn(m))).padStart(2, '0')}`;
}
const paid = (r, period) => state.expenses.some(e => e.recurring_id === r.id && e.period === period);

// Do zapłacenia (niezautomatyzowane): zaległe z poprzedniego miesiąca i z bieżącego do 5 dni naprzód
export function dueReminders() {
  const t = today(), m = monthKey(t), soon = new Date(Date.now() + 5 * 864e5).toLocaleDateString('sv-SE');
  const out = [];
  for (const r of state.recurring.filter(r => !r.auto)) for (const mm of [addMonth(m, -1), m]) {
    const d = dueIn(r, mm);
    if (d && d <= soon && !paid(r, mm)) out.push({ r, period: mm, date: d, overdue: d < t });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// Automatyczne: dodaje zaległe wpisy (bieżący i poprzedni miesiąc). Wywoływane po wczytaniu danych.
let running = false;
export async function runAutoRecurring() {
  if (running || !navigator.onLine || !state.budgetReady || !db.homeGroup()) return;
  const t = today(), m = monthKey(t);
  const todo = [];
  for (const r of state.recurring.filter(r => r.auto)) for (const mm of [addMonth(m, -1), m]) {
    const d = dueIn(r, mm);
    if (d && d <= t && !paid(r, mm)) todo.push([r, mm, d]);
  }
  if (!todo.length) return;
  running = true;
  try { for (const [r, mm, d] of todo) await db.payRecurring(r, mm, d); await db.refresh(); }
  catch (e) { console.warn('cykliczne', e); }
  finally { running = false; }
}

// Wydatek z tego miesiąca, który wygląda na tę opłatę (z wyciągu albo wpisany ręcznie): konto wspólne,
// niepowiązany, nazwa pasuje albo kwota różni się najwyżej o 5% (min. 1 zł)
export function matchExpense(r, m) {
  const g = db.homeGroup(); const t = r.title.toLowerCase();
  const cands = state.expenses.filter(e => e.group_id === g?.id && e.kind === 'expense' && !e.recurring_id && e.source === r.source
    && monthKey(e.spent_on) === m && (r.source === 'joint' || e.paid_by === r.paid_by));
  const near = e => Math.abs(inGroupCur(e) - Number(r.amount)) <= Math.max(1, Number(r.amount) * 0.05);
  const named = e => (e.title + ' ' + (e.note || '')).toLowerCase().includes(t);
  return cands.find(e => named(e) && near(e)) || cands.find(named) || cands.find(near) || null;
}

// ------------------------------------------------------------- obliczenia budżetu
export function budgetMonth(m = monthKey(today())) {
  const g = db.homeGroup();
  const joint = state.expenses.filter(e => e.group_id === g?.id && e.kind !== 'transfer' && e.source === 'joint' && monthKey(e.spent_on) === m);
  const spent = r2(joint.reduce((a, e) => a + inGroupCur(e), 0));
  const fixedDone = r2(joint.filter(e => e.recurring_id).reduce((a, e) => a + inGroupCur(e), 0));
  const variable = r2(spent - fixedDone);
  const limit = state.budget?.monthly_limit ?? null;
  const t = today(), cur = monthKey(t) === m;
  const dim = daysIn(m), elapsed = cur ? +t.slice(8, 10) : dim;
  // stałe opłaty z konta wspólnego, które w tym miesiącu jeszcze nie weszły
  const upcoming = state.recurring.filter(r => r.source === 'joint').map(r => ({ r, d: dueIn(r, m) }))
    .filter(x => x.d && !paid(x.r, m)).map(x => ({ r: x.r, title: x.r.title, amount: Number(x.r.amount), date: x.d, match: matchExpense(x.r, m) }));
  const upcomingSum = r2(upcoming.reduce((a, x) => a + x.amount, 0));
  // tempo: bieżący miesiąc, a na początku miesiąca (do 7. dnia) średnia z 3 poprzednich
  const prev = [1, 2, 3].map(i => addMonth(m, -i)).map(pm => state.expenses
    .filter(e => e.group_id === g?.id && e.kind !== 'transfer' && e.source === 'joint' && !e.recurring_id && monthKey(e.spent_on) === pm)
    .reduce((a, e) => a + inGroupCur(e), 0)).filter(v => v > 0);
  const avgPrev = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : null;
  let varForecast = elapsed ? variable / elapsed * dim : variable;
  if (cur && elapsed <= 7 && avgPrev != null) { const w = elapsed / 7; varForecast = w * varForecast + (1 - w) * avgPrev; }
  const forecast = cur ? r2(fixedDone + Math.max(variable, varForecast) + upcomingSum) : spent;
  const left = limit != null ? r2(limit - spent) : null;
  const perDay = cur && left != null ? r2((left - upcomingSum) / Math.max(1, dim - elapsed + 1)) : null;
  return { m, spent, fixedDone, variable, limit, upcoming, upcomingSum, forecast, left, perDay, cur, elapsed, dim, avgPrev };
}

export function jointBalance() {
  const b = state.budget; if (!b) return null;
  const g = db.homeGroup();
  const from = b.opening_date;
  const out = state.expenses.filter(e => e.group_id === g?.id && e.source === 'joint' && e.kind !== 'transfer' && e.spent_on >= from)
    .reduce((a, e) => a + inGroupCur(e), 0);
  const inn = state.deposits.filter(d => d.day >= from).reduce((a, d) => a + Number(d.amount), 0);
  return r2(Number(b.opening_balance) + inn - out);
}

const bar = (v, max) => { const p = max ? Math.min(100, v / max * 100) : 0; return `<div class="pbar" style="--p:${p.toFixed(1)}%" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p)}"><i class="${v > max ? 'over' : p > 85 ? 'warn' : ''}"></i></div>`; };

// Mała karta na Start i nad listą wydatków
export function budgetCard() {
  if (!state.budgetReady || state.budget?.monthly_limit == null) return '';
  const b = budgetMonth();
  const over = b.forecast > b.limit;
  return `<a class="card hero" href="#budzet">
    <span class="small"><b>Konto wspólne</b> · ${esc(monthName(monthKey(today())))}</span>
    <b class="amt">${fmtMoney(b.spent)}</b>
    ${bar(b.spent, b.limit)}
    <div class="row between small" style="margin:0"><span>z ${fmtMoney(b.limit)} limitu</span><span>prognoza <b class="${over ? 'neg' : ''}">${fmtMoney(b.forecast)}</b></span></div>
  </a>`;
}

// ------------------------------------------------------------- ekran BUDŻET
export function renderBudget(params) {
  const m = params.m || monthKey(today());
  const b = budgetMonth(m);
  const bal = jointBalance();
  const g = db.homeGroup();
  const people = g ? db.peopleOf(g.id) : [];
  const depM = state.deposits.filter(d => monthKey(d.day) === m);
  const byPerson = people.map(p => ({ p, sum: r2(depM.filter(d => d.person_id === p.id).reduce((a, d) => a + Number(d.amount), 0)) }));
  view.innerHTML = `${wtabs('budzet')}${needSql()}
    <div class="monthnav"><a class="btn small" href="#budzet?m=${addMonth(m, -1)}">‹</a><b>${monthName(m)}</b><a class="btn small" href="#budzet?m=${addMonth(m, 1)}">›</a></div>
    ${b.limit == null ? `<section class="card warn">Ustaw miesięczny limit wydatków z konta wspólnego — na dole tego ekranu.</section>` : `
    <section class="card">
      <div class="row between" style="margin:0"><span class="muted">Wydano z konta wspólnego</span><b class="big">${fmtMoney(b.spent)}</b></div>
      ${bar(b.spent, b.limit)}
      <div class="kvrow"><span>Limit</span><b>${fmtMoney(b.limit)}</b></div>
      <div class="kvrow"><span>Zostało</span><b class="${b.left < 0 ? 'neg' : ''}">${fmtMoney(b.left)}</b></div>
      ${b.cur ? `<div class="kvrow"><span>Na dzień do końca miesiąca<br><small class="muted">po odjęciu stałych opłat</small></span><b class="${b.perDay < 0 ? 'neg' : ''}">${fmtMoney(b.perDay)}</b></div>` : ''}
    </section>`}
    ${b.cur ? `<section class="card">
      <h2>Prognoza</h2>
      <div class="kvrow"><span>Stałe opłaty (już zapłacone)</span><b>${fmtMoney(b.fixedDone)}</b></div>
      <div class="kvrow"><span>Bieżące wydatki do dziś</span><b>${fmtMoney(b.variable)}</b></div>
      <div class="kvrow"><span>Bieżące — w tym tempie do końca miesiąca</span><b>${fmtMoney(b.forecast - b.fixedDone - b.upcomingSum)}</b></div>
      <div class="kvrow"><span>Stałe opłaty jeszcze przed wami</span><b>${fmtMoney(b.upcomingSum)}</b></div>
      ${b.upcoming.map((u, i) => `<div class="upc"><span>${esc(u.title)} · ${fmtDate(u.date)}</span><span>${fmtMoney(u.amount)}</span>
        <span class="upc-act">${u.match ? `<button class="btn small primary" data-link="${i}">To już jest: ${esc(u.match.title || 'wydatek')} ${fmtMoney(inGroupCur(u.match))}</button>` : ''}
        <button class="btn small" data-paid="${i}">Zapłacone</button></span></div>`).join('')}
      <div class="kvrow total"><span>Prognoza na koniec miesiąca</span><b class="${b.limit != null && b.forecast > b.limit ? 'neg' : 'pos'}">${fmtMoney(b.forecast)}</b></div>
      ${b.limit != null ? `<p class="hint">${b.forecast > b.limit ? `W tym tempie limit zostanie przekroczony o ${fmtMoney(b.forecast - b.limit)}.` : `W tym tempie zostanie ok. ${fmtMoney(b.limit - b.forecast)} z limitu.`}
        ${b.elapsed <= 7 && b.avgPrev != null ? ' Na początku miesiąca prognoza uwzględnia średnią z poprzednich miesięcy.' : ''}</p>` : ''}
    </section>` : ''}
    ${newBillsCount() ? `<a class="card row between" href="#rachunki-licz"><span class="row" style="margin:0">${icon('meter')} Rachunki z Liczników do dodania</span><span class="nbadge static">${newBillsCount()}</span></a>` : ''}
    <section class="card">
      <div class="row between" style="margin:0"><h2 style="margin:0">Konto wspólne</h2><div class="row" style="margin:0"><a class="btn small" href="#import">⇩ Import z banku</a><a class="btn small" href="#wplata">+ Wpłata</a></div></div>
      ${bal != null ? `<div class="kvrow"><span>Stan wg aplikacji</span><b class="big ${bal < 0 ? 'neg' : ''}">${fmtMoney(bal)}</b></div>` : ''}
      ${byPerson.map(x => `<div class="kvrow"><span>Wpłaty ${esc(x.p.name)} · ${monthName(m).toLowerCase()}</span><b>${fmtMoney(x.sum)}</b></div>`).join('')}
      ${depM.length ? `<details><summary>Wpłaty w tym miesiącu (${depM.length})</summary>${depM.map(d => `<div class="kvrow"><span>${fmtDate(d.day)} · ${esc(db.personName(d.person_id))}${d.note ? ' · ' + esc(d.note) : ''}</span>
        <span>${fmtMoney(Number(d.amount))} <button class="btn small" data-deld="${d.id}" aria-label="Usuń">✕</button></span></div>`).join('')}</details>` : ''}
      <p class="hint">Stan = stan początkowy + wpłaty − wydatki z konta wspólnego od ${fmtDate(state.budget?.opening_date)}. Gdy różni się od banku, popraw stan początkowy niżej.</p>
    </section>
    <form class="card" id="bf">
      <h2>Ustawienia</h2>
      <label class="field">Miesięczny limit z konta wspólnego (zł)<input name="limit" inputmode="decimal" value="${state.budget?.monthly_limit ?? ''}"></label>
      <div class="row"><label class="field">Stan konta (zł)<input name="ob" inputmode="decimal" value="${state.budget?.opening_balance ?? ''}"></label>
        <label class="field">na dzień<input type="date" name="od" value="${state.budget?.opening_date || today()}"></label></div>
      <button class="btn primary">Zapisz</button>
    </form>`;
  view.querySelectorAll('[data-link]').forEach(x => x.onclick = () => { const u = b.upcoming[+x.dataset.link];
    guard(async () => { await db.linkRecurring(u.match.id, u.r.id, m); toast(`Połączono z „${u.r.title}”`); }); });
  view.querySelectorAll('[data-paid]').forEach(x => x.onclick = () => { const u = b.upcoming[+x.dataset.paid];
    const v = prompt(`Kwota za „${u.r.title}” (zł) — doda nowy wydatek.\nJeśli ta opłata jest już w wydatkach (np. z wyciągu), otwórz ją i wybierz „Opłata cykliczna”.`, String(u.amount).replace('.', ','));
    if (v == null) return; const amount = parseNum(v); if (!(amount >= 0)) return toast('Nieprawidłowa kwota', true);
    guard(async () => { await db.payRecurring(u.r, m, u.date > today() ? today() : u.date, amount); await db.refresh(); toast('Zapisano'); }); });
  view.querySelectorAll('[data-deld]').forEach(x => x.onclick = e => { e.preventDefault(); confirm('Usunąć wpłatę?') && guard(() => db.deleteDeposit(x.dataset.deld)); });
  const f = view.querySelector('#bf');
  f.onsubmit = e => { e.preventDefault(); guard(async () => {
    await db.saveBudget({ monthly_limit: parseNum(f.limit.value), opening_balance: parseNum(f.ob.value) || 0, opening_date: f.od.value || today() });
    toast('Zapisano');
  }); };
}

export function renderDepositForm() {
  const g = db.homeGroup();
  const people = g ? db.peopleOf(g.id) : [];
  const me = g ? db.mePerson(g.id) : null;
  view.innerHTML = `<form class="card" id="df">
    <h2>Wpłata na konto wspólne</h2>
    <div class="amountrow"><input name="amount" inputmode="decimal" placeholder="0,00" required><span class="cur">zł</span></div>
    <div class="field">Kto wpłacił</div>
    ${pills('who', people.map(p => [p.id, esc(p.name)]), me?.id)}
    <label class="field">Data<input type="date" name="day" value="${today()}"></label>
    <label class="field">Notatka<input name="note" placeholder="np. pensja, zwrot"></label>
    <p class="hint">Wypłatę z konta wspólnego wpisz z minusem.</p>
    <div class="row between"><span></span><div class="row" style="margin:0"><button type="button" class="btn" id="cancel">Anuluj</button><button class="btn primary">Zapisz</button></div></div>
  </form>`;
  const f = view.querySelector('#df');
  bindPills(f);
  f.amount.focus();
  view.querySelector('#cancel').onclick = () => back('budzet');
  f.onsubmit = e => { e.preventDefault(); guard(async () => {
    const amount = parseNum(f.amount.value); if (!amount) throw new Error('Podaj kwotę');
    await db.addDeposit({ amount, person_id: picked(f, 'who'), day: f.day.value, note: f.note.value.trim() });
    toast('Zapisano'); go('budzet');
  }); };
}

// ------------------------------------------------------------- ekran CYKLICZNE
const every = r => r.every_months === 1 ? 'co miesiąc' : r.every_months === 12 ? 'co rok' : `co ${r.every_months} mies.`;
export function renderRecurringList() {
  const m = monthKey(today());
  const list = [...state.recurring].sort((a, b) => (b.active - a.active) || a.day_of_month - b.day_of_month);
  const monthly = r2(list.filter(r => r.active).reduce((a, r) => a + Number(r.amount) / (r.every_months || 1), 0));
  view.innerHTML = `${wtabs('cykl')}${needSql()}
    <a class="btn primary big" href="#cykliczny-edytuj">+ Nowy wydatek cykliczny</a>
    ${list.length ? `<p class="hint">Średnio ${fmtMoney(monthly)} miesięcznie.</p>` : ''}
    <section class="card flush">${list.map(r => { const c = db.category(r.category_id); const d = dueIn(r, m);
      return `<a class="xrow${r.active ? '' : ' off'}" href="#cykliczny-edytuj?id=${r.id}"><span class="ic">${c?.icon ? esc(c.icon) : icon('repeat')}</span>
        <span class="tt"><b>${esc(r.title)}</b><small>${r.day_of_month}. dnia · ${every(r)} · ${r.source === 'joint' ? 'konto wspólne' : esc(db.personName(r.paid_by))} · ${r.auto ? 'dodaje się sam' : 'przypomnienie'}${!r.active ? ' · wstrzymany' : ''}</small></span>
        <span class="am">${fmtMoney(Number(r.amount))}${d ? `<small>${paid(r, m) ? icon('check', 'ic-svg ic-inline') + ' ' : ''}${fmtDate(d)}</small>` : ''}</span></a>`; }).join('')
      || '<p class="muted center pad">Brak. Dodaj np. czynsz, internet, abonamenty, ubezpieczenie.</p>'}</section>`;
}

export function renderRecurringForm(params) {
  const r = params.id ? state.recurring.find(x => x.id === params.id) : null;
  const g = db.homeGroup();
  const people = g ? db.peopleOf(g.id) : [];
  view.innerHTML = `<form class="card" id="rf" autocomplete="off">
    <h2>${r ? 'Wydatek cykliczny' : 'Nowy wydatek cykliczny'}</h2>
    <label class="field">Nazwa<input name="title" value="${esc(r?.title || '')}" placeholder="Czynsz, Internet, Netflix…" required></label>
    <div class="amountrow"><input name="amount" inputmode="decimal" placeholder="0,00" value="${r ? String(r.amount).replace('.', ',') : ''}" required><span class="cur">zł</span></div>
    <p class="hint">Przy zmiennej kwocie (np. prąd) wpisz przybliżoną — do prognozy. Przy zapisie zapłaty podasz dokładną.</p>
    <div class="row"><label class="field">Dzień płatności<input name="day" inputmode="numeric" value="${r?.day_of_month || 10}"></label>
      <label class="field">Co ile miesięcy<select name="every" style="width:100%">${[[1, 'co miesiąc'], [2, 'co 2 mies.'], [3, 'co kwartał'], [6, 'co pół roku'], [12, 'co rok']].map(([v, l]) => `<option value="${v}" ${v === (r?.every_months || 1) ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <div class="row"><label class="field">Od miesiąca<input type="month" name="start" value="${(r?.start_month || today()).slice(0, 7)}"></label>
      <label class="field">Do (opcjonalnie)<input type="month" name="end" value="${r?.end_month?.slice(0, 7) || ''}"></label></div>
    <div class="field">Kategoria</div>
    ${pills('cat', state.categories.map(c => [c.id, `${esc(c.icon)} ${esc(c.name)}`]), r?.category_id || null)}
    <div class="field">Płacone z</div>
    ${pills('payer', [['joint', 'Konto wspólne'], ...people.map(p => [p.id, esc(p.name)])], r ? (r.source === 'joint' ? 'joint' : r.paid_by) : 'joint')}
    <p class="hint">Z prywatnego — dzielone po równo między was.</p>
    <label class="check"><input type="checkbox" name="auto" ${r?.auto ? 'checked' : ''}> Dodawaj automatycznie w dniu płatności (stała kwota, np. polecenie zapłaty)</label>
    ${r ? `<label class="check"><input type="checkbox" name="active" ${r.active ? 'checked' : ''}> Aktywny</label>` : ''}
    <div class="row between">
      ${r ? '<button type="button" class="btn danger" id="del">Usuń</button>' : '<span></span>'}
      <div class="row" style="margin:0"><button type="button" class="btn" id="cancel">Anuluj</button><button class="btn primary">Zapisz</button></div>
    </div>
  </form>`;
  const f = view.querySelector('#rf');
  bindPills(f);
  view.querySelector('#cancel').onclick = () => back('cykliczne');
  view.querySelector('#del')?.addEventListener('click', () => confirm('Usunąć? Zapisane już wydatki zostaną.') && guard(async () => { await db.deleteRecurring(r.id); go('cykliczne'); }));
  f.onsubmit = e => { e.preventDefault(); guard(async () => {
    const amount = parseNum(f.amount.value), day = parseInt(f.day.value);
    if (!(amount >= 0)) throw new Error('Podaj kwotę');
    if (!(day >= 1 && day <= 31)) throw new Error('Dzień płatności 1–31');
    const payer = picked(f, 'payer');
    await db.saveRecurring({ id: r?.id, title: f.title.value.trim(), amount, day_of_month: day, every_months: +f.every.value,
      start_month: f.start.value + '-01', end_month: f.end.value ? f.end.value + '-01' : null, category_id: picked(f, 'cat'),
      source: payer === 'joint' ? 'joint' : 'private', paid_by: payer === 'joint' ? null : payer,
      shares: payer === 'joint' ? [] : people.map(p => ({ p: p.id, w: 1 })), auto: f.auto.checked, active: r ? f.active.checked : true });
    toast('Zapisano'); go('cykliczne');
  }); };
}

// Karta przypomnień na Start
export function remindersCard() {
  const due = dueReminders();
  if (!due.length) return '';
  return `<section class="card">
    <h2>Do zapłacenia</h2>
    ${due.map((x, i) => `<div class="settle"><span><b>${esc(x.r.title)}</b><br><small class="${x.overdue ? 'neg' : 'muted'}">${x.overdue ? 'po terminie · ' : ''}${fmtDate(x.date)}</small></span>
      <b>${fmtMoney(Number(x.r.amount))}</b><button class="btn small primary" data-pay="${i}">Zapłacone</button></div>`).join('')}
  </section>`;
}
export function bindReminders() {
  const due = dueReminders();
  view.querySelectorAll('[data-pay]').forEach(b => b.onclick = () => {
    const x = due[+b.dataset.pay];
    const v = prompt(`Kwota za „${x.r.title}” (zł):`, String(x.r.amount).replace('.', ','));
    if (v == null) return;
    const amount = parseNum(v); if (!(amount >= 0)) return toast('Nieprawidłowa kwota', true);
    guard(async () => { await db.payRecurring(x.r, x.period, x.date > today() ? today() : x.date, amount); await db.refresh(); toast('Zapisano'); });
  });
}
