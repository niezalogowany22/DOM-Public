// Vercel Function: wysyłka powiadomień push.
//  • POST z Supabase (Database Webhook) przy nowej pozycji na liście zakupów / nowym wydatku
//  • GET ?cron=1 raz dziennie (vercel.json): opłaty cykliczne, gwarancje, terminy w spiżarni
// Zmienne środowiskowe (Vercel → Settings → Environment Variables):
//  VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, WEBHOOK_SECRET, CRON_SECRET
// Ten plik MUSI leżeć w folderze api/ (GitHub → Add file → Create new file → nazwa: api/push.js).
const webpush = require('web-push');

const E = process.env;
const SB = (E.SUPABASE_URL || '').replace(/\/$/, '') + '/rest/v1/';
const H = { apikey: E.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + E.SUPABASE_SERVICE_KEY };
async function q(path) {
  const r = await fetch(SB + path, { headers: H });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return r.json();
}
async function del(path) { await fetch(SB + path, { method: 'DELETE', headers: H }); }

const zl = v => new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + ' zł';
const plDate = d => new Date(d + 'T12:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', timeZone: 'Europe/Warsaw' });
const todayPL = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' });
const addDays = (d, n) => { const x = new Date(d + 'T12:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

// Wyślij do telefonów domu (z pominięciem autora zmiany), z uwzględnieniem ustawień
async function send(household, pref, msg, exceptUser) {
  const subs = await q(`push_subs?household_id=eq.${household}&select=*`);
  let n = 0;
  for (const s of subs) {
    if (exceptUser && s.user_id === exceptUser) continue;
    if (s.prefs && s.prefs[pref] === false) continue;
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(msg), { TTL: 6 * 3600 });
      n++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await del(`push_subs?id=eq.${s.id}`);   // telefon wypisany
      else console.error('push', e.statusCode, e.body);
    }
  }
  return n;
}
async function who(household, user) {
  if (!user) return 'Ktoś';
  const m = await q(`household_members?household_id=eq.${household}&user_id=eq.${user}&select=display_name`);
  return m[0]?.display_name || 'Ktoś';
}

// ------------------------------------------------------------- zdarzenia z bazy
async function onShop(r) {
  const name = await who(r.household_id, r.created_by);
  const where = r.list ? ` (${r.list})` : '';
  return send(r.household_id, 'shop', { title: '🛒 Lista zakupów', body: `${name} dodał(a)${where}: ${r.name}${r.qty ? ' — ' + r.qty : ''}`,
    tag: 'shop', url: './#zakupy' }, r.created_by);
}
async function onExpense(r) {
  if (r.kind !== 'expense') return 0;
  let n = 0;
  // ręcznie dodany wydatek (bez importu z banku i bez automatów)
  if (!r.import_ref && !r.recurring_id) {
    const name = await who(r.household_id, r.created_by);
    const groups = await q(`split_groups?id=eq.${r.group_id}&select=kind,name`);
    const trip = groups[0]?.kind === 'trip' ? ` · ${groups[0].name}` : '';
    n += await send(r.household_id, 'expense', { title: '💸 Nowy wydatek' + trip,
      body: `${name}: ${r.title || 'wydatek'} — ${zl(Number(r.amount) * Number(r.rate || 1))}${r.source === 'joint' ? ' (konto wspólne)' : ''}`,
      tag: 'exp-' + r.id, url: './#wydatki' }, r.created_by);
  }
  // budżet konta wspólnego: powiadom, gdy ten wydatek przekroczył 90% lub 100% limitu
  if (r.source === 'joint') {
    const b = (await q(`budget_settings?household_id=eq.${r.household_id}&select=monthly_limit`))[0];
    const limit = Number(b?.monthly_limit);
    if (limit > 0) {
      const m = r.spent_on.slice(0, 7), [y, mo] = m.split('-').map(Number);
      const next = `${mo === 12 ? y + 1 : y}-${String(mo === 12 ? 1 : mo + 1).padStart(2, '0')}-01`;
      const rows = await q(`split_expenses?household_id=eq.${r.household_id}&source=eq.joint&kind=eq.expense&and=(spent_on.gte.${m}-01,spent_on.lt.${next})&select=amount,rate`);
      const sum = rows.reduce((a, x) => a + Number(x.amount) * Number(x.rate || 1), 0);
      const before = sum - Number(r.amount) * Number(r.rate || 1);
      for (const [lvl, txt] of [[1, 'Przekroczono budżet'], [0.9, 'Wykorzystano 90% budżetu']]) {
        if (sum >= limit * lvl && before < limit * lvl) {
          n += await send(r.household_id, 'budget', { title: '📊 ' + txt, body: `Konto wspólne: ${zl(sum)} z ${zl(limit)} w tym miesiącu.`, tag: 'budget', url: './#budzet' });
          break;
        }
      }
    }
  }
  return n;
}

