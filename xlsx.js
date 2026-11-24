// Import z Liczniki20XX.xlsx i eksport do Excela (ExcelJS ładowany na żądanie).
import { parseLicznikiWorkbook } from './importParse.js';
import { KINDS, TARIFF_GROUPS, MEDIA, buildMonths, periodBalance, monthLabel, monthFrom } from './calc.js';

let excelLoading = null;
export function loadExcel() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  return excelLoading ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'exceljs.min.js';
    s.onload = () => res(window.ExcelJS);
    s.onerror = () => { excelLoading = null; rej(new Error('Nie udało się załadować biblioteki Excela')); };
    document.head.appendChild(s);
  });
}

function cellValue(c) {
  let v = c.value;
  if (v && typeof v === 'object') {
    if ('result' in v) v = v.result;            // formuła → wynik
    else if ('richText' in v) v = v.richText.map(t => t.text).join('');
    else if (v instanceof Date) v = v.toISOString();
    else if ('error' in v) v = undefined;
  }
  return v;
}

export async function readLicznikiFile(file) {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const cell = (sheet, addr) => {
    const ws = wb.getWorksheet(sheet);
    if (!ws) throw new Error(`Brak arkusza „${sheet}” w pliku`);
    return cellValue(ws.getCell(addr));
  };
  return parseLicznikiWorkbook(cell);
}

// ------------------------------------------------------------- eksport
const ZL = '#,##0.00 "zł"';
const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCEFEA' } };

function styleHeader(row) {
  row.font = { bold: true };
  row.alignment = { vertical: 'middle', wrapText: true };
  row.eachCell(c => { c.fill = HEAD_FILL; c.border = { bottom: { style: 'thin' } }; });
}

