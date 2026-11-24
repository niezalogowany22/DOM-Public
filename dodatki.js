// Rachunki z Liczników → wydatki, gwarancje, spiżarnia
import * as db from './db.js';
import { state } from './db.js';
import { view, esc, parseNum, go, back, toast, guard, pills, bindPills, picked, icon } from './ui.js';
import { fmtMoney, fmtDate, today, monthName } from './split.js';

const needSql = () => state.extrasReady ? '' : `<section class="card warn"><b>Brak tabel.</b> Uruchom <code>schema-dodatki.sql</code> w Supabase, potem odśwież.</section>`;
const daysTo = d => Math.round((new Date(d + 'T12:00') - new Date(today() + 'T12:00')) / 864e5);
const cat = name => state.categories.find(c => c.name === name)?.id || null;

// ================================================================ RACHUNKI Z LICZNIKÓW
const monthEnd = m => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0).toLocaleDateString('sv-SE'); };
export function billList() {
  const b = state.bills, out = [];
  for (const r of b.readings) out.push({ ref: `licz:prad:${r.month.slice(0, 7)}`, title: `Prąd — rachunek (${monthName(r.month.slice(0, 7)).toLowerCase()})`,
    amount: Number(r.bill_amount), date: r.read_on || monthEnd(r.month.slice(0, 7)) });
  for (const p of b.periods.filter(p => Number(p.actual_amount) < 0)) out.push({ ref: `licz:okres:${p.id}`, title: `Dopłata ze spółdzielni — ${p.name}`,
    amount: -Number(p.actual_amount), date: monthEnd(p.end_month.slice(0, 7)) });
  for (const x of b.expenses) out.push({ ref: `licz:wyd:${x.id}`, title: x.name, amount: Number(x.amount), date: monthEnd(x.month.slice(0, 7)) });
  const done = new Set(state.expenses.map(e => e.import_ref).filter(Boolean));
  return out.map(x => ({ ...x, done: done.has(x.ref) })).sort((a, b) => b.date.localeCompare(a.date));
}
export const newBillsCount = () => billList().filter(x => !x.done).length;

export function renderLiczBills() {
  const g = db.homeGroup(); const people = g ? db.peopleOf(g.id) : [];
  const list = billList();
  const fresh = list.filter(x => !x.done), old = list.filter(x => x.done);
  view.innerHTML = `
    <section class="card"><h2>Rachunki z Liczników</h2>
      <p class="hint">Rachunki za prąd, dopłaty ze spółdzielni i wydatki jednorazowe wpisane w Licznikach. Dodaj je do wydatków jednym przyciskiem —
        jeśli płacicie je z konta wspólnego i importujecie wyciąg, wybierz tylko jedno z dwóch, żeby nie liczyć podwójnie.</p></section>
    <section class="card flush">${fresh.map((x, i) => `<div class="bill" data-i="${i}">
      <span><b>${esc(x.title)}</b><small class="muted">${fmtDate(x.date)}</small></span><b>${fmtMoney(x.amount)}</b>
      <select class="src"><option value="joint">konto wspólne</option>${people.map(p => `<option value="${p.id}">${esc(p.name)} (½)</option>`).join('')}</select>
      <button class="btn small primary">Dodaj</button></div>`).join('') || '<p class="muted center pad">Nic nowego.</p>'}</section>
    ${old.length ? `<details class="card"><summary>Już w wydatkach (${old.length})</summary>${old.map(x => `<div class="kvrow"><span>${icon('check', 'ic-svg ic-inline')} ${esc(x.title)}</span><span>${fmtMoney(x.amount)}</span></div>`).join('')}</details>` : ''}`;
  view.querySelectorAll('.bill').forEach(el => el.querySelector('button').onclick = () => guard(async () => {
    const x = fresh[+el.dataset.i], src = el.querySelector('.src').value;
    await db.addBillExpense({ ...x, category_id: cat('Mieszkanie i media'), source: src === 'joint' ? 'joint' : 'private', paid_by: src === 'joint' ? null : src });
    toast('Dodano do wydatków');
  }));
}

