import * as db from './l-db.js';
import { state } from './l-db.js';
import { KINDS, TARIFF_GROUPS, TARIFF_FIELDS, MEDIA, addMonths, monthsDiff, monthLabel, currentMonth,
         buildMonths, consumptionByMonth, periodBalance, validateReading, missingStatus,
         fmtNum, fmtZl, tariffFor, monthFrom } from './calc.js';
import { readLicznikiFile, exportXlsx, backupJson, readBackup } from './xlsx.js';
import { renderCharts, renderBills, renderExpenses, renderExpenseForm, renderPrices, subnav } from './extras.js';

const view = document.getElementById('view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const parseNum = s => { const t = String(s ?? '').trim().replace(/\s/g, '').replace(',', '.'); return t === '' ? null : Number(t); };
const toMonth = v => v ? v + '-01' : null;            // <input type=month> → YYYY-MM-01
const fromMonth = m => m ? m.slice(0, 7) : '';
const sign = v => v == null ? '' : v > 0.005 ? 'pos' : v < -0.005 ? 'neg' : '';
const fmtDiff = v => v == null ? '—' : (v > 0 ? '+' : '') + fmtZl(v);

function toast(msg, err = false) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(t._h); t._h = setTimeout(() => t.className = 'toast', err ? 5000 : 2500);
}
async function guard(fn) {
  try { await fn(); } catch (e) { console.error(e); toast(e.message || String(e), true); }
}

// ------------------------------------------------------------- routing (w ramach aplikacji Dom: #l-<ekran>)
const FORM_ROUTES = new Set(['odczyt', 'stawka', 'okres', 'wydatek']);
function route() {
  const [full, qs] = (location.hash.slice(1) || '').split('?');
  return { name: full.startsWith('l-') ? full.slice(2) : '', params: Object.fromEntries(new URLSearchParams(qs || '')) };
}
import { go } from './ui.js';
db.onChange(() => { updateStatus(); const r = route(); if (r.name && !FORM_ROUTES.has(r.name)) render(); });

function updateStatus() {
  const el = document.getElementById('sync');
  if (!el || !route().name) return;
  const q = db.queue().length;
  el.className = 'sync ' + (!state.online ? 'off' : q || state.syncing ? 'wait' : 'ok');
  el.textContent = !state.online ? (q ? `offline · ${q} do wysłania` : 'offline') : (q ? `wysyłanie ${q}…` : '');
}

const SECTION = { odczyt: 'odczyty', stawki: 'wiecej', stawka: 'wiecej', okres: 'rozliczenia', ceny: 'wiecej',
                  wykresy: 'koszty', rachunki: 'koszty', wydatki: 'koszty', wydatek: 'koszty' };
const lnav = name => { const act = SECTION[name] || name;
  return `<div class="subnav lnav">${[['start', 'Przegląd'], ['odczyty', 'Odczyty'], ['koszty', 'Koszty'], ['rozliczenia', 'Rozliczenia'], ['wiecej', 'Opcje']]
    .map(([r, l]) => `<a href="#l-${r}" class="${r === act ? 'on' : ''}">${l}</a>`).join('')}</div>`; };

const SCREENS = {
  start: renderStart, odczyty: renderReadings, odczyt: renderReadingForm, koszty: renderCosts,
  rozliczenia: renderPeriods, okres: renderPeriodForm, stawki: renderTariffs, stawka: renderTariffForm,
  wiecej: renderMore,
  wykresy: p => renderCharts(view, p), rachunki: p => renderBills(view, p), wydatki: p => renderExpenses(view, p), wydatek: p => renderExpenseForm(view, p), ceny: () => renderPrices(view),
};
function render() {
  const { name, params } = route();
  if (!name) return;
  if (!state.household) { view.innerHTML = lnav(name) + '<p class="muted center">Ładowanie…</p>'; return; }
  const fn = SCREENS[name] || renderStart;
  const y = window.scrollY;
  view.innerHTML = '';
  fn(params);
  view.insertAdjacentHTML('afterbegin', lnav(name));
  if (!FORM_ROUTES.has(name)) window.scrollTo(0, y);
  updateStatus();
}

