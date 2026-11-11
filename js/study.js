// The libraries and the Ohio Union, read from data/study-spaces.json.
//
// These are where the app can still point when the classroom answer has to be
// no, which is finals week first of all. Ohio State does not publish exam room
// assignments, so Vacant refuses to rank classrooms; the libraries publish their
// own hours, by date, and in that week they publish their longest ones.
//
// What this file may say is narrow on purpose: whether the door is open by the
// hours the place itself publishes, and until when. Never that a seat is free.
//
// Pure. The app passes the clock in.

import { walkMetres, walkMinutes } from './engine.js';

const DAY = 1440;

const isoOf = (d) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const shift = (d, days) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);

// The published spans that touch a calendar date, as minutes from THAT date's
// midnight. Yesterday's late close spills in: Thompson's Monday 7:30am-2am is
// Tuesday 0-120. Null when nothing was published for the date or the day
// before it, which is different from closed and must not read as it.
function spansOn(space, date) {
  const today = space.days?.[isoOf(date)];
  const before = space.days?.[isoOf(shift(date, -1))];
  if (!Array.isArray(today) && !Array.isArray(before)) return null;
  const out = [];
  for (const [open, close] of before ?? []) {
    if (close > DAY) out.push([0, close - DAY]);
  }
  for (const span of today ?? []) out.push(span);
  // A day with no entry of its own but an overnight spill from the day before
  // is only known up to the end of that spill.
  return { spans: out.sort((a, b) => a[0] - b[0]), known: Array.isArray(today) };
}

// Where the door stands at this minute.
//   { when: 'open', closesAt }        closesAt in minutes from today's midnight,
//                                     past 1440 when it runs into tomorrow, and
//                                     null when it is open for the whole of
//                                     what is published
//   { when: 'before', opensAt }       shut now, opens later today
//   { when: 'after' }                 shut for the rest of today
//   { when: 'closed-today' }          published as closed all day
//   { when: 'unknown' }               nothing published for today
export function doorAt(space, now) {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const minute = now.getHours() * 60 + now.getMinutes();
  const day = spansOn(space, date);
  if (!day) return { when: 'unknown' };
  const here = day.spans.find(([open, close]) => minute >= open && minute < close);
  if (here) return { when: 'open', closesAt: closingFrom(space, date, here[1]) };
  if (!day.known) return { when: 'unknown' };
  const next = day.spans.find(([open]) => open > minute);
  if (next) return { when: 'before', opensAt: next[0] };
  if (!day.spans.length) return { when: 'closed-today' };
  return { when: 'after' };
}

// A close at midnight that the next day opens at midnight is not a close: the
// 18th Avenue Library publishes "24 hours" one day at a time. Follow it across
// up to a week; null means it never closes inside what is published.
function closingFrom(space, date, close) {
  let end = close;
  for (let ahead = 1; ahead <= 7; ahead++) {
    if (end < ahead * DAY) return end;
    const next = space.days?.[isoOf(shift(date, ahead))];
    if (!Array.isArray(next)) return end;
    const cont = next.find(([open]) => open === 0);
    if (!cont) return end;
    end = ahead * DAY + cont[1];
  }
  return null;
}

// Nearest first, open before shut, the way the buildings screen orders doors.
// Spaces with nothing published today are left out: a door we cannot describe
// is not one to send someone to.
export function rankStudySpaces({ spaces, buildings, origin, field, now }) {
  const open = [];
  const closed = [];
  for (const space of spaces ?? []) {
    const b = buildings?.[space.b];
    if (!b || !Number.isFinite(b.lat) || !Number.isFinite(b.lon)) continue;
    const door = doorAt(space, now);
    if (door.when === 'unknown') continue;
    const metres = walkMetres(origin, b, space.b, field);
    if (!Number.isFinite(metres)) continue;
    const row = {
      id: space.id,
      name: space.name,
      code: space.b,
      note: space.note ?? null,
      metres: Math.round(metres),
      walk: walkMinutes(metres),
      ...door,
    };
    (door.when === 'open' ? open : closed).push(row);
  }
  const byWalk = (a, b) => a.walk - b.walk || a.metres - b.metres || a.name.localeCompare(b.name);
  open.sort(byWalk);
  closed.sort(byWalk);
  return { open, closed };
}
