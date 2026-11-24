// Kuchnia: przepisy, menu tygodniowe, lista zakupów z menu
import * as db from './db.js';
import { state } from './db.js';
import { view, esc, parseNum, go, back, toast, guard, pills, bindPills, picked, icon } from './ui.js';
import { guessAisle } from './zakupy.js';
import { today } from './split.js';
import { shiftsOn, refreshShifts } from './grafik-dzis.js';
import { inPantry } from './dodatki.js';

const MEALS = ['Śniadanie', 'Obiad', 'Kolacja', 'Inne'];
const tabs = a => `<div class="subnav"><a href="#menu" class="${a === 'menu' ? 'on' : ''}">Menu</a><a href="#przepisy" class="${a === 'przepisy' ? 'on' : ''}">Przepisy</a></div>`;
const needSql = () => state.kitchenReady ? '' : `<section class="card warn"><b>Brak tabel kuchni.</b> Uruchom <code>schema-kuchnia.sql</code> w Supabase, potem odśwież.</section>`;
const recipe = id => state.recipes.find(r => r.id === id);
const lines = s => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);

// ------------------------------------------------------------- daty
const iso = d => d.toLocaleDateString('sv-SE');
const dayDate = s => new Date(s + 'T12:00');
const monday = s => { const d = dayDate(s); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return iso(d); };
const plusDays = (s, n) => { const d = dayDate(s); d.setDate(d.getDate() + n); return iso(d); };
const dayLabel = s => { const t = dayDate(s).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'short' }); return t[0].toUpperCase() + t.slice(1); };
const shortDate = s => dayDate(s).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });

// ------------------------------------------------------------- składniki
const UNIT = '(?:kg|dag|g|ml|l|łyżecz(?:ka|ki|ek)|łyżeczk[ai]|łyż(?:ka|ki|ek|\\.)?|szklan(?:ka|ki|ek)|szkl\\.?|szt(?:\\.|uk[ia]?|uka)?|opak(?:\\.|owani[ea])?|ząb(?:ek|ki|ków)?|ząbki|plaster(?:ki|ków|ek)?|plastr(?:y|ów)|puszk[ai]|puszek|pęcz(?:ek|ki|ków)|garść|garści|szczypt[ay]|kostk[ai]|kostek|słoik(?:i|ów)?|główk[ai]|liście|liść)';
const FRAC = { '½': .5, '¼': .25, '¾': .75, '⅓': 1 / 3, '⅔': 2 / 3 };
const RE = new RegExp(`^\\s*(\\d+\\s*[½¼¾⅓⅔]|\\d+(?:[.,]\\d+)?\\s*/\\s*\\d+|\\d+(?:[.,]\\d+)?|[½¼¾⅓⅔])?(?:\\s*[-–]\\s*\\d+(?:[.,]\\d+)?)?\\s*(${UNIT}(?=\\s|$))?\\s*(.*)$`, 'i');
function num(s) {
  if (!s) return null;
  s = s.replace(/\s+/g, '');
  const m = s.match(/^(\d+)([½¼¾⅓⅔])$/); if (m) return +m[1] + FRAC[m[2]];
  if (FRAC[s]) return FRAC[s];
  if (s.includes('/')) { const [a, b] = s.split('/'); return parseNum(a) / parseNum(b); }
  return parseNum(s);
}
export function parseIng(line) {
  const m = RE.exec(line) || [];
  return { q: num(m[1]), unit: (m[2] || '').toLowerCase(), name: (m[3] || line).trim() };
}
const fmtQ = q => q == null ? '' : (Math.round(q * 100) / 100).toLocaleString('pl-PL');
const ingText = (p, f = 1) => [p.q != null ? fmtQ(p.q * f) : '', p.unit, p.name].filter(Boolean).join(' ');
const shopName = n => n.replace(/\(.*?\)/g, '').split(/,|\s[-–]\s/)[0].trim();

