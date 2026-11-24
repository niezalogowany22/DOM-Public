// Warstwa danych: Supabase (ten sam projekt co Liczniki) + lokalna kopia do podglądu offline.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const configured = !SUPABASE_URL.includes('TWOJ-PROJEKT') && !SUPABASE_ANON_KEY.includes('WKLEJ');
export let initError = null;
export const sb = (() => {
  if (!configured) return null;
  try { return window.supabase.createClient(SUPABASE_URL.trim(), SUPABASE_ANON_KEY.trim()); }
  catch (e) { initError = e; return null; }
})();

export const state = {
  user: null, household: null, members: [],
  groups: [], people: [], categories: [], expenses: [],
  shop: [], known: [], cards: [], lists: [], shopReady: true,
  recipes: [], plan: [], kitchenReady: true,
  budget: null, deposits: [], recurring: [], budgetReady: true, rules: [],
  warranties: [], pantry: [], extrasReady: true, bills: { readings: [], periods: [], expenses: [] },
  online: navigator.onLine, loaded: false,
};
const listeners = new Set();
export const onChange = fn => listeners.add(fn);
const emit = () => listeners.forEach(fn => fn());

const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const ckey = () => `dom:cache:${state.household?.id}`;
const saveCache = () => lsSet(ckey(), {
  household: state.household, members: state.members, groups: state.groups,
  people: state.people, categories: state.categories, expenses: state.expenses,
  shop: state.shop, known: state.known, cards: state.cards, lists: state.lists,
  recipes: state.recipes, plan: state.plan,
  budget: state.budget, deposits: state.deposits, recurring: state.recurring,
  warranties: state.warranties, pantry: state.pantry,
});