// ================================================================ GWARANCJE
const until = w => { const d = new Date(w.bought_on + 'T12:00'); d.setMonth(d.getMonth() + w.months); return d.toLocaleDateString('sv-SE'); };
const status = w => { const left = daysTo(until(w));
  return left < 0 ? `<span class="badge">wygasła</span>` : left <= 30 ? `<span class="badge wait">kończy się za ${left} dni</span>` : `<span class="badge pos">do ${fmtDate(until(w))} ${until(w).slice(0, 4)}</span>`; };
export const warrantiesEnding = () => state.warranties.filter(w => { const l = daysTo(until(w)); return l >= 0 && l <= 30; });

export function renderWarranties(params) {
  const q = (params.q || '').toLowerCase();
  const list = state.warranties.filter(w => !q || (w.name + ' ' + (w.shop || '')).toLowerCase().includes(q))
    .sort((a, b) => (daysTo(until(a)) < 0) - (daysTo(until(b)) < 0) || until(a).localeCompare(until(b)));
  view.innerHTML = `${needSql()}
    <a class="btn primary big" href="#gwarancja-edytuj">+ Dodaj gwarancję</a>
    <input id="q" type="search" placeholder="Szukaj: pralka, telefon, sklep…" value="${esc(params.q || '')}">
    <section class="card flush">${list.map(w => `<a class="xrow" href="#gwarancja-edytuj?id=${w.id}"><span class="ic">${icon('shield')}</span>
      <span class="tt"><b>${esc(w.name)}</b><small>${esc(w.shop || '')}${w.shop ? ' · ' : ''}kupione ${fmtDate(w.bought_on)} ${w.bought_on.slice(0, 4)}${w.receipt_path ? ` · ${icon('receipt', 'ic-svg ic-inline')}` : ''}</small></span>
      <span class="am">${status(w)}</span></a>`).join('') || '<p class="muted center pad">Brak gwarancji. Dodaj sprzęt z paragonem — przyda się przy reklamacji.</p>'}</section>`;
  const qi = view.querySelector('#q');
  qi.onchange = () => go('gwarancje?q=' + encodeURIComponent(qi.value));
}

export function renderWarrantyForm(params) {
  const w = params.id ? state.warranties.find(x => x.id === params.id) : null;
  const e = params.exp ? state.expenses.find(x => x.id === params.exp) : null;
  let photoFile = null, removePhoto = false;
  const v = w || { name: '', shop: e?.title || '', bought_on: e?.spent_on || today(), months: 24, price: e ? Number(e.amount) : null, receipt_path: e?.receipt_path || null, expense_id: e?.id };
  view.innerHTML = `<form class="card" id="wf" autocomplete="off">
    <h2>${w ? 'Gwarancja' : 'Nowa gwarancja'}</h2>
    <label class="field">Co<input name="name" value="${esc(v.name)}" placeholder="Pralka Bosch, telefon…" required></label>
    <label class="field">Sklep<input name="shop" value="${esc(v.shop || '')}"></label>
    <div class="row"><label class="field">Data zakupu<input type="date" name="bought_on" value="${v.bought_on}" required></label>
      <label class="field">Cena (zł)<input name="price" inputmode="decimal" value="${v.price != null ? String(v.price).replace('.', ',') : ''}"></label></div>
    <div class="field">Okres gwarancji</div>
    ${pills('months', [['12', '1 rok'], ['24', '2 lata'], ['36', '3 lata'], ['60', '5 lat'], ['other', 'inny']], [12, 24, 36, 60].includes(v.months) ? String(v.months) : 'other')}
    <label class="field" id="mo" ${[12, 24, 36, 60].includes(v.months) ? 'hidden' : ''}>Miesięcy<input name="months" inputmode="numeric" value="${v.months}"></label>
    <p class="hint">Rękojmia sprzedawcy w Polsce to 2 lata niezależnie od gwarancji producenta.</p>
    <div class="field">Paragon / karta gwarancyjna</div>
    <div id="ph"></div>
    <div class="row"><label class="btn">${icon('camera')} Zrób zdjęcie<input type="file" accept="image/*" capture="environment" id="cam" hidden></label>
      <label class="btn">${icon('image')} Z galerii<input type="file" accept="image/*" id="gal" hidden></label></div>
    <label class="field">Notatka<input name="note" value="${esc(w?.note || '')}" placeholder="nr seryjny, gdzie karta gwarancyjna…"></label>
    <div class="row between">${w ? '<button type="button" class="btn danger" id="del">Usuń</button>' : '<span></span>'}
      <div class="row" style="margin:0"><button type="button" class="btn" id="cancel">Anuluj</button><button class="btn primary">Zapisz</button></div></div>
  </form>`;
  const f = view.querySelector('#wf');
  bindPills(f, (n, val) => { if (n === 'months') { view.querySelector('#mo').hidden = val !== 'other'; if (val !== 'other') f.months.value = val; } });
  const show = src => { view.querySelector('#ph').innerHTML = src ? `<div class="thumb"><a href="${esc(src)}" target="_blank" rel="noopener"><img src="${esc(src)}" alt=""></a>
      <button type="button" class="btn small danger" id="rm">Usuń zdjęcie</button></div>` : '';
    view.querySelector('#rm')?.addEventListener('click', () => { photoFile = null; removePhoto = true; show(null); }); };
  if (v.receipt_path) db.receiptUrl(v.receipt_path).then(show).catch(() => {});
  for (const id of ['cam', 'gal']) view.querySelector('#' + id).onchange = ev => { const file = ev.target.files[0]; if (!file) return; photoFile = file; removePhoto = false; show(URL.createObjectURL(file)); };
  view.querySelector('#cancel').onclick = () => back('gwarancje');
  view.querySelector('#del')?.addEventListener('click', () => confirm('Usunąć gwarancję?') && guard(async () => { await db.deleteWarranty(w); go('gwarancje'); }));
  f.onsubmit = ev => { ev.preventDefault(); guard(async () => {
    const months = picked(f, 'months') === 'other' ? parseInt(f.months.value) : +picked(f, 'months');
    if (!(months > 0)) throw new Error('Podaj okres gwarancji');
    const shared = !!(v.receipt_path && state.expenses.some(x => x.receipt_path === v.receipt_path));
    await db.saveWarranty({ id: w?.id, name: f.name.value.trim(), shop: f.shop.value.trim(), bought_on: f.bought_on.value, months,
      price: parseNum(f.price.value), receipt_path: v.receipt_path, expense_id: v.expense_id, note: f.note.value.trim(), shared_photo: shared }, photoFile, removePhoto);
    toast('Zapisano'); go('gwarancje');
  }); };
}