// ------------------------------------------------------------- START
function renderStart() {
  const today = currentMonth();
  const status = missingStatus(state.readings, today);
  const rows = buildMonths(state.readings, state.tariffs, addMonths(today, -14), addMonths(today, -1), state.expenses);
  const lastComplete = [...rows].reverse().find(r => r.complete);
  const active = state.periods.filter(p => p.start_month <= today && addMonths(p.end_month, 1) >= today);

  view.innerHTML = `
    <a class="btn primary big" href="#l-odczyt">+ Dodaj odczyt</a>
    <section class="card">
      <h2>Stan odczytów</h2>
      <ul class="status">
        ${status.map(s => {
          const k = KINDS[s.kind];
          const badge = s.last == null ? '<span class="badge neg">brak</span>'
            : s.missing === 0 ? '<span class="badge pos">aktualne</span>'
            : s.kind === 'prad' ? `<span class="badge wait">czeka na rachunek · ${s.missing} mc</span>`
            : `<span class="badge wait">brak ${s.missing} mc</span>`;
          return `<li><b>${k.label}</b><span class="muted">${s.last ? 'ostatni: za ' + monthLabel(s.last) : 'brak odczytów'}</span>${badge}</li>`;
        }).join('')}
      </ul>
    </section>
    ${active.map(p => periodCard(p, true)).join('')}
    ${lastComplete ? `
    <section class="card">
      <h2>Ostatni pełny miesiąc: ${monthLabel(lastComplete.month)}</h2>
      <dl class="kv">
        <dt>Czynsz wg zużycia</dt><dd>${fmtZl(lastComplete.czynsz)}</dd>
        <dt>Zaliczka w czynszu</dt><dd>${fmtZl(lastComplete.zaliczka)}</dd>
        <dt>Różnica</dt><dd class="${sign(lastComplete.roznica)}">${fmtDiff(lastComplete.roznica)}</dd>
        <dt>Prąd</dt><dd>${lastComplete.prad == null ? '<span class="muted">czeka na rachunek</span>' : fmtZl(lastComplete.prad)}</dd>
      </dl>
      <a class="link" href="#l-koszty">Wszystkie koszty →</a>
    </section>` : ''}
    ${!state.tariffs.length ? `<section class="card warn"><b>Brak stawek.</b> Dodaj stawki albo zaimportuj plik z Excela w zakładce <a href="#l-wiecej">Więcej</a>.</section>` : ''}
  `;
}

// ------------------------------------------------------------- ODCZYTY (lista)
function renderReadings(params) {
  const all = [...new Set(state.readings.map(r => r.month))].sort().reverse();
  const years = [...new Set(all.map(m => m.slice(0, 4)))];
  const year = params.y && years.includes(params.y) ? params.y : years[0];
  const months = all.filter(m => m.slice(0, 4) === year);
  const get = (k, m) => state.readings.find(r => r.kind === k && r.month === m);
  view.innerHTML = `
    <a class="btn primary big" href="#l-odczyt">+ Dodaj odczyt</a>
    ${years.length > 1 ? `<div class="subnav">${years.map(y => `<a href="#l-odczyty?y=${y}" class="${y === year ? 'on' : ''}">${y}</a>`).join('')}</div>` : ''}
    <section class="card flush">
      <table class="readings">
        <thead><tr><th>Za miesiąc</th>${Object.values(KINDS).map(k => `<th>${k.label}<small>${k.unit}</small></th>`).join('')}</tr></thead>
        <tbody>
        ${months.map(m => {
          const who = [...new Set(Object.keys(KINDS).map(k => get(k, m)?.created_by).filter(Boolean))].map(db.memberName).filter(Boolean).join(', ');
          return `<tr data-m="${m}"><td>${monthLabel(m)}${who ? `<small>${esc(who)}</small>` : ''}</td>
            ${Object.keys(KINDS).map(k => { const r = get(k, m);
              return `<td class="${r?._pending ? 'pending' : ''}">${r ? fmtNum(r.value, KINDS[k].decimals) + (r.swap_old_final != null ? ' <span title="wymiana licznika">⇄</span>' : '') : '<span class="muted">—</span>'}</td>`; }).join('')}
          </tr>`; }).join('') || `<tr><td colspan="5" class="muted center">Brak odczytów. Dodaj pierwszy albo zaimportuj plik z Excela (Więcej → Import).</td></tr>`}
        </tbody>
      </table>
    </section>`;
  view.querySelectorAll('tr[data-m]').forEach(tr => tr.onclick = () => go('l-odczyt?m=' + tr.dataset.m));
}