// ------------------------------------------------------------- konto i dom
export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}
export async function signUp(email, password) {
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
  return !!data.session;
}
// Usuń z telefonu wszystkie dane aplikacji (kopia offline, kolejki, zdjęcia czekające na wysłanie).
// Zostaje tylko wybrany motyw.
export function pendingLocal() {
  const n = k => { try { return (JSON.parse(localStorage.getItem(k) || '[]') || []).length; } catch { return 0; } };
  return n(EQKEY) + n(SQKEY) + n('liczniki:queue');
}
export function wipeLocalData() {
  for (const k of Object.keys(localStorage))
    if ((k.startsWith('dom:') && k !== 'dom:theme') || k.startsWith('liczniki:') || k.startsWith('grafik.')) localStorage.removeItem(k);
  try { indexedDB.deleteDatabase('dom'); } catch {}
}
export async function signOut() {
  // wyłącz powiadomienia na tym telefonie, żeby nie przychodziły po wylogowaniu
  try {
    const sub = await (await navigator.serviceWorker?.getRegistration())?.pushManager.getSubscription();
    if (sub) { await sb.from('push_subs').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
  } catch {}
  await sb.auth.signOut();
  wipeLocalData();
  Object.assign(state, { user: null, household: null, members: [], groups: [], people: [], categories: [], expenses: [],
                         shop: [], known: [], cards: [], recipes: [], plan: [], loaded: false });
}

export async function loadHousehold() {
  const { data: { session } } = await sb.auth.getSession();
  state.user = session?.user ?? null;
  if (!state.user) return null;
  const lastId = localStorage.getItem('dom:household');
  if (!navigator.onLine && lastId) { restoreCache(lastId); return state.household; }
  const { data, error } = await sb.from('household_members')
    .select('household_id, households(*)').eq('user_id', state.user.id);
  if (error) { if (lastId) { restoreCache(lastId); return state.household; } throw error; }
  if (!data.length) return null;
  const row = data.find(d => d.household_id === lastId) || data[0];
  state.household = row.households;
  localStorage.setItem('dom:household', state.household.id);
  restoreCache(state.household.id, true);
  return state.household;
}
function restoreCache(id, keepHousehold = false) {
  const c = lsGet(`dom:cache:${id}`, null);
  if (!c) return;
  if (!keepHousehold) state.household = c.household;
  Object.assign(state, { members: c.members || [], groups: c.groups || [], people: c.people || [],
                         categories: c.categories || [], expenses: c.expenses || [],
                         shop: c.shop || [], known: c.known || [], cards: c.cards || [], lists: c.lists || [],
                         recipes: c.recipes || [], plan: c.plan || [],
                         budget: c.budget || null, deposits: c.deposits || [], recurring: c.recurring || [],
                         warranties: c.warranties || [], pantry: c.pantry || [], loaded: true });
  applyShopQueue();
  for (const op of expQueue()) applyExpOp(op.row);
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
  await run(sb.from('household_members').update({ display_name: displayName })
    .eq('household_id', state.household.id).eq('user_id', state.user.id));
  // imię w grupach też
  await run(sb.from('split_people').update({ name: displayName })
    .eq('household_id', state.household.id).eq('user_id', state.user.id));
}

// ------------------------------------------------------------- pobieranie
export async function refresh() {
  if (!state.household || !navigator.onLine) return;
  const h = state.household.id;
  const [m, g, p, c, e] = await Promise.all([
    sb.from('household_members').select('*').eq('household_id', h),
    sb.from('split_groups').select('*').eq('household_id', h).order('created_at'),
    sb.from('split_people').select('*').eq('household_id', h).order('position').order('created_at'),
    sb.from('split_categories').select('*').eq('household_id', h).order('position').order('created_at'),
    sb.from('split_expenses').select('*').eq('household_id', h).order('spent_on', { ascending: false }).order('created_at', { ascending: false }),
  ]);
  for (const x of [m, g, p, c, e]) if (x.error) {
    if (/split_/.test(x.error.message)) throw new Error('Brak tabel wydatków w bazie — uruchom schema-dom.sql w Supabase (SQL Editor).');
    throw x.error;
  }
  Object.assign(state, { members: m.data, groups: g.data, people: p.data, categories: c.data, expenses: e.data, loaded: true });
  for (const op of expQueue()) applyExpOp(op.row);
  const [si, sk, lc] = await Promise.all([
    sb.from('shop_items').select('*').eq('household_id', h).order('created_at'),
    sb.from('shop_known').select('*').eq('household_id', h).order('uses', { ascending: false }).limit(500),
    sb.from('loyalty_cards').select('*').eq('household_id', h).order('position').order('created_at'),
  ]);
  state.shopReady = !si.error && !sk.error && !lc.error;
  if (state.shopReady) Object.assign(state, { shop: si.data, known: sk.data, cards: lc.data });
  else console.warn('Brak tabel zakupów — uruchom schema-zakupy.sql', si.error || sk.error || lc.error);
  const sl = await sb.from('shop_lists').select('*').eq('household_id', h).order('position');
  state.lists = sl.error ? [] : sl.data;
  applyShopQueue();
  const since = new Date(Date.now() - 60 * 864e5).toLocaleDateString('sv-SE');
  const [rc, mp] = await Promise.all([
    sb.from('recipes').select('*').eq('household_id', h).order('title'),
    sb.from('meal_plan').select('*').eq('household_id', h).gte('day', since).order('day').order('created_at'),
  ]);
  state.kitchenReady = !rc.error && !mp.error;
  if (state.kitchenReady) Object.assign(state, { recipes: rc.data, plan: mp.data });
  else console.warn('Brak tabel kuchni — uruchom schema-kuchnia.sql', rc.error || mp.error);
  const [bs, jd, rr] = await Promise.all([
    sb.from('budget_settings').select('*').eq('household_id', h),
    sb.from('joint_deposits').select('*').eq('household_id', h).order('day', { ascending: false }),
    sb.from('recurring').select('*').eq('household_id', h).order('day_of_month'),
  ]);
  state.budgetReady = !bs.error && !jd.error && !rr.error;
  if (state.budgetReady) Object.assign(state, { budget: bs.data[0] || null, deposits: jd.data, recurring: rr.data });
  else console.warn('Brak tabel budżetu — uruchom schema-budzet.sql', bs.error || jd.error || rr.error);
  const ir = await sb.from('import_rules').select('*').eq('household_id', h);
  state.rules = ir.error ? [] : ir.data;
  const [wr, pa, lr, lp, le] = await Promise.all([
    sb.from('warranties').select('*').eq('household_id', h).order('bought_on', { ascending: false }),
    sb.from('pantry').select('*').eq('household_id', h).order('name'),
    sb.from('readings').select('kind,month,bill_amount,read_on').eq('household_id', h).eq('kind', 'prad'),
    sb.from('settlement_periods').select('id,name,end_month,actual_amount').eq('household_id', h),
    sb.from('expenses').select('id,month,name,amount').eq('household_id', h),
  ]);
  state.extrasReady = !wr.error && !pa.error;
  if (state.extrasReady) Object.assign(state, { warranties: wr.data, pantry: pa.data });
  state.bills = { readings: (lr.data || []).filter(r => r.bill_amount != null), periods: (lp.data || []).filter(p => p.actual_amount != null), expenses: le.data || [] };
  if (await ensureDefaults()) return refresh();
  saveCache();
  emit();
}

const DEFAULT_CATS = [
  ['Spożywcze', '🛒'], ['Chemia i dom', '🧴'], ['Mieszkanie i media', '🏠'], ['Paliwo', '⛽'], ['Samochód', '🚗'],
  ['Restauracje', '🍽️'], ['Zdrowie', '💊'], ['Ubrania', '👕'], ['Rozrywka', '🎬'], ['Prezenty', '🎁'],
  ['Nocleg', '🛏️'], ['Atrakcje', '🎟️'], ['Inne', '•'],
];
// Pierwsze uruchomienie: grupa domowa z członkami domu + kategorie. Zwraca true, jeśli coś dodano.
async function ensureDefaults() {
  const h = state.household.id;
  let changed = false;
  let home = state.groups.find(g => g.kind === 'home');
  if (!home) {
    const { data, error } = await sb.from('split_groups').insert({ household_id: h, kind: 'home', name: 'Dom' }).select().single();
    if (error && !/duplicate/i.test(error.message)) throw error;
    home = data; changed = true;
  }
  if (home) {
    const missing = state.members.filter(m => !state.people.some(p => p.group_id === home.id && p.user_id === m.user_id));
    if (missing.length) {
      const { error } = await sb.from('split_people').insert(missing.map((m, i) => ({
        group_id: home.id, household_id: h, user_id: m.user_id, name: m.display_name, position: i })));
      if (error) throw error;
      changed = true;
    }
  }
  if (!state.categories.length) {
    const { error } = await sb.from('split_categories').insert(DEFAULT_CATS.map(([name, icon], i) => ({ household_id: h, name, icon, position: i })));
    if (error) throw error;
    changed = true;
  }
  return changed;
}

let channel = null;
export function subscribe() {
  if (channel || !state.household) return;
  const h = state.household.id;
  let timer = null;
  const later = () => { clearTimeout(timer); timer = setTimeout(() => refresh().catch(console.warn), 400); };
  channel = sb.channel('dom-' + h);
  for (const table of ['split_groups', 'split_people', 'split_categories', 'split_expenses', 'shop_items', 'shop_lists', 'loyalty_cards', 'recipes', 'meal_plan', 'budget_settings', 'joint_deposits', 'recurring', 'warranties', 'pantry'])
    channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `household_id=eq.${h}` }, later);
  channel.subscribe();
}
window.addEventListener('online', () => { state.online = true; emit(); flushShop().then(() => flushExpenses()).then(() => refresh()).catch(console.warn); });
window.addEventListener('offline', () => { state.online = false; emit(); });

