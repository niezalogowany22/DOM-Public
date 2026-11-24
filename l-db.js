// Warstwa danych: Supabase + lokalna kopia (offline) + kolejka zapisów odczytów.
// Ten sam klient Supabase co reszta aplikacji Dom
export { sb, configured, initError } from './db.js';
import { sb } from './db.js';

export const state = {
  user: null, household: null, members: [],
  readings: [], tariffs: [], periods: [], expenses: [],
  online: navigator.onLine, syncing: false,
};
const listeners = new Set();
export const onChange = fn => listeners.add(fn);
const emit = () => listeners.forEach(fn => fn());

const QKEY = 'liczniki:queue';
const ckey = () => `liczniki:cache:${state.household?.id}`;
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export const queue = () => lsGet(QKEY, []);
const saveCache = () => lsSet(ckey(), {
  household: state.household, members: state.members,
  readings: state.readings, tariffs: state.tariffs, periods: state.periods, expenses: state.expenses,
});

// ------------------------------------------------------------- auth
export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}
export async function signUp(email, password) {
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
  return !!data.session; // false = trzeba potwierdzić maila
}
export async function signOut() {
  await sb.auth.signOut();
  localStorage.removeItem(QKEY);
  Object.assign(state, { user: null, household: null, members: [], readings: [], tariffs: [], periods: [], expenses: [] });
}

// ------------------------------------------------------------- dom
export async function loadHousehold() {
  const { data: { session } } = await sb.auth.getSession();
  state.user = session?.user ?? null;
  if (!state.user) return null;
  const lastId = localStorage.getItem('liczniki:household');
  // offline: z kopii
  if (!navigator.onLine && lastId) { restoreCache(lastId); return state.household; }
  const { data, error } = await sb.from('household_members')
    .select('household_id, households(*)').eq('user_id', state.user.id);
  if (error) { if (lastId) { restoreCache(lastId); return state.household; } throw error; }
  if (!data.length) return null;
  const row = data.find(d => d.household_id === lastId) || data[0];
  state.household = row.households;
  localStorage.setItem('liczniki:household', state.household.id);
  restoreCache(state.household.id, true);
  return state.household;
}
function restoreCache(id, keepHousehold = false) {
  const c = lsGet(`liczniki:cache:${id}`, null);
  if (!c) return;
  if (!keepHousehold) state.household = c.household;
  Object.assign(state, { members: c.members, readings: c.readings, tariffs: c.tariffs, periods: c.periods, expenses: c.expenses || [] });
  applyQueueLocally();
}
export async function createHousehold(name, displayName) {
  const { error } = await sb.rpc('create_household', { p_name: name, p_display_name: displayName });
  if (error) throw error;
  return loadHousehold();
}
export async function joinHousehold(code, displayName) {
  const { error } = await sb.rpc('join_household', { p_code: code, p_display_name: displayName });
  if (error) throw error;
  return loadHousehold();
}
export async function renameMe(displayName) {
  const { error } = await sb.from('household_members').update({ display_name: displayName })
    .eq('household_id', state.household.id).eq('user_id', state.user.id);
  if (error) throw error;
  await refresh();
}

// ------------------------------------------------------------- pobieranie
export async function refresh() {
  if (!state.household || !navigator.onLine) return;
  const h = state.household.id;
  const [m, r, t, p, e] = await Promise.all([
    sb.from('household_members').select('*').eq('household_id', h),
    sb.from('readings').select('*').eq('household_id', h).order('month'),
    sb.from('tariffs').select('*').eq('household_id', h).order('valid_from'),
    sb.from('settlement_periods').select('*').eq('household_id', h).order('start_month'),
    sb.from('expenses').select('*').eq('household_id', h).order('month'),
  ]);
  for (const x of [m, r, t, p]) if (x.error) throw x.error;
  if (e.error) console.warn('Brak tabeli expenses — uruchom aktualizację SQL', e.error);
  Object.assign(state, { members: m.data, readings: r.data, tariffs: t.data, periods: p.data, expenses: e.data || [] });
  saveCache();
  applyQueueLocally();
  emit();
}

let channel = null;
export function subscribe() {
  if (channel || !state.household) return;
  const h = state.household.id;
  let timer = null;
  const later = () => { clearTimeout(timer); timer = setTimeout(() => refresh().catch(console.warn), 400); };
  channel = sb.channel('hh-' + h);
  for (const table of ['readings', 'tariffs', 'settlement_periods', 'expenses'])
    channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `household_id=eq.${h}` }, later);
  channel.subscribe();
}

// ------------------------------------------------------------- odczyty (offline-first)
function applyQueueLocally() {
  for (const op of queue()) applyOp(op);
}
function applyOp(op) {
  const i = state.readings.findIndex(r => r.kind === op.row.kind && r.month === op.row.month);
  if (op.type === 'delete') { if (i >= 0) state.readings.splice(i, 1); return; }
  const merged = { ...(i >= 0 ? state.readings[i] : {}), ...op.row, _pending: true };
  if (i >= 0) state.readings[i] = merged; else state.readings.push(merged);
}