// ------------------------------------------------------------- ODCZYT (formularz)
function renderReadingForm(params) {
  const month = params.m || addMonths(currentMonth(), -1);
  const existing = k => state.readings.find(r => r.kind === k && r.month === month);
  const prevOf = k => state.readings.filter(r => r.kind === k && r.month < month).sort((a, b) => a.month < b.month ? 1 : -1)[0];
  const anyExisting = Object.keys(KINDS).some(existing);

  view.innerHTML = `
    <form class="card" id="rf" autocomplete="off">
      <h2>${anyExisting ? 'Edycja odczytu' : 'Nowy odczyt'}</h2>
      <label class="field">Odczyt za miesiąc
        <input type="month" name="month" value="${fromMonth(month)}" required>
      </label>
      <p class="hint">Stan licznika na koniec tego miesiąca (odczyt z początku następnego). Wypełnij tylko te liczniki, które masz.</p>
      ${Object.entries(KINDS).map(([k, K]) => {
        const e = existing(k), p = prevOf(k);
        return `<fieldset data-kind="${k}">
          <legend>${K.label} <small>[${K.unit}]</small></legend>
          <input name="v_${k}" inputmode="decimal" placeholder="${p ? fmtNum(p.value, K.decimals) : 'stan licznika'}" value="${e ? String(e.value).replace('.', ',') : ''}">
          <div class="hint">${p ? `poprzedni: <b>${fmtNum(p.value, K.decimals)}</b> za ${monthLabel(p.month)}` : 'pierwszy odczyt — zużycie policzy się od następnego'}
            <span class="live" data-live="${k}"></span></div>
          ${k === 'prad' ? `<label class="field small">Kwota z rachunku (opcjonalnie, zł)
            <input name="bill" inputmode="decimal" value="${e?.bill_amount != null ? String(e.bill_amount).replace('.', ',') : ''}"></label>` : ''}
          <details ${e?.swap_old_final != null ? 'open' : ''}><summary>Wymiana licznika</summary>
            <label class="field small">Ostatni stan starego licznika<input name="so_${k}" inputmode="decimal" value="${e?.swap_old_final ?? ''}"></label>
            <label class="field small">Stan początkowy nowego licznika<input name="sn_${k}" inputmode="decimal" value="${e?.swap_new_start ?? ''}"></label>
          </details>
          ${e ? `<div class="hint">wpisał(a): ${esc(db.memberName(e.created_by)) || '—'}${e._pending ? ' · <b>czeka na wysłanie</b>' : ''}</div>` : ''}
        </fieldset>`; }).join('')}
      <label class="field">Data odczytu (opcjonalnie)<input type="date" name="read_on" value="${Object.keys(KINDS).map(existing).find(Boolean)?.read_on || ''}"></label>
      <label class="field">Uwagi<input name="note" value="${esc(Object.keys(KINDS).map(existing).find(e => e?.note && !e.note.startsWith('import'))?.note || '')}"></label>
      <div class="warnings" id="warn"></div>
      <div class="row">
        <a class="btn" href="#l-odczyty">Anuluj</a>
        <button class="btn primary" type="submit" id="save">Zapisz</button>
      </div>
    </form>`;

  const f = view.querySelector('#rf');
  f.month.onchange = () => { if (f.month.value) go('l-odczyt?m=' + toMonth(f.month.value)); };

  const swapOf = k => { const o = parseNum(f['so_' + k].value), n = parseNum(f['sn_' + k].value);
    return o != null && n != null ? { old_final: o, new_start: n } : null; };
  const live = () => {
    for (const k of Object.keys(KINDS)) {
      const el = view.querySelector(`[data-live="${k}"]`); const v = parseNum(f['v_' + k].value); const p = prevOf(k);
      if (v == null || !p || isNaN(v)) { el.textContent = ''; continue; }
      const sw = swapOf(k);
      let d = sw ? (sw.old_final - p.value) + (v - sw.new_start) : v - p.value;
      const span = monthsDiff(p.month, month);
      el.innerHTML = ` → zużycie <b>${fmtNum(d, KINDS[k].decimals)} ${KINDS[k].unit}</b>` + (span > 1 ? ` <span class="muted">(rozłożone na ${span} mies.)</span>` : '');
    }
    confirmed = false; view.querySelector('#save').textContent = 'Zapisz'; view.querySelector('#warn').innerHTML = '';
  };
  let confirmed = false;
  f.addEventListener('input', live); live();

  f.onsubmit = ev => {
    ev.preventDefault();
    const m = toMonth(f.month.value);
    const ops = [], warns = [], errors = [];
    for (const k of Object.keys(KINDS)) {
      const raw = f['v_' + k].value.trim(); const v = parseNum(raw); const e = existing(k);
      if (raw === '') { if (e) ops.push({ del: k }); continue; }
      if (isNaN(v)) { errors.push(`${KINDS[k].label}: nieprawidłowa liczba`); continue; }
      const sw = swapOf(k);
      if ((f['so_' + k].value || f['sn_' + k].value) && !sw) errors.push(`${KINDS[k].label}: przy wymianie podaj oba stany`);
      const bill = k === 'prad' ? parseNum(f.bill.value) : null;
      warns.push(...validateReading(state.readings, k, m, v, sw).map(w => `${KINDS[k].label}: ${w}`));
      ops.push({ row: { kind: k, month: m, value: v, read_on: f.read_on.value || null, note: f.note.value.trim() || null,
        bill_amount: bill, swap_old_final: sw?.old_final ?? null, swap_new_start: sw?.new_start ?? null, created_by: e?.created_by } });
    }
    const warnEl = view.querySelector('#warn');
    if (errors.length) { warnEl.innerHTML = errors.map(w => `<p class="err">${esc(w)}</p>`).join(''); return; }
    if (!ops.length) { warnEl.innerHTML = '<p class="err">Wpisz przynajmniej jeden stan licznika.</p>'; return; }
    const dels = ops.filter(o => o.del);
    if (dels.length && !confirmed) warns.push(`Usunięte zostaną odczyty: ${dels.map(o => KINDS[o.del].label).join(', ')}.`);
    if (warns.length && !confirmed) {
      warnEl.innerHTML = warns.map(w => `<p>${esc(w)}</p>`).join('');
      confirmed = true; view.querySelector('#save').textContent = 'Zapisz mimo to'; return;
    }
    for (const o of ops) o.del ? db.deleteReading(o.del, m) : db.saveReading(o.row);
    toast(state.online ? 'Zapisano' : 'Zapisano w telefonie — wyśle się po odzyskaniu sieci');
    go('l-start');
  };
}

