// Grafik — ekran w Dom: swój grafik (edycja), grafik drugiej osoby (podgląd), ustawienia
import { state } from './db.js';
import { view, esc, toast, guard, go } from './ui.js';
import * as gd from './gr-data.js';
import { G, fmtYM, shiftYM, monthDays, person, cat, catsFor, me, isOwner, entry, fmtH, renderTitle } from './gr-data.js';

const MONTHS = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
const monthLabel = ym => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
const todayISO = () => new Date().toLocaleDateString('sv-SE');

// ------------------------------------------------------------- święta
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}
const holCache = {};
function holidays(y) {
  if (holCache[y]) return holCache[y];
  const H = { [`${y}-01-01`]: 'Nowy Rok', [`${y}-01-06`]: 'Trzech Króli', [`${y}-05-01`]: 'Święto Pracy', [`${y}-05-03`]: 'Święto Konstytucji 3 Maja',
    [`${y}-08-15`]: 'Wniebowzięcie NMP', [`${y}-11-01`]: 'Wszystkich Świętych', [`${y}-11-11`]: 'Święto Niepodległości',
    [`${y}-12-25`]: 'Boże Narodzenie', [`${y}-12-26`]: 'Drugi dzień Bożego Narodzenia' };
  if (y >= 2025) H[`${y}-12-24`] = 'Wigilia';
  const e = easter(y), plus = n => new Date(e.getFullYear(), e.getMonth(), e.getDate() + n).toLocaleDateString('sv-SE');
  H[plus(0)] = 'Wielkanoc'; H[plus(1)] = 'Poniedziałek Wielkanocny'; H[plus(49)] = 'Zielone Świątki'; H[plus(60)] = 'Boże Ciało';
  return (holCache[y] = H);
}
const holidayName = d => holidays(+d.slice(0, 4))[d];

// ------------------------------------------------------------- rozliczenie miesiąca
function hoursOf(c, p) {
  if (!c || c.kind !== 'work') return 0;
  if (c.all_day) return Number(p?.daily_norm) || 8;
  if (!c.start_time || !c.end_time) return 0;
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  let d = toMin(c.end_time) - toMin(c.start_time); if (d <= 0) d += 1440;
  return d / 60;
}
const r1 = n => Math.round(n * 10) / 10, fmtNum = n => String(r1(n)).replace('.', ','), dayWord = n => (n === 1 ? 'dzień' : 'dni');
function monthReport(pid, ym) {
  const p = person(pid), dn = Number(p?.daily_norm) || 8;
  const rep = { offDays: 0, worked: 0, shifts: 0, counts: {}, workdays: 0, satHol: 0, leaveDays: 0, other: 0, otherH: 0, hols: [] };
  for (const date of monthDays(ym)) {
    const dow = new Date(date + 'T12:00').getDay(), hol = holidayName(date);
    if (hol) rep.hols.push(`${+date.slice(8)} ${hol}`);
    const normDay = dow >= 1 && dow <= 5 && !hol;
    if (normDay) rep.workdays++;
    if (hol && dow === 6) rep.satHol++;
    const e = entry(pid, date), c = e?.cat && cat(e.cat);
    if (!c) continue;
    rep.counts[c.id] = (rep.counts[c.id] || 0) + 1;
    if (c.kind === 'leave' && normDay) rep.leaveDays++;
    if (c.kind === 'work') {
      rep.worked += hoursOf(c, p); rep.shifts++;
      const night = !c.all_day && c.start_time && c.end_time && c.end_time <= c.start_time;
      if (night || hol || dow === 6 || dow === 0) rep.offDays++;
    }
    if (c.kind === 'other') { rep.other++; rep.otherH += hoursOf({ ...c, kind: 'work' }, p); }
  }
  rep.dn = dn; rep.norm = dn * (rep.workdays - rep.satHol) - dn * rep.leaveDays; rep.balance = rep.worked - rep.norm;
  return rep;
}

// ------------------------------------------------------------- ekran główny
let tool = null, painting = false, strokeVal, stroke = [], status = '', saving = false;
const curParams = { p: null, m: null };