export function saveReading(row) {
  enqueue({ type: 'upsert', row: {
    household_id: state.household.id, kind: row.kind, month: row.month, value: row.value,
    read_on: row.read_on || null, bill_amount: row.bill_amount ?? null,
    swap_old_final: row.swap_old_final ?? null, swap_new_start: row.swap_new_start ?? null,
    note: row.note || null, created_by: row.created_by || state.user.id,
  }});
}
export function deleteReading(kind, month) {
  enqueue({ type: 'delete', row: { household_id: state.household.id, kind, month } });
}
function enqueue(op) {
  const q = queue().filter(o => !(o.row.kind === op.row.kind && o.row.month === op.row.month));
  q.push(op); lsSet(QKEY, q);
  applyOp(op); saveCache(); emit();
  flush();
}

export async function flush() {
  if (state.syncing || !navigator.onLine || !sb) return;
  let q = queue(); if (!q.length) return;
  state.syncing = true; emit();
  try {
    while (q.length) {
      const op = q[0];
      const res = op.type === 'delete'
        ? await sb.from('readings').delete().eq('household_id', op.row.household_id).eq('kind', op.row.kind).eq('month', op.row.month)
        : await sb.from('readings').upsert(op.row, { onConflict: 'household_id,kind,month' });
      if (res.error) {
        if (/fetch|network/i.test(res.error.message)) break; // brak sieci — spróbuj później
        console.error('Odrzucony zapis', op, res.error);       // błąd danych — wyrzuć z kolejki
      }
      q = queue().slice(1); lsSet(QKEY, q);
    }
  } finally {
    state.syncing = false;
    await refresh().catch(() => emit());
  }
}
window.addEventListener('online', () => { state.online = true; emit(); flush(); });
window.addEventListener('offline', () => { state.online = false; emit(); });

// ------------------------------------------------------------- stawki, okresy (wymagają sieci)
function needOnline() { if (!navigator.onLine) throw new Error('Ta zmiana wymaga połączenia z internetem.'); }
async function run(p) { const { error } = await p; if (error) throw error; await refresh(); }

export const saveTariff = t => { needOnline(); return run(t.id
  ? sb.from('tariffs').update({ valid_from: t.valid_from, vals: t.vals, note: t.note }).eq('id', t.id)
  : sb.from('tariffs').insert({ household_id: state.household.id, valid_from: t.valid_from, vals: t.vals, note: t.note })); };
export const deleteTariff = id => { needOnline(); return run(sb.from('tariffs').delete().eq('id', id)); };

export const savePeriod = p => { needOnline();
  const row = { name: p.name, media: p.media, start_month: p.start_month, end_month: p.end_month,
                actual_amount: p.actual_amount, note: p.note };
  return run(p.id ? sb.from('settlement_periods').update(row).eq('id', p.id)
                  : sb.from('settlement_periods').insert({ ...row, household_id: state.household.id })); };
export const saveExpense = x => { needOnline();
  const row = { month: x.month, name: x.name, amount: x.amount, note: x.note };
  return run(x.id ? sb.from('expenses').update(row).eq('id', x.id)
                  : sb.from('expenses').insert({ ...row, household_id: state.household.id })); };
export const deleteExpense = id => { needOnline(); return run(sb.from('expenses').delete().eq('id', id)); };
export const deletePeriod = id => { needOnline(); return run(sb.from('settlement_periods').delete().eq('id', id)); };

// ------------------------------------------------------------- import / kopia
export async function bulkImport({ readings = [], tariffs = [], periods = [], expenses = [] }, overwrite = false) {
  needOnline();
  const h = state.household.id;
  const has = new Set(state.readings.map(r => r.kind + r.month));
  const rs = readings.filter(r => overwrite || !has.has(r.kind + r.month))
    .map(r => ({ household_id: h, kind: r.kind, month: r.month, value: r.value, read_on: r.read_on ?? null,
      bill_amount: r.bill_amount ?? null, swap_old_final: r.swap_old_final ?? null,
      swap_new_start: r.swap_new_start ?? null, note: r.note ?? null }));
  const hasT = new Set(state.tariffs.map(t => t.valid_from));
  const ts = tariffs.filter(t => overwrite || !hasT.has(t.valid_from))
    .map(t => ({ household_id: h, valid_from: t.valid_from, vals: t.vals, note: t.note ?? null }));
  const hasP = new Set(state.periods.map(p => p.name + p.start_month));
  const ps = periods.filter(p => !hasP.has(p.name + p.start_month)).map(p => ({ household_id: h, name: p.name, media: p.media, start_month: p.start_month,
    end_month: p.end_month, actual_amount: p.actual_amount ?? null, note: p.note ?? null }));
  if (rs.length) { const { error } = await sb.from('readings').upsert(rs, { onConflict: 'household_id,kind,month' }); if (error) throw error; }
  if (ts.length) { const { error } = await sb.from('tariffs').upsert(ts, { onConflict: 'household_id,valid_from' }); if (error) throw error; }
  if (ps.length) { const { error } = await sb.from('settlement_periods').insert(ps); if (error) throw error; }
  const hasE = new Set(state.expenses.map(x => x.month + x.name + x.amount));
  const es = expenses.filter(x => !hasE.has(x.month + x.name + x.amount))
    .map(x => ({ household_id: h, month: x.month, name: x.name, amount: x.amount, note: x.note ?? null }));
  if (es.length) { const { error } = await sb.from('expenses').insert(es); if (error) throw error; }
  await refresh();
  return { readings: rs.length, tariffs: ts.length, periods: ps.length, expenses: es.length };
}

export const memberName = id => state.members.find(m => m.user_id === id)?.display_name || '';
