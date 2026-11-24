// Wykresy, podział kosztów, porównanie z rachunkami za prąd.
import * as db from './l-db.js';
import { go } from './ui.js';
import { state } from './l-db.js';
import { KINDS, buildMonths, addMonths, monthLabel, currentMonth, fmtNum, fmtZl,
         consumptionByMonth, monthCost, TARIFF_FIELDS, monthFrom } from './calc.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const MFULL = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
const MSHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
const fmtDiff = v => v == null ? '—' : (v > 0 ? '+' : '') + fmtZl(v);
function toast(msg, err = false) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(t._h); t._h = setTimeout(() => t.className = 'toast', err ? 5000 : 2500);
}

function yearsWithData() {
  const cy = +currentMonth().slice(0, 4);
  const ys = new Set(state.readings.map(r => +r.month.slice(0, 4))); ys.add(cy);
  return [...ys].sort((a, b) => b - a);
}
function defaultYear() {
  const ms = state.readings.map(r => +r.month.slice(0, 4));
  const cy = +currentMonth().slice(0, 4);
  return ms.length ? Math.min(cy, Math.max(...ms)) : cy;
}
const yearSelect = (year, route) => `<select class="yearsel" data-route="${route}">${yearsWithData()
  .map(y => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select>`;
function bindYear(view) {
  const s = view.querySelector('.yearsel');
  if (s) s.onchange = () => { go(`l-${s.dataset.route}?y=${s.value}`); };
}
const subnav = (active, year) => `<div class="subnav">
  ${[['koszty', 'Miesiące'], ['wykresy', 'Wykresy'], ['wydatki', 'Wydatki'], ['rachunki', 'Rachunki']]
    .map(([r, l]) => `<a href="#l-${r}?y=${year}" class="${r === active ? 'on' : ''}">${l}</a>`).join('')}</div>`;
export { subnav };