// ------------------------------------------------------------- KOSZTY
function renderCosts(params) {
  const months = state.readings.map(r => r.month);
  const years = [...new Set(months.map(m => +m.slice(0, 4)))];
  const cy = +currentMonth().slice(0, 4);
  if (!years.includes(cy)) years.push(cy);
  years.sort((a, b) => b - a);
  const year = +(params.y || (months.length ? Math.min(cy, Math.max(...months.map(m => +m.slice(0, 4)))) : cy));
  const from = `${year}-01-01`, to = `${year}-12-01`;
  const rows = buildMonths(state.readings, state.tariffs, from, to, state.expenses);
  const prev = buildMonths(state.readings, state.tariffs, `${year - 1}-01-01`, `${year - 1}-12-01`, state.expenses);
  const shown = rows.filter(r => r.complete || r.prad != null || Object.values(r.use).some(v => v != null));
  const sum = (arr, k) => arr.reduce((s, r) => s + (r[k] ?? 0), 0);
  const useSum = (arr, k) => arr.reduce((s, r) => s + (r.use[k] ?? 0), 0);
  const full = rows.filter(r => r.complete);
  const fullPrev = prev.filter(r => full.some(f => f.month.slice(5) === r.month.slice(5)) && r.complete);

  view.innerHTML = `
    ${subnav('koszty', year)}
    <div class="row between">
      <select id="year">${years.map(y => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select>
      <span class="muted">${full.length} pełnych mies.</span>
    </div>
    <section class="card">
      <h2>Podsumowanie ${year}</h2>
      <dl class="kv">
        <dt>Media (ZW+CW+CO+śmieci)</dt><dd>${fmtZl(sum(full, 'media'))}</dd>
        <dt>Prąd</dt><dd>${fmtZl(sum(rows, 'prad'))}</dd>
        ${sum(rows, 'wydatki') ? `<dt>Wydatki jednorazowe</dt><dd>${fmtZl(sum(rows, 'wydatki'))}</dd>` : ''}
        <dt>Różnica do zaliczki</dt><dd class="${sign(sum(full, 'roznica'))}">${fmtDiff(sum(full, 'roznica'))}</dd>
      </dl>
      ${fullPrev.length ? `<h3>Zużycie vs ${year - 1} <small class="muted">(te same miesiące)</small></h3>
      <dl class="kv">${Object.entries(KINDS).map(([k, K]) => {
        const a = useSum(full, k), b = useSum(fullPrev, k); const pct = b ? (a - b) / b * 100 : null;
        return `<dt>${K.label}</dt><dd>${fmtNum(a, 1)} ${K.unit} <small class="${pct > 0 ? 'neg' : 'pos'}">${pct == null ? '' : (pct > 0 ? '+' : '') + pct.toFixed(0) + '%'}</small></dd>`; }).join('')}</dl>` : ''}
    </section>
    ${shown.length ? '' : '<p class="muted center">Brak danych za ten rok.</p>'}
    ${[...shown].reverse().map(r => monthCard(r, prev.find(p => p.month.slice(5) === r.month.slice(5)))).join('')}
  `;
  view.querySelector('#year').onchange = e => go('l-koszty?y=' + e.target.value);
}

function monthCard(r, ly) {
  const line = (label, use, unit, cost, k) => `<tr><td>${label}</td><td>${use == null ? '<span class="muted">brak odczytu</span>' : fmtNum(use, k === 'prad' ? 0 : 3) + ' ' + unit}
    ${ly && ly.use[k] != null && use != null ? `<small class="muted">(${fmtNum(ly.use[k], k === 'prad' ? 0 : 3)} rok temu)</small>` : ''}</td><td>${fmtZl(cost)}</td></tr>`;
  const billDiff = r.pradBill != null && r.prad != null ? r.pradBill / (r.pradSpan || 1) - r.prad : null;
  return `<details class="card month">
    <summary><b>${monthLabel(r.month)}</b>
      <span>${r.complete ? `czynsz ${fmtZl(r.czynsz)}` : '<span class="muted">niepełne</span>'}</span>
      <span class="${sign(r.roznica)}">${r.roznica == null ? '' : fmtDiff(r.roznica)}</span></summary>
    ${!r.tariff ? '<p class="warn">Brak stawek dla tego miesiąca.</p>' : `
    <table class="costs">
      ${line('Prąd', r.use.prad, 'kWh', r.prad, 'prad')}
      ${r.pradSpan > 1 ? `<tr><td></td><td colspan="2" class="muted">rachunek za ${r.pradSpan} mies. — zużycie podzielone po równo</td></tr>` : ''}
      ${billDiff != null ? `<tr><td></td><td colspan="2" class="${Math.abs(billDiff) > 2 ? 'neg' : 'muted'}">wg rachunku ${fmtZl(r.pradBill / (r.pradSpan || 1))}/mc (różnica ${fmtDiff(billDiff)})</td></tr>` : ''}
      ${line('Woda zimna', r.use.zw, 'm³', r.zw, 'zw')}
      ${line('Woda ciepła', r.use.cw, 'm³', r.cw, 'cw')}
      ${line('CO', r.use.co, 'GJ', r.co, 'co')}
      <tr><td>Śmieci</td><td></td><td>${fmtZl(r.smieci)}</td></tr>
      <tr class="sub"><td>Media razem</td><td></td><td>${fmtZl(r.media)}</td></tr>
      <tr><td>Opłaty stałe</td><td></td><td>${fmtZl(r.stale)}</td></tr>
      ${r.customIn.map(c => `<tr><td class="indent">w tym: ${esc(c.label)}</td><td></td><td class="muted">${fmtZl(+c.amount)}</td></tr>`).join('')}
      <tr class="sub"><td>Czynsz wg zużycia</td><td></td><td>${fmtZl(r.czynsz)}</td></tr>
      <tr><td>Zaliczka w czynszu</td><td></td><td>${fmtZl(r.zaliczka)}</td></tr>
      <tr class="sub"><td>Różnica</td><td></td><td class="${sign(r.roznica)}">${fmtDiff(r.roznica)}</td></tr>
      <tr><td>Internet</td><td></td><td>${fmtZl(r.internet)}</td></tr>
      <tr><td>Wynajem</td><td></td><td>${fmtZl(r.wynajem)}</td></tr>
      ${r.customOut.map(c => `<tr><td>${esc(c.label)}</td><td></td><td>${fmtZl(+c.amount)}</td></tr>`).join('')}
      ${r.wydatkiList.map(e => `<tr><td>${esc(e.name)}</td><td class="muted"><small>wydatek</small></td><td>${fmtZl(+e.amount)}</td></tr>`).join('')}
      <tr class="sub"><td>Koszty mieszkania</td><td></td><td>${fmtZl(r.koszty)}</td></tr>
      <tr><td>Płacona suma</td><td class="muted"><small>czynsz + prąd + internet + wynajem${r.inne || r.wydatki ? ' + inne' : ''}</small></td><td>${fmtZl(r.placone)}</td></tr>
    </table>`}
  </details>`;
}

