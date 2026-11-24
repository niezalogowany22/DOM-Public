// Wydatki: lista miesiąca, formularz (podział, paragon), rozliczenie grupy
import * as db from './db.js';
import { state } from './db.js';
import { view, esc, parseNum, go, back, toast, guard, signCls, pills, bindPills, picked, icon } from './ui.js';
import { wtabs, budgetCard } from './budzet.js';
import { r2, fmtMoney, fmtDate, fmtDateLong, today, monthKey, monthName, addMonth, inGroupCur, owedBy,
         balances, settle, totalSpent } from './split.js';

const CURRENCIES = ['PLN', 'EUR', 'USD', 'GBP', 'CZK', 'HUF', 'CHF', 'NOK', 'SEK', 'DKK', 'RON', 'BGN', 'TRY', 'UAH', 'GEL'];

// ------------------------------------------------------------- wiersz wydatku
export function expenseRow(e, g) {
  const c = db.category(e.category_id);
  const cur = g?.currency || 'PLN';
  if (e.kind === 'transfer') {
    const to = (e.shares || [])[0]?.p;
    return `<a class="xrow" href="#wydatek?g=${e.group_id}&id=${e.id}">
      <span class="ic">⇄</span>
      <span class="tt"><b>${esc(db.personName(e.paid_by))} → ${esc(db.personName(to))}</b><small>zwrot · ${fmtDate(e.spent_on)}</small></span>
      <span class="am muted">${fmtMoney(inGroupCur(e), cur)}</span></a>`;
  }
  const who = e.source === 'joint' ? 'konto wspólne' : esc(db.personName(e.paid_by));
  const me = db.mePerson(e.group_id);
  const mine = me && e.source !== 'joint' ? owedBy(e)[me.id] : null;
  const foreign = e.currency !== cur ? ` <small>${fmtMoney(e.amount, e.currency)}</small>` : '';
  return `<a class="xrow" href="#wydatek?g=${e.group_id}&id=${e.id}">
    <span class="ic">${esc(c?.icon || '•')}</span>
    <span class="tt"><b>${esc(e.title || c?.name || 'Wydatek')}</b><small>${who}${mine != null ? ` · mój udział ${fmtMoney(mine, cur)}` : ''}${e.receipt_path ? ` · ${icon('receipt', 'ic-svg ic-inline')}` : ''}</small></span>
    <span class="am">${e._pending ? icon('clock', 'ic-svg ic-inline') + ' ' : ''}${fmtMoney(inGroupCur(e), cur)}${foreign}</span></a>`;
}

export function groupedList(list, g) {
  if (!list.length) return '<p class="muted center pad">Brak wydatków.</p>';
  let out = '', day = null;
  for (const e of list) {
    if (e.spent_on !== day) { day = e.spent_on; out += `<div class="day">${fmtDateLong(day)}</div>`; }
    out += expenseRow(e, g);
  }
  return out;
}

// Karta salda grupy z przyciskiem rozliczenia
export function balanceCard(g, title = 'Saldo') {
  const people = db.peopleOf(g.id);
  const bal = balances(people, db.expensesOf(g.id));
  const tr = settle(bal);
  return `<section class="card">
    <div class="row between"><h2>${title}</h2><a class="btn small" href="#rozlicz?g=${g.id}">Rozlicz</a></div>
    ${tr.length ? tr.map(t => `<div class="kvrow"><span>${esc(db.personName(t.from))} → ${esc(db.personName(t.to))}</span><b>${fmtMoney(t.amount, g.currency)}</b></div>`).join('')
      : '<p class="muted">Wszyscy rozliczeni.</p>'}
  </section>`;
}

