// Wspólne drobiazgi interfejsu
export const view = document.getElementById('view');
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const parseNum = s => { const t = String(s ?? '').trim().replace(/\s/g, '').replace(',', '.'); return t === '' ? null : Number(t); };
// ---- Historia (przycisk / gest „Wstecz” w Androidzie) ----
// Trzy poziomy: Start (d=0) → sekcja (d=1: zakładki dolnego paska i ich podzakładki, moduły) → szczegóły (d≥2: formularze, podglądy).
// Przełączanie zakładek PODMIENIA bieżący wpis zamiast dokładać nowy, więc „Wstecz” prowadzi:
// szczegół → sekcja → Start → wyjście z aplikacji, niezależnie od tego, ile zakładek odwiedzono.
const SECTIONS = new Set(['wydatki', 'budzet', 'raport', 'cykliczne', 'zakupy', 'spizarnia', 'karty', 'menu', 'przepisy', 'kuchnia', 'wiecej',
  'wyjazdy', 'gwarancje', 'grafik', 'l-start', 'l-odczyty', 'l-koszty', 'l-wykresy', 'l-wydatki', 'l-rachunki', 'l-rozliczenia', 'l-wiecej']);
const nameOf = h => (String(h).replace(/^#/, '') || 'start').split('?')[0];
const levelOf = h => { const n = nameOf(h); return n === 'start' ? 0 : SECTIONS.has(n) ? 1 : 2; };
const depth = () => history.state?.d ?? 0;
let onNav = () => {}, pending = null, lastD = 0;

export function go(h) {
  h = '#' + String(h).replace(/^#/, '');
  if (h === '#') return;
  if (h === location.hash) { onNav(); return; }
  const d = depth(), t = levelOf(h);
  if (t === 0) {
    if (d > 0) { pending = null; history.go(-d); }        // wróć do wpisu Start zamiast dokładać nowy
    else { history.replaceState({ d: 0 }, '', h); onNav(); }
    return;
  }
  if (t === 1) {
    if (d === 0) history.pushState({ d: 1 }, '', h);
    else if (d === 1) history.replaceState({ d: 1 }, '', h);
    else { pending = h; history.go(-(d - 1)); return; }   // z formularza do innej sekcji: zdejmij szczegóły
    onNav(); return;
  }
  history.pushState({ d: d + 1 }, '', h); onNav();
}
export const back = fallback => { if (depth() > 0) history.back(); else go(fallback); };

export function initHistory(render) {
  onNav = () => { lastD = depth(); render(); };
  if (history.state?.d == null) {                          // pierwsze otwarcie (także z powiadomienia): pod spodem zawsze Start
    const h = location.hash || '#start';
    history.replaceState({ d: 0 }, '', '#start');
    if (levelOf(h) > 0) history.pushState({ d: 1 }, '', h);
  }
  lastD = depth();
  window.addEventListener('popstate', () => {
    if (history.state?.d == null) history.replaceState({ d: lastD + 1 }, '', location.hash);   // zmiana adresu spoza go()
    if (pending) { const h = pending; pending = null; history.replaceState({ d: 1 }, '', h); }
    onNav();
  });
  // wszystkie linki wewnętrzne przechodzą przez go()
  document.addEventListener('click', e => {
    const a = e.target.closest?.('a[href^="#"]');
    if (!a || e.defaultPrevented || a.target || e.button || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    go(a.getAttribute('href'));
  });
}

export function toast(msg, err = false) {
  const t = document.getElementById('toast');
  t.setAttribute('role', err ? 'alert' : 'status');
  t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(t._h); t._h = setTimeout(() => t.className = 'toast', err ? 5000 : 2500);
}
export async function guard(fn) {
  // przycisk, który uruchomił akcję, pokazuje „pracuję…” i nie przyjmuje kolejnych kliknięć
  const ae = document.activeElement;
  const btn = ae?.closest?.('button, .btn') || (ae?.tagName === 'FORM' ? ae.querySelector('button.primary') : null);
  const sub = btn || document.querySelector('form:focus-within button.primary');
  const mark = sub && sub.isConnected && !sub.hasAttribute('aria-busy');
  if (mark) { sub.setAttribute('aria-busy', 'true'); sub.setAttribute('aria-disabled', 'true'); sub.style.pointerEvents = 'none'; }
  try { return await fn(); } catch (e) { console.error(e); toast(e.message || String(e), true); }
  finally { if (mark) { sub.removeAttribute('aria-busy'); sub.removeAttribute('aria-disabled'); sub.style.pointerEvents = ''; } }
}
export const signCls = v => v > 0.004 ? 'pos' : v < -0.004 ? 'neg' : '';

// Pigułki wyboru (radio) — zwraca HTML; wartość czytana przez picked()
export const pills = (name, items, value) => `<div class="pills" data-name="${name}">${items.map(([v, label]) =>
  `<button type="button" class="pill${v === value ? ' on' : ''}" data-v="${esc(v)}">${label}</button>`).join('')}</div>`;
export function bindPills(root, onPick) {
  root.querySelectorAll('.pills').forEach(box => box.onclick = e => {
    const b = e.target.closest('.pill'); if (!b) return;
    box.querySelectorAll('.pill').forEach(x => x.classList.toggle('on', x === b));
    onPick?.(box.dataset.name, b.dataset.v);
  });
}
export const picked = (root, name) => root.querySelector(`.pills[data-name="${name}"] .pill.on`)?.dataset.v ?? null;

// Przyciski z samym symbolem dostają czytelną nazwę dla czytników ekranu
const GLYPH = { '‹': 'Poprzedni', '›': 'Następny', '+': 'Dodaj', '✕': 'Usuń', '⟳': 'Odśwież z kalendarza', '🔍': 'Szukaj', '⚙': 'Ustawienia',
  '↑': 'Przesuń wyżej', '↓': 'Przesuń niżej', '✓': 'Zużyte', '🛒': 'Dodaj do listy zakupów', '✎': 'Edytuj', '−': 'Mniej', '★': 'Ulubiony', '☆': 'Ulubiony' };
export function a11yPass(root = document) {
  root.querySelectorAll('a, button').forEach(el => {
    const t = el.textContent.trim();
    if (!el.children.length && GLYPH_ICON[t]) {
      if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', el.title || GLYPH[t] || t);
      el.innerHTML = icon(GLYPH_ICON[t]);
      el.classList.add('icon-only');
      return;
    }
    const m = !el.children.length && /^([+＋⇩⇧←])\s+(.+)$/s.exec(t);
    if (m && PREFIX_ICON[m[1]]) {
      el.textContent = ' ' + m[2];
      el.insertAdjacentHTML('afterbegin', icon(PREFIX_ICON[m[1]]));
    }
    if (el.hasAttribute('aria-label')) return;
    if (GLYPH[t]) el.setAttribute('aria-label', GLYPH[t]);
    else if (!/[\p{L}\p{N}]/u.test(t) && el.title) el.setAttribute('aria-label', el.title);
  });
}

// Ikony (SVG, obrys) — jedna rodzina dla elementów nawigacyjnych
const ICONS = {
  meter: '<rect x="4" y="3" width="16" height="18" rx="2"/><rect x="7" y="6" width="10" height="5" rx="1"/><path d="M8 15h.01M12 15h.01M16 15h.01M8 18h8"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  plane: '<path d="M10.5 13.5L3 11l1.5-1.5 7 1 4-4c1-1 2.5-1.5 3.5-.5s.5 2.5-.5 3.5l-4 4 1 7L14 22l-2.5-7.5"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  cart: '<path d="M3 4h2l2.4 11h10.6l2-8H6.2"/><circle cx="9" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/>',
  chevL: '<path d="M15 5l-7 7 7 7"/>',
  chevR: '<path d="M9 5l7 7-7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  star: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>',
  starFill: '<path fill="currentColor" d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  bag: '<path d="M5 8h14l-1 13H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
  sofa: '<path d="M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3"/><path d="M3 13a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v5H3z"/><path d="M5 18v2M19 18v2"/>',
  hammer: '<path d="M14 6l4 4"/><path d="M11 3l7 7-3 3-7-7z"/><path d="M10 10l-7 7 2 2 7-7"/>',
  pill: '<rect x="2.5" y="9" width="19" height="6" rx="3" transform="rotate(-45 12 12)"/><path d="M9.5 9.5l5 5"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  repeat: '<path d="M4 12V9a3 3 0 0 1 3-3h12l-3-3M20 12v3a3 3 0 0 1-3 3H5l3 3"/>',
  jar: '<path d="M8 3h8v3H8z"/><path d="M7 6h10a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/><path d="M5 11h14"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5a3 3 0 0 0-3-1.5c-1.7 0-3 .9-3 2s1.3 1.7 3 2 3 .9 3 2-1.3 2-3 2a3 3 0 0 1-3-1.5M12 6v12"/>',
  trendUp: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  trendDown: '<path d="M3 7l6 6 4-4 8 8"/><path d="M15 17h6v-6"/>',
  leaf: '<path d="M5 19c0-8 5-14 15-15-1 10-7 15-15 15z"/><path d="M5 19l7-7"/>',
  wallet2: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 15h2"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
  snow: '<path d="M12 2v20M4.9 7l14.2 10M19.1 7L4.9 17"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  fridge: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M5 10h14M9 5v2M9 13v3"/>',
  spray: '<path d="M8 10h6v11H8z"/><path d="M9 10V6h4v4M13 6h3l2-2M17 7.5h1.5M17 10l1.5 1"/>',
  bowl: '<path d="M3 11h18a9 9 0 0 1-18 0z"/><path d="M8 7c0-2 2-2 2-4M13 7c0-2 2-2 2-4"/>',
};
// Znaki na przyciskach zamieniane automatycznie na ikony (także w Licznikach i Grafiku)
const GLYPH_ICON = { '‹': 'chevL', '›': 'chevR', '+': 'plus', '✕': 'close', '⟳': 'refresh', '⚙': 'settings', '↑': 'up', '↓': 'down',
  '✓': 'check', '✎': 'edit', '−': 'minus', '★': 'starFill', '☆': 'star', '🛒': 'cart', '🔍': 'search' };
const PREFIX_ICON = { '+': 'plus', '＋': 'plus', '⇩': 'download', '⇧': 'upload', '←': 'chevL' };

// Motyw: 'auto' (wg systemu), 'light', 'dark' — zapamiętany na tym telefonie
const THEME_KEY = 'dom:theme';
export function getTheme() { try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch { return 'auto'; } }
export function applyTheme(t = getTheme()) {
  const root = document.documentElement;
  if (t === 'light' || t === 'dark') root.dataset.theme = t; else delete root.dataset.theme;
  try { if (t === 'auto') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, t); } catch {}
  const bg = getComputedStyle(root).getPropertyValue('--md-surface-container').trim();
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => { if (bg) m.content = bg; });
}
export const icon = (n, cls = 'ic-svg') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;