export async function exportXlsx(data, from, to, memberName) {
  const ExcelJS = await loadExcel();
  const { readings, tariffs, periods } = data;
  const expenses = data.expenses || [];
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Liczniki';

  // 1. Koszty miesięczne
  const rows = buildMonths(readings, tariffs, from, to, expenses);
  const stan = (kind, m) => readings.find(r => r.kind === kind && r.month === m)?.value ?? null;
  const customCols = [...new Map(rows.flatMap(r => [...(r.customIn || []).map(c => ({ label: c.label, in: true })),
    ...(r.customOut || []).map(c => ({ label: c.label, in: false }))]).map(c => [c.label + '|' + c.in, c])).values()];
  const customVal = (r, c) => ((c.in ? r.customIn : r.customOut) || []).find(x => x.label === c.label)?.amount ?? null;
  const ws = wb.addWorksheet('Koszty miesięczne', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
  const cols = [
    ['Miesiąc', 16], ['Prąd stan na koniec [kWh]', 11, '0.0'], ['Prąd zużycie [kWh]', 11, '0'], ['Prąd koszt', 12, ZL],
    ['ZW stan na koniec [m³]', 10, '0.000'], ['ZW zużycie [m³]', 10, '0.000'], ['ZW koszt', 11, ZL],
    ['CW stan na koniec [m³]', 10, '0.000'], ['CW zużycie [m³]', 10, '0.000'], ['Podgrzanie CW', 11, ZL],
    ['CO stan na koniec [GJ]', 10, '0.000'], ['CO zużycie [GJ]', 10, '0.000'], ['CO koszt', 11, ZL],
    ['Wywóz śmieci', 11, ZL], ['Suma mediów', 12, ZL], ['Opłaty stałe', 11, ZL],
    ['Czynsz wg zużycia', 12, ZL], ['Zaliczka w czynszu', 12, ZL], ['Różnica (+ nadpłata)', 12, ZL],
    ['Internet', 10, ZL], ['Wynajem', 11, ZL],
    ...customCols.map(c => [`${c.label} (${c.in ? 'w czynszu' : 'poza czynszem'})`, 12, ZL]),
    ['Wydatki jednorazowe', 12, ZL], ['Koszty mieszkania', 13, ZL], ['Płacona suma', 13, ZL],
  ];
  ws.columns = cols.map(([header, width, numFmt]) => ({ header, width, style: numFmt ? { numFmt } : {} }));
  styleHeader(ws.getRow(1)); ws.getRow(1).height = 32;
  const rd = v => v == null ? null : Math.round(v * 10000) / 10000;
  for (const r of rows) {
    ws.addRow([monthLabel(r.month),
      stan('prad', r.month), r.use.prad, r.prad,
      stan('zw', r.month), r.use.zw, r.zw,
      stan('cw', r.month), r.use.cw, r.cw,
      stan('co', r.month), r.use.co, r.co,
      r.smieci, r.media, r.stale, r.czynsz, r.zaliczka, r.roznica,
      r.internet, r.wynajem, ...customCols.map(c => customVal(r, c)), r.wydatki, r.koszty, r.placone].map((v, i) => i === 0 ? v : rd(v)));
  }
  const last = ws.rowCount;
  const sumRow = ws.addRow(['Suma']);
  const stanCols = new Set([2, 5, 8, 11]);
  for (let ci = 3; ci <= cols.length; ci++) {
    if (stanCols.has(ci)) continue;
    const L = ws.getColumn(ci).letter;
    sumRow.getCell(ci).value = { formula: `SUM(${L}2:${L}${last})` };
  }
  sumRow.font = { bold: true };
  sumRow.eachCell(c => { c.border = { top: { style: 'thin' } }; });
  ws.addRow([]);
  ws.addRow(['Puste pola = brak odczytu zamykającego miesiąc (np. prąd czeka na rachunek).']).font = { italic: true, color: { argb: 'FF666666' } };

  // 2. Odczyty
  const wr = wb.addWorksheet('Odczyty', { views: [{ state: 'frozen', ySplit: 1 }] });
  wr.columns = [
    { header: 'Za miesiąc', width: 16 }, { header: 'Licznik', width: 13 }, { header: 'Stan', width: 11 },
    { header: 'Jedn.', width: 6 }, { header: 'Data odczytu', width: 12 }, { header: 'Kwota z rachunku', width: 12, style: { numFmt: ZL } },
    { header: 'Wymiana: stan końcowy starego', width: 14 }, { header: 'Wymiana: stan początkowy nowego', width: 14 },
    { header: 'Wpisał(a)', width: 12 }, { header: 'Uwagi', width: 30 },
  ];
  styleHeader(wr.getRow(1)); wr.getRow(1).height = 32;
  const kindOrder = Object.keys(KINDS);
  readings.filter(r => r.month >= from && r.month <= to)
    .sort((a, b) => a.month === b.month ? kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) : (a.month < b.month ? -1 : 1))
    .forEach(r => wr.addRow([monthLabel(r.month), KINDS[r.kind].label, +r.value, KINDS[r.kind].unit,
      r.read_on || null, r.bill_amount, r.swap_old_final, r.swap_new_start, memberName(r.created_by), r.note || null]));

  // 3. Stawki (wiersze = pozycje, kolumny = wersje)
  const wt = wb.addWorksheet('Stawki', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
  const vers = [...tariffs].sort((a, b) => a.valid_from < b.valid_from ? -1 : 1);
  wt.columns = [{ header: 'Pozycja', width: 32 }, { header: 'Jedn.', width: 10 },
    ...vers.map(v => ({ header: 'od ' + monthFrom(v.valid_from), width: 14 }))];
  styleHeader(wt.getRow(1));
  for (const g of TARIFF_GROUPS) {
    const gr = wt.addRow([g.label]); gr.font = { bold: true, color: { argb: 'FF2F6F62' } };
    for (const f of g.fields) wt.addRow([f.label, f.unit, ...vers.map(v => v.vals[f.key] ?? null)]);
  }
  const customLabels = [...new Map(vers.flatMap(v => v.vals.custom || []).map(c => [c.label + '|' + !!c.in_czynsz, c])).values()];
  if (customLabels.length) {
    const gr = wt.addRow(['Własne pozycje']); gr.font = { bold: true, color: { argb: 'FF2F6F62' } };
    for (const c of customLabels) wt.addRow([`${c.label} (${c.in_czynsz ? 'w czynszu' : 'poza czynszem'})`, 'zł/mc',
      ...vers.map(v => (v.vals.custom || []).find(x => x.label === c.label && !!x.in_czynsz === !!c.in_czynsz)?.amount ?? null)]);
  }

  // Wydatki jednorazowe
  const exIn = expenses.filter(e => e.month >= from && e.month <= to).sort((a, b) => a.month < b.month ? -1 : 1);
  if (exIn.length) {
    const we = wb.addWorksheet('Wydatki');
    we.columns = [{ header: 'Miesiąc', width: 16 }, { header: 'Nazwa', width: 30 }, { header: 'Kwota', width: 12, style: { numFmt: ZL } },
      { header: 'Wpisał(a)', width: 12 }, { header: 'Uwagi', width: 30 }];
    styleHeader(we.getRow(1));
    exIn.forEach(e => we.addRow([monthLabel(e.month), e.name, +e.amount, memberName(e.created_by), e.note || null]));
    const sr = we.addRow(['Suma', null, { formula: `SUM(C2:C${exIn.length + 1})` }]); sr.font = { bold: true };
  }

  // 4. Rozliczenia
  if (periods.length) {
    const wp = wb.addWorksheet('Rozliczenia');
    wp.columns = [
      { header: 'Okres', width: 22 }, { header: 'Od', width: 14 }, { header: 'Do', width: 14 },
      { header: 'Media', width: 26 }, { header: 'Bilans (+ nadpłata)', width: 14, style: { numFmt: ZL } },
      { header: 'Miesięcy z danymi', width: 10 }, { header: 'Prognoza na koniec', width: 14, style: { numFmt: ZL } },
      { header: 'Faktyczne rozliczenie', width: 14, style: { numFmt: ZL } }, { header: 'Uwagi', width: 30 },
    ];
    styleHeader(wp.getRow(1)); wp.getRow(1).height = 32;
    for (const p of periods) {
      const b = periodBalance(p, readings, tariffs);
      wp.addRow([p.name, monthLabel(p.start_month), monthLabel(p.end_month), p.media.map(m => MEDIA[m]).join(', '),
        b.balance, `${b.done}/${b.total}`, b.forecast, p.actual_amount, p.note || null]);
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const name = from.slice(0, 4) === to.slice(0, 4) && from.endsWith('-01-01') && to.endsWith('-12-01')
    ? `Liczniki${from.slice(0, 4)}.xlsx` : `Liczniki_${from.slice(0, 7)}_${to.slice(0, 7)}.xlsx`;
  download(blob, name);
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function backupJson(data) {
  const strip = ({ id, household_id, created_at, updated_at, _pending, ...rest }) => rest;
  const out = { app: 'liczniki', version: 1, exported_at: new Date().toISOString(),
    readings: data.readings.map(strip), tariffs: data.tariffs.map(strip), periods: data.periods.map(strip), expenses: (data.expenses || []).map(strip) };
  download(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }),
    `liczniki-kopia-${new Date().toISOString().slice(0, 10)}.json`);
}
export async function readBackup(file) {
  const d = JSON.parse(await file.text());
  if (d.app !== 'liczniki') throw new Error('To nie jest kopia zapasowa aplikacji Liczniki');
  return d;
}