// ================================================================ SPIŻARNIA
export const PLACES = [['Lodówka', 'fridge'], ['Zamrażarka', 'snow'], ['Szafka', 'jar'], ['Chemia', 'spray'], ['Inne', 'box']];
const placeFromAisle = a => /Nabiał|Mięso/.test(a) ? 'Lodówka' : /Mrożon/.test(a) ? 'Zamrażarka' : /Chemia|Higiena/.test(a) ? 'Chemia' : /Warzywa/.test(a) ? 'Inne' : 'Szafka';
export const inPantry = name => { const k = db.nameKey(name); return state.pantry.some(p => db.nameKey(p.name) === k || k.startsWith(db.nameKey(p.name)) || db.nameKey(p.name).startsWith(k)); };
export const pantryExpiring = (days = 2) => state.pantry.filter(p => p.expires && daysTo(p.expires) <= days);
export async function boughtToPantry(items) {
  await db.savePantry(items.map(x => ({ name: x.name, qty: x.qty, place: placeFromAisle(x.aisle || '') })));
}
const expBadge = p => { if (!p.expires) return ''; const d = daysTo(p.expires);
  return `<span class="badge ${d < 0 ? 'neg' : d <= 2 ? 'wait' : ''}">${d < 0 ? 'po terminie' : d === 0 ? 'dziś' : d === 1 ? 'jutro' : 'do ' + fmtDate(p.expires)}</span>`; };

