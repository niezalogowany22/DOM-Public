/**
 * Dom — Grafik → Kalendarz Google (Google Apps Script, aplikacja internetowa)
 *
 * Wdrożenie:
 *  1. script.google.com → Nowy projekt → wklej ten plik jako Code.gs (i appsscript.json jako manifest).
 *  2. Ustawienia projektu → Właściwości skryptu → dodaj API_KEY = długi losowy ciąg (30+ znaków).
 *  3. Wdróż → Nowe wdrożenie → Aplikacja internetowa: Wykonaj jako „Ja”, Dostęp „Każdy”.
 *  4. Adres kończący się na /exec i API_KEY wpisz w Dom: Grafik → ustawienia.
 *  Kalendarz drugiej osoby musi być Ci udostępniony z prawem „Wprowadzanie zmian w wydarzeniach”.
 *
 * Żadnych ID kalendarzy w kodzie — przychodzą z aplikacji. Skrypt zmienia tylko wydarzenia,
 * które sam utworzył (tag „dom”) albo których tytuł pasuje do kategorii z Dom (managedTitles).
 * Twoje pozostałe wydarzenia w kalendarzu nie są ruszane.
 *
 * Protokół (POST, treść JSON): { key, action, ... } → { ok: true, ... } | { ok: false, error }
 *   ping                                   → { tz }
 *   calendars                              → { calendars: [{ id, name }] }
 *   list  { calendarId, from, to }         → { events: [{ date, title, allDay, start, end, cat, tagged }] }
 *   sync  { calendarId, from, to, items, managedTitles } → { stats: { created, updated, deleted } }
 *   from/to: 'RRRR-MM-DD' (to — bez tego dnia); start/end: 'GG:MM'
 */

const TAG = 'dom';         // znacznik wydarzeń utworzonych przez Dom
const TAG_CAT = 'domCat';  // id kategorii z Dom

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    checkKey_(req.key);
    switch (req.action) {
      case 'ping': return out_({ ok: true, tz: Session.getScriptTimeZone() });
      case 'calendars': return out_({ ok: true, calendars: listCalendars_() });
      case 'list': return out_({ ok: true, events: listEvents_(req) });
      case 'sync': return out_({ ok: true, stats: sync_(req) });
      default: throw new Error('Nieznana akcja');
    }
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  }
}

function doGet() {
  return out_({ ok: false, error: 'Użyj POST' });
}

// ---------------------------------------------------------------- pomocnicze
function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function checkKey_(key) {
  const expected = PropertiesService.getScriptProperties().getProperty('API_KEY');
  if (!expected || expected.length < 20) throw new Error('Skrypt nie ma ustawionego API_KEY (min. 20 znaków)');
  const given = String(key || '');
  // porównanie w stałym czasie
  let diff = given.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ (given.charCodeAt(i) || 0);
  if (diff !== 0) throw new Error('Nieprawidłowy klucz');
}

function calendar_(id) {
  if (!id) throw new Error('Brak ID kalendarza');
  const cal = CalendarApp.getCalendarById(id);
  if (!cal) throw new Error('Brak dostępu do kalendarza: ' + id);
  return cal;
}

function tz_() { return Session.getScriptTimeZone(); }

// 'RRRR-MM-DD' → Date o północy w strefie skryptu
function day_(s) {
  const p = String(s).split('-').map(Number);
  if (p.length !== 3 || p.some(isNaN)) throw new Error('Zła data: ' + s);
  return new Date(p[0], p[1] - 1, p[2]);
}

