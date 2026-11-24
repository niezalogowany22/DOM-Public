// Lista zakupów (wspólna, offline) i karty lojalnościowe
import * as db from './db.js';
import { state } from './db.js';
import { view, esc, go, back, toast, guard, icon } from './ui.js';
import { renderPantry, boughtToPantry } from './dodatki.js';

// ------------------------------------------------------------- działy sklepu
export const AISLES = [
  ['Warzywa i owoce', '🥕', 'pomidor ogór sałat ziemniak cebul czosn marchew pietrusz seler papryk kapust brokuł kalafior cukini bakłażan szpinak rzodk por koperek natk szczypior pieczark grzyb jabł grusz banan pomarańcz mandaryn cytryn limonk winogr trusk malin borówk jagod śliwk brzoskw morel ananas kiwi awokado arbuz melon imbir rukol fasolk awokad'],
  ['Pieczywo', '🥖', 'chleb bułk bagiet rogal chałk tortill pieczyw grahamk kajzerk'],
  ['Nabiał i jajka', '🥛', 'mlek jogurt kefir maślank śmietan masł ser twaróg serek mozzarell parmezan feta jaj jajk margaryn skyr'],
  ['Mięso i ryby', '🥩', 'mięs kurczak filet pierś udk indyk wołow wieprz schab karkówk boczek szynk kiełbas parów salami mielon łosoś dorsz ryb tuńczyk krewet pasztet kabanos'],
  ['Mrożonki', '🧊', 'mrożon lody frytki pizza mrożona pierogi'],
  ['Suche i przyprawy', '🍝', 'makaron ryż kasz mąk cukier sól pieprz przypraw olej oliw ocet płatki musli owsian fasol ciecierz soczewic groch passat koncentrat keczup musztard majonez sos bulion kawa herbat kakao miód dżem konserw puszk drożdż'],
  ['Napoje', '🧃', 'wod sok napój cola piwo wino oranżad lemoniad'],
  ['Słodycze i przekąski', '🍫', 'czekolad cukierk ciastk baton chips orzesz orzech żelk wafl paluszk krakers'],
  ['Chemia', '🧽', 'płyn proszek prania kapsułk zmywark tabletk domestos papier toalet ręcznik papier worki gąbk ścier folia odświeżacz'],
  ['Higiena', '🧴', 'szampon żel mydł pasta szczoteczk dezodorant krem podpask chusteczk wacik patyczk maszynk pianka'],
  ['Inne', '•', ''],
];
const AISLE_ORDER = Object.fromEntries(AISLES.map(([a], i) => [a, i]));
const aisleIcon = a => AISLES.find(x => x[0] === a)?.[1] || '•';
export function guessAisle(name) {
  const k = db.nameKey(name);
  const known = state.known.find(x => x.name_key === k);
  if (known) return known.aisle;
  for (const [a, , words] of AISLES) if (words && words.split(' ').some(w => w && k.includes(w))) return a;
  return 'Inne';
}

