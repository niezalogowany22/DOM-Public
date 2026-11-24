// Czysta logika obliczeń — bez DOM i bez Supabase (testowalna w Node).
// Odwzorowuje formuły z arkusza Liczniki2026.xlsx.

export const KINDS = {
  prad: { label: 'Prąd', unit: 'kWh', decimals: 1 },
  zw:   { label: 'Woda zimna', unit: 'm³', decimals: 3 },
  cw:   { label: 'Woda ciepła', unit: 'm³', decimals: 3 },
  co:   { label: 'CO', unit: 'GJ', decimals: 3 },
};

// Pozycje stawek. col = kolumna w arkuszu "Stawki" (do importu).
export const TARIFF_GROUPS = [
  { id: 'prad', label: 'Prąd (ceny netto)', fields: [
    { key: 'energia_kwh',      label: 'Energia czynna',            unit: 'zł/kWh',  col: 'D' },
    { key: 'kogeneracja_mwh',  label: 'Opłata kogeneracyjna',      unit: 'zł/MWh',  col: 'E' },
    { key: 'jakosciowa_kwh',   label: 'Składnik jakościowy',       unit: 'zł/kWh',  col: 'F' },
    { key: 'oze_mwh',          label: 'Opłata OZE',                unit: 'zł/MWh',  col: 'G' },
    { key: 'siec_zmienna_kwh', label: 'Opłata zmienna sieciowa',   unit: 'zł/kWh',  col: 'H' },
    { key: 'przesyl_stala',    label: 'Opłata stała za przesył',   unit: 'zł/mc',   col: 'I' },
    { key: 'handlowa',         label: 'Opłata handlowa',           unit: 'zł/mc',   col: 'J' },
    { key: 'abonament',        label: 'Opłata abonamentowa',       unit: 'zł/mc',   col: 'K' },
    { key: 'przejsciowa',      label: 'Opłata przejściowa',        unit: 'zł/mc',   col: 'L' },
    { key: 'mocowa',           label: 'Opłata mocowa',             unit: 'zł/mc',   col: 'M' },
    { key: 'vat_prad',         label: 'VAT na prąd',               unit: '%',       def: 23 },
  ]},
  { id: 'media', label: 'Media (ceny brutto)', fields: [
    { key: 'zw_m3',     label: 'Woda zimna i ścieki',  unit: 'zł/m³', col: 'P' },
    { key: 'cw_m3',     label: 'Podgrzanie wody',      unit: 'zł/m³', col: 'Q' },
    { key: 'co_gj',     label: 'CO',                   unit: 'zł/GJ', col: 'R' },
    { key: 'co_stala',  label: 'CO — opłata stała',    unit: 'zł/mc', col: 'S' },
    { key: 'smieci_m3', label: 'Wywóz nieczystości',   unit: 'zł/m³ ZW', col: 'T' },
  ]},
  { id: 'stale', label: 'Opłaty stałe w czynszu', fields: [
    { key: 'fundusz_remontowy',  label: 'Fundusz remontowy',            unit: 'zł/mc', col: 'U' },
    { key: 'domofon',            label: 'Konserwacja domofonu',         unit: 'zł/mc', col: 'V' },
    { key: 'czesc_wspolna',      label: 'Utrzymanie części wspólnej',   unit: 'zł/mc', col: 'W' },
    { key: 'wymiana_wodomierzy', label: 'Wymiana wodomierzy/ciepłomierzy', unit: 'zł/mc', col: 'X' },
    { key: 'abonament_zwik',     label: 'Abonament ZWiK za wodomierz',  unit: 'zł/mc', col: 'Y' },
  ]},
  { id: 'inne', label: 'Pozostałe', fields: [
    { key: 'internet', label: 'Internet', unit: 'zł/mc', col: 'Z' },
    { key: 'wynajem',  label: 'Wynajem',  unit: 'zł/mc', col: 'AA' },
  ]},
  { id: 'zaliczka', label: 'Zakładane zużycie (podstawa zaliczki w czynszu)', fields: [
    { key: 'zal_zw_m3', label: 'Woda zimna', unit: 'm³/mc', cell: 'P19' },
    { key: 'zal_cw_m3', label: 'Woda ciepła', unit: 'm³/mc', cell: 'Q19' },
    { key: 'zal_co_gj', label: 'CO',          unit: 'GJ/mc', cell: 'R19' },
  ]},
];
export const TARIFF_FIELDS = TARIFF_GROUPS.flatMap(g => g.fields);