// ------------------------------------------------------------- ROZLICZENIA
function periodCard(p, compact = false) {
  const b = periodBalance(p, state.readings, state.tariffs);
  const actualDiff = p.actual_amount != null ? p.actual_amount - b.forecast : null;
  return `<section class="card period" data-id="${p.id}">
    <h2>${esc(p.name)} <small class="muted">${monthLabel(p.start_month, true)} – ${monthLabel(p.end_month, true)}</small></h2>
    <p class="muted small">${p.media.map(m => MEDIA[m]).join(', ')}</p>
    <dl class="kv">
      <dt>Bilans do teraz <small>(${b.done}/${b.total} mies.)</small></dt><dd class="${sign(b.balance)}">${fmtDiff(b.balance)}</dd>
      ${b.estimated ? `<dt>Prognoza na koniec</dt><dd class="${sign(b.forecast)}">${fmtDiff(b.forecast)}</dd>` : ''}
      ${p.actual_amount != null ? `<dt>Faktyczne rozliczenie</dt><dd class="${sign(+p.actual_amount)}">${fmtDiff(+p.actual_amount)}</dd>
        <dt>Trafność wyliczeń</dt><dd>${fmtDiff(actualDiff)}</dd>` : ''}
    </dl>
    <p class="hint">${b.balance >= 0 ? 'Plus = nadpłata (zwrot od spółdzielni).' : 'Minus = niedopłata (do dopłaty).'}</p>
    ${compact ? '' : `<a class="link" href="#l-okres?id=${p.id}">Edytuj</a>`}
  </section>`;
}

function renderPeriods() {
  const ps = [...state.periods].sort((a, b) => a.start_month < b.start_month ? 1 : -1);
  view.innerHTML = `
    <a class="btn primary big" href="#l-okres">+ Nowy okres rozliczeniowy</a>
    ${ps.map(p => periodCard(p)).join('') || `<section class="card"><p>Dodaj okresy, w jakich spółdzielnia rozlicza media
      (np. woda co pół roku, CO wg sezonu grzewczego). Bilans liczy się osobno dla każdego okresu.</p></section>`}`;
}

