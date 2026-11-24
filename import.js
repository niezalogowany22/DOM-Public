// Import wyciągu z banku (konto wspólne) + kopia zapasowa
import * as db from './db.js';
import { state } from './db.js';
import { view, esc, go, toast, guard } from './ui.js';
import { fmtMoney, fmtDate, inGroupCur } from './split.js';
import { dueIn } from './budzet.js';
import { readText, parseMillennium, shopFromDesc, ruleKey, GUESS } from './bank.js';

let rows = null;   // ostatnio wczytany plik (tylko w pamięci telefonu)

// Czy transakcja to opłata cykliczna (konto wspólne)? nazwa w opisie albo kwota ±5% w miesiącu płatności
function guessRecurring(t, taken) {
  const m = t.date.slice(0, 7), amt = Math.abs(t.amount), hay = (t.party + ' ' + t.desc).toLowerCase();
  const ok = r => r.source === 'joint' && dueIn(r, m) && !taken.has(r.id + m) && !state.expenses.some(e => e.recurring_id === r.id && e.period === m);
  const near = r => Math.abs(amt - Number(r.amount)) <= Math.max(1, Number(r.amount) * 0.05);
  const named = r => hay.includes(r.title.toLowerCase());
  const r = state.recurring.find(r => ok(r) && named(r) && near(r)) || state.recurring.find(r => ok(r) && named(r));
  if (r) taken.add(r.id + m);
  return r || null;
}

function guessCategory(t) {
  const key = ruleKey(t);
  const rule = state.rules.find(r => r.pattern === key);
  if (rule) return { category_id: rule.category_id, title: rule.title };
  const hay = (t.party + ' ' + t.desc).toLowerCase().replace(/[^a-ząćęłńóśźż0-9 ]/g, '').replace(/\s+/g, '');
  for (const [cat, words] of GUESS) if (words.split(' ').some(w => hay.includes(w))) {
    const c = state.categories.find(x => x.name === cat);
    if (c) return { category_id: c.id };
  }
  return {};
}
// Wydatek wpisany ręcznie: konto wspólne, ta sama kwota, data ±3 dni
function manualTwin(t) {
  const g = db.homeGroup(); const d = new Date(t.date + 'T12:00');
  return state.expenses.find(e => e.group_id === g?.id && e.source === 'joint' && !(e.import_ref && !e.import_ref.startsWith('licz:')) && e.kind !== 'transfer'
    && Math.abs(inGroupCur(e) - Math.abs(t.amount)) < 0.01 && Math.abs(new Date(e.spent_on + 'T12:00') - d) <= 3 * 864e5);
}

