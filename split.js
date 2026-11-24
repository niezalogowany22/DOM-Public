// Dzielenie kosztów (logika jak w Tricount) i formatowanie. Bez zależności — używane też przez podglad.html.

export const r2 = x => Math.round((x + Number.EPSILON) * 100) / 100;

const nf = {};
export function fmtMoney(v, cur = 'PLN') {
  const f = nf[cur] ||= new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return f.format(v ?? 0) + ' ' + (cur === 'PLN' ? 'zł' : cur);
}
export const fmtDate = d => d ? new Date(d + 'T12:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' }) : '';
export const fmtDateLong = d => d ? new Date(d + 'T12:00').toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
export const today = () => new Date().toLocaleDateString('sv-SE');
export const monthKey = d => d.slice(0, 7);
export const monthName = m => { const s = new Date(m + '-15').toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' }); return s[0].toUpperCase() + s.slice(1); };
export const addMonth = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + n, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };

// Kwota wydatku w walucie grupy
export const inGroupCur = e => r2(Number(e.amount) * Number(e.rate || 1));

// Ile każda osoba „zużyła” z wydatku: { person_id: kwota } (w walucie grupy).
// Reszta z zaokrągleń trafia do pierwszych osób, więc suma zawsze się zgadza.
export function owedBy(e) {
  const total = inGroupCur(e);
  const shares = (e.shares || []).filter(s => s && s.p);
  const out = {};
  if (!shares.length) return out;
  if (e.split_mode === 'amounts') {
    for (const s of shares) out[s.p] = r2((Number(s.a) || 0) * Number(e.rate || 1));
    return out;
  }
  const wSum = shares.reduce((a, s) => a + (e.split_mode === 'equal' ? 1 : Number(s.w) || 0), 0);
  if (!wSum) return out;
  const cents = Math.round(total * 100);
  let given = 0;
  const raw = shares.map(s => {
    const w = e.split_mode === 'equal' ? 1 : Number(s.w) || 0;
    const c = Math.floor(cents * w / wSum); given += c; return { p: s.p, c, w };
  });
  let rest = cents - given;
  for (const x of raw) { if (rest <= 0) break; if (x.w > 0) { x.c++; rest--; } }
  for (const x of raw) out[x.p] = (out[x.p] || 0) + x.c / 100;
  return out;
}

// Saldo każdej osoby: + należy się jej, − jest winna. Wydatki z konta wspólnego pomijane.
export function balances(people, expenses) {
  const bal = Object.fromEntries(people.map(p => [p.id, 0]));
  for (const e of expenses) {
    if (e.source === 'joint' || !e.paid_by) continue;
    const owed = owedBy(e);
    const paid = Object.values(owed).reduce((a, b) => a + b, 0);
    bal[e.paid_by] = (bal[e.paid_by] || 0) + paid;
    for (const [p, v] of Object.entries(owed)) bal[p] = (bal[p] || 0) - v;
  }
  for (const k in bal) bal[k] = r2(bal[k]);
  return bal;
}

// Najmniej przelewów: największy dłużnik płaci największemu wierzycielowi.
export function settle(bal) {
  const deb = [], cred = [];
  for (const [p, v] of Object.entries(bal)) {
    if (v < -0.004) deb.push({ p, v: -v }); else if (v > 0.004) cred.push({ p, v });
  }
  deb.sort((a, b) => b.v - a.v); cred.sort((a, b) => b.v - a.v);
  const out = [];
  let i = 0, j = 0;
  while (i < deb.length && j < cred.length) {
    const x = r2(Math.min(deb[i].v, cred[j].v));
    if (x >= 0.01) out.push({ from: deb[i].p, to: cred[j].p, amount: x });
    deb[i].v = r2(deb[i].v - x); cred[j].v = r2(cred[j].v - x);
    if (deb[i].v < 0.01) i++;
    if (cred[j].v < 0.01) j++;
  }
  return out;
}

// Suma wydatków (bez przelewów) w walucie grupy
export const totalSpent = list => r2(list.filter(e => e.kind !== 'transfer').reduce((a, e) => a + inGroupCur(e), 0));