export function renderGrafik(params) {
  gd.grEnsure();
  if (!G.ready) { view.innerHTML = `<section class="card warn"><b>Brak tabel grafiku.</b> Uruchom <code>schema-grafik.sql</code> w Supabase, potem odśwież.</section>`; return; }
  if (!G.loaded) { view.innerHTML = '<p class="muted center">Ładowanie grafiku…</p>'; return; }
  const mine = me();
  if (!mine) return renderSetup();
  const pid = person(params.p) ? params.p : mine.id;
  const ym = /^\d{4}-\d\d$/.test(params.m || '') ? params.m : fmtYM(new Date());
  const firstView = curParams.p !== pid || curParams.m !== ym;
  Object.assign(curParams, { p: pid, m: ym });
  const own = isOwner(pid), p = person(pid);
  const cats = catsFor(pid);
  if (own && tool !== 'erase' && !cats.some(c => c.id === tool)) tool = cats[0]?.id || 'erase';
  const pending = gd.unsynced(pid).length;
  const days = monthDays(ym);
  const offset = (new Date(days[0] + 'T12:00').getDay() + 6) % 7;
  const rep = monthReport(pid, ym);
  const bal = rep.balance;
  const balTxt = Math.abs(bal) < 0.05 ? 'równo z normą' : bal > 0 ? `+${fmtNum(bal)} h <small>(≈ ${fmtNum(bal / rep.dn)} ${dayWord(r1(bal / rep.dn))})</small>`
    : `−${fmtNum(-bal)} h <small>(≈ ${fmtNum(-bal / rep.dn)} ${dayWord(r1(-bal / rep.dn))})</small>`;
  const counts = cats.filter(c => rep.counts[c.id]).map(c => `${esc(c.short)}×${rep.counts[c.id]}`).join(' · ');

  view.innerHTML = `
    <div class="pills gr-people">${G.people.map(x => `<button type="button" class="pill${x.id === pid ? ' on' : ''}" data-p="${x.id}" style="--pc:${esc(x.color)}">
      <i></i>${esc(x.id === mine.id ? 'Mój grafik' : x.name)}${x.id !== mine.id ? ' <small>podgląd</small>' : ''}</button>`).join('')}
      <a class="pill" href="#grafik-ustawienia" aria-label="Ustawienia grafiku">⚙</a></div>
    <div class="monthnav"><a class="btn small" href="#grafik?p=${pid}&m=${shiftYM(ym, -1)}">‹</a>
      <b>${monthLabel(ym)}</b>
      <span class="row" style="margin:0"><button class="btn small" id="reload" aria-label="Odśwież z kalendarza">⟳</button><a class="btn small" href="#grafik?p=${pid}&m=${shiftYM(ym, 1)}">›</a></span></div>
    <div class="gr-grid">${['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'].map(d => `<div class="gr-dow">${d}</div>`).join('')}
      ${'<div class="gr-cell blank"></div>'.repeat(offset)}${days.map(d => cellHTML(pid, d)).join('')}</div>
    ${own ? `<div class="gr-palette">${cats.map(c => `<button type="button" data-tool="${c.id}" class="${tool === c.id ? 'on' : ''}" style="--c:${esc(c.color)}">${esc(c.short || '?')}<small>${esc(c.all_day ? (c.name || 'cały dzień') : `${fmtH(c.start_time)}–${fmtH(c.end_time)}`)}</small></button>`).join('')}
      <button type="button" data-tool="erase" class="erase${tool === 'erase' ? ' on' : ''}">⌫<small>gumka</small></button></div>
      ${cats.length ? '' : '<p class="hint">Nie masz jeszcze kategorii — dodaj je w ustawieniach grafiku (ikona koła zębatego u góry).</p>'}
      <div class="gr-save"><button class="btn primary" id="save" ${pending && !saving ? '' : 'disabled'}>${saving ? 'Zapisywanie…' : `Zapisz do kalendarza${pending ? ` (${pending})` : ''}`}</button>
        ${pending ? '<button class="btn" id="discard">Cofnij</button>' : ''}</div>`
      : `<p class="hint">Grafik: ${esc(p.name)} — tylko podgląd. Zmiany wprowadza właściciel na swoim telefonie.</p>`}
    <p class="hint gr-status" id="grStatus">${esc(status)}</p>
    <section class="card gr-report">
      <div class="kvrow"><span>Przepracowane</span><b>${fmtNum(rep.worked)} h</b></div>
      ${counts ? `<p class="hint" style="margin:-4px 0 4px">${rep.shifts} zm. · ${counts}</p>` : ''}
      <div class="kvrow"><span>Norma <small class="muted">${rep.workdays - rep.satHol} dni × ${rep.dn} h${rep.leaveDays ? ` − urlop/L4 ${rep.leaveDays}` : ''}</small></span><b>${fmtNum(rep.norm)} h</b></div>
      <div class="kvrow"><span>Bilans</span><b class="${bal > 0.05 ? 'pos' : bal < -0.05 ? 'neg' : ''}">${balTxt}</b></div>
      <div class="kvrow"><span>Dni wolne (za nocki / weekendy / święta)</span><b>${rep.offDays}</b></div>
      ${rep.other ? `<div class="kvrow"><span>Dyżury / inne (poza czasem pracy)</span><b>${fmtNum(rep.otherH)} h</b></div>` : ''}
      ${rep.hols.length ? `<p class="hint">Święta: ${esc(rep.hols.join(', '))}</p>` : ''}
    </section>`;

  if (!own) view.querySelector('.gr-report')?.remove();
  view.querySelectorAll('[data-p]').forEach(b => b.onclick = () => go(`grafik?p=${b.dataset.p}&m=${ym}`));
  view.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => { tool = b.dataset.tool; view.querySelectorAll('[data-tool]').forEach(x => x.classList.toggle('on', x === b)); });
  view.querySelector('#reload').onclick = () => pull(pid, ym, true);
  view.querySelector('#save')?.addEventListener('click', () => save(pid));
  view.querySelector('#discard')?.addEventListener('click', () => confirm(`Cofnąć ${pending} niezapisanych zmian? Grafik wróci do stanu z kalendarza.`) &&
    guard(async () => { await gd.discardChanges(pid); setStatus('Zmiany cofnięte'); }));
  if (own) bindPaint(pid);
  // świeże dane z kalendarza (co najwyżej co 10 min dla miesiąca)
  if (firstView && Date.now() - gd.pulledAt(pid, ym) > 10 * 60e3) pull(pid, ym, false);
}