function fmtDay_(d) { return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd'); }
function fmtTime_(d) { return Utilities.formatDate(d, tz_(), 'HH:mm'); }

// 'GG:MM' lub 'GG:MM:SS' → [godz, min]
function hm_(s) {
  const p = String(s || '').split(':').map(Number);
  if (isNaN(p[0])) throw new Error('Zła godzina: ' + s);
  return [p[0], isNaN(p[1]) ? 0 : p[1]];
}

function isOurs_(ev, managed) {
  return ev.getTag(TAG) === '1' || managed.has(ev.getTitle());
}

// ---------------------------------------------------------------- akcje
function listCalendars_() {
  return CalendarApp.getAllCalendars()
    .filter(function (c) { return !c.isHidden(); })
    .map(function (c) { return { id: c.getId(), name: c.getName() }; });
}

function listEvents_(req) {
  const cal = calendar_(req.calendarId);
  const from = day_(req.from), to = day_(req.to);
  return cal.getEvents(from, to).map(function (ev) {
    const allDay = ev.isAllDayEvent();
    const start = allDay ? ev.getAllDayStartDate() : ev.getStartTime();
    return {
      date: fmtDay_(start),
      title: ev.getTitle(),
      allDay: allDay,
      start: allDay ? null : fmtTime_(ev.getStartTime()),
      end: allDay ? null : fmtTime_(ev.getEndTime()),
      cat: ev.getTag(TAG_CAT) || '',
      tagged: ev.getTag(TAG) === '1'
    };
  }).filter(function (e) { return e.date >= req.from && e.date < req.to; });
}

function sync_(req) {
  const cal = calendar_(req.calendarId);
  const from = day_(req.from), to = day_(req.to);
  const managed = new Set((req.managedTitles || []).map(String));
  const stats = { created: 0, updated: 0, deleted: 0 };

  // żądany stan: jeden wpis na dzień
  const want = {};
  (req.items || []).forEach(function (it) {
    if (it && it.date >= req.from && it.date < req.to && it.title) want[it.date] = it;
  });

  // obecne wydarzenia zarządzane przez Dom, pogrupowane po dniu
  const have = {};
  cal.getEvents(from, to).forEach(function (ev) {
    if (!isOurs_(ev, managed)) return;
    const d = fmtDay_(ev.isAllDayEvent() ? ev.getAllDayStartDate() : ev.getStartTime());
    if (d < req.from || d >= req.to) return;
    (have[d] = have[d] || []).push(ev);
  });

  // usuń zbędne i niezgodne
  Object.keys(have).forEach(function (d) {
    const it = want[d];
    let kept = false;
    have[d].forEach(function (ev) {
      if (!kept && it && same_(ev, it)) {
        kept = true;
        if (ev.getTag(TAG) !== '1' || (ev.getTag(TAG_CAT) || '') !== (it.cat || '')) { tag_(ev, it); stats.updated++; }
        delete want[d];
      } else {
        ev.deleteEvent();
        stats.deleted++;
      }
    });
  });

  // utwórz brakujące
  Object.keys(want).forEach(function (d) {
    create_(cal, want[d]);
    stats.created++;
  });
  return stats;
}

function same_(ev, it) {
  if (ev.getTitle() !== it.title) return false;
  if (!!it.allDay !== ev.isAllDayEvent()) return false;
  if (it.allDay) return true;
  return fmtTime_(ev.getStartTime()) === fmtHM_(it.start) && fmtTime_(ev.getEndTime()) === fmtHM_(it.end);
}

function fmtHM_(s) {
  const t = hm_(s);
  return ('0' + t[0]).slice(-2) + ':' + ('0' + t[1]).slice(-2);
}

function tag_(ev, it) {
  ev.setTag(TAG, '1');
  ev.setTag(TAG_CAT, it.cat || '');
}

function create_(cal, it) {
  const date = day_(it.date);
  let ev;
  if (it.allDay) {
    ev = cal.createAllDayEvent(it.title, date);
  } else {
    const s = hm_(it.start), e = hm_(it.end);
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), s[0], s[1]);
    const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), e[0], e[1]);
    if (end <= start) end.setDate(end.getDate() + 1); // zmiana nocna przez północ
    ev = cal.createEvent(it.title, start, end);
  }
  tag_(ev, it);
  return ev;
}