// ------------------------------------------------------------- codzienny przegląd
const daysIn = m => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
function dueIn(r, m) {
  const start = r.start_month.slice(0, 7);
  if (!r.active || m < start || (r.end_month && m > r.end_month.slice(0, 7))) return null;
  const [y1, m1] = start.split('-').map(Number), [y2, m2] = m.split('-').map(Number);
  if (((y2 - y1) * 12 + (m2 - m1)) % (r.every_months || 1)) return null;
  return `${m}-${String(Math.min(r.day_of_month, daysIn(m))).padStart(2, '0')}`;
}
async function daily() {
  const t = todayPL(), m = t.slice(0, 7), in2 = addDays(t, 2);
  const subs = await q('push_subs?select=household_id');
  let n = 0;
  for (const h of [...new Set(subs.map(s => s.household_id))]) {
    n += await meterReminder(h, t);
    // opłaty cykliczne (bez automatycznych): termin dziś lub za 2 dni, niezapłacone
    const rec = await q(`recurring?household_id=eq.${h}&auto=eq.false&active=eq.true&select=*`);
    for (const r of rec) {
      const d = dueIn(r, m);
      if (!d || (d !== t && d !== in2)) continue;
      const paid = await q(`split_expenses?recurring_id=eq.${r.id}&period=eq.${m}&select=id`);
      if (paid.length) continue;
      n += await send(h, 'bills', { title: '📅 ' + (d === t ? 'Dziś termin płatności' : 'Za 2 dni termin płatności'),
        body: `${r.title} — ${zl(Number(r.amount))} (${plDate(d)})`, tag: 'bill-' + r.id, url: './#start' });
    }
    // gwarancje: koniec za 30 lub 7 dni
    const war = await q(`warranties?household_id=eq.${h}&select=name,bought_on,months`);
    for (const w of war) {
      const end = new Date(w.bought_on + 'T12:00Z'); end.setUTCMonth(end.getUTCMonth() + w.months);
      const e = end.toISOString().slice(0, 10);
      if (e === addDays(t, 30) || e === addDays(t, 7))
        n += await send(h, 'warranty', { title: '🛡️ Kończy się gwarancja', body: `${w.name} — gwarancja do ${plDate(e)}.`, tag: 'war-' + w.name, url: './#gwarancje' });
    }
    // spiżarnia: termin dziś lub jutro — jedno zbiorcze powiadomienie
    const pan = await q(`pantry?household_id=eq.${h}&and=(expires.gte.${t},expires.lte.${addDays(t, 1)})&select=name,expires`);
    if (pan.length) n += await send(h, 'pantry', { title: '🥫 Kończy się termin', body: pan.map(p => `${p.name} (${p.expires === t ? 'dziś' : 'jutro'})`).join(', '),
      tag: 'pantry', url: './#spizarnia' });
  }
  return n;
}

// Odczyt liczników: 1. i 3. dnia miesiąca, jeśli brakuje odczytu za poprzedni miesiąc (woda, CO)
const METERS = { zw: 'woda zimna', cw: 'woda ciepła', co: 'CO' };
const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
async function meterReminder(h, t) {
  const day = +t.slice(8, 10);
  if (day !== 1 && day !== 3) return 0;
  const [y, m] = t.split('-').map(Number);
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  const month = `${py}-${String(pm).padStart(2, '0')}-01`;
  let have;
  try { have = new Set((await q(`readings?household_id=eq.${h}&month=eq.${month}&select=kind`)).map(r => r.kind)); } catch { return 0; }
  const missing = Object.keys(METERS).filter(k => !have.has(k));
  if (!missing.length) return 0;
  return send(h, 'meters', { title: '📟 Odczyt liczników', body: `Za ${MONTHS[pm - 1]} brakuje: ${missing.map(k => METERS[k]).join(', ')}.`, tag: 'meters', url: './#l-odczyt' });
}

// ------------------------------------------------------------- wejście
module.exports = async (req, res) => {
  try {
    if (!E.VAPID_PUBLIC_KEY || !E.VAPID_PRIVATE_KEY || !E.SUPABASE_SERVICE_KEY) return res.status(500).json({ ok: false, error: 'Brak zmiennych środowiskowych' });
    webpush.setVapidDetails(E.VAPID_SUBJECT || 'mailto:dom@example.com', E.VAPID_PUBLIC_KEY, E.VAPID_PRIVATE_KEY);
    if (req.method === 'GET' && req.query.cron) {
      if (!E.CRON_SECRET || req.headers.authorization !== `Bearer ${E.CRON_SECRET}`) return res.status(401).end();
      return res.status(200).json({ ok: true, sent: await daily() });
    }
    if (req.method === 'POST') {
      if (!E.WEBHOOK_SECRET || E.WEBHOOK_SECRET.length < 20 || req.headers['x-webhook-secret'] !== E.WEBHOOK_SECRET) return res.status(401).end();
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (body?.type !== 'INSERT' || !body.record) return res.status(200).json({ ok: true, skipped: true });
      const sent = body.table === 'shop_items' ? await onShop(body.record) : body.table === 'split_expenses' ? await onExpense(body.record) : 0;
      return res.status(200).json({ ok: true, sent });
    }
    res.status(405).end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'Błąd serwera' });
  }
};
module.exports.meterReminder = meterReminder;
