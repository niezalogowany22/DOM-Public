// Wyjazdy: osobne grupy z własnym saldem, uczestnicy bez konta, link do podglądu
import * as db from './db.js';
import { state } from './db.js';
import { view, esc, go, back, toast, guard, signCls } from './ui.js';
import { fmtMoney, fmtDate, balances, settle, totalSpent } from './split.js';
import { groupedList } from './wydatki.js';

const dates = g => g.start_date ? fmtDate(g.start_date) + (g.end_date && g.end_date !== g.start_date ? ' – ' + fmtDate(g.end_date) : '') : '';

function tripCard(g) {
  const list = db.expensesOf(g.id);
  const me = db.mePerson(g.id);
  const bal = me ? balances(db.peopleOf(g.id), list)[me.id] : null;
  return `<a class="card trip" href="#wyjazd?g=${g.id}">
    <div class="row between" style="margin:0"><b>${esc(g.name)}</b><span>${fmtMoney(totalSpent(list), g.currency)}</span></div>
    <div class="row between small" style="margin:4px 0 0"><span class="muted">${dates(g)} · ${db.peopleOf(g.id).length} os.</span>
      ${bal != null && Math.abs(bal) > 0.004 ? `<span class="${signCls(bal)}">ja: ${bal > 0 ? '+' : ''}${fmtMoney(bal, g.currency)}</span>` : ''}</div>
  </a>`;
}

export function renderTrips() {
  const trips = state.groups.filter(g => g.kind === 'trip').sort((a, b) => (b.start_date || b.created_at) < (a.start_date || a.created_at) ? -1 : 1);
  const active = trips.filter(g => !g.archived), old = trips.filter(g => g.archived);
  view.innerHTML = `
    <a class="btn primary big" href="#wyjazd-edytuj">+ Nowy wyjazd</a>
    ${active.map(tripCard).join('') || '<p class="muted center pad">Brak wyjazdów. Utwórz pierwszy — dodasz uczestników, także znajomych bez konta.</p>'}
    ${old.length ? `<details class="card"><summary>Zakończone (${old.length})</summary>${old.map(tripCard).join('')}</details>` : ''}`;
}

export const activeTrips = () => state.groups.filter(g => g.kind === 'trip' && !g.archived);
export { tripCard };

export function renderTrip(params) {
  const g = db.groupById(params.g);
  if (!g) { view.innerHTML = '<p class="muted center">Nie znaleziono wyjazdu.</p>'; return; }
  const people = db.peopleOf(g.id);
  const list = db.expensesOf(g.id);
  const bal = balances(people, list);
  const tr = settle(bal);
  const link = g.share_token ? new URL('podglad.html#t=' + g.share_token, location.href).href : null;

  view.innerHTML = `
    <div class="row between"><h2 style="margin:0">${esc(g.name)}</h2><a class="btn small" href="#wyjazd-edytuj?g=${g.id}">Edytuj</a></div>
    <p class="muted small">${dates(g)}${g.archived ? ' · zakończony' : ''}</p>
    <a class="btn primary big" href="#wydatek?g=${g.id}">+ Dodaj wydatek</a>
    <section class="card">
      <div class="row between" style="margin:0"><span class="muted">Razem</span><b class="big">${fmtMoney(totalSpent(list), g.currency)}</b></div>
      ${people.map(p => `<div class="kvrow"><span>${esc(p.name)}${p.user_id ? '' : ' <small class="muted">gość</small>'}</span><b class="${signCls(bal[p.id])}">${bal[p.id] > 0 ? '+' : ''}${fmtMoney(bal[p.id] || 0, g.currency)}</b></div>`).join('')}
    </section>
    <section class="card">
      <div class="row between"><h2>Kto komu</h2><a class="btn small" href="#rozlicz?g=${g.id}">Rozlicz</a></div>
      ${tr.length ? tr.map(t => `<div class="kvrow"><span>${esc(db.personName(t.from))} → ${esc(db.personName(t.to))}</span><b>${fmtMoney(t.amount, g.currency)}</b></div>`).join('') : '<p class="muted">Wszyscy rozliczeni.</p>'}
    </section>
    <section class="card">
      <h2>Podgląd dla znajomych</h2>
      ${link ? `<p class="hint">Każdy z tym linkiem widzi wydatki i saldo tego wyjazdu (bez paragonów i notatek). Nie może nic zmienić.</p>
        <input readonly value="${esc(link)}" id="lnk">
        <div class="row"><button class="btn primary" id="shr">Udostępnij</button><button class="btn danger" id="rvk">Wyłącz link</button></div>`
      : `<p class="hint">Utwórz link tylko do odczytu, np. dla osób bez konta.</p><button class="btn" id="mk">Utwórz link</button>`}
    </section>
    <section class="card flush">${groupedList(list, g)}</section>`;

  const share = url => navigator.share ? navigator.share({ title: g.name, text: `Wydatki: ${g.name}`, url }).catch(() => {})
    : navigator.clipboard.writeText(url).then(() => toast('Skopiowano link'));
  view.querySelector('#mk')?.addEventListener('click', () => guard(async () => {
    const t = await db.shareToken(g.id); share(new URL('podglad.html#t=' + t, location.href).href);
  }));
  view.querySelector('#shr')?.addEventListener('click', () => share(link));
  view.querySelector('#rvk')?.addEventListener('click', () => confirm('Wyłączyć link? Osoby z linkiem stracą podgląd.') && guard(() => db.revokeToken(g.id)));
}