export function renderPantry(tabs) {
  const by = PLACES.map(([pl, ic]) => [pl, ic, state.pantry.filter(p => (p.place || 'Szafka') === pl)
    .sort((a, b) => (a.expires || '9999').localeCompare(b.expires || '9999') || a.name.localeCompare(b.name, 'pl'))]);
  view.innerHTML = `${tabs}${needSql()}
    <form class="addrow pantryadd" id="pf" autocomplete="off">
      <input name="name" placeholder="Dodaj do spiżarni" list="known2">
      <input name="qty" placeholder="ile">
      <select name="place">${PLACES.map(([p]) => `<option>${p}</option>`).join('')}</select>
      <button class="btn primary" aria-label="Dodaj">+</button>
      <datalist id="known2">${state.known.slice(0, 300).map(k => `<option value="${esc(k.name)}">`).join('')}</datalist>
    </form>
    ${by.filter(x => x[2].length).map(([pl, ic, items]) => `<section class="card flush"><div class="day">${icon(ic, 'ic-svg ic-inline')} ${pl}</div>
      ${items.map(p => `<div class="pitem" data-id="${p.id}"><a href="#spizarnia-edytuj?id=${p.id}" class="nm">${esc(p.name)}${p.qty ? ` <small>${esc(p.qty)}</small>` : ''}</a>
        ${expBadge(p)}<button class="btn small" data-shop aria-label="Dodaj do listy zakupów">${icon('cart')}</button><button class="btn small" data-del title="Zużyte">✓</button></div>`).join('')}
    </section>`).join('') || '<p class="muted center pad">Spiżarnia jest pusta. Dodawaj ręcznie albo przy „Wyczyść kupione” na liście zakupów.</p>'}
    <p class="hint">${icon('check', 'ic-svg ic-inline')} — zużyte (usuń), ${icon('cart', 'ic-svg ic-inline')} — dopisz do listy zakupów. Lista z menu pomija to, co jest w spiżarni.</p>`;
  const f = view.querySelector('#pf');
  f.onsubmit = e => { e.preventDefault(); const name = f.name.value.trim(); if (!name) return;
    guard(async () => { await db.savePantry({ name, qty: f.qty.value.trim(), place: f.place.value }); }); };
  view.querySelectorAll('.pitem').forEach(el => {
    const p = state.pantry.find(x => x.id === el.dataset.id);
    el.querySelector('[data-del]').onclick = () => guard(() => db.deletePantry(p.id));
    el.querySelector('[data-shop]').onclick = async () => {
      const { guessAisle } = await import('./zakupy.js');
      db.addShopItem(p.name, '', guessAisle(p.name)); toast('Dodano do listy zakupów');
    };
  });
}

export function renderPantryForm(params) {
  const p = state.pantry.find(x => x.id === params.id);
  if (!p) { go('spizarnia'); return; }
  view.innerHTML = `<form class="card" id="ef">
    <h2>W spiżarni</h2>
    <label class="field">Nazwa<input name="name" value="${esc(p.name)}" required></label>
    <label class="field">Ilość<input name="qty" value="${esc(p.qty || '')}" placeholder="2 szt, 1 kg"></label>
    <label class="field">Miejsce<select name="place" style="width:100%">${PLACES.map(([pl, ic]) => `<option value="${pl}" ${pl === p.place ? 'selected' : ''}>${pl}</option>`).join('')}</select></label>
    <label class="field">Termin ważności (opcjonalnie)<input type="date" name="expires" value="${p.expires || ''}"></label>
    <div class="row between"><button type="button" class="btn danger" id="del">Usuń</button>
      <div class="row" style="margin:0"><button type="button" class="btn" id="cancel">Anuluj</button><button class="btn primary">Zapisz</button></div></div>
  </form>`;
  const f = view.querySelector('#ef');
  view.querySelector('#cancel').onclick = () => back('spizarnia');
  view.querySelector('#del').onclick = () => guard(async () => { await db.deletePantry(p.id); go('spizarnia'); });
  f.onsubmit = e => { e.preventDefault(); guard(async () => {
    await db.savePantry({ id: p.id, name: f.name.value.trim(), qty: f.qty.value.trim(), place: f.place.value, expires: f.expires.value || null });
    toast('Zapisano'); go('spizarnia');
  }); };
}

// ================================================================ Start: „Uwaga”
export function alertsCard() {
  const exp = pantryExpiring(2), war = warrantiesEnding();
  if (!exp.length && !war.length) return '';
  return `<section class="card"><h2>Uwaga</h2>
    ${exp.map(p => `<a class="kvrow" href="#spizarnia"><span>${icon('jar', 'ic-svg ic-inline')} ${esc(p.name)}</span>${expBadge(p)}</a>`).join('')}
    ${war.map(w => `<a class="kvrow" href="#gwarancja-edytuj?id=${w.id}"><span>${icon('shield', 'ic-svg ic-inline')} ${esc(w.name)}</span>${status(w)}</a>`).join('')}
  </section>`;
}
