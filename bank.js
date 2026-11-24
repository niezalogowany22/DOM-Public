// Odczyt wyciągu CSV (Bank Millennium, Millenet). Plik nie opuszcza telefonu.
export async function readText(file) {
  const buf = await file.arrayBuffer();
  let t = new TextDecoder('utf-8').decode(buf);
  if (t.includes('�')) t = new TextDecoder('windows-1250').decode(buf);
  return t.replace(/^﻿/, '');
}

// Prosty parser CSV z obsługą cudzysłowów; separator wykrywany z nagłówka (, lub ;)
function parseCsv(text, sep) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}

const num = s => { const t = String(s || '').replace(/\s/g, '').replace(',', '.'); return t ? Number(t) : null; };
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]/g, '');

// Zwraca [{ date, bookDate, type, party, desc, amount (− wydatek, + wpływ), balance, currency, ref }]
export function parseMillennium(text) {
  let lines = text.split(/\r?\n/).filter(l => l.trim());
  // Plik przepisany w Excelu bywa „podwójnie zacytowany” (cały wiersz w cudzysłowie) — rozpakuj
  if (lines.length && /^"[^"].*"",""/.test(lines[0])) lines = lines.map(l => l.replace(/^"|"$/g, '').replace(/""/g, '"'));
  const head = lines[0] || '';
  const sep = (head.match(/;/g) || []).length > (head.match(/,/g) || []).length ? ';' : ',';
  const rows = parseCsv(lines.join('\n'), sep);
  const h = rows[0].map(norm);
  const col = (...names) => names.map(n => h.findIndex(x => x.includes(n))).find(i => i >= 0) ?? -1;
  const ix = {
    date: col('datatransakcji'), book: col('datarozliczenia', 'dataksiegowania'), type: col('rodzajtransakcji', 'typ'),
    party: col('odbiorcazleceniodawca', 'odbiorca', 'kontrahent'), desc: col('opis', 'tytul'),
    debit: col('obciazenia'), credit: col('uznania'), amount: col('kwota'), balance: col('saldo'), cur: col('waluta'),
  };
  if (ix.date < 0 || (ix.debit < 0 && ix.amount < 0)) throw new Error('Nie rozpoznano układu pliku — to nie wygląda na wyciąg CSV z Millenetu.');
  const out = [];
  const seen = {};
  for (const r of rows.slice(1)) {
    const g = i => (i >= 0 ? (r[i] || '').trim() : '');
    const debit = num(g(ix.debit)), credit = num(g(ix.credit));
    const amount = ix.amount >= 0 ? num(g(ix.amount)) : credit ? Math.abs(credit) : debit ? -Math.abs(debit) : null;
    if (!amount) continue;
    const desc = g(ix.desc).replace(/\s+/g, ' ');
    // przy płatności kartą faktyczna data zakupu jest w opisie
    const inDesc = desc.match(/(20\d\d-\d\d-\d\d)\s*$/);
    const date = inDesc ? inDesc[1] : g(ix.date);
    const base = [g(ix.date), g(ix.book), amount.toFixed(2), desc, g(ix.party), g(ix.balance)].join('|');
    seen[base] = (seen[base] || 0) + 1;     // identyczne wiersze (np. dwa takie same zakupy) dostają kolejny numer
    out.push({ date, bookDate: g(ix.date), type: g(ix.type), party: g(ix.party), desc, amount, balance: num(g(ix.balance)),
               currency: g(ix.cur) || 'PLN', ref: hash(base + '#' + seen[base]) });
  }
  return out;
}
function hash(s) {   // krótki, stabilny odcisk (FNV-1a 2×32 bity) — bez danych wprost
  let a = 0x811c9dc5, b = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b ^ c, 2246822507) ^ (b >>> 13); }
  return 'm' + (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

// Czytelna nazwa sklepu z opisu karty: "LIDL 1855 LODZ POL 2026-11-14" → "Lidl"
export function shopFromDesc(t) {
  const d = (t.desc || '').replace(/\s+\d{4}-\d\d-\d\d$/, '').replace(/\s+(POL|PL|POLSKA)$/i, '');
  const name = t.party || d.split(/\s{2,}| \d/)[0] || d;
  return name.replace(/\s+(stacja|nr|sklep|sp\.?)(\s.*)?$/i, '').toLowerCase().replace(/(^|[\s.-])\S/g, m => m.toUpperCase()).trim().slice(0, 60);
}
// Klucz reguły: pierwsze słowo nazwy, np. "LIDL", "ORLEN", "ROSSMANN"
export const ruleKey = t => norm(((t.party || t.desc || '').split(/[\s*/]/).find(w => /[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]{3,}/.test(w)) || '')).slice(0, 20);

export const GUESS = [
  ['Spożywcze', 'lidl biedronka kaufland auchan carrefour netto dino aldi zabka stokrotka lewiatan polomarket intermarche spolem frisco delikatesy piekarnia'],
  ['Paliwo', 'orlen shell circlek bp amic moya lotos stacja'],
  ['Chemia i dom', 'rossmann hebe drogeria ikea leroy castorama obi jysk pepco action'],
  ['Zdrowie', 'apteka doz superpharm lekarz medicover luxmed'],
  ['Restauracje', 'mcdonald kfc burger pizza restauracja bistro bar kebab starbucks costa pyszne glovo uber eats'],
  ['Rozrywka', 'netflix spotify cinema kino multikino helios disney hbo max youtube steam'],
  ['Samochód', 'parking autostrada myjnia mechanik euromaster autocentrum'],
  ['Ubrania', 'zara hm reserved ccc deichmann sinsay lpp decathlon'],
  ['Mieszkanie i media', 'pge tauron enea energa innogy veolia fortum spoldzielnia czynsz orange play tmobile plus upc vectra netia'],
];
