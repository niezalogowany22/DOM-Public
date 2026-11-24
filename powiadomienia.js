// Powiadomienia push: zapis telefonu i ustawienia
import * as db from './db.js';
import { state, sb } from './db.js';
import { VAPID_PUBLIC_KEY } from './config.js';
import { view, toast, guard, icon } from './ui.js';

const PREFS = [['shop', 'cart', 'Nowe pozycje na liście zakupów'], ['expense', 'wallet2', 'Nowe wydatki (wpisane przez drugą osobę)'],
  ['budget', 'chart', 'Budżet: 90% i przekroczenie'], ['bills', 'calendar', 'Terminy opłat cyklicznych'], ['warranty', 'shield', 'Koniec gwarancji'],
  ['pantry', 'jar', 'Terminy w spiżarni'], ['meters', 'meter', 'Odczyt liczników (1. i 3. dnia miesiąca)']];
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const b64 = s => { const p = '='.repeat((4 - s.length % 4) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, c => c.charCodeAt(0)); };

async function currentSub() {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}
async function myRow(sub) {
  if (!sub) return null;
  const { data } = await sb.from('push_subs').select('*').eq('endpoint', sub.endpoint).maybeSingle();
  return data;
}

export function notifyCard() {
  return `<section class="card" id="notif"><h2>Powiadomienia</h2><p class="muted">Sprawdzam…</p></section>`;
}
export async function bindNotify() {
  const box = view.querySelector('#notif'); if (!box) return;
  if (!supported()) { box.innerHTML = '<h2>Powiadomienia</h2><p class="hint">Ta przeglądarka nie obsługuje powiadomień. Zainstaluj Dom jako aplikację (Chrome → Zainstaluj aplikację).</p>'; return; }
  let sub = await currentSub().catch(() => null);
  let row = await myRow(sub).catch(() => null);
  const draw = () => {
    const on = !!(sub && row);
    const denied = Notification.permission === 'denied';
    box.innerHTML = `<h2>Powiadomienia</h2>
      ${denied ? `<p class="hint neg">Powiadomienia są zablokowane w ustawieniach przeglądarki dla tej strony — odblokuj je (ikonka obok adresu → Uprawnienia).</p>` : ''}
      ${on ? `<p class="hint">Włączone na tym telefonie. Drugi telefon włącza je osobno.</p>
        ${PREFS.map(([k, ic, l]) => `<label class="check"><input type="checkbox" data-k="${k}" ${row.prefs?.[k] !== false ? 'checked' : ''}> ${icon(ic)} ${l}</label>`).join('')}
        <div class="row"><button class="btn" id="test">Wyślij testowe</button><button class="btn danger" id="off">Wyłącz na tym telefonie</button></div>`
      : `<p class="hint">Dostaniesz powiadomienie, gdy druga osoba doda coś do listy lub wpisze wydatek, o terminach opłat, gwarancjach i budżecie.</p>
        <button class="btn primary" id="on" ${denied ? 'disabled' : ''}>${icon('bell')} Włącz na tym telefonie</button>`}`;
    box.querySelector('#on')?.addEventListener('click', () => guard(async () => {
      if (await Notification.requestPermission() !== 'granted') throw new Error('Brak zgody na powiadomienia');
      const reg = await navigator.serviceWorker.ready;
      if (!VAPID_PUBLIC_KEY) throw new Error('Powiadomienia nie są skonfigurowane — uzupełnij VAPID_PUBLIC_KEY w config.js.');
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(VAPID_PUBLIC_KEY) });
      const j = sub.toJSON();
      const { data, error } = await sb.from('push_subs').upsert({ household_id: state.household.id, user_id: state.user.id, endpoint: j.endpoint,
        p256dh: j.keys.p256dh, auth: j.keys.auth, device: navigator.userAgent.slice(0, 120) }, { onConflict: 'endpoint' }).select().single();
      if (error) throw new Error(/push_subs/.test(error.message) ? 'Uruchom schema-powiadomienia.sql w Supabase.' : error.message);
      row = data; toast('Powiadomienia włączone'); draw();
    }));
    box.querySelector('#off')?.addEventListener('click', () => guard(async () => {
      await sb.from('push_subs').delete().eq('endpoint', sub.endpoint);
      await sub.unsubscribe(); sub = null; row = null; toast('Wyłączono'); draw();
    }));
    box.querySelector('#test')?.addEventListener('click', async () => {
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification('Dom', { body: 'Tak będą wyglądać powiadomienia.', icon: 'icon-192.png', badge: 'icon-192.png', tag: 'test' });
    });
    box.querySelectorAll('[data-k]').forEach(c => c.onchange = () => guard(async () => {
      const prefs = { ...(row.prefs || {}), [c.dataset.k]: c.checked };
      const { error } = await sb.from('push_subs').update({ prefs }).eq('id', row.id);
      if (error) throw error; row.prefs = prefs;
    }));
  };
  draw();
}