function cellHTML(pid, date) {
  const e = entry(pid, date), r = gd.row(pid, date);
  const d = new Date(date + 'T12:00'), hol = holidayName(date);
  const cls = ['gr-cell'];
  if (d.getDay() === 0 || d.getDay() === 6 || hol) cls.push('we');
  if (hol) cls.push('hol');
  if (date === todayISO()) cls.push('today');
  if (r && !r.synced) cls.push('changed');
  let chip = '', style = '';
  if (e?.cat) { const c = cat(e.cat); cls.push('filled'); if (c.local) cls.push('local'); style = `--c:${esc(c.color)}`; chip = `<span class="chip">${esc(c.short || '?')}</span>`; }
  else if (e?.raw) chip = `<span class="chip raw" title="${esc(e.raw.title)}">?</span>`;
  return `<div class="${cls.join(' ')}" data-date="${date}" style="${style}"${hol ? ` title="${esc(hol)}"` : ''}><span class="num">${d.getDate()}</span>${chip}</div>`;
}

function bindPaint(pid) {
  const grid = view.querySelector('.gr-grid');
  const paint = date => {
    const cur = entry(pid, date);
    let changed;
    if (!strokeVal) { if (!cur) return; changed = gd.setDayLocal(pid, date, null); }
    else { if (cur?.cat === strokeVal) return; changed = gd.setDayLocal(pid, date, strokeVal); }
    if (!changed) return;
    stroke.push(date);
    const el = grid.querySelector(`[data-date="${date}"]`); if (el) el.outerHTML = cellHTML(pid, date);
  };
  grid.addEventListener('pointerdown', e => {
    const cell = e.target.closest('[data-date]');
    if (!cell || saving) return;
    if (!navigator.onLine) return toast('Brak internetu — grafik wymaga połączenia', true);
    e.preventDefault();
    grid.setPointerCapture(e.pointerId);
    const cur = entry(pid, cell.dataset.date);
    strokeVal = tool === 'erase' || cur?.cat === tool ? null : tool;
    painting = true; stroke = [];
    paint(cell.dataset.date);
  });
  grid.addEventListener('pointermove', e => {
    if (!painting) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.gr-grid [data-date]');
    if (el) paint(el.dataset.date);
  });
  const end = () => {
    if (!painting) return; painting = false;
    const days = [...new Set(stroke)]; stroke = [];
    if (!days.length) return;
    guard(async () => { await gd.pushDays(pid, days); await gd.grLoad(); });
  };
  grid.addEventListener('pointerup', end);
  grid.addEventListener('pointercancel', end);
}
export const isPainting = () => painting;