// ------------------------------------------------------------- MENU
export function renderMenu(params) {
  const w = monday(params.w || today());
  const days = [...Array(7)].map((_, i) => plusDays(w, i));
  const t = today();
  view.innerHTML = `${tabs('menu')}${needSql()}
    <div class="monthnav"><a class="btn small" href="#menu?w=${plusDays(w, -7)}">‹</a><b>${shortDate(w)} – ${shortDate(plusDays(w, 6))}</b><a class="btn small" href="#menu?w=${plusDays(w, 7)}">›</a></div>
    ${days.map(d => { const items = state.plan.filter(p => p.day === d).sort((a, b) => MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal));
      return `<section class="card mday${d === t ? ' today' : ''}">
        <div class="row between" style="margin:0"><b>${dayLabel(d)}</b><a class="btn small" href="#posilek?d=${d}">+</a></div>
        <div class="mshifts">${shiftsOn(d).filter(s => s.cat && s.cat.kind !== 'off').map(s => `<span style="border-color:${esc(s.cat.color)}">${esc(s.name)}: ${esc(s.cat.short || s.cat.name)}</span>`).join('')}</div>
        ${items.map(p => { const r = recipe(p.recipe_id);
          return `<div class="meal"><span class="muted small">${esc(p.meal)}</span>
            ${r ? `<a href="#przepis?id=${r.id}${p.servings ? '&s=' + p.servings : ''}">${esc(r.title)}</a>` : `<span>${esc(p.text || '—')}</span>`}
            ${p.servings ? `<small class="muted">${p.servings} porc.</small>` : '<span></span>'}
            <button class="btn small" data-del="${p.id}" aria-label="Usuń">✕</button></div>`; }).join('')}
      </section>`; }).join('')}
    <a class="btn primary big" href="#menu-lista?w=${w}">${icon('cart')} Lista zakupów z tego tygodnia</a>`;
  view.querySelectorAll('[data-del]').forEach(b => b.onclick = () => guard(() => db.deleteMeal(b.dataset.del)));
  refreshShifts(days).then(ch => { if (ch && /^#(menu|kuchnia)/.test(location.hash || '#menu')) renderMenu(params); });
}

export function renderMealForm(params) {
  const d = params.d || today();
  const pre = params.r ? recipe(params.r) : null;
  const sorted = [...state.recipes].sort((a, b) => (b.fav - a.fav) || a.title.localeCompare(b.title, 'pl'));
  view.innerHTML = `
    <form class="card" id="mf" autocomplete="off">
      <h2>Dodaj do menu</h2>
      <label class="field">Dzień<input type="date" name="day" value="${d}" required></label>
      ${pills('meal', MEALS.map(m => [m, m]), 'Obiad')}
      <label class="field">Przepis<select name="recipe" style="width:100%"><option value="">— bez przepisu —</option>
        ${sorted.map(r => `<option value="${r.id}" ${r.id === pre?.id ? 'selected' : ''}>${r.fav ? '★ ' : ''}${esc(r.title)}</option>`).join('')}</select></label>
      <label class="field">albo wpisz<input name="text" placeholder="np. pizza na mieście, resztki"></label>
      <label class="field">Porcje<input name="servings" inputmode="numeric" value="${pre?.servings || ''}" placeholder="jak w przepisie"></label>
      <div class="row between"><span></span><div class="row" style="margin:0"><button type="button" class="btn" id="cancel">Anuluj</button><button class="btn primary">Dodaj</button></div></div>
    </form>`;
  const f = view.querySelector('#mf');
  bindPills(f);
  f.recipe.onchange = () => { const r = recipe(f.recipe.value); if (r) f.servings.value = r.servings; };
  view.querySelector('#cancel').onclick = () => back('menu');
  f.onsubmit = e => { e.preventDefault(); guard(async () => {
    if (!f.recipe.value && !f.text.value.trim()) throw new Error('Wybierz przepis albo wpisz, co jecie');
    await db.addMeal({ day: f.day.value, meal: picked(f, 'meal'), recipe_id: f.recipe.value || null, text: f.text.value.trim(), servings: parseInt(f.servings.value) || null });
    toast('Dodano'); go('menu?w=' + monday(f.day.value));
  }); };
}

// Zbiorcza lista składników z menu
export function renderMenuShop(params) {
  const w = monday(params.w || today());
  const from = w < today() && plusDays(w, 6) >= today() ? today() : w;
  const to = plusDays(w, 6);
  const meals = state.plan.filter(p => p.day >= from && p.day <= to && p.recipe_id && recipe(p.recipe_id));
  const agg = new Map();
  for (const m of meals) {
    const r = recipe(m.recipe_id);
    const f = m.servings && r.servings ? m.servings / r.servings : 1;
    for (const line of lines(r.ingredients)) {
      const p = parseIng(line);
      const name = shopName(p.name) || p.name;
      const key = db.nameKey(name) + '|' + p.unit;
      const cur = agg.get(key) || { name, unit: p.unit, q: null, from: new Set() };
      if (p.q != null) cur.q = (cur.q || 0) + p.q * f;
      cur.from.add(r.title);
      agg.set(key, cur);
    }
  }
  const items = [...agg.values()].sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  const onList = new Set(state.shop.filter(x => !x.done).map(x => db.nameKey(x.name)));
  for (const it of items) if (inPantry(it.name)) onList.add(db.nameKey(it.name)), it.pantry = true;
  view.innerHTML = `
    <section class="card">
      <h2>Składniki ${shortDate(from)} – ${shortDate(to)}</h2>
      <p class="hint">${meals.length} posiłków z przepisem. Odznacz to, co macie w domu.</p>
      ${items.map((it, i) => `<label class="check ing"><input type="checkbox" data-i="${i}" ${onList.has(db.nameKey(it.name)) ? '' : 'checked'}>
        <span><b>${esc(it.name)}</b> ${it.q != null ? fmtQ(it.q) + ' ' + esc(it.unit) : esc(it.unit)}
        <small class="muted">${esc([...it.from].join(', '))}${it.pantry ? ' · jest w spiżarni' : onList.has(db.nameKey(it.name)) ? ' · już na liście' : ''}</small></span></label>`).join('')
        || '<p class="muted">Brak przepisów w menu na ten tydzień.</p>'}
    </section>
    <div class="row between"><button class="btn" id="bk">Wróć</button>${items.length ? '<button class="btn primary" id="add">Dodaj zaznaczone do listy</button>' : ''}</div>`;
  view.querySelector('#bk').onclick = () => back('menu');
  view.querySelector('#add')?.addEventListener('click', () => {
    const chosen = [...view.querySelectorAll('input[data-i]:checked')].map(c => items[+c.dataset.i]);
    for (const it of chosen) db.addShopItem(it.name, it.q != null ? `${fmtQ(it.q)} ${it.unit}`.trim() : it.unit || '', guessAisle(it.name));
    toast(`Dodano ${chosen.length} pozycji`); go('zakupy');
  });
}

// ------------------------------------------------------------- PRZEPISY
export function renderRecipes(params) {
  db.migrateRecipeImages();
  const q = (params.q || '').toLowerCase();
  const tag = params.tag || '';
  const tags = [...new Set(state.recipes.flatMap(r => r.tags || []))].sort((a, b) => a.localeCompare(b, 'pl'));
  const list = state.recipes
    .filter(r => (!q || r.title.toLowerCase().includes(q) || r.ingredients.toLowerCase().includes(q)) && (!tag || (r.tags || []).includes(tag)))
    .sort((a, b) => (b.fav - a.fav) || a.title.localeCompare(b.title, 'pl'));
  view.innerHTML = `${tabs('przepisy')}${needSql()}
    <a class="btn primary big" href="#przepis-edytuj">+ Nowy przepis</a>
    <input id="q" type="search" placeholder="Szukaj po nazwie lub składniku" value="${esc(params.q || '')}">
    ${tags.length ? `<div class="pills tagbar">${['', ...tags].map(t => `<a class="pill${t === tag ? ' on' : ''}" href="#przepisy?tag=${encodeURIComponent(t)}${q ? '&q=' + encodeURIComponent(q) : ''}">${t ? esc(t) : 'Wszystkie'}</a>`).join('')}</div>` : ''}
    <div class="rlist">${list.map(r => `<a class="card rcard" href="#przepis?id=${r.id}">
      <span class="rimg" data-photo="${esc(r.photo_path || '')}">${r.photo_path ? '' : icon('bowl')}</span>
      <span><b>${r.fav ? icon('starFill', 'ic-svg ic-inline') + ' ' : ''}${esc(r.title)}</b><small class="muted">${[r.time_min ? r.time_min + ' min' : '', r.servings + ' porc.', ...(r.tags || [])].filter(Boolean).map(esc).join(' · ')}</small></span></a>`).join('')
      || `<p class="muted center pad">${state.recipes.length ? 'Nic nie pasuje.' : 'Brak przepisów. Dodaj pierwszy — możesz wkleić link ze strony z przepisem.'}</p>`}</div>`;
  const qi = view.querySelector('#q');
  let t;
  qi.oninput = () => { clearTimeout(t); t = setTimeout(() => { history.replaceState(history.state, '', `#przepisy?q=${encodeURIComponent(qi.value)}${tag ? '&tag=' + encodeURIComponent(tag) : ''}`); renderRecipes({ q: qi.value, tag }); const n = view.querySelector('#q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
  loadPhotos();
}
function loadPhotos() {
  view.querySelectorAll('[data-photo]').forEach(el => {
    if (!el.dataset.photo || !state.online) return;
    db.receiptUrl(el.dataset.photo).then(u => { el.style.backgroundImage = `url('${u}')`; el.textContent = ''; }).catch(() => {});
  });
}

let wake = null;
export function renderRecipe(params) {
  const r = recipe(params.id);
  if (!r) { view.innerHTML = '<p class="muted center">Nie znaleziono przepisu.</p>'; return; }
  let servings = parseInt(params.s) || r.servings;
  const ings = lines(r.ingredients).map(parseIng);
  const draw = () => {
    const f = r.servings ? servings / r.servings : 1;
    view.querySelector('#ings').innerHTML = ings.map(p => `<li>${esc(ingText(p, f))}</li>`).join('') || '<li class="muted">brak</li>';
    view.querySelector('#sv').textContent = servings;
  };
  view.innerHTML = `
    ${r.photo_path ? `<div class="hero" data-photo="${esc(r.photo_path)}"></div>` : ''}
    <div class="row between" style="margin-top:12px"><h2 style="margin:0">${esc(r.title)}</h2>
      <button class="btn small" id="fav" aria-label="Ulubiony">${r.fav ? '★' : '☆'}</button></div>
    <p class="muted small">${[r.time_min ? r.time_min + ' min' : '', ...(r.tags || [])].filter(Boolean).map(esc).join(' · ')}</p>
    <section class="card">
      <div class="row between" style="margin:0"><h3 style="margin:0">Składniki</h3>
        <div class="stepper"><button class="btn small" id="minus">−</button><span><b id="sv"></b> porc.</span><button class="btn small" id="plus">+</button></div></div>
      <ul class="ings" id="ings"></ul>
      <button class="btn" id="toShop">${icon('cart')} Dodaj składniki do listy</button>
    </section>
    <section class="card"><h3 style="margin-top:0">Przygotowanie</h3>
      <ol class="steps">${lines(r.steps).map(s => `<li>${esc(s)}</li>`).join('') || '<li class="muted">brak</li>'}</ol>
      ${r.note ? `<p class="hint">${esc(r.note)}</p>` : ''}
      ${r.source_url ? `<a class="link" href="${esc(r.source_url)}" target="_blank" rel="noopener">Źródło ↗</a>` : ''}
    </section>
    <div class="row between"><a class="btn" href="#przepis-edytuj?id=${r.id}">Edytuj</a><a class="btn primary" href="#posilek?r=${r.id}">${icon('calendar')} Do menu</a></div>
    <p class="hint center">Ekran nie zgaśnie, dopóki przepis jest otwarty.</p>`;
  draw();
  loadPhotos();
  view.querySelector('#minus').onclick = () => { if (servings > 1) { servings--; draw(); } };
  view.querySelector('#plus').onclick = () => { servings++; draw(); };
  view.querySelector('#fav').onclick = () => guard(() => db.setFav(r, !r.fav));
  view.querySelector('#toShop').onclick = () => {
    const f = r.servings ? servings / r.servings : 1;
    const onList = new Set(state.shop.filter(x => !x.done).map(x => db.nameKey(x.name)));
    let n = 0;
    for (const p of ings) {
      const name = shopName(p.name) || p.name;
      if (onList.has(db.nameKey(name)) || inPantry(name)) continue;
      db.addShopItem(name, p.q != null ? `${fmtQ(p.q * f)} ${p.unit}`.trim() : p.unit, guessAisle(name)); n++;
    }
    toast(n ? `Dodano ${n} składników do listy` : 'Wszystko już jest na liście');
  };
  navigator.wakeLock?.request('screen').then(l => { wake = l; }).catch(() => {});
}
window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#przepis?')) { wake?.release().catch(() => {}); wake = null; } });

export function renderRecipeForm(params) {
  const r = params.id ? recipe(params.id) : null;
  let photoFile = null, removePhoto = false, imageUrl = null;
  view.innerHTML = `
    <form class="card" id="rf" autocomplete="off">
      <h2>${r ? 'Edytuj przepis' : 'Nowy przepis'}</h2>
      ${r ? '' : `<div class="importrow"><input name="url" type="url" placeholder="Wklej link do przepisu (opcjonalnie)"><button type="button" class="btn" id="imp">Importuj</button></div>
        <p class="hint">Działa z większością stron z przepisami (np. Kwestia Smaku, Ania Gotuje, Przepisy.pl).</p>`}
      <label class="field">Nazwa<input name="title" value="${esc(r?.title || '')}" required></label>
      <div class="row"><label class="field">Porcje<input name="servings" inputmode="numeric" value="${r?.servings || 2}"></label>
        <label class="field">Czas (min)<input name="time_min" inputmode="numeric" value="${r?.time_min || ''}"></label></div>
      <label class="field">Tagi (po przecinku)<input name="tags" value="${esc((r?.tags || []).join(', '))}" placeholder="obiad, szybkie, wege"></label>
      <label class="field">Składniki — jeden w linii<textarea name="ingredients" rows="8" placeholder="500 g makaronu&#10;2 ząbki czosnku&#10;1 łyżka oliwy">${esc(r?.ingredients || '')}</textarea></label>
      <label class="field">Przygotowanie — jeden krok w linii<textarea name="steps" rows="8">${esc(r?.steps || '')}</textarea></label>
      <label class="field">Notatka<input name="note" value="${esc(r?.note || '')}" placeholder="np. dać mniej soli"></label>
      <label class="field">Źródło (link)<input name="source_url" type="url" value="${esc(r?.source_url || '')}"></label>
      <div class="field">Zdjęcie</div>
      <div id="ph"></div>
      <div class="row"><label class="btn">${icon('camera')} Zrób zdjęcie<input type="file" accept="image/*" capture="environment" id="cam" hidden></label>
        <label class="btn">${icon('image')} Z galerii<input type="file" accept="image/*" id="gal" hidden></label></div>
      <div class="row between">
        ${r ? '<button type="button" class="btn danger" id="del">Usuń</button>' : '<span></span>'}
        <div class="row" style="margin:0"><button type="button" class="btn" id="cancel">Anuluj</button><button class="btn primary">Zapisz</button></div>
      </div>
    </form>`;
  const f = view.querySelector('#rf');
  const showPhoto = src => {
    view.querySelector('#ph').innerHTML = src ? `<div class="thumb"><img src="${esc(src)}" alt=""><button type="button" class="btn small danger" id="rmP">Usuń zdjęcie</button></div>` : '';
    view.querySelector('#rmP')?.addEventListener('click', () => { photoFile = null; removePhoto = true; imageUrl = null; showPhoto(null); });
  };
  if (r?.photo_path) db.receiptUrl(r.photo_path).then(showPhoto).catch(() => {}); else showPhoto(null);
  for (const id of ['cam', 'gal']) view.querySelector('#' + id).onchange = ev => {
    const file = ev.target.files[0]; if (!file) return;
    photoFile = file; removePhoto = true; imageUrl = null; showPhoto(URL.createObjectURL(file));
  };
  view.querySelector('#imp')?.addEventListener('click', () => guard(async () => {
    const url = f.url.value.trim(); if (!url) throw new Error('Wklej link');
    toast('Pobieram przepis…');
    const d = await db.importRecipe(url);
    if (!d.ok) { if (d.title && !f.title.value) f.title.value = d.title; f.source_url.value = url; throw new Error(d.error); }
    f.title.value = d.title || f.title.value;
    if (d.servings) f.servings.value = d.servings;
    if (d.time_min) f.time_min.value = d.time_min;
    f.ingredients.value = d.ingredients.join('\n');
    f.steps.value = d.steps.join('\n');
    f.source_url.value = d.source_url;
    if (d.image_url && !photoFile) {
      try { photoFile = await db.recipeImage(d.image_url); removePhoto = true; showPhoto(URL.createObjectURL(photoFile)); } catch {}
    }
    toast('Zaimportowano — sprawdź i zapisz');
  }));
  view.querySelector('#cancel').onclick = () => back('przepisy');
  view.querySelector('#del')?.addEventListener('click', () => confirm(`Usunąć przepis „${r.title}”? Zniknie też z menu.`) && guard(async () => { await db.deleteRecipe(r); go('przepisy'); }));
  f.onsubmit = e => { e.preventDefault(); guard(async () => {
    const id = await db.saveRecipe({
      id: r?.id, title: f.title.value.trim(), servings: parseInt(f.servings.value) || 2, time_min: parseInt(f.time_min.value) || null,
      tags: f.tags.value.split(',').map(t => t.trim().toLowerCase()).filter(Boolean), ingredients: f.ingredients.value.trim(),
      steps: f.steps.value.trim(), note: f.note.value.trim(), source_url: f.source_url.value.trim(), image_url: imageUrl,
      photo_path: r?.photo_path, fav: r?.fav,
    }, photoFile, removePhoto && !photoFile);
    toast('Zapisano'); go('przepis?id=' + id);
  }); };
}

// Na ekran Start
export function todayMeals() {
  return state.plan.filter(p => p.day === today()).sort((a, b) => MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal))
    .map(p => ({ ...p, title: recipe(p.recipe_id)?.title || p.text }));
}
