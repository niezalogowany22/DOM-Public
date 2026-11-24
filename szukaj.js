// Wyszukiwarka wydatków
import * as db from './db.js';
import { state } from './db.js';
import { view, esc, parseNum, go } from './ui.js';
import { r2, fmtMoney, inGroupCur } from './split.js';
import { groupedList } from './wydatki.js';

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');

export function renderSearch(p) {
  const g = db.homeGroup();
  const people = g ? db.peopleOf(g.id) : [];
  const trips = state.groups.filter(x => x.kind === 'trip');
  view.innerHTML = `
    <form class="card" id="sf" autocomplete="off">
      <h2>Szukaj wydatków</h2>
      <input name="q" type="search" placeholder="Lidl, paliwo, prezent…" value="${esc(p.q || '')}">
      <div class="row"><label class="field">Od<input type="date" name="od" value="${p.od || ''}"></label><label class="field">Do<input type="date" name="do" value="${p.do || ''}"></label></div>
      <div class="pills" id="per">${[['m', 'Ten miesiąc'], ['m1', 'Poprzedni'], ['3m', '3 miesiące'], ['y', 'Ten rok'], ['', 'Wszystko']].map(([v, l]) => `<button type="button" class="pill" data-p="${v}">${l}</button>`).join('')}</div>
      <div class="row"><label class="field">Kwota od<input name="min" inputmode="decimal" value="${p.min || ''}"></label><label class="field">do<input name="max" inputmode="decimal" value="${p.max || ''}"></label></div>
      <label class="field">Kategoria<select name="cat" style="width:100%"><option value="">wszystkie</option>${state.categories.map(c => `<option value="${c.id}" ${c.id === p.cat ? 'selected' : ''}>${esc(c.icon + ' ' + c.name)}</option>`).join('')}</select></label>
      <label class="field">Kto płacił<select name="who" style="width:100%"><option value="">wszyscy</option><option value="joint" ${p.who === 'joint' ? 'selected' : ''}>konto wspólne</option>
        ${people.map(x => `<option value="${x.user_id}" ${x.user_id === p.who ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      ${trips.length ? `<label class="check"><input type="checkbox" name="trips" ${p.trips === '1' ? 'checked' : ''}> uwzględnij wyjazdy</label>` : ''}
    </form>
    <div id="res"></div>`;
  const f = view.querySelector('#sf');
  const iso = d => d.toLocaleDateString('sv-SE');
  view.querySelectorAll('#per [data-p]').forEach(b => b.onclick = () => {
    const now = new Date(), y = now.getFullYear(), m = now.getMonth(), v = b.dataset.p;
    const range = { m: [new Date(y, m, 1), new Date(y, m + 1, 0)], m1: [new Date(y, m - 1, 1), new Date(y, m, 0)], '3m': [new Date(y, m - 2, 1), new Date(y, m + 1, 0)], y: [new Date(y, 0, 1), new Date(y, 11, 31)] }[v];
    f.od.value = range ? iso(range[0]) : ''; f.do.value = range ? iso(range[1]) : ''; run();
  });
  let t;
  f.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 200); });
  f.addEventListener('change', run);
  f.onsubmit = e => { e.preventDefault(); run(); };
  function run() {
    const q = norm(f.q.value.trim()), od = f.od.value, dd = f.do.value, min = parseNum(f.min.value), max = parseNum(f.max.value);
    const cat = f.cat.value, who = f.who.value, withTrips = f.trips?.checked;
    // zapamiętaj filtry w adresie (powrót z wydatku wraca do wyników)
    const qs = new URLSearchParams(Object.entries({ q: f.q.value.trim(), od, do: dd, min: f.min.value, max: f.max.value, cat, who, trips: withTrips ? '1' : '' }).filter(([, v]) => v));
    history.replaceState(history.state, '', '#szukaj' + (qs.toString() ? '?' + qs : ''));
    const words = q.split(/\s+/).filter(Boolean);
    const list = state.expenses.filter(e => {
      if (e.kind === 'transfer') return false;
      if (!(e.group_id === g?.id || (withTrips && trips.some(x => x.id === e.group_id)))) return false;
      if (od && e.spent_on < od) return false;
      if (dd && e.spent_on > dd) return false;
      const v = inGroupCur(e);
      if (min != null && v < min) return false;
      if (max != null && v > max) return false;
      if (cat && e.category_id !== cat) return false;
      if (who === 'joint' && e.source !== 'joint') return false;
      if (who && who !== 'joint') { const pp = state.people.find(x => x.id === e.paid_by); if (pp?.user_id !== who) return false; }
      if (words.length) {
        const hay = norm([e.title, e.note, db.category(e.category_id)?.name, String(e.amount).replace('.', ',')].join(' '));
        if (!words.every(w => hay.includes(w))) return false;
      }
      return true;
    });
    const sum = r2(list.reduce((a, e) => a + inGroupCur(e), 0));
    const res = view.querySelector('#res');
    const any = words.length || od || dd || min != null || max != null || cat || who;
    res.innerHTML = !any ? '<p class="muted center pad">Wpisz nazwę albo wybierz okres, kategorię lub kwotę.</p>' : `
      <section class="card"><div class="row between" style="margin:0"><span class="muted">${list.length} wydatków</span><b class="big">${fmtMoney(sum)}</b></div>
        ${list.length > 1 ? `<div class="row between small" style="margin:4px 0 0"><span class="muted">średnio</span><span>${fmtMoney(r2(sum / list.length))}</span></div>` : ''}</section>
      <section class="card flush">${groupedList(list.slice(0, 300), g)}</section>
      ${list.length > 300 ? '<p class="hint center">Pokazano 300 najnowszych — zawęź wyszukiwanie.</p>' : ''}`;
  }
  run();
  if (!p.q) f.q.focus();
}
