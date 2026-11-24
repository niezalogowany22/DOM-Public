// Dom — ekrany główne, routing, logowanie
import * as db from './db.js';
import { state } from './db.js';
import { renderLiczniki } from './l-app.js';
const LICZNIKI_URL = '#l-start', GRAFIK_URL = '#grafik';
import { view, esc, go, toast, guard, a11yPass, icon, pills, bindPills, getTheme, applyTheme, back, initHistory } from './ui.js';
import { fmtMoney, today, monthKey, monthName, inGroupCur, totalSpent } from './split.js';
import { renderExpenses, renderExpenseForm, renderSettle, balanceCard, expenseRow } from './wydatki.js';
import { renderTrips, renderTrip, renderTripForm, activeTrips, tripCard } from './wyjazdy.js';
import { renderShop, renderShopItem, renderCards, renderCard, renderCardForm, shopCount, renderPantryTab } from './zakupy.js';
import { renderBudget, renderDepositForm, renderRecurringList, renderRecurringForm, budgetCard, remindersCard, bindReminders, runAutoRecurring } from './budzet.js';
import { renderImport, backupCard, bindBackup } from './import.js';
import { renderLiczBills, renderWarranties, renderWarrantyForm, renderPantryForm, alertsCard } from './dodatki.js';
import { renderReport } from './raport.js';
import { renderSearch } from './szukaj.js';
import { renderGrafik, renderGrafikSettings, isPainting } from './gr.js';
import { onGr } from './gr-data.js';
import { notifyCard, bindNotify } from './powiadomienia.js';
import { shiftsOn, shiftLabel, refreshShifts, grafikReady } from './grafik-dzis.js';
import { renderMenu, renderMealForm, renderMenuShop, renderRecipes, renderRecipe, renderRecipeForm, todayMeals } from './kuchnia.js';

// nazwy dla przycisków z samym symbolem — po każdej zmianie widoku (także w Licznikach)
let a11yT; new MutationObserver(() => { clearTimeout(a11yT); a11yT = setTimeout(() => a11yPass(view), 50); }).observe(view, { childList: true, subtree: true });
const FORMS = new Set(['wydatek', 'wyjazd-edytuj', 'kategorie', 'produkt', 'karta-edytuj', 'karta', 'posilek', 'przepis-edytuj', 'menu-lista', 'przepis', 'wplata', 'cykliczny-edytuj', 'gwarancja-edytuj', 'spizarnia-edytuj', 'szukaj', 'grafik-ustawienia']);
function route() {
  const [name, qs] = (location.hash.slice(1) || 'start').split('?');
  return { name, params: Object.fromEntries(new URLSearchParams(qs || '')) };
}
db.onChange(() => { runAutoRecurring(); updateStatus(); const n = route().name; if (!FORMS.has(n) && !n.startsWith('l-') && !(n === 'grafik' && isPainting())) render(); });
onGr(() => { const n = route().name; if ((n === 'grafik' && !isPainting()) || n === 'start' || n === 'menu' || n === 'kuchnia') render(); });

function updateStatus() {
  const el = document.getElementById('sync');
  const q = db.shopQueue().length + db.expQueue().length;
  if (el) { el.className = 'sync' + (state.online ? (q ? ' wait' : '') : ' off'); el.textContent = state.online ? (q ? `wysyłanie ${q}…` : '') : `offline${q ? ` · ${q} do wysłania` : ''}`; }
  if (state.syncError) { toast(state.syncError, true); state.syncError = null; }
  const badge = document.getElementById('shopBadge');
  if (badge) { const n = shopCount(); badge.textContent = n || ''; badge.hidden = !n; }
}
const TAB = { grafik: 'wiecej', 'grafik-ustawienia': 'wiecej', szukaj: 'wydatki', raport: 'wydatki', 'rachunki-licz': 'wydatki', gwarancje: 'wiecej', 'gwarancja-edytuj': 'wiecej', spizarnia: 'zakupy', 'spizarnia-edytuj': 'zakupy', import: 'wydatki', wydatek: 'wydatki', rozlicz: 'wydatki', budzet: 'wydatki', wplata: 'wydatki', cykliczne: 'wydatki', 'cykliczny-edytuj': 'wydatki', wyjazdy: 'wiecej', wyjazd: 'wiecej', 'wyjazd-edytuj': 'wiecej', kategorie: 'wiecej',
              menu: 'kuchnia', posilek: 'kuchnia', 'menu-lista': 'kuchnia', przepisy: 'kuchnia', przepis: 'kuchnia', 'przepis-edytuj': 'kuchnia',
              produkt: 'zakupy', karty: 'zakupy', karta: 'zakupy', 'karta-edytuj': 'zakupy' };