export const MEDIA = { zw: 'Woda zimna', cw: 'Woda ciepła', co: 'CO', smieci: 'Śmieci' };

// ---------------------------------------------------------------- miesiące
export const ym = (y, m) => `${y}-${String(m).padStart(2, '0')}-01`;
export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return ym(Math.floor(t / 12), (t % 12) + 1);
}
export function monthsDiff(a, b) { // b - a
  const [ya, ma] = a.split('-').map(Number), [yb, mb] = b.split('-').map(Number);
  return (yb * 12 + mb) - (ya * 12 + ma);
}
export function monthRange(from, to) {
  const out = []; for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m); return out;
}
const PL_MONTHS = ['styczeń','luty','marzec','kwiecień','maj','czerwiec','lipiec','sierpień','wrzesień','październik','listopad','grudzień'];
export function monthLabel(month, short = false) {
  const [y, m] = month.split('-').map(Number);
  const n = PL_MONTHS[m - 1];
  return short ? `${n.slice(0, 3)} ${String(y).slice(2)}` : `${n} ${y}`;
}
const PL_GEN = ['stycznia','lutego','marca','kwietnia','maja','czerwca','lipca','sierpnia','września','października','listopada','grudnia'];
export function monthFrom(month) { const [y, m] = month.split('-').map(Number); return `1 ${PL_GEN[m - 1]} ${y}`; }
export function currentMonth(d = new Date()) { return ym(d.getFullYear(), d.getMonth() + 1); }

const num = v => (v === null || v === undefined || v === '' || isNaN(+v)) ? 0 : +v;

// ---------------------------------------------------------------- stawki
export function tariffFor(tariffs, month) {
  let best = null;
  for (const t of tariffs) if (t.valid_from <= month && (!best || t.valid_from > best.valid_from)) best = t;
  return best ? best.vals : null;
}

// Zaliczka w czynszu rozbita na media (formuła AB w arkuszu Stawki)
export function advance(v) {
  const zw = num(v.zw_m3) * num(v.zal_zw_m3);
  const smieci = num(v.smieci_m3) * num(v.zal_zw_m3);
  const cw = num(v.cw_m3) * num(v.zal_cw_m3);
  const co = num(v.co_gj) * num(v.zal_co_gj) + num(v.co_stala);
  const stale = fixedFees(v);
  return { zw, cw, co, smieci, stale, total: zw + cw + co + smieci + stale };
}
// Własne pozycje: vals.custom = [{ label, amount, in_czynsz }]
export const customSum = (v, inCzynsz) => (v.custom || []).filter(c => !!c.in_czynsz === inCzynsz).reduce((s, c) => s + num(c.amount), 0);
export const fixedFees = v => num(v.fundusz_remontowy) + num(v.domofon) + num(v.czesc_wspolna)
  + num(v.wymiana_wodomierzy) + num(v.abonament_zwik) + customSum(v, true);
export const pradFixed = v => num(v.przesyl_stala) + num(v.handlowa) + num(v.abonament)
  + num(v.przejsciowa) + num(v.mocowa);

// ---------------------------------------------------------------- zużycie
function segmentDelta(kind, a, b) {
  let d = (b.swap_old_final != null && b.swap_new_start != null)
    ? (num(b.swap_old_final) - num(a.value)) + (num(b.value) - num(b.swap_new_start))
    : num(b.value) - num(a.value);
  if (kind === 'prad') d = Math.round(d);
  return d;
}

