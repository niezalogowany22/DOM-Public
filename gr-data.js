// Grafik — dane we wspólnej bazie + synchronizacja z Kalendarzem Google (Apps Script)
import { sb, state } from './db.js';

export const G = { settings: null, people: [], cats: [], rows: new Map(), loaded: false, ready: true };
const listeners = new Set();
export const onGr = fn => listeners.add(fn);
const emit = () => listeners.forEach(fn => { try { fn(); } catch (e) { console.warn(e); } });
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const CKEY = () => `dom:grafik:${state.household?.id}`;

export const pad = n => String(n).padStart(2, '0');
export const fmtYM = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const shiftYM = (ym, n) => { const [y, m] = ym.split('-').map(Number); return fmtYM(new Date(y, m - 1 + n, 1)); };
export const monthDays = ym => { const [y, m] = ym.split('-').map(Number); return Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => `${ym}-${pad(i + 1)}`); };
export const rowKey = (pid, day) => `${pid}|${day}`;

// ------------------------------------------------------------- pomocnicze
export const person = id => G.people.find(p => p.id === id);
export const cat = id => G.cats.find(c => c.id === id);
export const catsFor = pid => G.cats.filter(c => c.person_id === pid).sort((a, b) => a.position - b.position);
export const me = () => G.people.find(p => p.user_id === state.user?.id);
export const isOwner = pid => person(pid)?.user_id === state.user?.id;
export const row = (pid, day) => G.rows.get(rowKey(pid, day));
export const fmtH = t => { if (!t) return ''; const [h, m] = t.split(':'); return String(Number(h)) + (m && m !== '00' ? ':' + m : ''); };
export function renderTitle(c, p) {
  const vals = { osoba: p?.name || '', od: c.all_day ? '' : fmtH(c.start_time), do: c.all_day ? '' : fmtH(c.end_time), nazwa: c.name || '', skrot: c.short || '' };
  return (c.template || '{osoba} {od}-{do}').replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m)).replace(/\s+/g, ' ').trim();
}
// stan dnia: { cat } | { raw } | null
export function entry(pid, day) {
  const r = row(pid, day);
  if (!r) return null;
  if (r.category_id && cat(r.category_id)) return { cat: r.category_id };
  if (r.raw) return { raw: r.raw };
  return null;
}
export const unsynced = pid => [...G.rows.values()].filter(r => r.person_id === pid && !r.synced);

// ------------------------------------------------------------- wczytanie
function setRows(list) { G.rows = new Map(list.map(r => [rowKey(r.person_id, r.day), r])); }
export function restoreGr() {
  const c = lsGet(CKEY(), null);
  if (!c) return;
  Object.assign(G, { settings: c.settings, people: c.people || [], cats: c.cats || [], loaded: true });
  setRows(c.rows || []);
}
export async function grLoad() {
  if (!state.household || !navigator.onLine) return;
  const h = state.household.id;
  const d = new Date(); d.setMonth(d.getMonth() - 13); d.setDate(1);
  const since = d.toLocaleDateString('sv-SE');
  const [s, p, c, r] = await Promise.all([
    sb.from('grafik_settings').select('*').eq('household_id', h),
    sb.from('grafik_people').select('*').eq('household_id', h).order('position').order('created_at'),
    sb.from('grafik_categories').select('*').eq('household_id', h).order('position').order('created_at'),
    sb.from('grafik_days').select('*').eq('household_id', h).gte('day', since),
  ]);
  if (s.error || p.error || c.error || r.error) { G.ready = false; console.warn('Grafik: uruchom schema-grafik.sql', s.error || p.error || c.error || r.error); emit(); return; }
  Object.assign(G, { settings: s.data[0] || null, people: p.data, cats: c.data, loaded: true, ready: true });
  setRows(r.data);
  lsSet(CKEY(), { settings: G.settings, people: G.people, cats: G.cats, rows: r.data });
  emit();
}
let channel = null;
export function grSubscribe() {
  if (channel || !state.household) return;
  const h = state.household.id; let t;
  const later = () => { clearTimeout(t); t = setTimeout(() => grLoad().catch(console.warn), 500); };
  channel = sb.channel('grafik-' + h);
  for (const table of ['grafik_settings', 'grafik_people', 'grafik_categories', 'grafik_days'])
    channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `household_id=eq.${h}` }, later);
  channel.subscribe();
}
let started = null;
export function grEnsure() {
  if (!started) { restoreGr(); started = grLoad().then(grSubscribe).catch(e => { started = null; console.warn(e); }); }
  return started;
}