// ============================================================ WYKRESY
// Słupki pogrupowane (bieżący rok vs poprzedni) + opcjonalna linia, jedna oś.
function barChart({ labels, series, unit, decimals = 0, line = null, trend = null, marks = false }) {
  const W = 340, H = 190, L = 40, R = 6, T = 10, B = 22;
  const all = [...series.flatMap(s => s.values), ...(line ? line.values : []), ...(trend ? trend.values : [])].filter(v => v != null);
  const max = niceMax(Math.max(1e-9, ...all));
  const n = labels.length, cw = (W - L - R) / n;
  const bw = Math.min(14, (cw - 4) / series.length - 2);
  const y = v => T + (H - T - B) * (1 - v / max);
  const ticks = [0, max / 2, max];
  let svg = ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="grid"/>
    <text x="${L - 4}" y="${y(t) + 3}" class="axis" text-anchor="end">${fmtNum(t, max < 10 ? 1 : 0)}</text>`).join('');
  labels.forEach((lab, i) => {
    const x0 = L + i * cw + (cw - series.length * (bw + 2)) / 2;
    series.forEach((s, k) => {
      const v = s.values[i]; if (v == null || v <= 0) return;
      const h = y(0) - y(v), x = x0 + k * (bw + 2), r = Math.min(4, bw / 2, h);
      // zaokrąglony tylko górny koniec, przyklejony do osi
      svg += `<path class="bar ${s.cls}" d="M${x},${y(0)} V${y(v) + r} Q${x},${y(v)} ${x + r},${y(v)} H${x + bw - r} Q${x + bw},${y(v)} ${x + bw},${y(v) + r} V${y(0)} Z"/>`;
    });
    svg += `<text x="${L + i * cw + cw / 2}" y="${H - 6}" class="axis" text-anchor="middle">${lab}</text>`;
  });
  if (line) {
    const pts = line.values.map((v, i) => v == null ? null : [L + i * cw + cw / 2, y(v)]);
    let d = '', pen = false;
    for (const p of pts) { if (!p) { pen = false; continue; } d += (pen ? 'L' : 'M') + p[0] + ',' + p[1]; pen = true; }
    svg += `<path d="${d}" class="line ${line.cls}"/>` + pts.filter(Boolean).map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" class="dot ${line.cls}"/>`).join('');
  }
  if (trend) {
    let d = '', pen = false;
    trend.values.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + (L + i * cw + cw / 2) + ',' + y(v); pen = true; });
    svg += `<path d="${d}" class="line tr"/>`;
  }
  if (marks) {
    const vals = series[0].values.map((v, i) => [v, i]).filter(([v]) => v != null);
    if (vals.length > 1) {
      const mx = vals.reduce((a, b) => b[0] > a[0] ? b : a), mn = vals.reduce((a, b) => b[0] < a[0] ? b : a);
      for (const [[v, i], t] of [[mx, 'max'], [mn, 'min']]) {
        const x = L + i * cw + (cw - series.length * (bw + 2)) / 2 + bw / 2;
        svg += `<text x="${x}" y="${y(v) - 5}" class="mark" text-anchor="middle">${t}</text>`;
      }
    }
  }
  svg += `<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" class="base"/>`;
  labels.forEach((_, i) => { svg += `<rect class="hit" data-i="${i}" x="${L + i * cw}" y="${T}" width="${cw}" height="${H - T - B}"/>`; });
  const legend = [...series, ...(line ? [line] : []), ...(trend ? [trend] : [])];
  return `<div class="chart" data-unit="${esc(unit)}" data-dec="${decimals}">
    ${legend.length > 1 ? `<div class="legend">${legend.map(s => `<span><i class="${s.cls}${s === line || s === trend ? ' ln' : ''}"></i>${esc(s.name)}</span>`).join('')}</div>` : ''}
    <svg viewBox="0 0 ${W} ${H}" role="img">${svg}</svg><div class="tip" hidden></div>
    <script type="application/json">${JSON.stringify({ labels, series: legend.map(s => ({ name: s.name, values: s.values, cls: s.cls })) })}</script>
  </div>`;
}
function niceMax(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
function bindCharts(view) {
  view.querySelectorAll('.chart').forEach(ch => {
    const data = JSON.parse(ch.querySelector('script').textContent);
    const tip = ch.querySelector('.tip'), unit = ch.dataset.unit, dec = +ch.dataset.dec;
    const show = (i, ev) => {
      ch.querySelectorAll('.hit').forEach(h => h.classList.toggle('on', +h.dataset.i === i));
      tip.innerHTML = `<b>${data.labels[i]}</b>` + data.series.map(s => `<div><i class="${s.cls}"></i>${esc(s.name)}: <b>${s.values[i] == null ? '—' : fmtNum(s.values[i], dec) + ' ' + unit}</b></div>`).join('');
      tip.hidden = false;
      const box = ch.getBoundingClientRect(), r = ev.target.getBoundingClientRect();
      const left = Math.min(Math.max(0, r.left - box.left + r.width / 2 - tip.offsetWidth / 2), box.width - tip.offsetWidth);
      tip.style.left = left + 'px';
    };
    ch.querySelectorAll('.hit').forEach(h => {
      h.addEventListener('pointerenter', e => show(+h.dataset.i, e));
      h.addEventListener('click', e => show(+h.dataset.i, e));
    });
    ch.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { tip.hidden = true; ch.querySelectorAll('.hit.on').forEach(h => h.classList.remove('on')); } });
  });
}

