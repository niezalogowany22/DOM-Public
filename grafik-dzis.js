// Kto pracuje danego dnia — dane z grafiku we wspólnej bazie (Start, Menu)
import { G, grEnsure, entry, cat, fmtH, pullMonth, pulledAt, grLoad } from './gr-data.js';

export const grafikReady = () => { grEnsure(); return G.people.length > 0; };

// [{ name, color, cat: {name, short, color, start_time, end_time, all_day, kind} | null, title }]
export function shiftsOn(date) {
  grEnsure();
  return G.people.map(p => {
    const e = entry(p.id, date);
    return { name: p.name, color: p.color, cat: e?.cat ? cat(e.cat) : null, title: e?.raw?.title || null };
  });
}
export function shiftLabel(s) {
  if (s.cat) return s.cat.kind === 'work' && !s.cat.all_day ? `${s.cat.name} ${fmtH(s.cat.start_time)}–${fmtH(s.cat.end_time)}` : s.cat.name;
  return s.title || 'wolne';
}
// Odśwież z kalendarzy miesiące z podanych dni (najwyżej co 30 min). true = coś się zmieniło
let busy = false;
export async function refreshShifts(dates, maxAge = 30 * 60e3) {
  await grEnsure();
  if (busy || !navigator.onLine || !G.settings?.api_url) return false;
  busy = true; let changed = false;
  try {
    for (const p of G.people) for (const ym of [...new Set(dates.map(d => d.slice(0, 7)))])
      if (p.calendar_id && Date.now() - pulledAt(p.id, ym) > maxAge) changed = (await pullMonth(p.id, ym).catch(() => false)) || changed;
  } finally { busy = false; }
  return changed;
}
export { grLoad };