// ------------------------------------------------------------- zapisy w bazie
async function run(p) { const { data, error } = await p; if (error) throw error; return data; }
const need = () => { if (!navigator.onLine) throw new Error('Brak internetu — zmiany w grafiku wymagają połączenia.'); };

export async function saveSettings(api_url, api_key) {
  need();
  await run(sb.from('grafik_settings').upsert({ household_id: state.household.id, api_url, api_key, updated_at: new Date().toISOString() }));
  await grLoad();
}
export async function savePerson(p) {
  need();
  const rowP = { name: p.name, calendar_id: p.calendar_id || null, color: p.color, daily_norm: p.daily_norm || 8 };
  if (p.id) await run(sb.from('grafik_people').update(rowP).eq('id', p.id));
  else await run(sb.from('grafik_people').insert({ ...rowP, household_id: state.household.id, user_id: p.user_id, position: G.people.length }));
  await grLoad();
}
export async function saveCat(c) {
  need();
  const r = { name: c.name, short: c.short, color: c.color, all_day: !!c.all_day, start_time: c.start_time || null, end_time: c.end_time || null,
    template: c.template || '', kind: c.kind || 'work', local: !!c.local, position: c.position ?? catsFor(c.person_id).length };
  if (c.id) await run(sb.from('grafik_categories').update(r).eq('id', c.id));
  else await run(sb.from('grafik_categories').insert({ ...r, household_id: state.household.id, person_id: c.person_id }));
  await grLoad();
}
export async function deleteCat(id) { need(); await run(sb.from('grafik_categories').delete().eq('id', id)); await grLoad(); }

// Malowanie: zmiany od razu lokalnie, do bazy po zakończeniu ruchu palcem
export function setDayLocal(pid, day, categoryId) {
  const prev = row(pid, day);
  const r = { household_id: state.household.id, person_id: pid, day, category_id: categoryId || null, raw: null, synced: false };
  if (prev && prev.category_id === r.category_id && !prev.raw) return false;
  G.rows.set(rowKey(pid, day), { ...prev, ...r });
  return true;
}
export async function pushDays(pid, days) {
  if (!days.length) return;
  need();
  const rows = days.map(d => { const r = row(pid, d); return { household_id: r.household_id, person_id: pid, day: d, category_id: r.category_id, raw: null, synced: false, updated_at: new Date().toISOString() }; });
  await run(sb.from('grafik_days').upsert(rows, { onConflict: 'person_id,day' }));
}