function setStatus(s) { status = s; const el = document.getElementById('grStatus'); if (el) el.textContent = s; }
async function pull(pid, ym, manual) {
  if (!G.settings?.api_url || !person(pid)?.calendar_id) { if (manual) setStatus('Uzupełnij połączenie i ID kalendarza w ustawieniach grafiku'); return; }
  setStatus('Wczytywanie z kalendarza…');
  try { await gd.pullMonth(pid, ym); setStatus(`Aktualne z kalendarza · ${new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}`); }
  catch (e) { setStatus('Nie udało się wczytać z kalendarza: ' + e.message); }
}
async function save(pid) {
  if (saving) return;
  saving = true; setStatus('Zapisywanie…'); renderGrafik({ p: pid, m: curParams.m });
  try {
    const s = await gd.saveToCalendar(pid, ym => setStatus(`Zapisywanie: ${monthLabel(ym)}…`));
    status = `Zapisano w kalendarzu · nowe: ${s.created}, zmienione: ${s.updated}, usunięte: ${s.deleted}`;
  } catch (e) { status = 'Błąd zapisu: ' + e.message; }
  saving = false;
  if (location.hash.startsWith('#grafik')) renderGrafik({ p: pid, m: curParams.m });
}

// ------------------------------------------------------------- pierwsze uruchomienie
function renderSetup() {
  const old = gd.oldSettings();
  const meMember = state.members.find(m => m.user_id === state.user?.id);
  view.innerHTML = `
    ${old ? `<form class="card" id="imp">
      <h2>Przenieś dawny Grafik</h2>
      <p class="hint">Na tym telefonie są ustawienia dawnego Grafiku. Wskaż, kto jest kim — osoby, kalendarze i kategorie trafią do wspólnej bazy.</p>
      ${old.people.map(op => `<label class="field">${esc(op.name)} ${op.calendarId ? `<small class="muted">(${esc(op.calendarId)})</small>` : ''}
        <select name="${esc(op.id)}" style="width:100%"><option value="">— pomiń —</option>${state.members.map(m => `<option value="${m.user_id}" ${guess(op, m) ? 'selected' : ''}>${esc(m.display_name)}</option>`).join('')}</select></label>`).join('')}
      <button class="btn primary">Przenieś</button>
    </form>` : ''}
    <form class="card" id="new">
      <h2>${old ? 'albo zacznij od nowa' : 'Twój grafik'}</h2>
      <label class="field">Imię w nazwie wydarzenia ({osoba})<input name="name" value="${esc((meMember?.display_name || '').toLowerCase())}" required></label>
      <label class="field">ID Kalendarza Google<input name="cal" placeholder="adres@gmail.com"></label>
      <button class="btn${old ? '' : ' primary'}">Utwórz mój grafik</button>
    </form>`;
  view.querySelector('#imp')?.addEventListener('submit', e => { e.preventDefault();
    const mapping = Object.fromEntries(old.people.map(op => [op.id, e.target.elements[op.id].value]));
    guard(async () => { await gd.importOld(mapping); toast('Przeniesiono'); go('grafik'); }); });
  view.querySelector('#new').onsubmit = e => { e.preventDefault();
    guard(async () => { await gd.savePerson({ name: e.target.name.value.trim(), calendar_id: e.target.cal.value.trim(), color: '#2563eb', daily_norm: 8, user_id: state.user.id }); go('grafik-ustawienia'); }); };
}
const guess = (op, m) => (m.display_name || '').toLowerCase().startsWith((op.name || '').toLowerCase().slice(0, 3));