// ------------------------------------------------------------- zapisy (wymagają sieci)
function needOnline() { if (!navigator.onLine) throw new Error('Brak internetu — ta zmiana wymaga połączenia.'); }
async function run(p) { const { data, error } = await p; if (error) throw error; return data; }

export const homeGroup = () => state.groups.find(g => g.kind === 'home');
export const groupById = id => state.groups.find(g => g.id === id);
export const peopleOf = gid => state.people.filter(p => p.group_id === gid);
export const expensesOf = gid => state.expenses.filter(e => e.group_id === gid);
export const personName = id => state.people.find(p => p.id === id)?.name || '?';
export const category = id => state.categories.find(c => c.id === id);
export const mePerson = gid => state.people.find(p => p.group_id === gid && p.user_id === state.user?.id);

const uuid = () => crypto.randomUUID ? crypto.randomUUID()
  : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));

function expenseRow(x, h, id, receipt_path) {
  return {
    id, group_id: x.group_id, household_id: h, kind: x.kind || 'expense', title: x.title || '',
    amount: x.amount, currency: x.currency || 'PLN', rate: x.rate || 1, spent_on: x.spent_on,
    category_id: x.category_id || null, source: x.source, paid_by: x.source === 'joint' ? null : x.paid_by,
    split_mode: x.split_mode, shares: x.shares, receipt_path, note: x.note || null,
    ...(x.recurring_id || x._rec ? { recurring_id: x.recurring_id || null, period: x.period || null } : {}),
  };
}
export async function saveExpense(x, receiptFile, removeReceipt) {
  const h = state.household.id;
  const id = x.id || uuid();
  if (!navigator.onLine) {                       // bez internetu: zapis do kolejki, wyśle się sam
    if (removeReceipt && x.receipt_path) throw new Error('Usunięcie zdjęcia wymaga internetu.');
    let photoKey = null;
    if (receiptFile) { photoKey = 'p-' + id; await idbPut(photoKey, await compressImage(receiptFile)); }
    const row = expenseRow(x, h, id, x.receipt_path || null);
    const q = expQueue().filter(o => o.row.id !== id);
    q.push({ row, photoKey, oldPath: receiptFile ? x.receipt_path || null : null });
    lsSet(EQKEY, q);
    applyExpOp(row); saveCache(); emit();
    return id;
  }
  let receipt_path = x.receipt_path || null;
  if (removeReceipt && receipt_path) {
    await sb.storage.from('receipts').remove([receipt_path]);
    receipt_path = null;
  }
  if (receiptFile) {
    const blob = await compressImage(receiptFile);
    const path = `${h}/${id}-${Date.now()}.jpg`;
    const { error } = await sb.storage.from('receipts').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
    if (error) throw new Error('Nie udało się wysłać zdjęcia: ' + error.message);
    if (x.receipt_path && x.receipt_path !== path) sb.storage.from('receipts').remove([x.receipt_path]);
    receipt_path = path;
  }
  const row = expenseRow(x, h, id, receipt_path);
  const { error } = await sb.from('split_expenses').upsert(row);
  if (error) throw new Error(/recurring_period|unique|duplicate/i.test(error.message) ? 'Ta opłata cykliczna ma już wydatek za ten miesiąc.' : error.message);
  await refresh();
  return id;
}