// ------------------------------------------------------------- lista miesiąca
export function renderExpenses(params) {
  const g = db.homeGroup();
  if (!g) { view.innerHTML = '<p class="muted center">Ładowanie…</p>'; return; }
  const m = params.m || monthKey(today());
  const withTrips = params.t === '1';
  const tripIds = new Set(state.groups.filter(x => x.kind === 'trip' && x.currency === 'PLN').map(x => x.id));
  const inMonth = state.expenses.filter(e => monthKey(e.spent_on) === m && (e.group_id === g.id || (withTrips && tripIds.has(e.group_id))));
  const spend = inMonth.filter(e => e.kind !== 'transfer');
  const total = totalSpent(spend);
  const joint = r2(spend.filter(e => e.source === 'joint').reduce((a, e) => a + inGroupCur(e), 0));
  const byCat = {};
  for (const e of spend) byCat[e.category_id || ''] = (byCat[e.category_id || ''] || 0) + inGroupCur(e);
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const max = cats[0]?.[1] || 1;
  const q = (mm, t = withTrips) => `#wydatki?m=${mm}${t ? '&t=1' : ''}`;

  view.innerHTML = `${wtabs('lista')}
    <a class="searchbar" href="#szukaj">${icon('search')}<span>Szukaj wydatków</span></a>
    <a class="fab" href="#wydatek?g=${g.id}" aria-label="Dodaj wydatek">${icon('plus')}<span>Wydatek</span></a>
    ${m === monthKey(today()) ? budgetCard() : ''}
    <div class="monthnav"><a class="btn small" href="${q(addMonth(m, -1))}">‹</a><b>${monthName(m)}</b><a class="btn small" href="${q(addMonth(m, 1))}">›</a></div>
    <section class="card">
      <div class="row between"><span class="muted">Razem</span><b class="big">${fmtMoney(total)}</b></div>
      <div class="row between small"><span class="muted">w tym z konta wspólnego</span><span>${fmtMoney(joint)}</span></div>
      ${cats.length ? `<div class="bars">${cats.map(([id, v]) => { const c = db.category(id);
        return `<div class="bar"><span>${esc(c?.icon || '•')} ${esc(c?.name || 'Bez kategorii')}</span><b>${fmtMoney(v)}</b><i style="width:${Math.max(2, v / max * 100)}%"></i></div>`; }).join('')}</div>` : ''}
      <label class="check small"><input type="checkbox" id="wt" ${withTrips ? 'checked' : ''}> uwzględnij wyjazdy (w zł)</label>
    </section>
    ${balanceCard(g, 'Saldo między wami')}
    <section class="card flush">${groupedList(inMonth, g)}</section>`;
  view.querySelector('#wt').onchange = e => go(q(m, e.target.checked).slice(1));
}

// ------------------------------------------------------------- podpowiedzi sklepów
// Najczęstsze nazwy z historii (ostatnie 12 mies.) z ostatnio użytą kategorią i płatnikiem
export function shopHints(groupId) {
  const since = new Date(Date.now() - 365 * 864e5).toLocaleDateString('sv-SE');
  const map = new Map();
  for (const e of state.expenses) {   // lista jest od najnowszych
    if (e.kind !== 'expense' || !e.title || e.spent_on < since || e.recurring_id) continue;
    const k = e.title.trim().toLowerCase();
    const x = map.get(k) || { title: e.title.trim(), n: 0, cat: e.category_id, payer: e.source === 'joint' ? 'joint' : e.paid_by, group: e.group_id };
    x.n++; map.set(k, x);
  }
  for (const r of state.rules || []) { const k = (r.title || '').trim().toLowerCase(); if (k && !map.has(k)) map.set(k, { title: r.title, n: 0, cat: r.category_id }); }
  return [...map.values()].sort((a, b) => (b.group === groupId) - (a.group === groupId) || b.n - a.n);
}