export function renderCharts(view, params) {
  const year = +(params.y || defaultYear());
  const kind = params.k || 'co';
  const cur = buildMonths(state.readings, state.tariffs, `${year}-01-01`, `${year}-12-01`, state.expenses);
  const prev = buildMonths(state.readings, state.tariffs, `${year - 1}-01-01`, `${year - 1}-12-01`, state.expenses);
  const hasPrev = prev.some(r => Object.values(r.use).some(v => v != null));
  const two = (pick, nameA = String(year), nameB = String(year - 1)) => [
    { name: nameA, values: cur.map(pick), cls: 's1' },
    ...(hasPrev ? [{ name: nameB, values: prev.map(pick), cls: 's2' }] : [])];
  const K = KINDS[kind];
  const both = [...prev, ...cur];
  const trendOf = pick => ({ name: 'Trend (średnia 12 mies.)', cls: 'tr', values: cur.map((r, i) => {
    if (pick(r) == null) return null;
    const w = both.slice(i + 1, i + 13).map(pick).filter(v => v != null);
    return w.length >= 10 ? w.reduce((a, b) => a + b, 0) / w.length : null; }) });
  const stats = (pick, unit, dec) => {
    const v = cur.map((r, i) => [pick(r), i]).filter(([x]) => x != null);
    if (v.length < 2) return '';
    const mx = v.reduce((a, b) => b[0] > a[0] ? b : a), mn = v.reduce((a, b) => b[0] < a[0] ? b : a);
    const sum = v.reduce((a, b) => a + b[0], 0);
    const pv = prev.map((r, i) => [pick(r), i]).filter(([x, i]) => x != null && v.some(([, j]) => j === i));
    const psum = pv.reduce((a, b) => a + b[0], 0);
    const pct = pv.length === v.length && psum ? (sum - psum) / psum * 100 : null;
    const f = x => `${fmtNum(x, dec)} ${unit}`;
    return `<dl class="kv stats">
      <dt>Najwyższe</dt><dd>${f(mx[0])} <small class="muted">${MFULL[mx[1]]}</small></dd>
      <dt>Najniższe</dt><dd>${f(mn[0])} <small class="muted">${MFULL[mn[1]]}</small></dd>
      <dt>Średnio / mies.</dt><dd>${f(sum / v.length)}</dd>
      <dt>Razem (${v.length} mies.)</dt><dd>${f(sum)}${pct != null ? ` <small class="${pct > 0 ? 'neg' : 'pos'}">${pct > 0 ? '+' : ''}${pct.toFixed(0)}% r/r</small>` : ''}</dd>
    </dl>`;
  };
  const dec = kind === 'prad' ? 0 : 3;

  view.innerHTML = `
    ${subnav('wykresy', year)}
    <div class="row between">${yearSelect(year, 'wykresy')}</div>
    <section class="card">
      <div class="row between"><h2>Zużycie</h2>
        <select id="kind">${Object.entries(KINDS).map(([k, x]) => `<option value="${k}" ${k === kind ? 'selected' : ''}>${x.label}</option>`).join('')}</select></div>
      ${barChart({ labels: MSHORT, series: two(r => r.use[kind]), unit: K.unit, decimals: dec, trend: trendOf(r => r.use[kind]), marks: true })}
      ${stats(r => r.use[kind], K.unit, dec)}
      <p class="hint">Trend to średnie zużycie z ostatnich 12 miesięcy — rośnie, gdy zużywacie więcej niż rok wcześniej, i nie zależy od pory roku.</p>
    </section>
    <section class="card">
      <h2>Czynsz wg zużycia a zaliczka</h2>
      ${barChart({ labels: MSHORT, series: [{ name: 'Czynsz wg zużycia', values: cur.map(r => r.czynsz), cls: 's1' }],
                   line: { name: 'Zaliczka', values: cur.map(r => r.tariff ? r.zaliczka : null), cls: 's2' }, unit: 'zł', decimals: 2 })}
      <p class="hint">Słupek poniżej linii = nadpłata w danym miesiącu.</p>
    </section>
    <section class="card">
      <h2>Koszt prądu</h2>
      ${barChart({ labels: MSHORT, series: two(r => r.prad), unit: 'zł', decimals: 2, trend: trendOf(r => r.prad), marks: true })}
      ${stats(r => r.prad, 'zł', 2)}
    </section>
    <section class="card">
      <h2>Media (ZW+CW+CO+śmieci)</h2>
      ${barChart({ labels: MSHORT, series: two(r => r.media), unit: 'zł', decimals: 2, trend: trendOf(r => r.media), marks: true })}
      ${stats(r => r.media, 'zł', 2)}
    </section>
    <p class="hint center">Dotknij miesiąca, żeby zobaczyć wartości. Szczegóły w tabeli: <a href="#l-koszty?y=${year}">Miesiące</a>.</p>`;
  bindYear(view); bindCharts(view);
  view.querySelector('#kind').onchange = e => { go(`l-wykresy?y=${year}&k=${e.target.value}`); };
}