function renderPeriodForm(params) {
  const p = state.periods.find(x => x.id === params.id);
  const y = currentMonth().slice(0, 4);
  view.innerHTML = `
    <form class="card" id="pf">
      <h2>${p ? 'Edycja okresu' : 'Nowy okres rozliczeniowy'}</h2>
      <label class="field">Nazwa<input name="name" required value="${esc(p?.name || 'Rozliczenie ' + y)}"></label>
      <div class="row">
        <label class="field">Od miesiąca<input type="month" name="start" required value="${fromMonth(p?.start_month || y + '-01-01')}"></label>
        <label class="field">Do miesiąca<input type="month" name="end" required value="${fromMonth(p?.end_month || y + '-12-01')}"></label>
      </div>
      <fieldset><legend>Media w tym rozliczeniu</legend>
        ${Object.entries(MEDIA).map(([k, l]) => `<label class="check"><input type="checkbox" name="media" value="${k}" ${!p || p.media.includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}
      </fieldset>
      <label class="field">Faktyczne rozliczenie ze spółdzielni (zł)
        <input name="actual" inputmode="decimal" placeholder="+ zwrot, − dopłata" value="${p?.actual_amount != null ? String(p.actual_amount).replace('.', ',') : ''}"></label>
      <label class="field">Uwagi<input name="note" value="${esc(p?.note || '')}"></label>
      <div class="row">
        ${p ? '<button type="button" class="btn danger" id="del">Usuń</button>' : ''}
        <a class="btn" href="#l-rozliczenia">Anuluj</a>
        <button class="btn primary">Zapisz</button>
      </div>
    </form>`;
  const f = view.querySelector('#pf');
  f.onsubmit = ev => { ev.preventDefault(); guard(async () => {
    const media = [...f.querySelectorAll('[name=media]:checked')].map(c => c.value);
    if (!media.length) throw new Error('Wybierz przynajmniej jedno medium');
    if (f.end.value < f.start.value) throw new Error('Koniec okresu przed początkiem');
    const actual = parseNum(f.actual.value);
    await db.savePeriod({ id: p?.id, name: f.name.value.trim(), media, start_month: toMonth(f.start.value),
      end_month: toMonth(f.end.value), actual_amount: actual, note: f.note.value.trim() || null });
    toast('Zapisano'); go('l-rozliczenia');
  }); };
  const del = view.querySelector('#del');
  if (del) del.onclick = () => confirm('Usunąć ten okres?') && guard(async () => { await db.deletePeriod(p.id); go('l-rozliczenia'); });
}

// ------------------------------------------------------------- STAWKI
function renderTariffs() {
  const vs = [...state.tariffs].sort((a, b) => a.valid_from < b.valid_from ? -1 : 1);
  const cards = vs.map((t, i) => {
    const prev = vs[i - 1];
    const changes = prev ? TARIFF_FIELDS.filter(f => +(t.vals[f.key] ?? 0) !== +(prev.vals[f.key] ?? 0)) : [];
    const cOld = Object.fromEntries((prev?.vals.custom || []).map(c => [c.label, c]));
    const cNew = Object.fromEntries((t.vals.custom || []).map(c => [c.label, c]));
    const cChanges = prev ? [...new Set([...Object.keys(cOld), ...Object.keys(cNew)])].filter(k => +(cOld[k]?.amount ?? NaN) !== +(cNew[k]?.amount ?? NaN))
      .map(k => !cOld[k] ? `<li>nowa pozycja: <b>${esc(k)}</b> ${fmtNum(cNew[k].amount, 2)} zł/mc</li>`
        : !cNew[k] ? `<li>usunięto: <s>${esc(k)}</s></li>`
        : `<li>${esc(k)}: <s>${fmtNum(cOld[k].amount, 2)}</s> → <b>${fmtNum(cNew[k].amount, 2)}</b> zł/mc</li>`) : [];
    return `<section class="card" >
      <h2>Od ${monthFrom(t.valid_from)} ${i === vs.length - 1 ? '<span class="badge pos">aktualne</span>' : ''}</h2>
      ${prev ? (changes.length || cChanges.length ? `<ul class="changes">${changes.map(f => `<li>${f.label}: <s>${fmtNum(prev.vals[f.key], 5)}</s> → <b>${fmtNum(t.vals[f.key], 5)}</b> ${f.unit}</li>`).join('')}${cChanges.join('')}</ul>`
        : '<p class="muted">bez zmian względem poprzedniej wersji</p>') : '<p class="muted">wersja początkowa</p>'}
      ${t.note ? `<p class="hint">${esc(t.note)}</p>` : ''}
      <a class="link" href="#l-stawka?id=${t.id}">Pokaż / popraw</a>
    </section>`;
  }).reverse();
  view.innerHTML = `
    <a class="btn primary big" href="#l-stawka">+ Nowe stawki od…</a>
    ${vs.length > 1 ? '<a class="btn big" href="#l-ceny">Jak zmieniały się ceny →</a>' : ''}
    <p class="hint">Gdy zmienia się cena, dodaj nową wersję z datą obowiązywania. Starsze miesiące liczą się dalej po starych stawkach.
      „Popraw” służy tylko do poprawiania pomyłek.</p>
    ${cards.join('') || '<section class="card"><p>Brak stawek.</p></section>'}`;
}

function renderTariffForm(params) {
  const t = state.tariffs.find(x => x.id === params.id);
  const base = t?.vals || tariffFor(state.tariffs, '9999-12-01') || {};
  const vf = t?.valid_from || currentMonth();
  view.innerHTML = `
    <form class="card" id="tf">
      <h2>${t ? 'Popraw stawki' : 'Nowe stawki'}</h2>
      <label class="field">Obowiązują od miesiąca<input type="month" name="valid_from" required value="${fromMonth(vf)}"></label>
      ${!t ? '<p class="hint">Pola są wypełnione aktualnymi stawkami — zmień tylko to, co się zmieniło.</p>' : ''}
      ${TARIFF_GROUPS.map(g => `<fieldset><legend>${g.label}</legend>
        ${g.fields.map(f => `<label class="field inline"><span>${f.label} <small>${f.unit}</small></span>
          <input name="${f.key}" inputmode="decimal" value="${String(base[f.key] ?? f.def ?? '').replace('.', ',')}" data-orig="${base[f.key] ?? ''}"></label>`).join('')}
      </fieldset>`).join('')}
      <fieldset id="custom"><legend>Własne pozycje</legend>
        <p class="hint">Dodatkowe stałe opłaty miesięczne, których nie ma na liście. Pozycja „w czynszu” wlicza się do opłat stałych i zaliczki,
          „poza czynszem” — do kosztów mieszkania, jak internet. Żeby pozycja przestała obowiązywać, dodaj nowe stawki bez niej.</p>
        <div id="crows">${(base.custom || []).map(customRow).join('')}</div>
        <button type="button" class="btn small" id="cadd">+ Dodaj pozycję</button>
      </fieldset>
      <label class="field">Uwagi (np. „pismo ze spółdzielni z 12.03”)<input name="note" value="${esc(t?.note || '')}"></label>
      <div class="row">
        ${t ? '<button type="button" class="btn danger" id="del">Usuń wersję</button>' : ''}
        <a class="btn" href="#l-stawki">Anuluj</a>
        <button class="btn primary">Zapisz</button>
      </div>
    </form>`;
  const f = view.querySelector('#tf');
  const crows = view.querySelector('#crows');
  view.querySelector('#cadd').onclick = () => { crows.insertAdjacentHTML('beforeend', customRow({ in_czynsz: true })); crows.lastElementChild.querySelector('input').focus(); };
  crows.addEventListener('click', e => { if (e.target.closest('.cdel')) e.target.closest('.crow').remove(); });
  if (!t) f.addEventListener('input', e => { if (e.target.dataset.orig !== undefined)
    e.target.classList.toggle('changed', String(parseNum(e.target.value)) !== String(+e.target.dataset.orig)); });
  f.onsubmit = ev => { ev.preventDefault(); guard(async () => {
    const vals = {};
    for (const fd of TARIFF_FIELDS) {
      const v = parseNum(f[fd.key].value);
      if (v != null && isNaN(v)) throw new Error(`${fd.label}: nieprawidłowa liczba`);
      vals[fd.key] = v ?? 0;
    }
    vals.custom = [...crows.querySelectorAll('.crow')].map(row => {
      const label = row.querySelector('[name=c_label]').value.trim();
      const amount = parseNum(row.querySelector('[name=c_amount]').value);
      if (!label && amount == null) return null;
      if (!label) throw new Error('Własna pozycja: podaj nazwę');
      if (amount == null || isNaN(amount)) throw new Error(`${label}: nieprawidłowa kwota`);
      return { label, amount, in_czynsz: row.querySelector('[name=c_where]').value === 'czynsz' };
    }).filter(Boolean);
    const valid_from = toMonth(f.valid_from.value);
    const clash = state.tariffs.find(x => x.valid_from === valid_from && x.id !== t?.id);
    if (clash) throw new Error(`Wersja od ${monthFrom(valid_from)} już istnieje — popraw ją zamiast dodawać nową.`);
    await db.saveTariff({ id: t?.id, valid_from, vals, note: f.note.value.trim() || null });
    const moved = await propagateCustom(valid_from, vals.custom);
    if (moved) toast(`Własne pozycje przeniesiono też do ${moved} późniejszych wersji stawek`);
    toast('Zapisano stawki'); go('l-stawki');
  }); };
  const del = view.querySelector('#del');
  if (del) del.onclick = () => confirm('Usunąć tę wersję stawek?') && guard(async () => { await db.deleteTariff(t.id); go('l-stawki'); });
}

// Zmiana własnych pozycji w wersji stawek obowiązuje też w późniejszych wersjach,
// o ile tam dana pozycja nie została ustawiona inaczej (porównanie z wersją poprzedzającą).
async function propagateCustom(validFrom, custom) {
  const vs = [...state.tariffs].sort((a, b) => a.valid_from < b.valid_from ? -1 : 1);
  const prev = [...vs].reverse().find(v => v.valid_from < validFrom);
  const base = Object.fromEntries((prev?.vals.custom || []).map(c => [c.label, c]));
  const now = Object.fromEntries((custom || []).map(c => [c.label, c]));
  const same = (a, b) => (!a && !b) || (a && b && +a.amount === +b.amount && !!a.in_czynsz === !!b.in_czynsz);
  const changed = [...new Set([...Object.keys(base), ...Object.keys(now)])].filter(k => !same(base[k], now[k]));
  if (!changed.length) return 0;
  let n = 0;
  for (const v of vs.filter(v => v.valid_from > validFrom)) {
    const cur = Object.fromEntries((v.vals.custom || []).map(c => [c.label, c]));
    let touched = false;
    for (const k of changed) {
      if (!same(cur[k], base[k]) || same(cur[k], now[k])) continue;   // tam ustawiono inaczej albo już jest
      if (now[k]) cur[k] = { ...now[k] }; else delete cur[k];
      touched = true;
    }
    if (touched) { await db.saveTariff({ id: v.id, valid_from: v.valid_from, vals: { ...v.vals, custom: Object.values(cur) }, note: v.note }); n++; }
  }
  return n;
}

function customRow(c) {
  return `<div class="crow">
    <input name="c_label" placeholder="nazwa, np. monitoring" value="${esc(c.label || '')}">
    <input name="c_amount" inputmode="decimal" placeholder="zł/mc" value="${c.amount != null ? String(c.amount).replace('.', ',') : ''}">
    <select name="c_where"><option value="czynsz" ${c.in_czynsz ? 'selected' : ''}>w czynszu</option><option value="poza" ${c.in_czynsz ? '' : 'selected'}>poza czynszem</option></select>
    <button type="button" class="btn small danger cdel" title="Usuń">✕</button>
  </div>`;
}

// ------------------------------------------------------------- WIĘCEJ
function renderMore() {
  const h = state.household;
  const me = state.members.find(m => m.user_id === state.user?.id);
  const years = [...new Set(state.readings.map(r => r.month.slice(0, 4)))].sort().reverse();
  view.innerHTML = `
    <section class="card">
      <h2>Stawki</h2>
      <p class="muted">${state.tariffs.length} wersji · aktualne od ${state.tariffs.length ? monthFrom([...state.tariffs].sort((a, b) => a.valid_from < b.valid_from ? 1 : -1)[0].valid_from) : '—'}</p>
      <a class="btn" href="#l-stawki">Zarządzaj stawkami</a>
    </section>
    <section class="card">
      <h2>Eksport do Excela</h2>
      <div class="row">
        <select id="exYear">${years.map(y => `<option value="${y}">${y}</option>`).join('')}<option value="all">Wszystkie lata</option></select>
        <button class="btn primary" id="exBtn">Pobierz .xlsx</button>
      </div>
    </section>
    <section class="card">
      <h2>Import z Excela</h2>
      <p class="hint">Plik w układzie Liczniki2026.xlsx (arkusze „Liczniki” i „Stawki”). Można importować kolejne lata.</p>
      <input type="file" id="imFile" accept=".xlsx">
      <div id="imPrev"></div>
    </section>
    <section class="card">
      <h2>Kopia zapasowa</h2>
      <div class="row">
        <button class="btn" id="bkDown">Pobierz kopię (JSON)</button>
        <label class="btn">Przywróć z pliku<input type="file" id="bkFile" accept=".json" hidden></label>
      </div>
    </section>
    `;

  view.querySelector('#exBtn').onclick = () => guard(async () => {
    const y = view.querySelector('#exYear').value;
    let from, to;
    if (y === 'all') { const ms = state.readings.map(r => r.month).sort(); from = ms[0]?.slice(0, 4) + '-01-01'; to = ms.at(-1)?.slice(0, 4) + '-12-01'; }
    else { from = `${y}-01-01`; to = `${y}-12-01`; }
    if (!from || from.startsWith('undefined')) throw new Error('Brak danych do eksportu');
    toast('Przygotowuję plik…');
    await exportXlsx(state, from, to, db.memberName);
  });

  view.querySelector('#imFile').onchange = e => guard(async () => {
    const file = e.target.files[0]; if (!file) return;
    const box = view.querySelector('#imPrev');
    box.innerHTML = '<p class="muted">Czytam plik…</p>';
    const d = await readLicznikiFile(file);
    const dupR = d.readings.filter(r => state.readings.some(x => x.kind === r.kind && x.month === r.month)).length;
    box.innerHTML = `<p>Rok <b>${d.year}</b>: ${d.readings.length} odczytów, ${d.tariffs.length} wersji stawek
      (${d.tariffs.map(t => 'od ' + monthFrom(t.valid_from)).join(', ')}).</p>
      ${dupR ? `<label class="check"><input type="checkbox" id="imOver"> nadpisz ${dupR} istniejących odczytów</label>` : ''}
      <label class="check"><input type="checkbox" id="imPer" ${state.periods.some(p => p.start_month === d.year + '-01-01') ? '' : 'checked'}> utwórz okres rozliczeniowy „Rozliczenie ${d.year}” (styczeń–grudzień)</label>
      <button class="btn primary" id="imGo">Importuj</button>`;
    box.querySelector('#imGo').onclick = () => guard(async () => {
      const periods = box.querySelector('#imPer').checked ? [{ name: `Rozliczenie ${d.year}`, media: Object.keys(MEDIA),
        start_month: `${d.year}-01-01`, end_month: `${d.year}-12-01` }] : [];
      const res = await db.bulkImport({ ...d, periods }, !!box.querySelector('#imOver')?.checked);
      toast(`Zaimportowano: ${res.readings} odczytów, ${res.tariffs} wersji stawek`);
      go('l-start');
    });
  });

  view.querySelector('#bkDown').onclick = () => backupJson(state);
  view.querySelector('#bkFile').onchange = e => guard(async () => {
    const file = e.target.files[0]; if (!file) return;
    const d = await readBackup(file);
    if (!confirm(`Przywrócić ${d.readings.length} odczytów, ${d.tariffs.length} wersji stawek, ${d.periods.length} okresów i ${(d.expenses || []).length} wydatków? Istniejące wpisy nie zostaną nadpisane.`)) return;
    const res = await db.bulkImport(d, false);
    toast(`Przywrócono: ${res.readings} odczytów, ${res.tariffs} stawek, ${res.periods} okresów, ${res.expenses} wydatków`);
  });
}

// ------------------------------------------------------------- wejście z aplikacji Dom
let started = null;
export function renderLiczniki() {
  if (!started) started = (async () => {
    try {
      const h = await db.loadHousehold();
      if (!h) throw new Error('Brak domu dla tego konta');
      render();
      await db.refresh().catch(e => console.warn('refresh', e));
      db.subscribe();
      db.flush();
    } catch (e) {
      started = null;
      view.innerHTML = `<section class="card warn"><h2>Liczniki</h2><p>${esc(e.message)}</p></section>`;
    }
  })();
  render();
}