// ------------------------------------------------------------- formularz
export function renderExpenseForm(params) {
  const g = db.groupById(params.g) || db.homeGroup();
  if (!g) { view.innerHTML = '<p class="muted center">Ładowanie…</p>'; return; }
  const e = params.id ? state.expenses.find(x => x.id === params.id) : null;
  if (params.id && !e) { view.innerHTML = '<p class="muted center">Nie znaleziono wydatku.</p>'; return; }
  if (e?.kind === 'transfer') return renderTransfer(g, e);

  const isHome = g.kind === 'home';
  const people = db.peopleOf(g.id);
  const me = db.mePerson(g.id) || people[0];
  const shareOf = id => (e?.shares || []).find(s => s.p === id);
  const mode0 = e?.split_mode || 'equal';
  const payer0 = e ? (e.source === 'joint' ? 'joint' : e.paid_by) : me?.id;
  const cur0 = e?.currency || g.currency;
  let receiptFile = null, removeReceipt = false;
  const hints = shopHints(g.id);
  let catTouched = !!(e?.category_id || params.cat), payerTouched = !!e;

  view.innerHTML = `
    <form class="card" id="xf" autocomplete="off">
      <div class="row between"><h2>${e ? 'Edytuj wydatek' : 'Nowy wydatek'}</h2><span class="muted small">${esc(g.kind === 'trip' ? g.name : '')}</span></div>
      <div class="amountrow">
        <input name="amount" inputmode="decimal" placeholder="0,00" value="${e ? String(e.amount).replace('.', ',') : ''}" required>
        ${isHome && cur0 === 'PLN' ? '<span class="cur">zł</span>' : `<select name="currency">${[...new Set([g.currency, cur0, ...CURRENCIES])].map(c => `<option ${c === cur0 ? 'selected' : ''}>${c}</option>`).join('')}</select>`}
      </div>
      <div class="row" id="rateRow" hidden>
        <label class="field">Kurs → ${g.currency}<input name="rate" inputmode="decimal" value="${e && e.currency !== g.currency ? String(e.rate).replace('.', ',') : ''}"></label>
        <button type="button" class="btn small" id="nbp">Kurs NBP</button>
      </div>
      <label class="field">Sklep / opis<input name="title" value="${esc(e?.title || params.title || '')}" placeholder="Biedronka" list="shopHints" autocomplete="off"></label>
      <datalist id="shopHints">${hints.slice(0, 80).map(h => `<option value="${esc(h.title)}">`).join('')}</datalist>
      ${!e && hints.length ? `<div class="pills quick">${hints.filter(h => h.n).slice(0, 6).map((h, i) => `<button type="button" class="pill" data-hint="${i}">${esc(db.category(h.cat)?.icon || '')} ${esc(h.title)}</button>`).join('')}</div>` : ''}
      <label class="field">Data<input type="date" name="spent_on" value="${e?.spent_on || today()}" required></label>

      <div class="field">Kategoria</div>
      ${pills('cat', state.categories.map(c => [c.id, `${esc(c.icon)} ${esc(c.name)}`]), e?.category_id || params.cat || null)}

      <div class="field">Zapłacone przez</div>
      ${pills('payer', [...(isHome ? [['joint', 'Konto wspólne']] : []), ...people.map(p => [p.id, esc(p.name)])], payer0)}

      <div id="splitBox">
        <div class="field">Podział</div>
        ${pills('mode', [['equal', 'Po równo'], ['shares', 'Części'], ['amounts', 'Kwoty'], ...(isHome ? [['mine', 'Tylko płacący']] : [])], mode0)}
        <div id="shares">${people.map(p => { const s = shareOf(p.id);
          const on = e ? !!s : true;
          const val = mode0 === 'amounts' ? (s?.a ?? '') : mode0 === 'shares' ? (s?.w ?? 1) : '';
          return `<label class="share" data-p="${p.id}"><input type="checkbox" ${on ? 'checked' : ''}><span>${esc(p.name)}</span>
            <input class="sv" inputmode="decimal" value="${String(val).replace('.', ',')}"><b class="sp"></b></label>`; }).join('')}</div>
        <p class="hint" id="splitHint"></p>
      </div>
      <p class="hint" id="jointHint" hidden>Z konta wspólnego — wydatek liczy się do statystyk, ale nikt nikomu nie jest winien.</p>

      <div class="field">Paragon</div>
      <div id="rcpt"></div>
      <div class="row">
        <label class="btn">${icon('camera')} Zrób zdjęcie<input type="file" accept="image/*" capture="environment" id="cam" hidden></label>
        <label class="btn">${icon('image')} Z galerii<input type="file" accept="image/*" id="gal" hidden></label>
      </div>
      <label class="field">Notatka<input name="note" value="${esc(e?.note || params.note || '')}"></label>
      ${isHome && state.recurring.length ? `<label class="field">Opłata cykliczna<select name="rec" style="width:100%"><option value="">— nie —</option>
        ${state.recurring.map(r => `<option value="${r.id}" ${e?.recurring_id === r.id ? 'selected' : ''}>${esc(r.title)} (${String(r.amount).replace('.', ',')} zł)</option>`).join('')}</select></label>
        <p class="hint">Zaznacz, jeśli ten wydatek to np. czynsz czy internet — wtedy liczy się jako zapłacona stała opłata.</p>` : ''}
      ${e ? `<a class="btn" href="#gwarancja-edytuj?exp=${e.id}">${icon('shield')} Dodaj gwarancję do tego zakupu</a>` : ''}
      <div class="row between">
        ${e ? '<button type="button" class="btn danger" id="del">Usuń</button>' : '<span></span>'}
        <div class="row" style="margin:0"><button type="button" class="btn" id="cancel">Anuluj</button><button class="btn primary">Zapisz</button></div>
      </div>
    </form>`;

  const f = view.querySelector('#xf');
  const amount = () => parseNum(f.amount.value) || 0;
  const cur = () => f.currency?.value || 'PLN';

  function update() {
    const payer = picked(f, 'payer');
    const joint = payer === 'joint';
    view.querySelector('#splitBox').hidden = joint;
    view.querySelector('#jointHint').hidden = !joint;
    const foreign = cur() !== g.currency;
    view.querySelector('#rateRow').hidden = !foreign;
    let mode = picked(f, 'mode');
    const rows = [...f.querySelectorAll('.share')];
    if (mode === 'mine') rows.forEach(r => r.querySelector('input[type=checkbox]').checked = r.dataset.p === payer);
    rows.forEach(r => {
      const sv = r.querySelector('.sv');
      sv.hidden = mode === 'equal' || mode === 'mine';
      sv.placeholder = mode === 'shares' ? '1' : '0,00';
    });
    const sh = readShares();
    const fake = { amount: amount(), rate: 1, split_mode: mode === 'mine' ? 'equal' : mode, shares: sh };
    const owed = owedBy(fake);
    rows.forEach(r => r.querySelector('.sp').textContent = owed[r.dataset.p] != null && r.querySelector('input[type=checkbox]').checked ? fmtMoney(owed[r.dataset.p], cur()) : '');
    const hint = view.querySelector('#splitHint');
    if (mode === 'amounts') {
      const left = r2(amount() - sh.reduce((a, s) => a + (s.a || 0), 0));
      hint.textContent = Math.abs(left) < 0.005 ? 'Kwoty się zgadzają.' : `Do rozdzielenia: ${fmtMoney(left, cur())}`;
      hint.className = 'hint' + (Math.abs(left) < 0.005 ? '' : ' neg');
    } else hint.textContent = '';
  }
  function readShares() {
    const mode = picked(f, 'mode');
    return [...f.querySelectorAll('.share')].filter(r => r.querySelector('input[type=checkbox]').checked).map(r => {
      const v = parseNum(r.querySelector('.sv').value);
      return mode === 'amounts' ? { p: r.dataset.p, a: v || 0 } : mode === 'shares' ? { p: r.dataset.p, w: v ?? 1 } : { p: r.dataset.p, w: 1 };
    });
  }
  function showReceipt(src) {
    const box = view.querySelector('#rcpt');
    box.innerHTML = src ? `<div class="thumb"><a href="${src}" target="_blank" rel="noopener"><img src="${src}" alt="Paragon"></a>
      <button type="button" class="btn small danger" id="rmR">Usuń zdjęcie</button></div>` : '';
    box.querySelector('#rmR')?.addEventListener('click', () => { receiptFile = null; removeReceipt = true; showReceipt(null); });
  }
  if (e?.receipt_path) db.receiptUrl(e.receipt_path).then(showReceipt).catch(() => showReceipt(null));
  for (const id of ['cam', 'gal']) view.querySelector('#' + id).onchange = ev => {
    const file = ev.target.files[0]; if (!file) return;
    receiptFile = file; removeReceipt = false; showReceipt(URL.createObjectURL(file));
  };

  const setPill = (name, v) => f.querySelectorAll(`.pills[data-name="${name}"] .pill`).forEach(p => p.classList.toggle('on', p.dataset.v === v));
  const applyHint = (h, withPayer) => {
    if (!h) return;
    if (h.cat && !catTouched) setPill('cat', h.cat);
    if (withPayer && h.payer && !payerTouched && f.querySelector(`.pills[data-name="payer"] [data-v="${h.payer}"]`)) setPill('payer', h.payer);
    update();
  };
  f.title.addEventListener('change', () => applyHint(hints.find(h => h.title.toLowerCase() === f.title.value.trim().toLowerCase()), true));
  f.querySelectorAll('[data-hint]').forEach(b => b.onclick = () => {
    const h = hints.filter(x => x.n).slice(0, 6)[+b.dataset.hint];
    f.title.value = h.title; applyHint(h, true);
    f.querySelectorAll('[data-hint]').forEach(x => x.classList.toggle('on', x === b));
  });
  bindPills(f, (name, v) => {
    if (name === 'cat') catTouched = true;
    if (name === 'payer') payerTouched = true;
    if (name === 'mode' && v !== 'mine') {
      const rows = [...f.querySelectorAll('.share')];
      if (v === 'shares') rows.forEach(r => { if (!r.querySelector('.sv').value) r.querySelector('.sv').value = '1'; });
      if (v === 'amounts') rows.forEach(r => r.querySelector('.sv').value = '');
      if (rows.every(r => !r.querySelector('input[type=checkbox]').checked)) rows.forEach(r => r.querySelector('input[type=checkbox]').checked = true);
    }
    update();
  });
  f.addEventListener('input', update);
  f.addEventListener('change', update);
  if (f.currency) f.currency.onchange = () => { f.rate.value = ''; update(); };
  view.querySelector('#nbp').onclick = () => guard(async () => {
    const [a, b] = await Promise.all([db.nbpRate(cur(), f.spent_on.value), db.nbpRate(g.currency, f.spent_on.value)]);
    f.rate.value = String(Math.round(a / b * 10000) / 10000).replace('.', ',');
    toast(`1 ${cur()} = ${f.rate.value} ${g.currency}`);
  });
  view.querySelector('#cancel').onclick = () => back('wydatki');
  view.querySelector('#del')?.addEventListener('click', () => confirm('Usunąć wydatek?') && guard(async () => { await db.deleteExpense(e); toast('Usunięto'); back('wydatki'); }));
  update();
  if (!e) f.amount.focus();

  f.onsubmit = ev => {
    ev.preventDefault();
    guard(async () => {
      const amt = amount();
      if (!(amt > 0)) throw new Error('Podaj kwotę');
      const payer = picked(f, 'payer');
      if (!payer) throw new Error('Wybierz, kto zapłacił');
      let mode = picked(f, 'mode');
      const shares = payer === 'joint' ? [] : readShares();
      if (mode === 'mine') mode = 'equal';
      if (payer !== 'joint') {
        if (!shares.length) throw new Error('Zaznacz, za kogo był wydatek');
        if (mode === 'amounts' && Math.abs(amt - shares.reduce((a, s) => a + s.a, 0)) > 0.005) throw new Error('Kwoty podziału nie sumują się do kwoty wydatku');
        if (mode === 'shares' && !shares.some(s => s.w > 0)) throw new Error('Podaj części większe od zera');
      }
      const foreign = cur() !== g.currency;
      const rate = foreign ? parseNum(f.rate.value) : 1;
      if (foreign && !(rate > 0)) throw new Error(`Podaj kurs ${cur()} → ${g.currency} albo pobierz z NBP`);
      await db.saveExpense({
        id: e?.id, group_id: g.id, title: f.title.value.trim(), amount: amt, currency: cur(), rate,
        spent_on: f.spent_on.value, category_id: picked(f, 'cat'), source: payer === 'joint' ? 'joint' : 'private',
        paid_by: payer === 'joint' ? null : payer, split_mode: mode, shares, receipt_path: e?.receipt_path, note: f.note.value.trim(),
        ...(f.rec ? { recurring_id: f.rec.value || null, period: f.rec.value ? f.spent_on.value.slice(0, 7) : null, _rec: true } : {}),
      }, receiptFile, removeReceipt);
      toast(navigator.onLine ? 'Zapisano' : 'Zapisano w telefonie — wyśle się po powrocie internetu');
      back(g.kind === 'trip' ? 'wyjazd?g=' + g.id : 'wydatki');
    });
  };
}