// ============================================================ RACHUNKI ZA PRĄD
export function renderBills(view, params) {
  const rs = state.readings.filter(r => r.kind === 'prad').sort((a, b) => a.month < b.month ? -1 : 1);
  const segs = [];
  for (let i = 1; i < rs.length; i++) {
    const a = rs[i - 1], b = rs[i];
    const months = buildMonths(state.readings, state.tariffs, addMonths(a.month, 1), b.month, state.expenses);
    const calc = months.every(m => m.prad != null) ? months.reduce((s, m) => s + m.prad, 0) : null;
    const kwh = months.reduce((s, m) => s + (m.use.prad || 0), 0);
    const bill = b.bill_amount != null ? +b.bill_amount : null;
    const diff = bill != null && calc != null ? bill - calc : null;
    segs.push({ from: addMonths(a.month, 1), to: b.month, kwh, calc, bill, diff, pct: diff != null && calc ? diff / calc * 100 : null });
  }
  const withBill = segs.filter(s => s.diff != null);
  const sumDiff = withBill.reduce((s, x) => s + x.diff, 0);
  const off = withBill.filter(s => Math.abs(s.pct) > 3);
  const year = +(params.y || defaultYear());

  view.innerHTML = `
    ${subnav('rachunki', year)}
    <section class="card">
      <h2>Rachunki a wyliczenia</h2>
      ${withBill.length ? `<dl class="kv">
        <dt>Rachunków z kwotą</dt><dd>${withBill.length} z ${segs.length}</dd>
        <dt>Suma różnic (rachunek − wyliczenie)</dt><dd>${fmtDiff(sumDiff)}</dd>
      </dl>
      ${off.length ? `<p class="warn pad">${off.length} ${off.length === 1 ? 'rachunek różni' : 'rachunki różnią'} się o ponad 3% — prawdopodobnie zmieniły się stawki prądu.
        Sprawdź taryfę na rachunku i dodaj nowe stawki od miesiąca, od którego zaczyna się rozbieżność.</p>`
        : '<p class="hint">Wszystkie rachunki zgadzają się z wyliczeniem w granicach 3%.</p>'}`
      : '<p>Brak rachunków z kwotą. Przy wpisywaniu odczytu prądu podaj „Kwotę z rachunku”, a tu zobaczysz, czy zgadza się z wyliczeniem.</p>'}
    </section>
    ${[...segs].reverse().map(s => `<section class="card bill">
      <div class="row between"><b>${s.from === s.to ? monthLabel(s.to) : monthLabel(s.from) + ' – ' + monthLabel(s.to)}</b>
        <span class="muted">${fmtNum(s.kwh, 0)} kWh</span></div>
      <dl class="kv">
        <dt>Wyliczenie</dt><dd>${fmtZl(s.calc)}</dd>
        <dt>Rachunek</dt><dd>${s.bill == null ? `<a href="#l-odczyt?m=${s.to}">dodaj kwotę</a>` : fmtZl(s.bill)}</dd>
        ${s.diff != null ? `<dt>Różnica</dt><dd class="${Math.abs(s.pct) > 3 ? 'neg' : 'muted'}">${fmtDiff(s.diff)} (${s.pct > 0 ? '+' : ''}${s.pct.toFixed(1)}%)</dd>` : ''}
      </dl></section>`).join('')}`;
}


// ============================================================ WYDATKI JEDNORAZOWE
export function renderExpenses(view, params) {
  const year = +(params.y || defaultYear());
  const list = state.expenses.filter(e => +e.month.slice(0, 4) === year)
    .sort((a, b) => a.month === b.month ? (a.created_at < b.created_at ? 1 : -1) : (a.month < b.month ? 1 : -1));
  const total = list.reduce((s, e) => s + +e.amount, 0);
  const byMonth = {};
  for (const e of list) (byMonth[e.month] ||= []).push(e);
  view.innerHTML = `
    ${subnav('wydatki', year)}
    <a class="btn primary big" href="#l-wydatek">+ Dodaj wydatek</a>
    <div class="row between">${yearSelect(year, 'wydatki')}<span class="muted">razem ${fmtZl(total)}</span></div>
    ${Object.entries(byMonth).map(([m, es]) => `<section class="card">
      <h2>${monthLabel(m)} <small class="muted">${fmtZl(es.reduce((s, e) => s + +e.amount, 0))}</small></h2>
      <table class="costs">${es.map(e => `<tr class="click" data-id="${e.id}"><td>${esc(e.name)}</td>
        <td>${e.note ? `<small>${esc(e.note)}</small>` : ''}</td><td>${fmtZl(+e.amount)}</td></tr>`).join('')}</table>
    </section>`).join('') || `<section class="card"><p>Brak wydatków w ${year}.</p>
      <p class="hint">Jednorazowe koszty mieszkania (naprawa, zakup, opłata) wpisane tutaj doliczają się do kosztów danego miesiąca
      i do eksportu. Rozliczenia ze spółdzielnią wpisuj w zakładce Rozliczenia, nie tutaj — inaczej policzą się podwójnie.</p></section>`}`;
  bindYear(view);
  view.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => { go('l-wydatek?id=' + tr.dataset.id); });
}