let draft = { name: '', qty: '', unit: 'szt', focus: false };
const UNITS = ['szt', 'kg', 'g', 'l', 'ml', 'opak'];
const splitQty = q => { const m = String(q || '').match(/^\s*([\d.,/½¼¾]+)\s*(.*)$/); return m ? { n: m[1], u: m[2].trim() } : { n: '', u: String(q || '').trim() }; };
const unitSelect = (name, v) => `<select name="${name}" class="unit">${[...new Set([...UNITS, ...(v && !UNITS.includes(v) ? [v] : [])])].map(u => `<option ${u === v ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select>`;
export const shopCount = () => state.shop.filter(x => !x.done).length;

const tabs = active => `<div class="subnav"><a href="#zakupy" class="${active === 'lista' ? 'on' : ''}">Lista</a><a href="#spizarnia" class="${active === 'spizarnia' ? 'on' : ''}">Spiżarnia</a><a href="#karty" class="${active === 'karty' ? 'on' : ''}">Karty</a></div>`;
export const renderPantryTab = () => renderPantry(tabs('spizarnia'));
const needSql = () => state.shopReady ? '' : `<section class="card warn"><b>Brak tabel zakupów.</b> Uruchom <code>schema-zakupy.sql</code> w Supabase (SQL Editor), potem odśwież.</section>`;

// ------------------------------------------------------------- LISTA
let sel = (() => { try { return localStorage.getItem('dom:shoplist') ?? '*'; } catch { return '*'; } })();
const setSel = v => { sel = v; try { localStorage.setItem('dom:shoplist', v); } catch {} };
const listNames = () => [...new Set([...state.lists.map(l => l.name), ...state.shop.map(x => x.list).filter(Boolean)])];
const LIST_ICON = { '🪑': 'sofa', '📦': 'box', '🔨': 'hammer', '💊': 'pill', '🛍️': 'bag', '🛒': 'cart' };
const listIcon = n => icon(LIST_ICON[state.lists.find(l => l.name === n)?.icon] || 'bag', 'ic-svg ic-inline');
const byAisle = items => { let a = null; return items.map(x => { let h = ''; if (x.aisle !== a) { a = x.aisle; h = `<div class="day">${aisleIcon(a)} ${esc(a)}</div>`; } return h + itemRow(x); }).join(''); };

export function renderShop() {
  const names = listNames();
  if (sel !== '*' && sel !== '' && !names.includes(sel)) setSel('*');
  const inSel = x => sel === '*' || (x.list || '') === sel;
  const todo = state.shop.filter(x => !x.done && inSel(x))
    .sort((a, b) => (AISLE_ORDER[a.aisle] ?? 99) - (AISLE_ORDER[b.aisle] ?? 99) || a.created_at.localeCompare(b.created_at));
  const done = state.shop.filter(x => x.done && inSel(x)).sort((a, b) => (b.done_at || '').localeCompare(a.done_at || ''));
  const pending = db.shopQueue().length;
  const cnt = n => state.shop.filter(x => !x.done && (n === '*' || (x.list || '') === n)).length;
  const general = todo.filter(x => !x.list);
  let rows = '';
  if (sel === '*') {
    rows = byAisle(general);
    for (const n of names) { const it = todo.filter(x => x.list === n); if (it.length) rows += `<div class="day listhdr">${listIcon(n)} ${esc(n)}</div>` + it.map(itemRow).join(''); }
  } else rows = sel === '' ? byAisle(todo) : todo.map(itemRow).join('');
  const target = sel === '*' || sel === '' ? 'ogólnej' : sel;

  view.innerHTML = `
    ${tabs('lista')}${needSql()}
    <div class="pills listbar">
      ${[['*', 'Wszystkie'], ['', `${icon('cart', 'ic-svg ic-inline')} Ogólna`], ...names.map(n => [n, `${listIcon(n)} ${esc(n)}`])].map(([v, l]) =>
        `<button type="button" class="pill${v === sel ? ' on' : ''}" data-l="${esc(v)}">${l}${cnt(v) ? ` <small>${cnt(v)}</small>` : ''}</button>`).join('')}
      <button type="button" class="pill" id="newList" aria-label="Nowa lista">＋ lista</button>
    </div>
    <form class="addrow" id="af" autocomplete="off">
      <input name="name" placeholder="Dodaj do ${esc(target)}" list="known" enterkeyhint="done" value="${esc(draft.name)}">
      <input name="qty" placeholder="ile" class="qty" inputmode="decimal" value="${esc(draft.qty)}">
      ${unitSelect('unit', draft.unit)}
      <button class="btn primary" aria-label="Dodaj">+</button>
      <datalist id="known">${state.known.slice(0, 300).map(k => `<option value="${esc(k.name)}">`).join('')}</datalist>
    </form>
    ${pending ? `<p class="hint">${state.online ? 'Wysyłanie…' : `Offline — ${pending} zmian wyśle się po powrocie sieci.`}</p>` : ''}
    <section class="card flush">${rows || '<p class="muted center pad">Lista jest pusta.</p>'}</section>
    ${done.length ? `<section class="card flush done"><div class="day">Kupione (${done.length})</div>${done.map(itemRow).join('')}</section>
      <div class="row between">
        <button class="btn" id="clr">Wyczyść kupione</button>
        <button class="btn primary" id="toExp">Zapisz jako wydatek</button>
      </div>` : ''}
    ${sel !== '*' && sel !== '' ? `<button class="btn danger small" id="delList">Usuń listę „${esc(sel)}”</button>` : ''}`;

  view.querySelectorAll('[data-l]').forEach(b => b.onclick = () => { setSel(b.dataset.l); renderShop(); });
  view.querySelector('#newList').onclick = () => {
    const n = prompt('Nazwa nowej listy (np. IKEA, Internet, Budowlany, Apteka):'); if (!n?.trim()) return;
    guard(async () => { await db.saveList(n.trim(), /ikea|dom|mebl/i.test(n) ? '🪑' : /internet|allegro|amazon|online/i.test(n) ? '📦' : /bud|castor|leroy|obi/i.test(n) ? '🔨' : /aptek/i.test(n) ? '💊' : '🛍️');
      setSel(n.trim()); renderShop(); });
  };
  view.querySelector('#delList')?.addEventListener('click', () => confirm(`Usunąć listę „${sel}”? Jej pozycje trafią do ogólnej.`) &&
    guard(async () => { const n = sel; setSel('*'); await db.deleteList(n); }));

  const f = view.querySelector('#af');
  // tekst w polu przetrwa odświeżenie listy (np. gdy druga osoba coś odhaczy)
  f.oninput = f.onchange = () => { draft.name = f.name.value; draft.qty = f.qty.value; draft.unit = f.unit.value; };
  f.name.onfocus = () => draft.focus = true;
  f.name.onblur = () => setTimeout(() => { if (document.activeElement?.closest('#af') == null) draft.focus = false; }, 0);
  if (draft.focus) f.name.focus();
  f.onsubmit = e => {
    e.preventDefault();
    const name = f.name.value.trim(); if (!name) return;
    const q = f.qty.value.trim();
    draft = { name: '', qty: '', unit: 'szt', focus: true };
    db.addShopItem(name, q ? `${q} ${f.unit.value}` : '', guessAisle(name), sel !== '*' && sel !== '' ? sel : null);
  };
  view.querySelectorAll('.sitem').forEach(el => {
    const item = state.shop.find(x => x.id === el.dataset.id);
    el.querySelector('.tick').onclick = () => db.toggleShopItem(item);
    el.querySelector('.edit').onclick = () => go('produkt?id=' + item.id);
  });
  view.querySelector('#clr')?.addEventListener('click', () => {
    if (!confirm(`Usunąć ${done.length} kupionych pozycji z listy?`)) return;
    const food = done.filter(x => !x.list);
    if (food.length && state.extrasReady && state.online && confirm('Dodać kupione z listy ogólnej do spiżarni?'))
      guard(async () => { await boughtToPantry(food); db.clearBought(done); toast('Dodano do spiżarni'); });
    else db.clearBought(done);
  });
  view.querySelector('#toExp')?.addEventListener('click', () => {
    const g = db.homeGroup(); if (!g) return;
    const custom = sel !== '*' && sel !== '';
    const cat = custom ? null : state.categories.find(c => c.name === 'Spożywcze');
    go(`wydatek?g=${g.id}${cat ? '&cat=' + cat.id : ''}${custom ? '&title=' + encodeURIComponent(sel) : ''}&note=${encodeURIComponent(done.map(x => x.name).join(', ').slice(0, 300))}`);
  });
}

function itemRow(x) {
  return `<div class="sitem${x.done ? ' is-done' : ''}${x._pending ? ' pending' : ''}" data-id="${x.id}">
    <button class="tick" aria-label="${x.done ? 'Odznacz' : 'Kupione'}"><span class="box">${x.done ? icon('check') : ''}</span>
      <span class="nm">${esc(x.name)}${x.qty ? ` <small>${esc(x.qty)}</small>` : ''}</span></button>
    <button class="edit" aria-label="Edytuj">✎</button></div>`;
}

export function renderShopItem(params) {
  const x = state.shop.find(i => i.id === params.id);
  if (!x) { go('zakupy'); return; }
  view.innerHTML = `
    <form class="card" id="ef">
      <h2>Produkt</h2>
      <label class="field">Nazwa<input name="name" value="${esc(x.name)}" required></label>
      <div class="field">Ilość</div>
      <div class="qtyrow"><button type="button" class="btn" id="qm">−</button><input name="qty" inputmode="decimal" value="${esc(splitQty(x.qty).n)}">
        ${unitSelect('unit', splitQty(x.qty).u || 'szt')}<button type="button" class="btn" id="qp">+</button></div>
      <label class="field">Lista<select name="list" style="width:100%"><option value="">Ogólna</option>${listNames().map(n => `<option ${n === x.list ? 'selected' : ''} value="${esc(n)}">${esc(n)}</option>`).join('')}</select></label>
      <label class="field">Dział<select name="aisle" style="width:100%">${AISLES.map(([a, i]) => `<option ${a === x.aisle ? 'selected' : ''} value="${esc(a)}">${i} ${esc(a)}</option>`).join('')}</select></label>
      <p class="hint">Zmiana działu zostanie zapamiętana dla tego produktu.</p>
      <div class="row between"><button type="button" class="btn danger" id="del">Usuń</button>
        <div class="row" style="margin:0"><button type="button" class="btn" id="cancel">Anuluj</button><button class="btn primary">Zapisz</button></div></div>
    </form>`;
  const f = view.querySelector('#ef');
  const step = d => { const v = parseFloat((f.qty.value || '0').replace(',', '.')) || 0; const s = ['kg', 'l'].includes(f.unit.value) ? 0.5 : ['g', 'ml'].includes(f.unit.value) ? 100 : 1;
    f.qty.value = String(Math.max(0, Math.round((v + d * s) * 100) / 100)).replace('.', ','); };
  view.querySelector('#qm').onclick = () => step(-1);
  view.querySelector('#qp').onclick = () => step(1);
  f.onsubmit = e => { e.preventDefault(); const q = f.qty.value.trim();
    db.updateShopItem(x, { name: f.name.value.trim(), qty: q && q !== '0' ? `${q} ${f.unit.value}` : null, aisle: f.aisle.value, ...(f.list.value || x.list ? { list: f.list.value || null } : {}) }); back('zakupy'); };
  view.querySelector('#cancel').onclick = () => back('zakupy');
  view.querySelector('#del').onclick = () => { db.deleteShopItem(x); back('zakupy'); };
}

// ------------------------------------------------------------- KARTY
const FORMATS = [['EAN13', 'EAN-13'], ['EAN8', 'EAN-8'], ['CODE128', 'Code 128'], ['UPC', 'UPC-A'], ['CODE39', 'Code 39'], ['ITF', 'ITF'], ['QR', 'Kod QR']];
const COLORS = ['#2f6f62', '#c0392b', '#e67e22', '#f1c40f', '#27ae60', '#2980b9', '#8e44ad', '#34495e', '#d81b60', '#6d4c41'];
const guessFormat = n => /^\d{13}$/.test(n) ? 'EAN13' : /^\d{8}$/.test(n) ? 'EAN8' : /^\d{12}$/.test(n) ? 'UPC' : 'CODE128';
const textOn = hex => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) * 299 + ((n >> 8 & 255) * 587) + (n & 255) * 114) / 1000 > 150 ? '#1d2523' : '#fff'; };

export function renderCards() {
  view.innerHTML = `${tabs('karty')}${needSql()}
    <div class="cards">${state.cards.map(c => `<a class="lcard" href="#karta?id=${c.id}" style="background:${esc(c.color)};color:${textOn(c.color)}">
      <b>${esc(c.name)}</b><small>${esc(c.number.slice(-4).padStart(Math.min(c.number.length, 8), '•'))}</small></a>`).join('')}
      <a class="lcard add" href="#karta-edytuj">+ Dodaj kartę</a></div>
    <p class="hint">Karty działają też bez internetu.</p>`;
}

function drawCode(el, c) {
  if (c.format === 'QR') {
    const qr = qrcode(0, 'M'); qr.addData(c.number); qr.make();
    el.innerHTML = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
    return;
  }
  el.innerHTML = '<svg></svg>';
  try {
    JsBarcode(el.querySelector('svg'), c.number, { format: c.format, displayValue: false, margin: 10, height: 110, width: 2.6, background: '#fff' });
  } catch {
    el.innerHTML = `<p class="neg">Numer nie pasuje do formatu ${esc(c.format)}. Zmień format w edycji.</p>`;
  }
}

let wakeLock = null;
export function renderCard(params) {
  const c = state.cards.find(x => x.id === params.id);
  if (!c) { go('karty'); return; }
  view.innerHTML = `
    <section class="card showcard">
      <div class="row between" style="margin:0"><h2 style="margin:0">${esc(c.name)}</h2><a class="btn small" href="#karta-edytuj?id=${c.id}">Edytuj</a></div>
      <div class="code-box" id="code"></div>
      <p class="cardnum">${esc(c.number.replace(/(.{4})/g, '$1 ').trim())}</p>
      ${c.note ? `<p class="hint center">${esc(c.note)}</p>` : ''}
    </section>
    <p class="hint center">Ekran nie zgaśnie, dopóki karta jest otwarta. Jeśli kasa nie czyta kodu — podgłośnij jasność ekranu.</p>
    <a class="btn" href="#karty">← Karty</a>`;
  drawCode(view.querySelector('#code'), c);
  navigator.wakeLock?.request('screen').then(l => { wakeLock = l; }).catch(() => {});
}
window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#karta?')) { wakeLock?.release().catch(() => {}); wakeLock = null; } });

export function renderCardForm(params) {
  const c = params.id ? state.cards.find(x => x.id === params.id) : null;
  let color = c?.color || COLORS[state.cards.length % COLORS.length];
  view.innerHTML = `
    <form class="card" id="cf" autocomplete="off">
      <h2>${c ? 'Edytuj kartę' : 'Nowa karta'}</h2>
      <div class="scanrow">
        <button type="button" class="btn primary big" id="scan">${icon('camera')} Aparat</button>
        <button type="button" class="btn big" id="scanImg">${icon('image')} Ze zdjęcia</button>
      </div>
      <input type="file" id="scanFile" accept="image/*" hidden>
      <p class="hint">Masz kartę w aplikacji sklepu? Zrób zrzut ekranu z kodem i wybierz go przyciskiem „Ze zdjęcia”.</p>
      <div id="scanBox"></div>
      <label class="field">Sklep<input name="name" value="${esc(c?.name || '')}" placeholder="Biedronka, Rossmann…" required></label>
      <label class="field">Numer karty<input name="number" value="${esc(c?.number || '')}" required inputmode="text"></label>
      <label class="field">Format kodu<select name="format" style="width:100%">${FORMATS.map(([v, l]) => `<option value="${v}" ${v === (c?.format || 'CODE128') ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="code-box small" id="prev"></div>
      <div class="field">Kolor</div>
      <div class="swatches">${COLORS.map(x => `<button type="button" class="sw${x === color ? ' on' : ''}" data-c="${x}" style="background:${x}" aria-label="Kolor"></button>`).join('')}</div>
      <label class="field">Notatka<input name="note" value="${esc(c?.note || '')}" placeholder="np. karta Oli"></label>
      <div class="row between">
        ${c ? '<button type="button" class="btn danger" id="del">Usuń</button>' : '<span></span>'}
        <div class="row" style="margin:0"><button type="button" class="btn" id="cancel">Anuluj</button><button class="btn primary">Zapisz</button></div>
      </div>
    </form>`;
  const f = view.querySelector('#cf');
  const preview = () => { const n = f.number.value.trim(); const box = view.querySelector('#prev'); if (n) drawCode(box, { number: n, format: f.format.value }); else box.innerHTML = ''; };
  f.number.oninput = () => { if (!c) f.format.value = guessFormat(f.number.value.trim()); preview(); };
  f.format.onchange = preview;
  preview();
  view.querySelectorAll('.sw').forEach(b => b.onclick = () => { color = b.dataset.c; view.querySelectorAll('.sw').forEach(x => x.classList.toggle('on', x === b)); });
  view.querySelector('#scan').onclick = () => guard(() => scan(f, preview));
  const file = view.querySelector('#scanFile');
  view.querySelector('#scanImg').onclick = () => { stopScan(); file.value = ''; file.click(); };
  file.onchange = () => file.files[0] && guard(() => scanImage(file.files[0], f, preview));
  view.querySelector('#cancel').onclick = () => { stopScan(); back('karty'); };
  view.querySelector('#del')?.addEventListener('click', () => confirm(`Usunąć kartę ${c.name}?`) && guard(async () => { await db.deleteCard(c.id); go('karty'); }));
  f.onsubmit = e => {
    e.preventDefault();
    guard(async () => {
      stopScan();
      await db.saveCard({ id: c?.id, name: f.name.value.trim(), number: f.number.value.trim(), format: f.format.value, color, note: f.note.value.trim() });
      toast('Zapisano'); go('karty');
    });
  };
}

// --- skanowanie aparatem (Chrome na Androidzie: BarcodeDetector)
const DET_FORMATS = { ean_13: 'EAN13', ean_8: 'EAN8', code_128: 'CODE128', upc_a: 'UPC', code_39: 'CODE39', itf: 'ITF', qr_code: 'QR' };
let stream = null, scanning = false;
function stopScan() {
  scanning = false;
  stream?.getTracks().forEach(t => t.stop()); stream = null;
  const box = document.getElementById('scanBox'); if (box) box.innerHTML = '';
}
window.addEventListener('hashchange', stopScan);
async function detector() {
  if (!('BarcodeDetector' in window)) throw new Error('Ta przeglądarka nie umie skanować kodów — wpisz numer ręcznie.');
  const supported = await BarcodeDetector.getSupportedFormats();
  return new BarcodeDetector({ formats: Object.keys(DET_FORMATS).filter(x => supported.includes(x)) });
}
function fillCode(f, code, onDone) {
  f.number.value = code.rawValue;
  f.format.value = DET_FORMATS[code.format] || guessFormat(code.rawValue);
  navigator.vibrate?.(80);
  onDone(); toast('Odczytano kod');
}
// Kod ze zdjęcia lub zrzutu ekranu: próbuje całe zdjęcie, potem obrócone (kody pionowe) i pomniejszone (bardzo duże zdjęcia)
async function scanImage(file, f, onDone) {
  const det = await detector();
  const img = await createImageBitmap(file);
  const tries = [{ rot: 0, max: 0 }, { rot: 90, max: 0 }, { rot: 0, max: 1600 }, { rot: 90, max: 1600 }];
  for (const t of tries) {
    let src = img;
    if (t.rot || (t.max && Math.max(img.width, img.height) > t.max)) {
      const k = t.max ? Math.min(1, t.max / Math.max(img.width, img.height)) : 1;
      const w = Math.round(img.width * k), h = Math.round(img.height * k);
      const c = document.createElement('canvas');
      c.width = t.rot ? h : w; c.height = t.rot ? w : h;
      const ctx = c.getContext('2d');
      if (t.rot) { ctx.translate(h, 0); ctx.rotate(Math.PI / 2); }
      ctx.drawImage(img, 0, 0, w, h);
      src = c;
    }
    const codes = await det.detect(src).catch(() => []);
    if (codes.length) { fillCode(f, codes[0], onDone); img.close?.(); return; }
  }
  img.close?.();
  throw new Error('Nie znalazłem kodu na zdjęciu. Przytnij zdjęcie do samego kodu albo wpisz numer ręcznie.');
}
async function scan(f, onDone) {
  const det = await detector();
  stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  const box = view.querySelector('#scanBox');
  box.innerHTML = '<video class="scanvid" playsinline muted></video><p class="hint center">Skieruj aparat na kod kreskowy karty</p>';
  const video = box.querySelector('video');
  video.srcObject = stream; await video.play();
  scanning = true;
  while (scanning) {
    const codes = await det.detect(video).catch(() => []);
    if (codes.length) {
      stopScan(); fillCode(f, codes[0], onDone);
      return;
    }
    await new Promise(r => setTimeout(r, 200));
  }
}