function renderTransfer(g, e) {
  const to = (e.shares || [])[0]?.p;
  view.innerHTML = `<section class="card">
    <h2>Zwrot</h2>
    <dl class="kv"><dt>Od</dt><dd>${esc(db.personName(e.paid_by))}</dd><dt>Dla</dt><dd>${esc(db.personName(to))}</dd>
      <dt>Kwota</dt><dd>${fmtMoney(e.amount, e.currency)}</dd><dt>Data</dt><dd>${fmtDateLong(e.spent_on)}</dd></dl>
    <div class="row between"><button class="btn danger" id="del">Usuń zwrot</button><button class="btn" id="bk">Wróć</button></div></section>`;
  view.querySelector('#bk').onclick = () => back('wydatki');
  view.querySelector('#del').onclick = () => confirm('Usunąć zwrot? Saldo wróci do stanu sprzed rozliczenia.') && guard(async () => { await db.deleteExpense(e); back('wydatki'); });
}

// ------------------------------------------------------------- rozliczenie
export function renderSettle(params) {
  const g = db.groupById(params.g) || db.homeGroup();
  if (!g) return;
  const people = db.peopleOf(g.id);
  const list = db.expensesOf(g.id);
  const bal = balances(people, list);
  const tr = settle(bal);
  const transfers = list.filter(e => e.kind === 'transfer');
  view.innerHTML = `
    <section class="card">
      <h2>Saldo · ${esc(g.kind === 'home' ? 'Dom' : g.name)}</h2>
      ${people.map(p => `<div class="kvrow"><span>${esc(p.name)}</span><b class="${signCls(bal[p.id])}">${bal[p.id] > 0 ? '+' : ''}${fmtMoney(bal[p.id] || 0, g.currency)}</b></div>`).join('')}
      <p class="hint">Plus — tej osobie się należy. Minus — ta osoba jest winna.</p>
    </section>
    <section class="card">
      <h2>Jak się rozliczyć</h2>
      ${tr.length ? tr.map((t, i) => `<div class="settle"><span><b>${esc(db.personName(t.from))}</b> oddaje <b>${esc(db.personName(t.to))}</b></span>
        <b>${fmtMoney(t.amount, g.currency)}</b><button class="btn small primary" data-i="${i}">Zapłacone</button></div>`).join('')
        : '<p class="muted">Wszyscy rozliczeni.</p>'}
    </section>
    ${transfers.length ? `<section class="card flush"><div class="day">Historia zwrotów</div>${transfers.map(e => expenseRow(e, g)).join('')}</section>` : ''}`;
  view.querySelectorAll('.settle button').forEach(b => b.onclick = () => {
    const t = tr[+b.dataset.i];
    if (!confirm(`Zapisać zwrot ${fmtMoney(t.amount, g.currency)}: ${db.personName(t.from)} → ${db.personName(t.to)}?`)) return;
    guard(async () => { await db.addTransfer(g.id, t.from, t.to, t.amount, g.currency); toast('Zapisano zwrot'); });
  });
}