export function renderExpenseForm(view, params) {
  const e = state.expenses.find(x => x.id === params.id);
  const m = e?.month || currentMonth();
  view.innerHTML = `
    <form class="card" id="ef">
      <h2>${e ? 'Edycja wydatku' : 'Nowy wydatek'}</h2>
      <label class="field">Nazwa<input name="name" required value="${esc(e?.name || '')}" placeholder="np. naprawa spłuczki"></label>
      <label class="field">Kwota (zł)<input name="amount" required inputmode="decimal" value="${e ? String(e.amount).replace('.', ',') : ''}"></label>
      <label class="field">Miesiąc<input type="month" name="month" required value="${m.slice(0, 7)}"></label>
      <label class="field">Uwagi<input name="note" value="${esc(e?.note || '')}"></label>
      <div class="row">
        ${e ? '<button type="button" class="btn danger" id="del">Usuń</button>' : ''}
        <a class="btn" href="#l-wydatki?y=${m.slice(0, 4)}">Anuluj</a>
        <button class="btn primary">Zapisz</button>
      </div>
    </form>`;
  const f = view.querySelector('#ef');
  f.onsubmit = async ev => {
    ev.preventDefault();
    try {
      const amount = Number(f.amount.value.trim().replace(/\s/g, '').replace(',', '.'));
      if (isNaN(amount)) throw new Error('Nieprawidłowa kwota');
      const month = f.month.value + '-01';
      await db.saveExpense({ id: e?.id, name: f.name.value.trim(), amount, month, note: f.note.value.trim() || null });
      toast('Zapisano'); go('l-wydatki?y=' + month.slice(0, 4));
    } catch (err) { toast(err.message || String(err), true); }
  };
  const del = view.querySelector('#del');
  if (del) del.onclick = async () => {
    if (!confirm('Usunąć ten wydatek?')) return;
    try { await db.deleteExpense(e.id); go('l-wydatki?y=' + m.slice(0, 4)); }
    catch (err) { toast(err.message || String(err), true); }
  };
}

// ============================================================ TREND CEN
// Typowy miesiąc = średnie zużycie z ostatnich 12 miesięcy z danymi, wyceniony wg każdej wersji stawek.
function basketUse() {
  const cons = consumptionByMonth(state.readings);
  const use = {};
  for (const k of Object.keys(KINDS)) {
    const vals = Object.keys(cons).sort().reverse().map(m => cons[m][k]?.value).filter(v => v != null).slice(0, 12);
    use[k] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }
  return use;
}
function basketCost(vals, use) {
  const M = '2000-01-01';
  const cons = { [M]: Object.fromEntries(Object.entries(use).map(([k, v]) => [k, { value: v }])) };
  const r = monthCost(M, cons, vals);
  return { prad: r.prad, media: r.media, stale: r.stale, internet: r.internet, inne: r.inne, wynajem: r.wynajem,
           total: r.prad + r.media + r.stale + r.internet + r.inne };
}

