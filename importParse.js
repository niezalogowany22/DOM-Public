// Parsowanie pliku LicznikiRRRR.xlsx (układ jak w Liczniki2026).
// cell(sheetName, 'A1') → wartość (liczba/tekst) lub undefined.
import { ym, addMonths, TARIFF_FIELDS } from './calc.js';

const READING_COLS = { prad: 'D', zw: 'G', cw: 'J', co: 'M' };
const isNum = v => typeof v === 'number' && isFinite(v);

export function parseLicznikiWorkbook(cell) {
  const year = Number(cell('Liczniki', 'B2'));
  if (!year || year < 2000 || year > 2100) throw new Error('Nie znaleziono roku w komórce Liczniki!B2');
  if (!String(cell('Liczniki', 'D4') ?? '').includes('kWh'))
    throw new Error('Plik nie wygląda jak arkusz Liczniki (brak „Stan licznika [kWh]” w D4)');

  const readings = [];
  for (let r = 5; r <= 17; r++) {
    // wiersz r = odczyt z 1. dnia miesiąca (r-4) → zamyka miesiąc poprzedni
    const month = addMonths(ym(year, 1), r - 5 - 1);
    for (const [kind, col] of Object.entries(READING_COLS)) {
      const v = cell('Liczniki', col + r);
      if (isNum(v) && v > 0) readings.push({ kind, month, value: v, note: `import ${year}` });
    }
  }

  const zal = {};
  for (const f of TARIFF_FIELDS) if (f.cell) zal[f.key] = Number(cell('Stawki', f.cell)) || 0;

  const tariffs = [];
  let prevKey = null;
  for (let r = 7; r <= 18; r++) {
    const vals = { ...zal };
    let any = false;
    for (const f of TARIFF_FIELDS) {
      if (!f.col) continue;
      const v = cell('Stawki', f.col + r);
      vals[f.key] = isNum(v) ? v : 0;
      if (isNum(v)) any = true;
    }
    vals.vat_prad = 23;
    if (!any) continue;
    const key = JSON.stringify(vals);
    if (key !== prevKey) tariffs.push({ valid_from: ym(year, r - 6), vals, note: `import ${year}` });
    prevKey = key;
  }
  return { year, readings, tariffs };
}