function setNav(name, params) {
  let active = name.startsWith('l-') ? 'wiecej' : TAB[name] || name;
  if ((name === 'wydatek' || name === 'rozlicz') && db.groupById(params.g)?.kind === 'trip') active = 'wiecej';
  document.querySelectorAll('nav a').forEach(a => { const on = a.dataset.tab === active; a.classList.toggle('on', on); on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'); });
  // przycisk wstecz na ekranach podrzędnych (formularze, szczegóły)
  const roots = new Set(['start', 'wydatki', 'zakupy', 'menu', 'kuchnia', 'wiecej']);
  const hb = document.getElementById('hback');
  if (hb) { hb.hidden = roots.has(name); hb.onclick = () => back(active === 'kuchnia' ? 'menu' : active); }
  document.querySelector('nav').hidden = false;
}

const SCREENS = {
  start: renderStart, wydatki: renderExpenses, wydatek: renderExpenseForm, rozlicz: renderSettle,
  wyjazdy: renderTrips, wyjazd: renderTrip, 'wyjazd-edytuj': renderTripForm,
  wiecej: renderMore, kategorie: renderCategories,
  budzet: renderBudget, wplata: renderDepositForm, cykliczne: renderRecurringList, 'cykliczny-edytuj': renderRecurringForm,
  import: renderImport, raport: renderReport, szukaj: renderSearch, grafik: renderGrafik, 'grafik-ustawienia': renderGrafikSettings, 'rachunki-licz': renderLiczBills, gwarancje: renderWarranties, 'gwarancja-edytuj': renderWarrantyForm,
  spizarnia: renderPantryTab, 'spizarnia-edytuj': renderPantryForm,
  kuchnia: renderMenu, menu: renderMenu, posilek: renderMealForm, 'menu-lista': renderMenuShop,
  przepisy: renderRecipes, przepis: renderRecipe, 'przepis-edytuj': renderRecipeForm,
  zakupy: renderShop, produkt: renderShopItem, karty: renderCards, karta: renderCard, 'karta-edytuj': renderCardForm,
};
function render() {
  if (!state.household) return;
  const { name, params } = route();
  setNav(name, params);
  document.querySelector('header h1').textContent = name.startsWith('l-') ? 'Liczniki' : name.startsWith('grafik') ? 'Grafik' : 'Dom';
  if (name.startsWith('l-')) { renderLiczniki(); return; }
  const y = window.scrollY;
  view.innerHTML = '';
  if (!state.loaded) { view.innerHTML = '<p class="muted center">Ładowanie…</p>'; return; }
  (SCREENS[name] || renderStart)(params);
  if (!FORMS.has(name)) window.scrollTo(0, y);
  updateStatus();
}

// ------------------------------------------------------------- START
function renderStart() {
  const g = db.homeGroup();
  const m = monthKey(today());
  const spend = state.expenses.filter(e => e.group_id === g?.id && e.kind !== 'transfer' && monthKey(e.spent_on) === m);
  const recent = state.expenses.filter(e => e.group_id === g?.id).slice(0, 5);
  const trips = activeTrips();
  const meals = todayMeals();
  const t = today();
  const tm = new Date(); tm.setDate(tm.getDate() + 1);
  const tomorrow = tm.toLocaleDateString('sv-SE');
  const shiftRows = (label, d) => `<div class="shiftday"><span class="muted small">${label}</span><span class="sl">${shiftsOn(d).map(s =>
    `<span class="shift"><i style="background:${esc(s.cat?.color || 'transparent')}"></i><b>${esc(s.name)}</b> ${esc(shiftLabel(s))}</span>`).join('')}</span></div>`;
  const dateLabel = new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
  view.innerHTML = `
    <p class="greet">${esc(dateLabel)}</p>
    ${grafikReady() ? `<a class="card shifts" href="${esc(GRAFIK_URL)}">${shiftRows('Dziś', t)}${shiftRows('Jutro', tomorrow)}</a>`
      : `<a class="card shifts" href="${esc(GRAFIK_URL)}"><span class="muted">Grafik nie jest skonfigurowany — otwórz i zaimportuj ustawienia →</span></a>`}
    ${remindersCard()}
    ${alertsCard()}
    ${budgetCard()}
    ${g ? balanceCard(g, 'Saldo między wami') : ''}
    <div class="tiles">
      <a class="card stat" href="#wydatki"><span class="muted">${monthName(m)}</span><b class="big">${fmtMoney(totalSpent(spend))}</b><span class="muted small">${spend.length} wydatków →</span></a>
      <a class="card stat" href="#zakupy"><span class="muted">Do kupienia</span><b class="big">${shopCount()}</b><span class="muted small">lista zakupów →</span></a>
    </div>
    <a class="card stat" href="#menu"><span class="muted">Dziś w menu</span>
      ${meals.length ? meals.map(p => `<span><small class="muted">${esc(p.meal)}:</small> <b>${esc(p.title || '—')}</b></span>`).join('') : '<span class="muted">nic nie zaplanowano →</span>'}</a>
    <h3>Wyjazdy</h3>${trips.map(tripCard).join('')}<a class="btn" href="#wyjazdy">${trips.length ? 'Wszystkie wyjazdy' : '+ Wyjazd'}</a>
    ${recent.length ? `<h3>Ostatnie</h3><section class="card flush">${recent.map(e => expenseRow(e, g)).join('')}</section>` : ''}
    <div class="tiles">
      ${LICZNIKI_URL ? `<a class="card tile" href="${esc(LICZNIKI_URL)}"><span>${icon('meter')}</span>Liczniki</a>` : ''}
      ${GRAFIK_URL ? `<a class="card tile" href="${esc(GRAFIK_URL)}"><span>${icon('calendar')}</span>Grafik</a>` : ''}
    </div>
    ${g ? `<a class="fab" href="#wydatek?g=${g.id}" aria-label="Dodaj wydatek">${icon('plus')}<span>Wydatek</span></a>` : ''}`;
  bindReminders();
  refreshShifts([t, tomorrow]).then(ch => { if (ch && route().name === 'start') render(); });
}

// ------------------------------------------------------------- WIĘCEJ
function renderMore() {
  const h = state.household;
  const me = state.members.find(m => m.user_id === state.user?.id);
  view.innerHTML = `
    <section class="card">
      <h2>Inne moduły</h2>
      <div class="row">
        <a class="btn" href="#wyjazdy">${icon('plane')} Wyjazdy</a>
        <a class="btn" href="#gwarancje">${icon('shield')} Gwarancje</a>
        ${LICZNIKI_URL ? `<a class="btn" href="${esc(LICZNIKI_URL)}">${icon('meter')} Liczniki</a>` : ''}
        ${GRAFIK_URL ? `<a class="btn" href="${esc(GRAFIK_URL)}">${icon('calendar')} Grafik</a>` : ''}
      </div>
    </section>
    <section class="card">
      <h2>Wygląd</h2>
      ${pills('theme', [['auto', 'Jak w telefonie'], ['light', 'Jasny'], ['dark', 'Ciemny']], getTheme())}
    </section>
    ${notifyCard()}
    ${backupCard()}
    <section class="card">
      <h2>Kategorie wydatków</h2>
      <p class="muted">${state.categories.map(c => esc(c.icon + ' ' + c.name)).join(' · ')}</p>
      <a class="btn" href="#kategorie">Edytuj kategorie</a>
    </section>
    <section class="card">
      <h2>${esc(h.name)}</h2>
      <p>Kod zaproszenia: <b class="code">${esc(h.invite_code)}</b> <button class="btn small" id="cp">Kopiuj</button></p>
      <p class="muted">Członkowie: ${state.members.map(m => esc(m.display_name)).join(', ')}</p>
      <form class="row" id="nm"><input name="dn" value="${esc(me?.display_name || '')}" placeholder="Twoje imię"><button class="btn">Zmień imię</button></form>
      <p class="muted small">Zalogowano: ${esc(state.user?.email)}</p>
      <button class="btn danger" id="out">Wyloguj</button>
    </section>`;
  bindBackup();
  bindNotify();
  bindPills(view.querySelector('.pills[data-name="theme"]').parentElement, (n, v) => applyTheme(v));
  view.querySelector('#cp').onclick = () => navigator.clipboard?.writeText(h.invite_code).then(() => toast('Skopiowano'));
  view.querySelector('#nm').onsubmit = e => { e.preventDefault(); guard(async () => { await db.renameMe(e.target.dn.value.trim()); await db.refresh(); toast('Zapisano'); }); };
  view.querySelector('#out').onclick = () => {
    const n = db.pendingLocal();
    const msg = n ? `Na tym telefonie czeka ${n} niewysłanych zmian — po wylogowaniu przepadną. Wylogować mimo to?`
      : 'Wylogować? Kopia danych zapisana na tym telefonie zostanie usunięta (w bazie wszystko zostaje).';
    if (confirm(msg)) guard(async () => { await db.signOut(); boot(); });
  };
}

function renderCategories() {
  const used = id => state.expenses.filter(e => e.category_id === id).length;
  view.innerHTML = `
    <section class="card">
      <h2>Kategorie</h2>
      ${state.categories.map(c => `<form class="catrow" data-id="${c.id}">
        <input name="icon" value="${esc(c.icon)}" maxlength="4"><input name="name" value="${esc(c.name)}" required>
        <button class="btn small">Zapisz</button><button type="button" class="btn small danger" data-del>✕</button></form>
        <p class="hint" style="margin:-4px 0 6px">${used(c.id)} wydatków</p>`).join('')}
    </section>
    <form class="card catrow" id="nc"><input name="icon" placeholder="🙂" maxlength="4"><input name="name" placeholder="Nowa kategoria" required><button class="btn small primary">Dodaj</button></form>
    <a class="btn" href="#wiecej">← Wróć</a>`;
  view.querySelectorAll('form.catrow').forEach(f => {
    f.onsubmit = e => { e.preventDefault(); guard(async () => { await db.saveCategory({ id: f.dataset.id, name: f.name.value.trim(), icon: f.icon.value.trim() }); toast('Zapisano'); render(); }); };
    f.querySelector('[data-del]')?.addEventListener('click', () => {
      const n = used(f.dataset.id);
      if (confirm(n ? `Usunąć kategorię? ${n} wydatków zostanie bez kategorii.` : 'Usunąć kategorię?')) guard(async () => { await db.deleteCategory(f.dataset.id); render(); });
    });
  });
}

// ------------------------------------------------------------- logowanie
function bare(html) { document.querySelector('nav').hidden = true; view.innerHTML = html; }

function renderLogin() {
  bare(`<form class="card" id="lf">
      <h2>Zaloguj się</h2>
      <p class="hint">To samo konto co w Licznikach.</p>
      <label class="field">E-mail<input type="email" name="email" required autocomplete="username"></label>
      <label class="field">Hasło<input type="password" name="pass" required minlength="6" autocomplete="current-password"></label>
      <div class="row"><button class="btn" type="button" id="su">Załóż konto</button><button class="btn primary">Zaloguj</button></div>
    </form>`);
  const f = view.querySelector('#lf');
  f.onsubmit = e => { e.preventDefault(); guard(async () => { await db.signIn(f.email.value, f.pass.value); boot(); }); };
  view.querySelector('#su').onclick = () => { if (!f.reportValidity()) return; guard(async () => {
    const ok = await db.signUp(f.email.value, f.pass.value);
    if (ok) boot(); else toast('Konto założone — potwierdź adres w mailu i zaloguj się.');
  }); };
}

function renderOnboarding() {
  bare(`<section class="card"><h2>Witaj!</h2><p>Załóż wspólny dom albo dołącz kodem od drugiej osoby.</p></section>
    <form class="card" id="cf"><h2>Nowy dom</h2>
      <label class="field">Nazwa<input name="name" value="Mieszkanie"></label>
      <label class="field">Twoje imię<input name="dn" required></label>
      <button class="btn primary">Załóż</button></form>
    <form class="card" id="jf"><h2>Dołącz kodem</h2>
      <label class="field">Kod zaproszenia<input name="code" required maxlength="6" style="text-transform:uppercase"></label>
      <label class="field">Twoje imię<input name="dn" required></label>
      <button class="btn primary">Dołącz</button></form>
    <button class="btn" id="out">Wyloguj</button>`);
  view.querySelector('#cf').onsubmit = e => { e.preventDefault(); guard(async () => { await db.createHousehold(e.target.name.value, e.target.dn.value); boot(); }); };
  view.querySelector('#jf').onsubmit = e => { e.preventDefault(); guard(async () => { await db.joinHousehold(e.target.code.value, e.target.dn.value); boot(); }); };
  view.querySelector('#out').onclick = () => guard(async () => { await db.signOut(); boot(); });
}

async function boot() {
  if (!db.configured || db.initError) {
    bare(`<section class="card warn"><h2>Brak konfiguracji</h2><p>Uzupełnij <code>config.js</code> (adres i klucz z Supabase).</p></section>`);
    return;
  }
  try {
    const h = await db.loadHousehold();
    if (!state.user) return renderLogin();
    if (!h) return renderOnboarding();
    render();
    await db.refresh();
    db.subscribe();
    db.flushExpenses();
  } catch (e) {
    console.error(e);
    if (state.loaded) { render(); toast(e.message, true); return; }
    bare(`<section class="card warn"><h2>Błąd</h2><p>${esc(e.message)}</p><button class="btn" id="retry">Spróbuj ponownie</button></section>`);
    document.getElementById('retry')?.addEventListener('click', () => location.reload());
  }
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js');
applyTheme();
initHistory(render);
boot();