export function renderImport() {
  const g = db.homeGroup();
  const people = g ? db.peopleOf(g.id) : [];
  const done = new Set([...state.expenses.map(e => e.import_ref), ...state.deposits.map(d => d.import_ref)].filter(Boolean));
  view.innerHTML = `
    <section class="card">
      <h2>Import z banku</h2>
      <p class="hint">Millenet → historia konta wspólnego → eksport <b>CSV</b>. Plik jest czytany tylko w telefonie;
        do bazy trafiają wyłącznie zaznaczone pozycje (data, kwota, nazwa). Ponowny import tego samego pliku niczego nie zdubluje.</p>
      <input type="file" id="file" accept=".csv,text/csv,text/plain">
    </section>
    <div id="out"></div>`;
  const draw = () => {
    const box = view.querySelector('#out');
    if (!rows) { box.innerHTML = ''; return; }
    const fresh = rows.filter(t => !done.has(t.ref));
    const taken = new Set();
    const recOf = new Map(fresh.filter(t => t.amount < 0).map(t => [t.ref, guessRecurring(t, taken)]));
    const skipped = rows.length - fresh.length;
    box.innerHTML = `
      <p class="hint">${rows.length} transakcji${skipped ? `, ${skipped} już zaimportowanych (pominięte)` : ''}. Odznacz to, czego nie chcesz dodawać.</p>
      <section class="card flush">${fresh.map(t => {
        const i = rows.indexOf(t);
        if (t.amount > 0) {
          const guess = people.find(p => t.party && t.party.toLowerCase().includes(p.name.toLowerCase()));
          return `<div class="imp in" data-i="${i}"><label class="check"><input type="checkbox" class="on" checked>
            <span><b>Wpłata ${fmtMoney(t.amount)}</b><small>${fmtDate(t.date)} · ${esc(t.party || t.desc)}</small></span></label>
            <select class="who"><option value="">— kto —</option>${people.map(p => `<option value="${p.id}" ${guess?.id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>`;
        }
        const gc = guessCategory(t), twin = manualTwin(t), rec = recOf.get(t.ref);
        if (rec) { gc.category_id = rec.category_id || gc.category_id; gc.title = rec.title; }
        return `<div class="imp" data-i="${i}"><label class="check"><input type="checkbox" class="on" ${twin ? '' : 'checked'}>
          <span><b>${fmtMoney(-t.amount)}</b> <input class="ttl" value="${esc(gc.title || shopFromDesc(t))}">
          <small>${fmtDate(t.date)} · ${esc(t.desc)}${twin ? ` · <span class="wait">prawdopodobnie już wpisany („${esc(twin.title || 'wydatek')}”)</span>` : ''}${rec ? ` · <span class="pos">opłata cykliczna „${esc(rec.title)}”</span>` : ''}</small></span></label>
          <select class="cat"><option value="">— kategoria —</option>${state.categories.map(c => `<option value="${c.id}" ${c.id === gc.category_id ? 'selected' : ''}>${esc(c.icon + ' ' + c.name)}</option>`).join('')}</select></div>`;
      }).join('') || '<p class="muted center pad">Nic nowego do zaimportowania.</p>'}</section>
      ${fresh.length ? `<label class="check small"><input type="checkbox" id="learn" checked> zapamiętaj kategorie dla tych sklepów</label>
        <button class="btn primary big" id="go">Importuj zaznaczone</button>` : ''}`;
    box.querySelector('#go')?.addEventListener('click', () => guard(async () => {
      const expenses = [], deposits = [], rules = new Map();
      box.querySelectorAll('.imp').forEach(el => {
        if (!el.querySelector('.on').checked) return;
        const t = rows[+el.dataset.i];
        if (t.amount > 0) deposits.push({ date: t.date, amount: t.amount, person_id: el.querySelector('.who').value || null, note: t.party || t.desc, ref: t.ref });
        else {
          const category_id = el.querySelector('.cat').value || null, title = el.querySelector('.ttl').value.trim();
          const rec = recOf.get(t.ref);
          expenses.push({ date: t.date, amount: Math.abs(t.amount), title, category_id, note: t.desc, ref: t.ref, ...(rec ? { recurring_id: rec.id, period: t.date.slice(0, 7) } : {}) });
          const k = ruleKey(t);
          if (k && category_id) rules.set(k, { pattern: k, category_id, title });
        }
      });
      if (!expenses.length && !deposits.length) throw new Error('Nic nie zaznaczono');
      await db.importBank({ expenses, deposits, rules: box.querySelector('#learn')?.checked ? [...rules.values()] : [] });
      toast(`Zaimportowano: ${expenses.length} wydatków, ${deposits.length} wpłat`);
      rows = null; go('budzet');
    }));
  };
  view.querySelector('#file').onchange = e => guard(async () => {
    const f = e.target.files[0]; if (!f) return;
    rows = parseMillennium(await readText(f)).sort((a, b) => b.date.localeCompare(a.date));
    draw();
  });
  draw();
}

// ------------------------------------------------------------- kopia zapasowa (Więcej)
export function backupCard() {
  return `<section class="card">
    <h2>Kopia zapasowa</h2>
    <p class="hint">Darmowy Supabase nie robi kopii. Pobierz plik raz na jakiś czas i trzymaj np. na Dysku Google.
      Zawiera wydatki, wyjazdy, listę, karty, przepisy, menu, budżet (bez zdjęć). Liczniki mają własną kopię w Liczniki → Opcje.</p>
    <div class="row"><button class="btn" id="bkDown">Pobierz kopię (JSON)</button>
      <label class="btn">Przywróć z pliku<input type="file" id="bkFile" accept=".json,application/json" hidden></label></div>
  </section>`;
}
export function bindBackup() {
  view.querySelector('#bkDown')?.addEventListener('click', () => guard(async () => {
    const data = await db.backupAll();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    a.download = `dom-kopia-${new Date().toLocaleDateString('sv-SE')}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }));
  view.querySelector('#bkFile')?.addEventListener('change', e => guard(async () => {
    const f = e.target.files[0]; if (!f) return;
    const data = JSON.parse(await f.text());
    if (!confirm('Przywrócić dane z kopii? Istniejące wpisy nie zostaną nadpisane — dojdą tylko brakujące.')) return;
    const n = await db.restoreAll(data);
    toast(`Przywrócono ${n} wpisów`);
  }));
}
