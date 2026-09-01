// One room, one date: the classes that meet in it, and what the screen is
// allowed to say about that day.
//
// Split out of the screen for the same reason js/claim.js is. The room screen
// draws a day and makes one sentence about it, the sentence is the half that is
// wrong in the expensive direction, and neither half could be checked without a
// browser while both lived in js/app.js.
//
// Pure. A room, a date and the term's own tables in; intervals and a sentence
// out. No app state, no Date, no DOM.

import { activeSessions } from './engine.js';
import { clock, isoDate } from './state.js';

// One class in one room on one day. Unlike blocksOn this does NOT merge: two
// classes back to back are two things a reader wants to see named, and the grid
// has room to draw them as two.
export function classesOn(room, date, sessions, courses) {
  const active = activeSessions(sessions, isoDate(date));
  const day = date.getDay();
  const seen = new Set();
  const out = [];
  for (const b of room.busy ?? []) {
    if (Number(b[0]) !== day) continue;
    if (active && b[3] !== undefined && active[b[3]] === false) continue;
    const [, from, to] = b;
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
    const course = Number.isInteger(b[4]) && b[4] >= 0 ? (courses?.[b[4]] ?? null) : null;
    const key = `${from}|${to}|${course ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from, to, course });
  }
  out.sort((a, b) => a.from - b.from || a.to - b.to);
  return out;
}

// The same day merged, which is the shape a sentence about free time reads.
// Overlaps become one block and back-to-back classes stay two.
//
// The DATE decides both halves, not today's weekday. The mask matters as much
// as the weekday: the term runs three sessions and 18 of 425 rooms have a
// different Monday either side of the 2026-10-19 boundary, 107 of the 2,975
// room-days in a week.
export function blocksOn(room, date, sessions) {
  const active = activeSessions(sessions, isoDate(date));
  const day = date.getDay();
  const raw = [];
  for (const b of room.busy ?? []) {
    if (Number(b[0]) !== day) continue;
    if (active && b[3] !== undefined && active[b[3]] === false) continue;
    const [, s, e] = b;
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
    raw.push([s, e]);
  }
  raw.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const b of raw) {
    const last = merged[merged.length - 1];
    if (last && b[0] < last[1]) last[1] = Math.max(last[1], b[1]);
    else merged.push([...b]);
  }
  return merged;
}

// The one line at the top of the room screen for a date nobody is standing in.
//
// claimFor is the only thing on that screen that talks about now, so on another
// day it stops: no window, no walk, no "yours for", because none of those are a
// fact about Tuesday. What is left is the shape of the day.
//
// The mask alone cannot see that shape. An empty busy list means two different
// things, the room has nothing that weekday or the schedule does not reach the
// date at all, so reading only the mask put "First class 10:05am" on Veterans
// Day and "No class Tue Dec 15" inside finals week. Order and words follow
// refusalFor() and resolveState(): two screens that reach this verdict by their
// own routes drift, and the day they drift the room screen names a class on a
// date the question screen refuses on.
export function dayClaim({ closed, blocks = [], calendar, inTerm, term }) {
  if (calendar?.exams) return { head: 'Finals week, exam rooms are not published', sub: '' };
  if (inTerm === false) return { head: `${term ?? 'This term'} does not cover this day`, sub: '' };
  if (calendar?.buildingsClosed) {
    return { head: calendar.name ? `${calendar.name}, campus is closed` : 'Campus is closed', sub: '' };
  }
  // Autumn Break has open doors and no classes, which is the best day of the
  // term for this app, so it must not be dressed as a closure.
  if (calendar?.noClasses) return { head: calendar.name ? `${calendar.name}, no classes` : 'No classes', sub: '' };
  if (closed) return { head: 'Closed', sub: '' };
  // No date in any of these. The grid heading five lines below already names
  // the day the sentence is about.
  const first = blocks[0];
  return first ? { head: `First class ${clock(first[0])}`, sub: '' } : { head: 'No class', sub: '' };
}