export function renderPrices(view) {
  const vers = [...state.tariffs].sort((a, b) => a.valid_from < b.valid_from ? -1 : 1);
  if (vers.length < 2) {
    view.innerHTML = `<a class="link" href="#l-stawki">← Stawki</a><section class="card"><p>Do porównania potrzebne są co najmniej dwie wersje stawek.</p></section>`;
    return;
  }
  const use = basketUse();
  const costs = vers.map(v => basketCost(v.vals, use));
  const first = vers[0], last = vers.at(-1), c0 = costs[0], c1 = costs.at(-1);
  const pct = (a, b) => a ? (b - a) / a * 100 : null;
  const fp = p => p == null ? '' : `${p > 0 ? '+' : ''}${p.toFixed(1)}%`;
  const vlab = v => { const [y, m] = v.valid_from.split('-'); return MSHORT[+m - 1] + ' ' + y.slice(2); };

  // zmiany pozycji: wpływ na typowy miesiąc liczony przez podmianę jednej pozycji
  const items = [];
  for (const f of TARIFF_FIELDS) {
    const seq = vers.map(v => +(v.vals[f.key] ?? 0));
    if (seq.every(x => x === seq[0])) continue;
    const swapped = basketCost({ ...first.vals, [f.key]: seq.at(-1) }, use).total - c0.total;
    items.push({ label: f.label, unit: f.unit, seq, impact: swapped });
  }
  const labels = [...new Set(vers.flatMap(v => (v.vals.custom || []).map(c => c.label)))];
  for (const lab of labels) {
    const seq = vers.map(v => (v.vals.custom || []).find(c => c.label === lab)?.amount ?? null);
    if (seq.every(x => x === seq[0])) continue;
    const inCz = vers.flatMap(v => v.vals.custom || []).find(c => c.label === lab).in_czynsz;
    items.push({ label: lab, unit: 'zł/mc', seq, impact: (+(seq.at(-1) ?? 0)) - (+(seq[0] ?? 0)), custom: inCz ? 'w czynszu' : 'poza czynszem' });
  }
  items.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  const hist = it => it.seq.map((x, i) => i === 0 || x !== it.seq[i - 1]
    ? `<span>${vlab(vers[i])}: <b>${x == null ? '—' : fmtNum(x, 5)}</b></span>` : '').filter(Boolean).join(' → ');

  view.innerHTML = `
    <a class="link" href="#l-stawki">← Stawki</a>
    <section class="card">
      <h2>Typowy miesiąc wg stawek</h2>
      <p class="hint">Średnie zużycie z ostatnich 12 miesięcy: prąd ${fmtNum(use.prad, 0)} kWh, woda zimna ${fmtNum(use.zw, 2)} m³,
        ciepła ${fmtNum(use.cw, 2)} m³, CO ${fmtNum(use.co, 2)} GJ — wycenione wg każdej wersji stawek. Zużycie jest stałe, więc różnice to wyłącznie zmiany cen.</p>
      <h3>Wzrost względem stawek od ${monthFrom(first.valid_from)} (zł/mc)</h3>
      ${barChart({ labels: vers.map(vlab), series: [{ name: 'Wzrost', values: costs.map(c => c.total - c0.total), cls: 's1' }], unit: 'zł', decimals: 2 })}
      <dl class="kv stats">
        <dt>Wg stawek od ${monthFrom(first.valid_from)}</dt><dd>${fmtZl(c0.total)}</dd>
        <dt>Obecnie (od ${monthFrom(last.valid_from)})</dt><dd>${fmtZl(c1.total)}</dd>
        <dt>Zmiana</dt><dd class="${c1.total > c0.total ? 'neg' : 'pos'}">${c1.total > c0.total ? '+' : ''}${fmtZl(c1.total - c0.total)} / mc (${fp(pct(c0.total, c1.total))})</dd>
        <dt>Rocznie</dt><dd class="${c1.total > c0.total ? 'neg' : 'pos'}">${c1.total > c0.total ? '+' : ''}${fmtZl((c1.total - c0.total) * 12)}</dd>
      </dl>
      <p class="hint">Bez wynajmu${c1.wynajem !== c0.wynajem ? ` (wynajem: ${fmtZl(c0.wynajem)} → ${fmtZl(c1.wynajem)})` : ''}.</p>
    </section>
    <section class="card">
      <h2>Według grup</h2>
      <table class="costs">
        <tr class="sub"><td>Grupa</td><td>teraz</td><td>zmiana</td></tr>
        ${[['Prąd', 'prad'], ['Media', 'media'], ['Opłaty stałe w czynszu', 'stale'], ['Internet', 'internet'], ['Inne poza czynszem', 'inne']]
          .filter(([, k]) => c0[k] || c1[k]).map(([l, k]) => `<tr><td>${l}</td><td>${fmtZl(c1[k])}</td>
          <td class="${c1[k] > c0[k] + 0.005 ? 'neg' : c1[k] < c0[k] - 0.005 ? 'pos' : 'muted'}">${Math.abs(c1[k] - c0[k]) < 0.005 ? '—' : `${c1[k] > c0[k] ? '+' : ''}${fmtZl(c1[k] - c0[k])}<br><small>${fp(pct(c0[k], c1[k]))}</small>`}</td></tr>`).join('')}
      </table>
    </section>
    <section class="card">
      <h2>Zmiany pozycji</h2>
      <p class="hint">Od największego wpływu na typowy miesiąc.</p>
      ${items.map(it => `<div class="pricechg">
        <div class="row between"><b>${esc(it.label)}${it.custom ? ` <small class="muted">${it.custom}</small>` : ''}</b>
          <span class="${it.impact > 0.005 ? 'neg' : it.impact < -0.005 ? 'pos' : 'muted'}">${it.impact > 0 ? '+' : ''}${fmtZl(it.impact)}/mc</span></div>
        <div class="hint">${hist(it)} ${it.unit}${it.seq[0] && it.seq.at(-1) != null ? ` · <b>${fp(pct(+it.seq[0], +it.seq.at(-1)))}</b>` : ''}</div>
      </div>`).join('') || '<p class="muted">Żadna pozycja się nie zmieniła.</p>'}
    </section>`;
  bindCharts(view);
}