export function renderTripForm(params) {
  const g = params.g ? db.groupById(params.g) : null;
  const existing = g ? db.peopleOf(g.id) : [];
  const members = state.members;
  // uczestnicy: członkowie domu (zaznaczani) + goście
  let guests = existing.filter(p => !p.user_id).map(p => ({ id: p.id, name: p.name }));
  const memberOn = m => g ? existing.some(p => p.user_id === m.user_id) : true;

  view.innerHTML = `
    <form class="card" id="tf" autocomplete="off">
      <h2>${g ? 'Edytuj wyjazd' : 'Nowy wyjazd'}</h2>
      <label class="field">Nazwa<input name="name" value="${esc(g?.name || '')}" placeholder="Bieszczady" required></label>
      <div class="row"><label class="field">Od<input type="date" name="start_date" value="${g?.start_date || ''}"></label>
        <label class="field">Do<input type="date" name="end_date" value="${g?.end_date || ''}"></label></div>
      <label class="field">Waluta rozliczenia<select name="currency">${['PLN', 'EUR', 'USD', 'GBP', 'CZK', 'HUF', 'NOK', 'SEK', 'CHF'].map(c => `<option ${c === (g?.currency || 'PLN') ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <p class="hint">Wydatki w innych walutach przeliczysz kursem NBP przy dodawaniu.</p>
      <div class="field">Uczestnicy z domu</div>
      ${members.map(m => `<label class="check"><input type="checkbox" name="m" value="${m.user_id}" ${memberOn(m) ? 'checked' : ''}> ${esc(m.display_name)}</label>`).join('')}
      <div class="field">Goście (bez konta)</div>
      <div id="guests"></div>
      <div class="row"><input id="gname" placeholder="Imię, np. Tomek"><button type="button" class="btn" id="gadd">Dodaj</button></div>
      <div class="row between">
        ${g ? `<div class="row" style="margin:0"><button type="button" class="btn" id="arch">${g.archived ? 'Przywróć' : 'Zakończ'}</button><button type="button" class="btn danger" id="del">Usuń</button></div>` : '<span></span>'}
        <div class="row" style="margin:0"><button type="button" class="btn" id="cancel">Anuluj</button><button class="btn primary">Zapisz</button></div>
      </div>
    </form>`;
  const f = view.querySelector('#tf');
  const drawGuests = () => {
    view.querySelector('#guests').innerHTML = guests.map((p, i) => `<div class="guest"><input value="${esc(p.name)}" data-i="${i}"><button type="button" class="btn small danger" data-x="${i}">✕</button></div>`).join('');
    view.querySelectorAll('#guests input').forEach(inp => inp.oninput = () => guests[+inp.dataset.i].name = inp.value);
    view.querySelectorAll('#guests [data-x]').forEach(b => b.onclick = () => { guests.splice(+b.dataset.x, 1); drawGuests(); });
  };
  drawGuests();
  const addGuest = () => { const n = view.querySelector('#gname').value.trim(); if (!n) return; guests.push({ name: n }); view.querySelector('#gname').value = ''; drawGuests(); };
  view.querySelector('#gadd').onclick = addGuest;
  view.querySelector('#gname').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); addGuest(); } };
  view.querySelector('#cancel').onclick = () => back('wyjazdy');
  view.querySelector('#arch')?.addEventListener('click', () => guard(async () => { await db.setArchived(g.id, !g.archived); go('wyjazdy'); }));
  view.querySelector('#del')?.addEventListener('click', () => confirm(`Usunąć wyjazd „${g.name}” razem ze wszystkimi wydatkami?`) && guard(async () => { await db.deleteTrip(g.id); go('wyjazdy'); }));

  f.onsubmit = e => {
    e.preventDefault();
    guard(async () => {
      if (f.start_date.value && f.end_date.value && f.end_date.value < f.start_date.value) throw new Error('Data końca jest przed początkiem');
      const chosen = [...f.querySelectorAll('input[name=m]:checked')].map(i => i.value);
      const people = [
        ...members.filter(m => chosen.includes(m.user_id)).map(m => ({ id: existing.find(p => p.user_id === m.user_id)?.id, user_id: m.user_id, name: m.display_name })),
        ...guests.filter(p => p.name.trim()).map(p => ({ id: p.id, name: p.name.trim() })),
      ];
      if (people.length < 2) throw new Error('Dodaj co najmniej dwie osoby');
      const id = await db.saveTrip({ id: g?.id, name: f.name.value.trim(), currency: f.currency.value,
        start_date: f.start_date.value, end_date: f.end_date.value }, people);
      toast('Zapisano');
      go('wyjazd?g=' + id);
    });
  };
}
