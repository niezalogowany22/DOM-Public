// Service worker: aplikacja otwiera się offline. Po każdej zmianie plików podbij VERSION.
const VERSION = 'dom-v20';
const SHELL = [
  './', 'index.html', 'podglad.html', 'theme-boot.js', 'boot-error.js', 'podglad.js', 'tokens.css', 'styles.css', 'roboto-flex-latin.woff2', 'roboto-flex-latin-ext.woff2', 'manifest.webmanifest',
  'app.js', 'db.js', 'ui.js', 'split.js', 'wydatki.js', 'wyjazdy.js', 'zakupy.js', 'kuchnia.js', 'budzet.js', 'import.js', 'bank.js', 'dodatki.js', 'powiadomienia.js', 'raport.js', 'szukaj.js', 'config.js',
  'supabase.js', 'jsbarcode.min.js', 'qrcode.js',
  'grafik-dzis.js', 'icon-192.png', 'icon-512.png',
  // Liczniki
  'l-app.js', 'l-db.js', 'calc.js', 'extras.js', 'xlsx.js', 'importParse.js', 'exceljs.min.js',
  // Grafik
  'grafik.html', 'gr.js', 'gr-data.js',
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Najpierw sieć, przy braku sieci — kopia. Tylko pliki aplikacji.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});

// Powiadomienia push
self.addEventListener('push', e => {
  let d = {}; try { d = e.data.json(); } catch { d = { title: 'Dom', body: e.data?.text() || '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Dom', {
    body: d.body || '', icon: 'icon-192.png', badge: 'icon-192.png', tag: d.tag, renotify: !!d.tag, data: { url: d.url || './#start' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './#start', self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const w = list.find(c => c.url.startsWith(self.registration.scope));
    if (w) { w.navigate(url).catch(() => {}); return w.focus(); }
    return clients.openWindow(url);
  }));
});