// ------------------------------------------------------------- Kalendarz Google (Apps Script)
export async function api(action, payload = {}) {
  const s = G.settings;
  if (!s?.api_url) throw new Error('Brak adresu skryptu — uzupełnij ustawienia grafiku');
  const res = await fetch(s.api_url, { method: 'POST', body: JSON.stringify({ key: s.api_key, action, ...payload }) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  let data; try { data = await res.json(); } catch { throw new Error('Nieprawidłowa odpowiedź skryptu'); }
  if (!data.ok) throw new Error(data.error || 'Nieznany błąd');
  return data;
}
const rangeFor = (p, ym) => ({ calendarId: p.calendar_id, from: `${ym}-01`, to: `${shiftYM(ym, 1)}-01` });
function eventsToDays(events, pid) {
  const p = person(pid);
  const byTitle = new Map(catsFor(pid).filter(c => !c.local).map(c => [renderTitle(c, p), c]));
  const days = {};
  for (const ev of events) {
    let e = null;
    const c = ev.cat && cat(ev.cat);
    if (c && c.person_id === pid) e = { cat: c.id };
    else if (byTitle.has(ev.title)) e = { cat: byTitle.get(ev.title).id };
    else if (ev.tagged) e = { raw: { title: ev.title, allDay: ev.allDay, start: ev.start, end: ev.end } };
    if (e && !days[ev.date]) days[ev.date] = e;
  }
  return days;
}

// Pobierz miesiąc z kalendarza do bazy. Nie rusza niezapisanych zmian ani wpisów „tylko w Dom”
// (chyba że mode = 'all' po zapisie / 'discard' przy cofaniu).
const PULLKEY = 'dom:grpull';
export const pulledAt = (pid, ym) => lsGet(PULLKEY, {})[rowKey(pid, ym)] || 0;
export async function pullMonth(pid, ym, mode = 'normal') {
  const p = person(pid);
  if (!p?.calendar_id || !G.settings?.api_url || !navigator.onLine) return false;
  const owner = isOwner(pid);
  const fresh = eventsToDays((await api('list', rangeFor(p, ym))).events, pid);
  const ups = [], dels = [];
  for (const day of monthDays(ym)) {
    const r = row(pid, day), c = r?.category_id && cat(r.category_id);
    if (r && !r.synced && mode === 'normal') continue;
    if (r && c?.local) { if (mode !== 'normal' && !r.synced && owner) ups.push({ ...base(pid, day), category_id: r.category_id, raw: null, synced: true }); continue; }
    const want = fresh[day];
    if (!want) { if (r) dels.push(day); continue; }
    if (!r || !r.synced || r.category_id !== (want.cat || null) || JSON.stringify(r.raw || null) !== JSON.stringify(want.raw || null))
      ups.push({ ...base(pid, day), category_id: want.cat || null, raw: want.raw || null, synced: true });
  }
  if (ups.length) await run(sb.from('grafik_days').upsert(ups, { onConflict: 'person_id,day' }));
  if (dels.length) await run(sb.from('grafik_days').delete().eq('person_id', pid).in('day', dels));
  const t = lsGet(PULLKEY, {}); t[rowKey(pid, ym)] = Date.now(); lsSet(PULLKEY, t);
  if (ups.length || dels.length) { await grLoad(); return true; }
  return false;
}
const base = (pid, day) => ({ household_id: state.household.id, person_id: pid, day, updated_at: new Date().toISOString() });

function toItem(e, day, p) {
  if (!e) return null;
  if (e.raw) return { date: day, ...e.raw, cat: '' };
  const c = cat(e.cat);
  if (!c || c.local) return null;
  return { date: day, title: renderTitle(c, p), allDay: !!c.all_day, start: c.start_time, end: c.end_time, cat: c.id };
}
// Zapis do Kalendarza Google: wszystkie miesiące z niezapisanymi zmianami (tylko własny grafik)
export async function saveToCalendar(pid, onStep) {
  need();
  const p = person(pid);
  if (!isOwner(pid)) throw new Error('Możesz zapisywać tylko swój grafik.');
  if (!p.calendar_id) throw new Error('Ustaw ID swojego kalendarza w ustawieniach grafiku.');
  const months = [...new Set(unsynced(pid).map(r => r.day.slice(0, 7)))].sort();
  const sum = { created: 0, updated: 0, deleted: 0 };
  for (const ym of months) {
    onStep?.(ym);
    const range = rangeFor(p, ym);
    const fresh = eventsToDays((await api('list', range)).events, pid);
    const items = [];
    for (const day of monthDays(ym)) {
      const r = row(pid, day);
      const it = toItem(r ? entry(pid, day) : fresh[day], day, p);
      if (it) items.push(it);
    }
    const managedTitles = catsFor(pid).filter(c => !c.local).map(c => renderTitle(c, p));
    const res = await api('sync', { ...range, items, managedTitles });
    for (const k in sum) sum[k] += res.stats?.[k] || 0;
    // po zapisie: puste dni usuń, resztę oznacz jako zapisane, uzgodnij z kalendarzem
    const empty = monthDays(ym).filter(d => { const r = row(pid, d); return r && !r.synced && !r.category_id && !r.raw; });
    if (empty.length) await run(sb.from('grafik_days').delete().eq('person_id', pid).in('day', empty));
    await run(sb.from('grafik_days').update({ synced: true }).eq('person_id', pid).eq('synced', false).gte('day', `${ym}-01`).lt('day', `${shiftYM(ym, 1)}-01`));
    await grLoad();
    await pullMonth(pid, ym, 'all');
  }
  await grLoad();
  return sum;
}
export async function discardChanges(pid) {
  need();
  const months = [...new Set(unsynced(pid).map(r => r.day.slice(0, 7)))];
  await run(sb.from('grafik_days').delete().eq('person_id', pid).eq('synced', false));
  await grLoad();
  for (const ym of months) await pullMonth(pid, ym, 'discard').catch(console.warn);
}

// ------------------------------------------------------------- import z dawnego Grafiku (pamięć telefonu)
export const oldSettings = () => lsGet('grafik.settings', null);
// mapping: { oldPersonId: userId | '' }
export async function importOld(mapping) {
  need();
  const old = oldSettings(); if (!old) throw new Error('Brak ustawień dawnego Grafiku na tym telefonie');
  const h = state.household.id;
  if (!G.settings?.api_url && old.apiUrl) await run(sb.from('grafik_settings').upsert({ household_id: h, api_url: old.apiUrl, api_key: old.apiKey }));
  for (const [i, op] of old.people.entries()) {
    const uid = mapping[op.id]; if (!uid) continue;
    let p = G.people.find(x => x.user_id === uid);
    if (!p) p = (await run(sb.from('grafik_people').insert({ household_id: h, user_id: uid, name: op.name, calendar_id: op.calendarId || null,
      color: op.color || '#2563eb', daily_norm: op.dailyNorm || 8, position: i }).select().single()));
    else if (!p.calendar_id && op.calendarId) await run(sb.from('grafik_people').update({ calendar_id: op.calendarId }).eq('id', p.id));
    const existing = new Set(G.cats.filter(c => c.person_id === p.id).map(c => c.name + '|' + c.short));
    const cats = old.categories.filter(c => !c.personId || c.personId === op.id).filter(c => !existing.has(c.name + '|' + c.short));
    if (cats.length) await run(sb.from('grafik_categories').insert(cats.map((c, j) => ({ household_id: h, person_id: p.id, name: c.name || '', short: c.short || '',
      color: c.color || '#64748b', all_day: !!c.allDay, start_time: c.start || null, end_time: c.end || null, template: c.template || '',
      kind: c.kind || (c.allDay ? 'leave' : 'work'), local: c.local ?? c.kind === 'off', position: j }))));
  }
  await grLoad();
  // dni „tylko w apce” (np. Wolne) z dawnego Grafiku — tylko własne
  const oldLocal = lsGet('grafik.local', {});
  const mine = me();
  const myOld = old.people.find(op => mapping[op.id] === state.user.id);
  if (mine && myOld) {
    const rows = [];
    for (const [k, days] of Object.entries(oldLocal)) {
      if (!k.startsWith(myOld.id + '|')) continue;
      for (const [day, oldCatId] of Object.entries(days)) {
        const oc = old.categories.find(c => c.id === oldCatId); if (!oc) continue;
        const nc = G.cats.find(c => c.person_id === mine.id && c.name === oc.name && c.short === oc.short); if (!nc) continue;
        rows.push({ household_id: h, person_id: mine.id, day, category_id: nc.id, raw: null, synced: true });
      }
    }
    if (rows.length) await run(sb.from('grafik_days').upsert(rows, { onConflict: 'person_id,day' }));
  }
  await grLoad();
}
