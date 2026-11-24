// Podgląd wyjazdu z linku (bez logowania, tylko odczyt).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { fmtMoney, fmtDate, fmtDateLong, inGroupCur, owedBy, balances, settle, totalSpent } from './split.js';
const view = document.getElementById('view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sign = v => v > 0.004 ? 'pos' : v < -0.004 ? 'neg' : '';
// token w części # adresu (nie trafia do logów serwera); stare linki ?t= nadal działają
const token = new URLSearchParams(location.hash.slice(1)).get('t') || new URLSearchParams(location.search).get('t');
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });

async function load() {
  const { data, error } = await sb.rpc('trip_public', { p_token: token });
  if (error || !data) {
    view.innerHTML = '<section class="card warn"><h2>Link nie działa</h2><p>Mógł zostać wyłączony. Poproś o nowy.</p></section>';
    return;
  }
  const { group: g, people, expenses } = data;
  const name = id => people.find(p => p.id === id)?.name || '?';
  const bal = balances(people, expenses);
  const tr = settle(bal);
  document.title = g.name; document.getElementById('ttl').textContent = g.name;
  let day = null;
  const rows = expenses.map(e => {
    let h = '';
    if (e.spent_on !== day) { day = e.spent_on; h += `<div class="day">${fmtDateLong(day)}</div>`; }
    if (e.kind === 'transfer') return h + `<div class="xrow"><span class="ic">⇄</span><span class="tt"><b>${esc(name(e.paid_by))} → ${esc(name(e.shares[0]?.p))}</b><small>zwrot</small></span><span class="am muted">${fmtMoney(inGroupCur(e), g.currency)}</span></div>`;
    const forWho = Object.keys(owedBy(e)).map(name).join(', ');
    return h + `<div class="xrow"><span class="ic">${esc(e.icon || '•')}</span><span class="tt"><b>${esc(e.title || e.category || 'Wydatek')}</b>
      <small>płaci ${esc(name(e.paid_by))} · za: ${esc(forWho)}</small></span>
      <span class="am">${fmtMoney(inGroupCur(e), g.currency)}${e.currency !== g.currency ? ` <small>${fmtMoney(e.amount, e.currency)}</small>` : ''}</span></div>`;
  }).join('');
  view.innerHTML = `
    <p class="muted small">${g.start_date ? fmtDate(g.start_date) + (g.end_date ? ' – ' + fmtDate(g.end_date) : '') : ''}</p>
    <section class="card">
      <div class="row between" style="margin:0"><span class="muted">Razem</span><b class="big">${fmtMoney(totalSpent(expenses), g.currency)}</b></div>
      ${people.map(p => `<div class="kvrow"><span>${esc(p.name)}</span><b class="${sign(bal[p.id])}">${bal[p.id] > 0 ? '+' : ''}${fmtMoney(bal[p.id] || 0, g.currency)}</b></div>`).join('')}
    </section>
    <section class="card"><h2>Kto komu</h2>
      ${tr.length ? tr.map(t => `<div class="kvrow"><span>${esc(name(t.from))} → ${esc(name(t.to))}</span><b>${fmtMoney(t.amount, g.currency)}</b></div>`).join('') : '<p class="muted">Wszyscy rozliczeni.</p>'}
    </section>
    <section class="card flush">${rows || '<p class="muted center pad">Brak wydatków.</p>'}</section>
    <p class="hint center">Tylko podgląd · odświeża się co minutę</p>`;
}
if (!token) view.innerHTML = '<section class="card warn"><h2>Brak linku</h2></section>';
else { load(); setInterval(load, 60000); document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && load()); }