// Zwraca { [month]: { [kind]: {value, span, bill, from, to} } }
// Zużycie między dwoma odczytami dzielone po równo na miesiące pomiędzy nimi.
export function consumptionByMonth(readings) {
  const out = {};
  for (const kind of Object.keys(KINDS)) {
    const rs = readings.filter(r => r.kind === kind).sort((x, y) => x.month < y.month ? -1 : 1);
    for (let i = 1; i < rs.length; i++) {
      const a = rs[i - 1], b = rs[i];
      const span = monthsDiff(a.month, b.month);
      if (span <= 0) continue;
      const delta = segmentDelta(kind, a, b);
      const per = Math.max(0, delta) / span;
      for (let k = 1; k <= span; k++) {
        const m = addMonths(a.month, k);
        (out[m] ||= {})[kind] = { value: per, span, negative: delta < 0,
          bill: b.bill_amount != null ? +b.bill_amount : null, closing: b.month, swap: b.swap_old_final != null };
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- koszty
export function monthCost(month, cons, v, expenses = []) {
  const c = cons[month] || {};
  const get = k => c[k] ? c[k].value : null;
  const prad = get('prad'), zw = get('zw'), cw = get('cw'), co = get('co');
  const r = { month, use: { prad, zw, cw, co }, tariff: !!v };
  if (!v) return { ...r, complete: false };

  r.prad = prad == null ? null
    : (prad * (num(v.energia_kwh) + num(v.jakosciowa_kwh) + num(v.siec_zmienna_kwh))
       + prad / 1000 * (num(v.kogeneracja_mwh) + num(v.oze_mwh))
       + pradFixed(v)) * (1 + num(v.vat_prad ?? 23) / 100);
  r.zw = zw == null ? null : zw * num(v.zw_m3);
  r.smieci = zw == null ? null : zw * num(v.smieci_m3);
  r.cw = cw == null ? null : cw * num(v.cw_m3);
  r.co = co == null ? null : co * num(v.co_gj) + num(v.co_stala);
  r.complete = zw != null && cw != null && co != null;
  r.media = r.complete ? r.zw + r.cw + r.co + r.smieci : null;
  r.stale = fixedFees(v);
  r.czynsz = r.complete ? r.media + r.stale : null;           // czynsz wg faktycznego zużycia
  r.adv = advance(v);
  r.zaliczka = r.adv.total;                                   // czynsz zakładany (płacony)
  r.roznica = r.complete ? r.zaliczka - r.czynsz : null;      // + nadpłata, − niedopłata
  r.internet = num(v.internet); r.wynajem = num(v.wynajem);
  r.inne = customSum(v, false);                               // własne pozycje poza czynszem
  r.customIn = (v.custom || []).filter(c => c.in_czynsz);
  r.customOut = (v.custom || []).filter(c => !c.in_czynsz);
  r.wydatkiList = expenses.filter(e => e.month === month);
  r.wydatki = r.wydatkiList.reduce((s, e) => s + num(e.amount), 0);
  r.koszty = r.complete ? r.czynsz + r.internet + r.wynajem + r.inne + r.wydatki : null;
  r.placone = r.prad == null ? null : r.wynajem + r.zaliczka + r.internet + r.inne + r.wydatki + r.prad;
  r.pradBill = c.prad ? c.prad.bill : null;
  r.pradSpan = c.prad ? c.prad.span : null;
  return r;
}

export function buildMonths(readings, tariffs, from, to, expenses = []) {
  const cons = consumptionByMonth(readings);
  return monthRange(from, to).map(m => monthCost(m, cons, tariffFor(tariffs, m), expenses));
}

// Różnica (zaliczka − faktyczny koszt) tylko dla wybranych mediów
export function mediaDiff(r, media) {
  if (!r.tariff) return null;
  let s = 0;
  for (const k of media) {
    const actual = r[k];
    if (actual == null) return null;
    s += r.adv[k] - actual;
  }
  return s;
}

// ---------------------------------------------------------------- bilans okresu
export function periodBalance(period, readings, tariffs, today = currentMonth()) {
  const lastYearFrom = addMonths(period.start_month, -12);
  const rows = buildMonths(readings, tariffs, lastYearFrom, period.end_month);
  const byMonth = Object.fromEntries(rows.map(r => [r.month, r]));
  const inPeriod = monthRange(period.start_month, period.end_month);
  let balance = 0, done = 0; const known = [];
  for (const m of inPeriod) {
    const d = mediaDiff(byMonth[m], period.media);
    if (d != null) { balance += d; done++; known.push(d); }
  }
  const avg = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0;
  let forecast = balance, estimated = 0;
  for (const m of inPeriod) {
    if (mediaDiff(byMonth[m], period.media) != null) continue;
    const ly = byMonth[addMonths(m, -12)];
    const lyd = ly ? mediaDiff(ly, period.media) : null;
    forecast += lyd != null ? lyd : avg; estimated++;
  }
  return { balance, done, total: inPeriod.length, forecast, estimated,
           finished: today > period.end_month, actual: period.actual_amount };
}

// ---------------------------------------------------------------- walidacja
export function validateReading(readings, kind, month, value, swap) {
  const warn = [];
  const rs = readings.filter(r => r.kind === kind && r.month !== month).sort((a, b) => a.month < b.month ? -1 : 1);
  const prev = [...rs].reverse().find(r => r.month < month);
  const next = rs.find(r => r.month > month);
  const u = KINDS[kind].unit;
  const isSwap = swap && swap.old_final != null && swap.new_start != null;
  if (prev && !isSwap && value < num(prev.value))
    warn.push(`Stan niższy niż poprzedni (${fmtNum(prev.value)} ${u} za ${monthLabel(prev.month)}). Jeśli wymieniono licznik, zaznacz „Wymiana licznika”.`);
  if (next && !next.swap_old_final && value > num(next.value))
    warn.push(`Stan wyższy niż następny odczyt (${fmtNum(next.value)} ${u} za ${monthLabel(next.month)}).`);
  if (prev && (isSwap || value >= num(prev.value))) {
    const span = monthsDiff(prev.month, month);
    const delta = isSwap ? (swap.old_final - num(prev.value)) + (value - swap.new_start) : value - num(prev.value);
    const per = delta / span;
    // średnia z ostatnich 12 mies.
    const cons = consumptionByMonth(rs);
    const hist = monthRange(addMonths(prev.month, -11), prev.month).map(m => cons[m]?.[kind]?.value).filter(x => x != null);
    if (hist.length >= 3) {
      const avg = hist.reduce((a, b) => a + b, 0) / hist.length;
      if (avg > 0 && per > avg * 2.5)
        warn.push(`Zużycie ${fmtNum(per)} ${u}/mc to ponad 2,5× średnia (${fmtNum(avg)} ${u}/mc). Sprawdź, czy nie ma literówki.`);
    }
  }
  return warn;
}

// Czego brakuje: dla każdego licznika ostatni miesiąc z odczytem
export function missingStatus(readings, today = currentMonth()) {
  const expected = addMonths(today, -1);
  return Object.keys(KINDS).map(kind => {
    const last = readings.filter(r => r.kind === kind).reduce((m, r) => r.month > m ? r.month : m, '');
    return { kind, last: last || null, missing: last ? Math.max(0, monthsDiff(last, expected)) : null };
  });
}

// ---------------------------------------------------------------- format
export function fmtNum(v, d = 3) {
  if (v == null || isNaN(v)) return '—';
  return (+v).toLocaleString('pl-PL', { maximumFractionDigits: d });
}
export function fmtZl(v) {
  if (v == null || isNaN(v)) return '—';
  return (+v).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł';
}