// ------------------------------------------------------------- ustawienia
let calendars = [];
export function renderGrafikSettings() {
  gd.grEnsure();
  if (!G.loaded) { view.innerHTML = '<p class="muted center">Ładowanie…</p>'; return; }
  const mine = me();
  if (!mine) return renderSetup();
  const cats = catsFor(mine.id);
  const s = G.settings || {};
  view.innerHTML = `
    <a class="btn" href="#grafik">← Grafik</a>
    <form class="card" id="conn">
      <h2>Połączenie z Kalendarzem Google</h2>
      <p class="hint">Wspólne dla domu — ten sam Apps Script co dotąd.</p>
      <input name="url" type="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(s.api_url || '')}">
      <input name="key" type="password" placeholder="Klucz API (API_KEY ze skryptu)" value="${esc(s.api_key || '')}" style="margin-top:8px">
      <div class="row"><button class="btn primary">Zapisz</button><button type="button" class="btn" id="ping">Testuj</button><button type="button" class="btn" id="cals">Lista kalendarzy</button></div>
      <p class="hint" id="cs"></p>
    </form>
    <form class="card" id="me">
      <h2>Mój grafik</h2>
      <label class="field">Imię w nazwie wydarzenia ({osoba})<input name="name" value="${esc(mine.name)}" required></label>
      <label class="field">ID kalendarza<input name="cal" list="calList" value="${esc(mine.calendar_id || '')}" placeholder="adres@gmail.com"></label>
      <datalist id="calList">${calendars.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</datalist>
      <div class="row"><label class="field">Kolor<input type="color" name="color" value="${esc(mine.color)}"></label>
        <label class="field">Norma dobowa (h)<input name="norm" inputmode="decimal" value="${mine.daily_norm}"></label></div>
      <button class="btn primary">Zapisz</button>
    </form>
    <h3>Moje kategorie</h3>
    <p class="hint">Nazwa wydarzenia to szablon: <code>{osoba}</code> <code>{od}</code> <code>{do}</code> <code>{nazwa}</code> <code>{skrot}</code>, np. „{osoba} {od}-{do}” → „${esc(mine.name)} 8-20”.</p>
    ${cats.map((c, i) => catForm(c, mine, i, cats.length)).join('')}
    ${catForm({ person_id: mine.id, name: '', short: '', color: '#64748b', all_day: false, start_time: '07:00', end_time: '19:00', template: '{osoba} {od}-{do}', kind: 'work', local: false }, mine, -1, 0)}
    ${G.people.filter(p => p.id !== mine.id).map(o => `<form class="card gr-other" data-id="${o.id}">
      <h2>Kalendarz: ${esc(o.name)}</h2>
      <label class="field">ID kalendarza<input name="cal" list="calList" value="${esc(o.calendar_id || '')}" placeholder="adres@gmail.com"></label>
      <p class="hint">Kategorie i grafik tej osoby zmienia ona sama na swoim telefonie.</p>
      <button class="btn primary">Zapisz</button>
    </form>`).join('')}`;
  const cs = view.querySelector('#cs');
  view.querySelector('#conn').onsubmit = e => { e.preventDefault(); guard(async () => { await gd.saveSettings(e.target.url.value.trim(), e.target.key.value.trim()); toast('Zapisano'); }); };
  view.querySelector('#ping').onclick = async () => { cs.textContent = 'Łączenie…'; try { const r = await gd.api('ping'); cs.textContent = `Połączono (strefa: ${r.tz})`; } catch (e) { cs.textContent = 'Błąd: ' + e.message; } };
  view.querySelector('#cals').onclick = async () => { cs.textContent = 'Pobieranie…'; try { calendars = (await gd.api('calendars')).calendars; renderGrafikSettings(); toast(`${calendars.length} kalendarzy — wybierz w polu ID kalendarza`); } catch (e) { cs.textContent = 'Błąd: ' + e.message; } };
  view.querySelector('#me').onsubmit = e => { e.preventDefault(); const f = e.target;
    guard(async () => { await gd.savePerson({ id: mine.id, name: f.name.value.trim(), calendar_id: f.cal.value.trim(), color: f.color.value, daily_norm: parseFloat(f.norm.value.replace(',', '.')) || 8 }); toast('Zapisano'); }); };
  view.querySelectorAll('form.gr-other').forEach(f => f.onsubmit = e => { e.preventDefault();
    const o = person(f.dataset.id);
    guard(async () => { await gd.savePerson({ ...o, calendar_id: f.cal.value.trim() }); toast('Zapisano'); }); });
  view.querySelectorAll('form.gr-cat').forEach(f => {
    const id = f.dataset.id || null;
    const read = () => ({ id, person_id: mine.id, name: f.name_.value.trim(), short: f.short.value.trim(), color: f.color.value, all_day: f.all_day.checked,
      start_time: f.start_time?.value || null, end_time: f.end_time?.value || null, template: f.template?.value || '', kind: f.kind.value, local: f.local.checked });
    f.onsubmit = e => { e.preventDefault(); guard(async () => { const c = read(); if (!c.short) throw new Error('Podaj skrót'); await gd.saveCat(c); toast('Zapisano'); renderGrafikSettings(); }); };
    f.querySelectorAll('input[name=all_day], input[name=local]').forEach(x => x.onchange = () => { f.querySelector('.times').hidden = f.all_day.checked || f.local.checked; f.querySelector('.tpl').hidden = f.local.checked; });
    f.querySelector('[data-del]')?.addEventListener('click', () => confirm('Usunąć kategorię? Dni z nią zostaną puste w grafiku (w kalendarzu do najbliższego zapisu).') && guard(async () => { await gd.deleteCat(id); renderGrafikSettings(); }));
    f.querySelectorAll('[data-move]').forEach(b => b.onclick = () => guard(async () => {
      const list = catsFor(mine.id), i = list.findIndex(c => c.id === id), j = i + +b.dataset.move;
      if (j < 0 || j >= list.length) return;
      await gd.saveCat({ ...list[i], position: j }); await gd.saveCat({ ...list[j], position: i }); renderGrafikSettings();
    }));
  });
}
function catForm(c, p, i, n) {
  const isNew = i < 0;
  return `<form class="card gr-cat" data-id="${c.id || ''}" style="--c:${esc(c.color)}">
    ${isNew ? '<h3 style="margin-top:0">+ Nowa kategoria</h3>' : ''}
    <div class="gr-catrow"><input name="short" value="${esc(c.short)}" maxlength="5" placeholder="Skrót"><input name="name_" value="${esc(c.name)}" placeholder="Nazwa, np. Dzienna"><input type="color" name="color" value="${esc(c.color)}"></div>
    <label class="field">Typ<select name="kind" style="width:100%">
      <option value="work" ${c.kind === 'work' ? 'selected' : ''}>praca — liczy się do czasu pracy</option>
      <option value="other" ${c.kind === 'other' ? 'selected' : ''}>dyżur / inne — poza czasem pracy</option>
      <option value="leave" ${c.kind === 'leave' ? 'selected' : ''}>urlop / L4 (obniża normę)</option>
      <option value="off" ${c.kind === 'off' ? 'selected' : ''}>wolne / odbiór</option></select></label>
    <label class="check"><input type="checkbox" name="all_day" ${c.all_day ? 'checked' : ''}> cały dzień</label>
    <label class="check"><input type="checkbox" name="local" ${c.local ? 'checked' : ''}> tylko w Dom (nie wysyłaj do kalendarza)</label>
    <div class="row times" ${c.all_day || c.local ? 'hidden' : ''}><label class="field">od<input type="time" name="start_time" value="${esc(c.start_time || '')}"></label><label class="field">do<input type="time" name="end_time" value="${esc(c.end_time || '')}"></label></div>
    <div class="tpl" ${c.local ? 'hidden' : ''}><label class="field">Nazwa wydarzenia<input name="template" value="${esc(c.template)}"></label>
      ${!isNew ? `<p class="hint">→ <b>${esc(renderTitle(c, p))}</b></p>` : ''}</div>
    <div class="row between">${isNew ? '<span></span>' : `<span class="row" style="margin:0"><button type="button" class="btn small" data-move="-1" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" class="btn small" data-move="1" ${i === n - 1 ? 'disabled' : ''}>↓</button><button type="button" class="btn small danger" data-del>Usuń</button></span>`}
      <button class="btn primary">${isNew ? 'Dodaj' : 'Zapisz'}</button></div>
  </form>`;
}
