// Raport miesiąca: podsumowanie, ciekawostki, kategorie, wykres dzień po dniu
import * as db from './db.js';
import { state } from './db.js';
import { view, esc, go, icon } from './ui.js';
import { r2, fmtMoney, today, monthKey, monthName, addMonth, inGroupCur, fmtDateLong } from './split.js';
import { wtabs, budgetMonth } from './budzet.js';

const COLORS = [1, 2, 3, 4, 5, 6, 7, 8].map(i => `var(--chart-${i})`);   // tokens.css
const daysIn = m => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0).getDate(); };
const zl0 = v => new Intl.NumberFormat('pl-PL', Math.abs(v) < 100 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 }).format(v) + ' zł';

function monthData(m, scope) {
  const g = db.homeGroup();
  return state.expenses.filter(e => e.group_id === g?.id && e.kind !== 'transfer' && monthKey(e.spent_on) === m && (scope === 'all' || e.source === 'joint'));
}

export function renderReport(params) {
  const m = params.m || monthKey(today());
  const scope = params.s === 'joint' ? 'joint' : 'all';
  const list = monthData(m, scope);
  const total = r2(list.reduce((a, e) => a + inGroupCur(e), 0));
  const cur = m === monthKey(today());
  const dim = daysIn(m), elapsed = cur ? +today().slice(8, 10) : dim;
  const avg = elapsed ? total / elapsed : 0;
  const forecast = cur ? (scope === 'joint' && state.budget ? budgetMonth(m).forecast : total / elapsed * dim) : null;
  const prevTotal = r2(monthData(addMonth(m, -1), scope).reduce((a, e) => a + inGroupCur(e), 0));
  const deposits = r2(state.deposits.filter(d => monthKey(d.day) === m).reduce((a, d) => a + Number(d.amount), 0));
  const jointOut = r2(monthData(m, 'joint').reduce((a, e) => a + inGroupCur(e), 0));
  const bilans = r2(deposits - jointOut);

  // kategorie
  const byCat = new Map();
  for (const e of list) byCat.set(e.category_id || '', (byCat.get(e.category_id || '') || 0) + inGroupCur(e));
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([id, v], i) => {
    const c = db.category(id); return { name: c?.name || 'Bez kategorii', icon: c?.icon || '•', v: r2(v), p: total ? v / total * 100 : 0, color: COLORS[Math.min(i, COLORS.length - 1)] };
  });
  // dni
  const byDay = Array(dim).fill(0);
  for (const e of list) byDay[+e.spent_on.slice(8, 10) - 1] += inGroupCur(e);
  const maxDay = Math.max(...byDay);
  const topDay = byDay.indexOf(maxDay) + 1;
  const empty = byDay.slice(0, elapsed).filter(v => v === 0).length;
  const biggest = [...list].sort((a, b) => inGroupCur(b) - inGroupCur(a))[0];
  // sklepy
  const byShop = new Map();
  for (const e of list) if (e.title) { const k = e.title.trim(); const x = byShop.get(k) || { n: 0, v: 0 }; x.n++; x.v += inGroupCur(e); byShop.set(k, x); }
  const topShop = [...byShop.entries()].sort((a, b) => b[1].n - a[1].n || b[1].v - a[1].v)[0];
  // kto płacił (prywatnie)
  const g = db.homeGroup();
  const people = g ? db.peopleOf(g.id) : [];
  const paid = people.map(p => ({ p, v: r2(list.filter(e => e.paid_by === p.id).reduce((a, e) => a + inGroupCur(e), 0)) }));
  const fromJoint = r2(list.filter(e => e.source === 'joint').reduce((a, e) => a + inGroupCur(e), 0));

  const insights = [];
  if (cats[0]) insights.push(['tag', `Najwięcej poszło na ${esc(cats[0].name)} — ${zl0(cats[0].v)} (${Math.round(cats[0].p)}%).`]);
  if (maxDay > 0) insights.push(['calendar', `Najdroższy dzień: ${fmtDateLong(`${m}-${String(topDay).padStart(2, '0')}`)} — ${zl0(r2(maxDay))}.`]);
  if (biggest) insights.push(['coin', `Największy wydatek: ${esc(biggest.title || db.category(biggest.category_id)?.name || 'wydatek')} — ${zl0(inGroupCur(biggest))}.`]);
  if (topShop && topShop[1].n > 1) insights.push(['cart', `Najczęściej: ${esc(topShop[0])} — ${topShop[1].n} razy, razem ${zl0(r2(topShop[1].v))}.`]);
  if (prevTotal > 0) {
    const prevSame = cur ? r2(monthData(addMonth(m, -1), scope).filter(e => +e.spent_on.slice(8, 10) <= elapsed).reduce((a, e) => a + inGroupCur(e), 0)) : prevTotal;
    if (prevSame > 0) { const d = (total - prevSame) / prevSame * 100;
      insights.push([d > 0 ? 'trendUp' : 'trendDown', `${d > 0 ? 'Więcej' : 'Mniej'} niż w ${monthName(addMonth(m, -1)).toLowerCase().split(' ')[0]}${cur ? ' (te same dni)' : ''}: ${d > 0 ? '+' : ''}${Math.round(d)}%.`]); }
  }
  if (elapsed && empty) insights.push(['leaf', `${empty} ${empty === 1 ? 'dzień' : 'dni'} bez żadnych wydatków.`]);

  // wykres dzień po dniu (SVG)
  const W = 340, Hh = 120, bw = W / dim;
  const scale = maxDay ? (Hh - 10) / maxDay : 0;
  const bars = byDay.map((v, i) => v ? `<rect x="${(i * bw + bw * 0.2).toFixed(1)}" y="${(Hh - v * scale).toFixed(1)}" width="${(bw * 0.6).toFixed(1)}" height="${(v * scale).toFixed(1)}" rx="2" class="${i + 1 === topDay ? 'top' : ''}"><title>${i + 1}: ${zl0(r2(v))}</title></rect>` : '').join('');
  const avgY = Hh - avg * scale;

  view.innerHTML = `${wtabs('raport')}
    <div class="monthnav"><a class="btn small" href="#raport?m=${addMonth(m, -1)}&s=${scope}">‹</a><b>${monthName(m)}</b><a class="btn small" href="#raport?m=${addMonth(m, 1)}&s=${scope}">›</a></div>
    <div class="pills" data-name="scope"><a class="pill${scope === 'all' ? ' on' : ''}" href="#raport?m=${m}">Wszystkie wydatki</a><a class="pill${scope === 'joint' ? ' on' : ''}" href="#raport?m=${m}&s=joint">Konto wspólne</a></div>
    <section class="card rhero">
      <span class="cap">Wydatki</span>
      <b class="huge">${zl0(total)}</b>
      <span class="muted">${list.length} ${list.length === 1 ? 'wydatek' : list.length < 5 && list.length > 1 ? 'wydatki' : 'wydatków'}${cur && forecast != null ? ` · prognoza na koniec miesiąca ~${zl0(r2(forecast))}` : ''}</span>
    </section>
    <div class="tiles">
      <section class="card rtile"><span class="cap">Dziennie</span><b>${zl0(r2(avg))}</b><span class="muted small">średnio</span></section>
      <section class="card rtile"><span class="cap">Bilans konta wspólnego</span><b class="${bilans < 0 ? 'neg' : 'pos'}">${bilans > 0 ? '+' : ''}${zl0(bilans)}</b><span class="muted small">wpłaty ${zl0(deposits)}</span></section>
    </div>
    ${insights.length ? `<section class="card insights">${insights.map(([i, t]) => `<div><span>${icon(i)}</span><span>${t}</span></div>`).join('')}</section>` : ''}
    ${cats.length ? `<h3>Na co poszło</h3>
    <div class="stack">${cats.map(c => `<i style="width:${c.p}%;background:${c.color}" title="${esc(c.name)}"></i>`).join('')}</div>
    <section class="card flush">${cats.map(c => `<div class="catline"><i style="background:${c.color}"></i><span>${esc(c.icon)} ${esc(c.name)} <small class="muted">${Math.round(c.p)}%</small></span><b>${zl0(c.v)}</b>
      <span class="cbar"><i style="width:${c.p}%;background:${c.color}"></i></span></div>`).join('')}</section>` : ''}
    ${total ? `<h3>Dzień po dniu <small class="muted">· średnio ${zl0(r2(avg))}</small></h3>
    <section class="card"><svg class="daychart" viewBox="0 0 ${W} ${Hh + 16}">
      ${bars}
      <line x1="0" x2="${W}" y1="${avgY.toFixed(1)}" y2="${avgY.toFixed(1)}" class="avg"/>
      <text x="2" y="${Hh + 13}">1</text><text x="${W / 2}" y="${Hh + 13}" text-anchor="middle">15</text><text x="${W - 2}" y="${Hh + 13}" text-anchor="end">${dim}</text>
    </svg></section>` : ''}
    ${people.length && total ? `<h3>Kto płacił</h3><section class="card">
      ${fromJoint ? `<div class="kvrow"><span>Konto wspólne</span><b>${zl0(fromJoint)}</b></div>` : ''}
      ${paid.filter(x => x.v).map(x => `<div class="kvrow"><span>${esc(x.p.name)}</span><b>${zl0(x.v)}</b></div>`).join('')}
    </section>` : ''}
    ${!list.length ? '<p class="muted center pad">Brak wydatków w tym miesiącu.</p>' : ''}`;
}