// ---- kolejka wydatków offline (zdjęcia paragonów czekają w IndexedDB)
const EQKEY = 'dom:expqueue';
export const expQueue = () => lsGet(EQKEY, []);
function applyExpOp(row) {
  const i = state.expenses.findIndex(e => e.id === row.id);
  const merged = { ...(i >= 0 ? state.expenses[i] : { created_at: new Date().toISOString() }), ...row, _pending: true };
  if (i >= 0) state.expenses[i] = merged; else state.expenses.push(merged);
  state.expenses.sort((a, b) => b.spent_on.localeCompare(a.spent_on) || (b.created_at || '').localeCompare(a.created_at || ''));
}
const idbOpen = () => new Promise((res, rej) => { const r = indexedDB.open('dom', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('photos'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function idbDo(mode, fn) { const d = await idbOpen(); return new Promise((res, rej) => {
  const t = d.transaction('photos', mode); const r = fn(t.objectStore('photos')); t.oncomplete = () => res(r?.result); t.onerror = () => rej(t.error); }); }
const idbPut = (k, v) => idbDo('readwrite', s => s.put(v, k));
const idbGet = k => idbDo('readonly', s => s.get(k));
const idbDel = k => idbDo('readwrite', s => s.delete(k));
let expSyncing = false;
export async function flushExpenses() {
  if (expSyncing || !navigator.onLine || !sb || !state.household) return;
  let q = expQueue(); if (!q.length) return;
  expSyncing = true;
  try {
    while (q.length) {
      const op = q[0], row = { ...op.row };
      if (op.photoKey) {
        const blob = await idbGet(op.photoKey).catch(() => null);
        if (blob) {
          const path = `${row.household_id}/${row.id}-${Date.now()}.jpg`;
          const up = await sb.storage.from('receipts').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
          if (up.error) { if (/fetch|network|Failed/i.test(up.error.message)) break; console.error('zdjęcie', up.error); }
          else { row.receipt_path = path; if (op.oldPath) sb.storage.from('receipts').remove([op.oldPath]); }
        }
      }
      const { error } = await sb.from('split_expenses').upsert(row);
      if (error) {
        if (/fetch|network|Failed/i.test(error.message)) break;
        console.error('Odrzucony wydatek z kolejki', row, error);
        state.syncError = `Nie zapisano wydatku „${row.title || row.amount + ' zł'}”: ${error.message}`;
      }
      if (op.photoKey) await idbDel(op.photoKey).catch(() => {});
      q = expQueue().slice(1); lsSet(EQKEY, q);
    }
  } catch (e) { console.warn('kolejka wydatków', e); }
  finally { expSyncing = false; await refresh().catch(() => emit()); }
}

export async function deleteExpense(e) {
  needOnline();
  if (e.receipt_path) await sb.storage.from('receipts').remove([e.receipt_path]);
  await run(sb.from('split_expenses').delete().eq('id', e.id));
  await refresh();
}
export async function addTransfer(groupId, from, to, amount, currency) {
  return saveExpense({ group_id: groupId, kind: 'transfer', title: 'Zwrot', amount, currency, rate: 1,
    spent_on: new Date().toLocaleDateString('sv-SE'), source: 'private', paid_by: from,
    split_mode: 'amounts', shares: [{ p: to, a: amount }] });
}

const urlCache = new Map();
export async function receiptUrl(path) {
  if (urlCache.has(path)) return urlCache.get(path);
  const { data, error } = await sb.storage.from('receipts').createSignedUrl(path, 3600);
  if (error) throw error;
  urlCache.set(path, data.signedUrl);
  return data.signedUrl;
}

// Zdjęcie paragonu: max 1600 px, JPEG ~0.7 → zwykle 150–300 KB
export async function compressImage(file, max = 1600, q = 0.7) {
  const img = await createImageBitmap(file).catch(() => null);
  if (!img) return file;
  const s = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(b => res(b || file), 'image/jpeg', q));
}

// --- wyjazdy
export async function saveTrip(t, people) {
  needOnline();
  const h = state.household.id;
  const row = { name: t.name, currency: t.currency || 'PLN', start_date: t.start_date || null, end_date: t.end_date || null };
  const g = t.id
    ? await run(sb.from('split_groups').update(row).eq('id', t.id).select().single())
    : await run(sb.from('split_groups').insert({ ...row, household_id: h, kind: 'trip' }).select().single());
  // uczestnicy: dodaj nowych, zmień nazwy, usuń tylko tych bez wydatków
  const old = peopleOf(g.id);
  const keep = new Set();
  for (const [i, p] of people.entries()) {
    if (p.id) { keep.add(p.id); await run(sb.from('split_people').update({ name: p.name, position: i }).eq('id', p.id)); }
    else await run(sb.from('split_people').insert({ group_id: g.id, household_id: h, user_id: p.user_id || null, name: p.name, position: i }));
  }
  for (const p of old.filter(p => !keep.has(p.id))) {
    const used = expensesOf(g.id).some(e => e.paid_by === p.id || (e.shares || []).some(s => s.p === p.id));
    if (used) throw new Error(`${p.name} ma wydatki w tym wyjeździe — nie można usunąć.`);
    await run(sb.from('split_people').delete().eq('id', p.id));
  }
  await refresh();
  return g.id;
}
export async function setArchived(id, archived) {
  needOnline();
  await run(sb.from('split_groups').update({ archived }).eq('id', id));
  await refresh();
}
export async function deleteTrip(id) {
  needOnline();
  const paths = expensesOf(id).map(e => e.receipt_path).filter(Boolean);
  if (paths.length) await sb.storage.from('receipts').remove(paths);
  await run(sb.from('split_groups').delete().eq('id', id));
  await refresh();
}
export async function shareToken(id) {
  needOnline();
  const g = groupById(id);
  if (g.share_token) return g.share_token;
  const a = new Uint8Array(18); crypto.getRandomValues(a);
  const token = btoa(String.fromCharCode(...a)).replace(/[+/=]/g, c => ({ '+': '-', '/': '_', '=': '' })[c]);
  await run(sb.from('split_groups').update({ share_token: token }).eq('id', id));
  await refresh();
  return token;
}
export async function revokeToken(id) {
  needOnline();
  await run(sb.from('split_groups').update({ share_token: null }).eq('id', id));
  await refresh();
}

// --- kategorie
export async function saveCategory(c) {
  needOnline();
  const row = { name: c.name, icon: c.icon || '•' };
  if (c.id) await run(sb.from('split_categories').update(row).eq('id', c.id));
  else await run(sb.from('split_categories').insert({ ...row, household_id: state.household.id, position: state.categories.length }));
  await refresh();
}
export async function deleteCategory(id) {
  needOnline();
  await run(sb.from('split_categories').delete().eq('id', id));
  await refresh();
}

// --- kurs NBP (tabela A, ostatni dostępny do danej daty)
export async function nbpRate(cur, date) {
  if (cur === 'PLN') return 1;
  const end = date; const d = new Date(date + 'T12:00'); d.setDate(d.getDate() - 10);
  const start = d.toLocaleDateString('sv-SE');
  const res = await fetch(`https://api.nbp.pl/api/exchangerates/rates/a/${cur.toLowerCase()}/${start}/${end}/?format=json`);
  if (!res.ok) throw new Error('Brak kursu NBP dla ' + cur);
  const j = await res.json();
  return j.rates.at(-1).mid;
}

// ================================================================ ZAKUPY (działa offline)
// Każda zmiana listy: najpierw lokalnie + kolejka, potem wysyłka, gdy jest sieć.
const SQKEY = 'dom:shopqueue';
export const shopQueue = () => lsGet(SQKEY, []);
function applyShopQueue() {
  for (const op of shopQueue()) applyShopOp(op);
}
function applyShopOp(op) {
  if (op.t === 'known') return;
  const i = state.shop.findIndex(x => x.id === (op.row?.id || op.id));
  if (op.t === 'delete') { if (i >= 0) state.shop.splice(i, 1); return; }
  const merged = { ...(i >= 0 ? state.shop[i] : {}), ...op.row, _pending: true };
  if (i >= 0) state.shop[i] = merged; else state.shop.push(merged);
}
function shopEnqueue(ops) {
  const q = shopQueue();
  for (const op of ops) { q.push(op); applyShopOp(op); }
  lsSet(SQKEY, q); saveCache(); emit();
  flushShop();
}
let shopSyncing = false;
export async function flushShop() {
  if (shopSyncing || !navigator.onLine || !sb || !state.shopReady) return;
  let q = shopQueue(); if (!q.length) return;
  shopSyncing = true;
  try {
    while (q.length) {
      const op = q[0];
      const res = op.t === 'delete' ? await sb.from('shop_items').delete().eq('id', op.id)
        : op.t === 'known' ? await sb.from('shop_known').upsert(op.row)
        : await sb.from('shop_items').upsert(op.row);
      if (res.error) {
        if (/fetch|network|Failed/i.test(res.error.message)) break;
        console.error('Odrzucony zapis listy', op, res.error);
      }
      q = shopQueue().slice(1); lsSet(SQKEY, q);
    }
  } finally {
    shopSyncing = false;
    await refresh().catch(() => emit());
  }
}

export const nameKey = n => n.trim().toLowerCase().replace(/\s+/g, ' ');
export function addShopItem(name, qty, aisle, list = null) {
  const h = state.household.id;
  const k = nameKey(name);
  const known = state.known.find(x => x.name_key === k);
  const row = { id: uuid(), household_id: h, name: name.trim(), qty: qty || null, aisle,
                done: false, done_at: null, created_at: new Date().toISOString(), ...(list ? { list } : {}) };
  // ten sam produkt już na liście (niekupiony) → nie dubluj, tylko zaktualizuj ilość
  const dup = state.shop.find(x => !x.done && nameKey(x.name) === k && (x.list || null) === (list || null));
  const ops = dup ? [{ t: 'upsert', row: { ...strip(dup), qty: qty || dup.qty } }] : [{ t: 'upsert', row }];
  const kn = { household_id: h, name_key: k, name: name.trim(), aisle, uses: (known?.uses || 0) + 1, last_used: new Date().toISOString() };
  const ki = state.known.findIndex(x => x.name_key === k);
  if (ki >= 0) state.known[ki] = kn; else state.known.push(kn);
  ops.push({ t: 'known', row: kn });
  shopEnqueue(ops);
}
const strip = x => { const { _pending, ...r } = x; return r; };
export function updateShopItem(item, changes) {
  const row = { ...strip(item), ...changes };
  const ops = [{ t: 'upsert', row }];
  if (changes.aisle && changes.aisle !== item.aisle) {
    const k = nameKey(row.name);
    const kn = { ...(state.known.find(x => x.name_key === k) || { household_id: state.household.id, name_key: k, uses: 1 }), name: row.name, aisle: changes.aisle };
    const ki = state.known.findIndex(x => x.name_key === k);
    if (ki >= 0) state.known[ki] = kn; else state.known.push(kn);
    ops.push({ t: 'known', row: kn });
  }
  shopEnqueue(ops);
}
export const toggleShopItem = item => updateShopItem(item, { done: !item.done, done_at: item.done ? null : new Date().toISOString() });
export const deleteShopItem = item => shopEnqueue([{ t: 'delete', id: item.id }]);
export const clearBought = (items = state.shop.filter(x => x.done)) => shopEnqueue(items.map(x => ({ t: 'delete', id: x.id })));

// ================================================================ KARTY LOJALNOŚCIOWE
export async function saveCard(c) {
  needOnline();
  const row = { name: c.name, number: c.number, format: c.format, color: c.color, note: c.note || null };
  if (c.id) await run(sb.from('loyalty_cards').update(row).eq('id', c.id));
  else await run(sb.from('loyalty_cards').insert({ ...row, household_id: state.household.id, position: state.cards.length }));
  await refresh();
}
export async function deleteCard(id) {
  needOnline();
  await run(sb.from('loyalty_cards').delete().eq('id', id));
  await refresh();
}

// ================================================================ KUCHNIA
export async function saveRecipe(r, photoFile, removePhoto) {
  needOnline();
  const h = state.household.id;
  const id = r.id || uuid();
  let photo_path = r.photo_path || null;
  if (removePhoto && photo_path) { await sb.storage.from('receipts').remove([photo_path]); photo_path = null; }
  if (photoFile) {
    const blob = await compressImage(photoFile, 1400, 0.75);
    const path = `${h}/przepisy/${id}-${Date.now()}.jpg`;
    const { error } = await sb.storage.from('receipts').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
    if (error) throw new Error('Nie udało się wysłać zdjęcia: ' + error.message);
    if (r.photo_path) sb.storage.from('receipts').remove([r.photo_path]);
    photo_path = path;
  }
  const row = { id, household_id: h, title: r.title, servings: r.servings || 2, time_min: r.time_min || null,
    ingredients: r.ingredients || '', steps: r.steps || '', tags: r.tags || [], source_url: r.source_url || null,
    image_url: r.image_url || null, photo_path, note: r.note || null, fav: !!r.fav };
  await run(sb.from('recipes').upsert(row));
  await refresh();
  return id;
}
export async function setFav(r, fav) { needOnline(); await run(sb.from('recipes').update({ fav }).eq('id', r.id)); await refresh(); }
export async function deleteRecipe(r) {
  needOnline();
  if (r.photo_path) await sb.storage.from('receipts').remove([r.photo_path]);
  await run(sb.from('recipes').delete().eq('id', r.id));
  await refresh();
}
export async function addMeal(m) {
  needOnline();
  await run(sb.from('meal_plan').insert({ household_id: state.household.id, day: m.day, meal: m.meal || 'Obiad',
    recipe_id: m.recipe_id || null, text: m.text || null, servings: m.servings || null }));
  await refresh();
}
export async function updateMeal(id, changes) { needOnline(); await run(sb.from('meal_plan').update(changes).eq('id', id)); await refresh(); }
export async function deleteMeal(id) { needOnline(); await run(sb.from('meal_plan').delete().eq('id', id)); await refresh(); }
// Funkcje serwera (api/) przyjmują tylko zalogowanych — wysyłamy token sesji
async function authHeaders() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('Zaloguj się ponownie');
  return { Authorization: 'Bearer ' + session.access_token };
}
export async function importRecipe(url) {
  needOnline();
  const res = await fetch('api/przepis?url=' + encodeURIComponent(url), { headers: await authHeaders() });
  if (!res.ok) throw new Error(res.status === 404 ? 'Brak pliku api/przepis.js na serwerze — zobacz README.'
    : res.status === 401 ? 'Import wymaga zalogowania i zmiennych SUPABASE_URL / SUPABASE_ANON_KEY w Vercelu.' : 'Import nie działa (' + res.status + ')');
  return res.json();
}
// Zdjęcie przepisu kopiujemy do własnego Supabase — aplikacja nie ładuje obrazków z cudzych stron
export async function recipeImage(url) {
  const res = await fetch('api/przepis?img=' + encodeURIComponent(url), { headers: await authHeaders() });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.startsWith('image/')) throw new Error('Nie udało się pobrać zdjęcia');
  return new File([await res.blob()], 'przepis.jpg', { type });
}
// Starsze przepisy z linkiem do cudzego zdjęcia: jednorazowo skopiuj zdjęcie do Supabase
let migrating = false;
export async function migrateRecipeImages() {
  if (migrating || !navigator.onLine) return;
  const todo = state.recipes.filter(r => r.image_url && !r.photo_path);
  if (!todo.length) return;
  migrating = true;
  try {
    for (const r of todo) {
      let file = null;
      try { file = await recipeImage(r.image_url); } catch {}
      await saveRecipe({ ...r, image_url: null }, file, false).catch(() => {});
    }
  } finally { migrating = false; }
}

// ================================================================ BUDŻET, KONTO WSPÓLNE, CYKLICZNE
export async function saveBudget(b) {
  needOnline();
  await run(sb.from('budget_settings').upsert({ household_id: state.household.id, monthly_limit: b.monthly_limit,
    opening_balance: b.opening_balance || 0, opening_date: b.opening_date, updated_at: new Date().toISOString() }));
  await refresh();
}
export async function addDeposit(d) {
  needOnline();
  await run(sb.from('joint_deposits').insert({ household_id: state.household.id, person_id: d.person_id || null, amount: d.amount, day: d.day, note: d.note || null }));
  await refresh();
}
export async function deleteDeposit(id) { needOnline(); await run(sb.from('joint_deposits').delete().eq('id', id)); await refresh(); }
export async function saveRecurring(r) {
  needOnline();
  const row = { title: r.title, amount: r.amount, category_id: r.category_id || null, source: r.source, paid_by: r.source === 'joint' ? null : r.paid_by,
    split_mode: 'equal', shares: r.shares || [], day_of_month: r.day_of_month, every_months: r.every_months || 1,
    start_month: r.start_month, end_month: r.end_month || null, auto: !!r.auto, active: r.active !== false };
  if (r.id) await run(sb.from('recurring').update(row).eq('id', r.id));
  else await run(sb.from('recurring').insert({ ...row, household_id: state.household.id }));
  await refresh();
}
export async function deleteRecurring(id) { needOnline(); await run(sb.from('recurring').delete().eq('id', id)); await refresh(); }

// Zapis wydatku z pozycji cyklicznej za dany okres (YYYY-MM). Duplikat z drugiego telefonu jest ignorowany.
export async function payRecurring(r, period, dueDate, amount) {
  needOnline();
  const g = homeGroup(); if (!g) return;
  const people = peopleOf(g.id);
  const { error } = await sb.from('split_expenses').insert({
    group_id: g.id, household_id: state.household.id, kind: 'expense', title: r.title, amount: amount ?? r.amount, currency: 'PLN', rate: 1,
    spent_on: dueDate, category_id: r.category_id, source: r.source, paid_by: r.source === 'joint' ? null : r.paid_by,
    split_mode: 'equal', shares: r.source === 'joint' ? [] : (r.shares?.length ? r.shares : people.map(p => ({ p: p.id, w: 1 }))),
    recurring_id: r.id, period, note: 'cykliczny' });
  if (error && !/duplicate|unique/i.test(error.message)) throw error;
}

// ================================================================ IMPORT Z BANKU
// expenses: [{date, title, amount, category_id, ref}], deposits: [{date, amount, person_id, note, ref}], rules: [{pattern, category_id, title}]
export async function importBank({ expenses, deposits, rules }) {
  needOnline();
  const h = state.household.id, g = homeGroup();
  if (expenses.length) {
    const { error } = await sb.from('split_expenses').upsert(expenses.map(x => ({
      group_id: g.id, household_id: h, kind: 'expense', title: x.title, amount: x.amount, currency: 'PLN', rate: 1,
      spent_on: x.date, category_id: x.category_id || null, source: 'joint', paid_by: null, split_mode: 'equal', shares: [],
      note: x.note || null, import_ref: x.ref, recurring_id: x.recurring_id || null, period: x.period || null })), { onConflict: 'household_id,import_ref', ignoreDuplicates: true });
    if (error) throw new Error(/import_ref/.test(error.message) ? 'Uruchom schema-import.sql w Supabase.' : error.message);
  }
  if (deposits.length) {
    const { error } = await sb.from('joint_deposits').upsert(deposits.map(d => ({
      household_id: h, person_id: d.person_id || null, amount: d.amount, day: d.date, note: d.note || null, import_ref: d.ref })),
      { onConflict: 'household_id,import_ref', ignoreDuplicates: true });
    if (error) throw error;
  }
  if (rules.length) await sb.from('import_rules').upsert(rules.map(r => ({ household_id: h, ...r })));
  await refresh();
}

// ================================================================ KOPIA ZAPASOWA
const BACKUP_TABLES = ['split_categories', 'split_groups', 'split_people', 'recurring', 'split_expenses', 'shop_items', 'shop_known',
  'loyalty_cards', 'recipes', 'meal_plan', 'budget_settings', 'joint_deposits', 'import_rules'];
export async function backupAll() {
  needOnline();
  const h = state.household.id, out = { app: 'Dom', version: 1, created: new Date().toISOString(), tables: {} };
  for (const t of BACKUP_TABLES) {
    const { data, error } = await sb.from(t).select('*').eq('household_id', h);
    if (!error) out.tables[t] = data;
  }
  return out;
}
export async function restoreAll(backup) {
  needOnline();
  if (backup?.app !== 'Dom' || !backup.tables) throw new Error('To nie jest kopia aplikacji Dom');
  const h = state.household.id; let n = 0;
  const pk = { budget_settings: 'household_id', shop_known: 'household_id,name_key', import_rules: 'household_id,pattern' };
  for (const t of BACKUP_TABLES) {
    const rows = (backup.tables[t] || []).map(r => ({ ...r, household_id: h }));
    if (!rows.length) continue;
    const { error } = await sb.from(t).upsert(rows, { onConflict: pk[t] || 'id', ignoreDuplicates: true });
    if (error) throw new Error(`${t}: ${error.message}`);
    n += rows.length;
  }
  await refresh();
  return n;
}

// ================================================================ RACHUNKI Z LICZNIKÓW → WYDATKI
export async function addBillExpense(b) {
  needOnline();
  const g = homeGroup(), people = peopleOf(g.id);
  const { error } = await sb.from('split_expenses').upsert({
    group_id: g.id, household_id: state.household.id, kind: 'expense', title: b.title, amount: b.amount, currency: 'PLN', rate: 1,
    spent_on: b.date, category_id: b.category_id || null, source: b.source, paid_by: b.source === 'joint' ? null : b.paid_by,
    split_mode: 'equal', shares: b.source === 'joint' ? [] : people.map(p => ({ p: p.id, w: 1 })), note: 'z Liczników', import_ref: b.ref,
  }, { onConflict: 'household_id,import_ref', ignoreDuplicates: true });
  if (error) throw new Error(/import_ref/.test(error.message) ? 'Uruchom schema-import.sql w Supabase.' : error.message);
  await refresh();
}

// ================================================================ GWARANCJE
export async function saveWarranty(w, photoFile, removePhoto) {
  needOnline();
  const h = state.household.id, id = w.id || uuid();
  let receipt_path = w.receipt_path || null;
  if (removePhoto && receipt_path && !w.shared_photo) { await sb.storage.from('receipts').remove([receipt_path]); }
  if (removePhoto) receipt_path = null;
  if (photoFile) {
    const blob = await compressImage(photoFile);
    const path = `${h}/gwarancje/${id}-${Date.now()}.jpg`;
    const { error } = await sb.storage.from('receipts').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
    if (error) throw new Error('Nie udało się wysłać zdjęcia: ' + error.message);
    receipt_path = path;
  }
  await run(sb.from('warranties').upsert({ id, household_id: h, name: w.name, shop: w.shop || null, bought_on: w.bought_on, months: w.months,
    price: w.price ?? null, receipt_path, expense_id: w.expense_id || null, note: w.note || null }));
  await refresh();
}
export async function deleteWarranty(w) {
  needOnline();
  // zdjęcie usuwamy tylko, jeśli nie jest wspólne z wydatkiem
  if (w.receipt_path && !state.expenses.some(e => e.receipt_path === w.receipt_path)) await sb.storage.from('receipts').remove([w.receipt_path]);
  await run(sb.from('warranties').delete().eq('id', w.id));
  await refresh();
}

// ================================================================ SPIŻARNIA
export async function savePantry(items) {
  needOnline();
  const h = state.household.id;
  await run(sb.from('pantry').upsert([].concat(items).map(x => ({ id: x.id || uuid(), household_id: h, name: x.name, qty: x.qty || null,
    place: x.place || 'Szafka', expires: x.expires || null }))));
  await refresh();
}
export async function deletePantry(ids) { needOnline(); await run(sb.from('pantry').delete().in('id', [].concat(ids))); await refresh(); }

// --- listy zakupów (ogólna = null)
export async function saveList(name, icon) {
  needOnline();
  await run(sb.from('shop_lists').upsert({ household_id: state.household.id, name, icon: icon || '🛍️', position: state.lists.length }));
  await refresh();
}
export async function deleteList(name) {
  needOnline();
  await run(sb.from('shop_items').update({ list: null }).eq('household_id', state.household.id).eq('list', name));
  await run(sb.from('shop_lists').delete().eq('household_id', state.household.id).eq('name', name));
  await refresh();
}

// Powiązanie istniejącego wydatku (np. z wyciągu) z opłatą cykliczną za dany okres
export async function linkRecurring(expenseId, recurringId, period) {
  needOnline();
  const { error } = await sb.from('split_expenses').update({ recurring_id: recurringId, period }).eq('id', expenseId);
  if (error) throw new Error(/unique|duplicate/i.test(error.message) ? 'Ta opłata ma już wydatek za ten miesiąc.' : error.message);
  await refresh();
}
