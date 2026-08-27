// What the app is allowed to say today, decided before a single room is ranked.
//
// Everything here is pure and takes its clock as an argument. That is not a
// style preference. The exam-week refusal is the one behaviour nobody can check
// by opening the app, because the only way to reach exam week is to wait until
// December, so it has to be reachable from a test with a fake date.
//
// Runs in the browser and under node, and imports nothing that touches the DOM.

import { PACKUP, activeSessions, distanceMetres, usableMinutes, walkMinutes } from './engine.js';

// ---------------------------------------------------------------- formatting

export const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const clock = (m) => {
  const h24 = Math.floor(m / 60) % 24;
  const mm = String(Math.floor(m) % 60).padStart(2, '0');
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${mm}${h24 < 12 ? 'am' : 'pm'}`;
};

export const dur = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`);
export const durShort = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}m`);

// Spoken forms. A screen reader gets words where the screen gets glyphs, so
// "7:50p" is read as "7:50 pm" and "2h05" as "2 hours 5 minutes".
export const spokenClock = (m) => {
  const h24 = Math.floor(m / 60) % 24;
  const mm = Math.floor(m) % 60;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(mm).padStart(2, '0')} ${h24 < 12 ? 'am' : 'pm'}`;
};

export const spokenDur = (m) => {
  const h = Math.floor(m / 60);
  const mm = Math.floor(m) % 60;
  const parts = [];
  if (h) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
  if (mm || !h) parts.push(`${mm} minute${mm === 1 ? '' : 's'}`);
  return parts.join(' ');
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDay(iso) {
  const [, m, d] = String(iso).split('-').map(Number);
  return Number.isFinite(m) && MONTHS[m - 1] ? `${MONTHS[m - 1]} ${d}` : String(iso);
}

// Whole days between two ISO days, by calendar date rather than elapsed hours,
// so a build at 23:00 read at 01:00 is one day old and not zero.
export function daysBetween(fromIso, toIso) {
  const a = Date.parse(`${String(fromIso).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(toIso).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

// ---------------------------------------------------------------- the index floor

// A term that comes back with fewer rooms than this did not build, it
// collapsed. Measured on the shipped indexes: 871 rooms for Autumn 1268, 884
// for Spring 1262, 206 for the much smaller Summer 1264. build-index.mjs holds
// one floor of 150 for every term, which a Spring index carrying 200 rooms
// walks straight through, so the app checks per term digit instead.
const ROOM_FLOOR = { 2: 400, 4: 100, 8: 400 };
export const TERM_NAMES = { 2: 'Spring', 4: 'Summer', 8: 'Autumn' };

export function floorFor(term) {
  return ROOM_FLOOR[Number(String(term ?? '').slice(-1))] ?? 150;
}

export function indexFloorCheck(index) {
  const observed = Object.keys(index?.rooms ?? {}).length;
  const expected = floorFor(index?.term);
  return { ok: observed >= expected, observed, expected };
}

// ---------------------------------------------------------------- calendar reads

// The calendar fields land in the room index. Reading current.json as well
// costs one line and means a rollover that moves them does not silently
// disable the refusal, which is the failure this file exists to prevent.
const calendar = (key, current, index) => index?.[key] ?? current?.[key];

// Accepts {start, end} or [start, end]. Anything else means no window.
function windowOf(raw) {
  if (!raw) return null;
  const start = Array.isArray(raw) ? raw[0] : raw.start;
  const end = Array.isArray(raw) ? raw[1] : raw.end;
  return start && end ? { start, end } : null;
}

// Two shapes reach this. The harvest writes a list of {date, state} rows,
// which is what the issue specifies and what the build actually emits; a
// date-keyed object is the shape that is easier to hand-write in a fixture.
// Reading only the second one is how the refusal ends up wired to nothing:
// `list['2026-09-07']` on an array is undefined and the campus-closed message
// never fires, with no error anywhere.
export function closedDayFor(today, current, index) {
  const closed = calendar('closed', current, index);
  if (!closed) return null;
  const hit = Array.isArray(closed) ? closed.find((c) => c?.date === today) : closed[today];
  if (!hit) return null;
  return typeof hit === 'string' ? { state: hit, name: null } : { state: hit.state, name: hit.name ?? null };
}

export function lowConfidenceFor(today, current, index) {
  const ranges = calendar('lowConfidence', current, index) ?? [];
  for (const raw of ranges) {
    const w = windowOf(raw);
    if (w && today >= w.start && today <= w.end) return { ...w, why: raw.why ?? raw.reason ?? null };
  }
  return null;
}

// Every date span the term claims to cover. `instruction` is the harvested
// first and last meeting date, and the sessions are the sub-terms inside it.
function termSpans(current, index) {
  const spans = [];
  const inst = windowOf(current?.instruction);
  if (inst) spans.push(inst);
  for (const s of index?.sessions ?? []) {
    const w = windowOf(s);
    if (w) spans.push(w);
  }
  return spans;
}

export function inTermOn(today, current, index) {
  return termSpans(current, index).some((s) => today >= s.start && today <= s.end);
}

// ---------------------------------------------------------------- staleness

// Four rungs, and the reason they are not decoration: 81% of campus reads free
// on a healthy day, so a Vacant whose weekly build died looks exactly like a
// Vacant that found a lot of rooms. The banner is the only channel that reports
// a dead build to the person who can fix it.
export function staleness({ now, current }) {
  const today = isoDate(now);
  const generated = current?.generated;
  const days = generated ? daysBetween(generated, today) : null;
  const end = windowOf(current?.instruction)?.end;

  if (end && today > end) {
    return { level: 'gated', days, text: 'This schedule covers a term that is over.' };
  }
  if (days == null) return { level: 'silent', days: null, text: '' };
  if (days >= 35) {
    return {
      level: 'banner',
      days,
      text: `Vacant last read the class schedule ${days} days ago. A build this old means the weekly job has stopped running, so treat everything below as a guess.`,
    };
  }
  if (days >= 14) return { level: 'line', days, text: `Schedule read ${days} days ago.` };
  return { level: 'silent', days, text: '' };
}

// ---------------------------------------------------------------- resolveState

const REFUSAL = { ranked: false, note: null };

// The order is the point. Finals week sits outside every session range, so a
// between-terms check running first would send Dec 11 to 17 down the "campus is
// empty, so everything is free" path, which is the exact wrong answer.
export function resolveState({ now, current, index }) {
  const today = isoDate(now);

  const floor = indexFloorCheck(index);
  if (!floor.ok) {
    return {
      ...REFUSAL,
      kind: 'INDEX_REFUSED',
      heading: 'The schedule did not build',
      body: 'Vacant read fewer rooms than a term this size can hold, so the weekly build broke somewhere. Ranking what survived would invent free rooms out of missing data.',
      detail: `rooms ${floor.observed} < ${floor.expected}`,
      action: null,
    };
  }

  const exams = windowOf(calendar('exams', current, index));
  if (exams && today >= exams.start && today <= exams.end) {
    return {
      ...REFUSAL,
      kind: 'EXAM_REFUSAL',
      heading: 'Finals week',
      body: `Ohio State reassigns rooms for exams and does not publish the assignments. Vacant cannot tell you what is free until ${fmtDay(nextDay(exams.end))}.`,
      detail: null,
      action: { label: 'Show nearest buildings anyway', to: 'near' },
    };
  }

  if (!inTermOn(today, current, index)) {
    const inst = windowOf(current?.instruction);
    const next = nextTermStart(current);
    if (inst && today < inst.start) {
      return {
        ...REFUSAL,
        kind: 'BETWEEN_TERMS',
        heading: `${current?.termName ?? 'This term'} has not started yet`,
        body: `Classes run ${fmtDay(inst.start)} to ${fmtDay(inst.end)}. Until then the schedule says nothing about which rooms are empty, so Vacant is not answering.`,
        detail: null,
        action: { label: 'Show nearest buildings anyway', to: 'near' },
      };
    }
    if (next) {
      const gap = daysBetween(today, next.start);
      return {
        ...REFUSAL,
        kind: 'BETWEEN_TERMS',
        heading: 'Campus is between terms',
        body: `The last class of ${current?.termName ?? 'the term'} met on ${fmtDay(inst?.end ?? today)}. ${next.name ?? 'The next term'} begins ${fmtDay(next.start)}, ${gap} days from now. Nothing meets in between, so there is no schedule to read.`,
        detail: null,
        action: { label: 'Show nearest buildings anyway', to: 'near' },
      };
    }
    return {
      ...REFUSAL,
      kind: 'TERM_ENDED',
      heading: `${current?.termName ?? 'The term'} is over`,
      body: 'Ohio State has not published the next term yet. Vacant will not rank rooms against a term that has finished.',
      detail: current?.generated ? `last checked ${current.generated}` : null,
      action: { label: 'Show nearest buildings anyway', to: 'near' },
    };
  }

  const closed = closedDayFor(today, current, index);
  if (closed?.state === 'offices-closed') {
    return {
      ...REFUSAL,
      kind: 'CAMPUS_CLOSED',
      heading: closed.name ? `${closed.name}, campus is closed` : 'Campus is closed today',
      body: 'University offices are closed and most buildings are locked, so a room the schedule shows as empty is still a room you cannot get into.',
      detail: null,
      action: { label: 'Show nearest buildings anyway', to: 'near' },
    };
  }

  // Oct 15 and 16 sit in both tables. One message beats two stacked banners, so
  // a closed day takes the note and the low-confidence window is dropped.
  if (closed?.state === 'no-classes') {
    return {
      kind: 'RANKED',
      ranked: true,
      heading: null,
      body: null,
      note: `${closed.name ? `${closed.name}. ` : ''}No classes are meeting today, so campus is quiet and these rooms are free for that reason rather than a lucky gap.`,
      action: null,
    };
  }

  if (lowConfidenceFor(today, current, index)) {
    return {
      kind: 'RANKED',
      ranked: true,
      heading: null,
      body: null,
      note: 'Session 1 is finishing this week. Its finals run in the seven week rooms without appearing on the schedule, while the full term classes meet as normal, so today the answers below are weaker than usual in both directions.',
      action: null,
    };
  }

  return { kind: 'RANKED', ranked: true, heading: null, body: null, note: null, action: null };
}

function nextDay(iso) {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t)) return iso;
  return new Date(t + 86400000).toISOString().slice(0, 10);
}

// current.next is whatever the harvest knows about the term after this one. The
// research docs write it three different ways, so all three read.
function nextTermStart(current) {
  const n = current?.next;
  if (!n) return null;
  const start = windowOf(n.instruction)?.start ?? n.start ?? n.from ?? null;
  return start ? { start, name: n.termName ?? n.name ?? null } : null;
}

// ---------------------------------------------------------------- unscheduled hours

// A day the schedule really covers, as a share of the week's blocks. Measured
// on the shipped index: the five weekdays carry 14.87% to 22.67% each, Saturday
// carries 0.06% and Sunday 0.02%. Seven blocks in the whole term do not make
// Saturday a scheduled day, and the gap between 0.06 and 14.87 is wide enough
// that nothing sits near this line.
const DAY_SHARE = 0.01;

// The tail of the day is not its edge. Thirty of 12,168 blocks start before
// 8:00 and 35 end after 21:30, mostly single evening sections, and letting one
// 23:00 class hold the whole campus in "scheduled hours" is what turns the
// ranked list into a distance sort at 10pm. Trimming half a percent off each
// end of the shipped index lands on 8:00 and 21:30.
const TAIL = 0.005;

// A day whose sessions have all ended is not a day the schedule covers, and
// the weekday mask above cannot see that: it is week-shaped, so 2026-12-10
// reads as an ordinary Thursday while the sessions running that date hold one
// block out of the 2,661 the weekly Thursday pattern carries.
//
// Measured over the 95 weekdays of the shipped Autumn 1268 index: every day
// where the sessions have all finished or not yet begun sits at 0.11% of its
// weekday's blocks or below (the nine finals-week and between-term weekdays
// come out 0.00% to 0.11%), and the thinnest real teaching day, Mon Aug 24,
// comes out 1.80%. There is nothing in between, so this line has a 16x margin
// under it and a 3.6x margin over it.
const DARK_SHARE = 0.005;

const quantile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

// The bounds the class schedule actually covers. current.json carries them when
// the build emits them, and otherwise they are measured off the index here,
// because four research passes found the last class of the day at 20:15, 21:30,
// 22:15 and 22:30, and a constant picked from any one of those is wrong on the
// other three.
export function busyDayOf(current, index) {
  const given = current?.busyDay;
  if (given && Number.isFinite(given.earliestStart) && Number.isFinite(given.latestEnd)) return given;

  const starts = [];
  const ends = [];
  const perDay = [0, 0, 0, 0, 0, 0, 0];
  let total = 0;
  for (const room of Object.values(index?.rooms ?? {})) {
    for (const b of room.busy ?? []) {
      const d = Number(b[0]);
      const s = Number(b[1]);
      const e = Number(b[2]);
      if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
      if (d >= 0 && d <= 6) perDay[d] += 1;
      starts.push(s);
      ends.push(e);
      total += 1;
    }
  }
  if (!total) return null;
  starts.sort((a, b) => a - b);
  ends.sort((a, b) => a - b);
  return {
    earliestStart: quantile(starts, TAIL),
    latestEnd: quantile(ends, 1 - TAIL),
    weekdays: perDay.map((n) => n / total >= DAY_SHARE),
    measured: true,
  };
}

// How much of this weekday's schedule is actually running on this date, as a
// share of the blocks the weekly pattern carries for that weekday. 1 means a
// full teaching day, 0 means the term's classes have all ended or none has
// started.
export function scheduleShareOn({ now, index }) {
  const active = activeSessions(index?.sessions, isoDate(now));
  const day = now.getDay();
  let total = 0;
  let running = 0;
  for (const room of Object.values(index?.rooms ?? {})) {
    for (const b of room.busy ?? []) {
      if (Number(b[0]) !== day) continue;
      total += 1;
      if (b[3] !== undefined && active[b[3]] === false) continue;
      running += 1;
    }
  }
  return total ? running / total : 0;
}

// True when today is one of those days. One caller decides whether to rank on
// it, another picks which sentence explains why not, and a second copy of the
// number is how those two drift apart.
export function scheduleDarkOn({ now, index }) {
  return scheduleShareOn({ now, index }) < DARK_SHARE;
}

// True when the class schedule constrains this minute at all. Outside it every
// room in the index reads free and the ranked list quietly becomes a distance
// sort wearing the clothes of a schedule answer.
export function inScheduledHours({ now, current, index }) {
  const today = isoDate(now);
  const busyDay = busyDayOf(current, index);
  if (!busyDay) return false;
  if (!inTermOn(today, current, index)) return false;
  // A no-classes day still ranks, with the quiet-campus line saying why. Only a
  // day the university itself is shut takes the schedule off the table, and
  // resolveState has already refused by the time that reaches here.
  if (closedDayFor(today, current, index)?.state === 'offices-closed') return false;
  if (!busyDay.weekdays[now.getDay()]) return false;
  // Finals week is the case this catches without needing a calendar. Ohio State
  // stops publishing rooms once exams start, so every busy list empties out and
  // the ranked list reads 871 rooms free, a 727 seat lecture hall first. An
  // index with no exam window cannot name the reason, but it can see that its
  // own schedule has gone dark, and that is enough to stop it answering.
  if (scheduleDarkOn({ now, index })) return false;
  const minute = now.getHours() * 60 + now.getMinutes();
  return minute >= busyDay.earliestStart && minute < busyDay.latestEnd;
}

// Buildings whose published hours are non-null on all seven days. Read out of
// the hours table rather than typed into the app, so a term rollover that
// closes one of them on Sundays drops it from this list with no code change.
export function allWeekCodes(hoursTerm) {
  return Object.entries(hoursTerm?.buildings ?? {})
    .filter(([, rec]) => Array.isArray(rec.hours) && rec.hours.every((d) => Array.isArray(d)))
    .map(([code]) => code);
}

export function roomsPerBuilding(index) {
  const counts = {};
  for (const room of Object.values(index?.rooms ?? {})) {
    if (!room?.b) continue;
    counts[room.b] = (counts[room.b] ?? 0) + 1;
  }
  return counts;
}

// The nearest buildings that hold classrooms, in three groups that are never
// interleaved. A building with no published hours is not sorted among the open
// ones, because "we do not know" is a weaker claim than "open until 11pm" and
// the order has to carry that difference where a label would be skipped.
export function rankBuildings({ origin, buildings, counts, hoursFor, day, nowMin }) {
  const open = [];
  const unknown = [];
  const closed = [];

  for (const [code, count] of Object.entries(counts ?? {})) {
    const b = buildings?.[code];
    if (!b || !Number.isFinite(b.lat) || !Number.isFinite(b.lon)) continue;
    const metres = distanceMetres(origin, b);
    if (!Number.isFinite(metres)) continue;
    const hours = hoursFor ? hoursFor(code, day) : undefined;
    // Five states, not two. 43 of the 47 buildings in the Registrar pool
    // publish at least one day as closed, so on a weekend "the Registrar says
    // this is shut today" is the majority of the closed group, and rendering it
    // the same as "nobody publishes anything" throws away the one published
    // fact the screen exists to carry.
    const when = !Array.isArray(hours)
      ? hours === null
        ? 'closed-today'
        : 'unknown'
      : nowMin < hours[0]
        ? 'before'
        : nowMin >= hours[1]
          ? 'after'
          : 'open';
    const row = {
      code,
      name: b.name,
      rooms: count,
      metres: Math.round(metres),
      walk: walkMinutes(metres),
      when,
      opensAt: Array.isArray(hours) ? hours[0] : null,
      closesAt: Array.isArray(hours) ? hours[1] : null,
    };
    if (when === 'unknown') unknown.push(row);
    else if (when === 'open') open.push(row);
    else closed.push(row);
  }

  const byWalk = (a, b) => a.walk - b.walk || a.metres - b.metres;
  open.sort(byWalk);
  unknown.sort(byWalk);
  closed.sort(byWalk);
  return { open, unknown, closed };
}

// ---------------------------------------------------------------- the row window

// What a row says about the end of its window, in glyphs and in words. No
// branch here prints a duration for a building nobody publishes hours for. That
// is the path that once printed "9h44", by capping an unknown window at
// midnight and calling the remainder free.
// clock() wraps modulo 24 hours, so a window that ran past midnight would
// print as an innocent morning time rather than as an error. Nothing in the
// engine can produce one today, and this is the check that keeps it that way.
export const DAY_END = 1440;
const inDay = (m) => m == null || (Number.isFinite(m) && m >= 0 && m <= DAY_END);

export function windowPhrase(row, close) {
  if (![row.availableAt, row.usableUntil, row.nextClassAt, close].every(inDay)) {
    return {
      tier: 'unknown',
      text: 'window unknown',
      say: 'Vacant worked out a window that does not fit inside today, so it is not saying when this room frees up',
    };
  }
  if (row.wait > 0) {
    return {
      tier: 'wait',
      text: `from ${clock(row.availableAt)}`,
      say: `free at ${spokenClock(row.availableAt)} then ${spokenDur(row.usable ?? 0)}`,
    };
  }
  if (!row.hoursKnown) {
    return {
      tier: 'unknown',
      text: 'hours not published',
      say: 'opening hours are not published for this building so Vacant cannot say when it locks',
    };
  }
  // 83.4% of rows end because the door locks and 16.6% because a class walks
  // in. Those are different promises, so they get different sentences rather
  // than one sentence with a marker on the end.
  if (close != null && row.nextClassAt < close) {
    return {
      tier: 'strong',
      text: `free till ${clock(row.usableUntil)}`,
      // usableUntil is PACKUP before the class, so "when a class starts" named a
      // cause the data contradicts: nothing starts at 3:20 when the class is at
      // 3:30, and the room screen says 3:30 for the same room. Both numbers and
      // the relation between them, or the two screens disagree out loud.
      say: `free until ${spokenClock(row.usableUntil)}, which is ${spokenDur(PACKUP)} before the next class at ${spokenClock(row.nextClassAt)}`,
    };
  }
  return {
    tier: 'medium',
    text: 'no class rest of today',
    say:
      close == null
        ? 'no class in it for the rest of today'
        : `no class in it for the rest of today, and the building locks at ${spokenClock(close)}`,
  };
}

// ------------------------------------------------------------ the room claim

// The one line at the top that makes a claim, and the only place on the room
// screen that talks about now.
//
// Every duration here goes through the engine's formula, walk included. The
// version that shipped first was `gapEnd - packup - now`, which is the exact
// expression engine.js documents as the bug it exists to fix: it counts the
// walk as study time and overstates by it. Measured on a Thursday at 12:15 it
// was wrong on all 23 rooms in the top 40 that carried a claim, by 5 minutes
// each.
export function roomClaim({ rows, blocks, open, close }, nowMin, bname, metres) {
  const yours = (gapStart, gapEnd) => {
    if (!Number.isFinite(metres)) return null;
    return usableMinutes({ now: nowMin, gapStart, gapEnd, metres });
  };

  if (nowMin < open) {
    const first = rows.find((r) => r.kind === 'free');
    const got = first ? yours(first.t, first.end) : null;
    return {
      head: `${bname} opens at ${clock(open)}`,
      sub: got > 0 ? `Free from ${clock(first.t)} for ${dur(got)}` : '',
    };
  }
  if (nowMin >= close) return { head: `${bname} is closed for the day`, sub: '' };

  const inClass = blocks.find(([s, e]) => nowMin >= s && nowMin < e);
  if (inClass) {
    const next = rows.find((r) => r.kind === 'free' && r.t >= inClass[1]);
    const got = next ? yours(next.t, next.end) : null;
    return {
      head: `In use till ${clock(inClass[1])}`,
      sub: next
        ? got > 0
          ? `Next free ${clock(next.t)}, for ${dur(got)}`
          : `Next free ${clock(next.t)}`
        : 'Nothing free after it today',
    };
  }
  const here = rows.find((r) => r.kind === 'free' && r.now);
  if (!blocks.length) return { head: 'No class in here all day', sub: '' };
  if (here) {
    const later = blocks.find(([s]) => s >= nowMin);
    const got = yours(here.t, here.end ?? close);
    return {
      head: later ? `Free till ${clock(later[0])}` : 'No class in here for the rest of today',
      sub:
        got == null
          ? ''
          : got > 0
            ? `Yours for ${dur(got)} once you get there`
            : 'It closes before you could walk there',
    };
  }
  return { head: 'Nothing free in here right now', sub: '' };
}

// ---------------------------------------------------------------- diagnostics

export const round4 = (n) => (Number.isFinite(n) ? Number(n.toFixed(4)) : n);

const MAX_BLOCK = 4000;

// One labelled line each, so a student can paste the block into an issue and a
// maintainer can tell a stale side table from a wrong gap without holding the
// phone. The busy list is last because it is the only unbounded line, so it is
// the one that loses entries when the cap bites.
export function diagnosticsBlock(d) {
  const line = (k, v) => `${k.padEnd(10)} ${v}`;
  const rows = [
    line('build', `${d.build ?? 'unknown'}${d.controlling ? '  (controlling)' : ''}`),
    line('term', `${d.term ?? '?'}  ${d.termName ?? ''}`.trimEnd()),
    line('index', `generated ${d.generated ?? '?'}${d.ageDays == null ? '' : `  (${d.ageDays} days old)`}`),
    line('state', d.stateKind ?? '?'),
    line('counts', `${d.rooms ?? 0} rooms / ${d.buildings ?? 0} buildings / ${d.sessions ?? 0} sessions`),
  ];

  const acc = Number.isFinite(d.accuracy) ? `+/-${Math.round(d.accuracy)} m` : 'accuracy unpublished';
  const age = Number.isFinite(d.originAgeS) ? `  age ${d.originAgeS} s` : '';
  const where =
    d.includeLocation && Number.isFinite(d.lat) ? `  ${round4(d.lat)}, ${round4(d.lon)}` : '  [location withheld]';
  rows.push(line('origin', `${d.originSource ?? '?'}  ${acc}${age}${where}`));
  rows.push(line('hours', `${d.hoursSource ?? 'none'}  read ${d.hoursGenerated ?? '?'}`));
  rows.push(line('clock', `${d.clock ?? '?'}  ${d.zone ?? '?'}`));

  if (d.room) {
    const r = d.room;
    rows.push(line('room', `${r.id}  type ${r.type ?? '?'}  cap ${r.cap ?? '?'}  bldg ${r.building ?? '?'}`));
    if (Number.isFinite(r.metres)) rows.push(line('walk', `${r.metres} m -> ${r.walk} min   (WALK_MPM 78, DETOUR 1.30)`));
    if (Number.isFinite(r.gapStart)) {
      const usable = r.usable == null ? 'unknown' : dur(r.usable);
      // The last minute you could have set off and still got the usable figure
      // on this line. Any later and the arrival, not the gap, sets the start,
      // so usable shrinks minute for minute. Once the gap has already opened
      // that is simply the minute the row was tapped.
      const leaveBy =
        Number.isFinite(r.nowMin) && Number.isFinite(r.walk)
          ? `, leaveBy ${clock(Math.max(r.nowMin, r.gapStart - r.walk))}`
          : '';
      rows.push(line('gap', `${clock(r.gapStart)}-${clock(r.gapEnd)} sess ${r.session ?? '?'}  ->  usable ${usable}${leaveBy}`));
    }
  }
  if (d.caches?.length) rows.push(line('caches', d.caches.join(', ')));

  const head = rows.join('\n');
  const all = d.busy ?? [];
  if (!all.length) return head.slice(0, MAX_BLOCK);

  const label = `busy ${d.dayName ?? ''}`.padEnd(10);
  const fmt = (list, dropped) =>
    `${label} ${list.map(([s, e]) => `${clock(s)}-${clock(e)}`).join(' | ')}${dropped ? ` ... ${dropped} more` : ''}`;

  let keep = all.length;
  let out = `${head}\n${fmt(all, 0)}`;
  // A room can carry 57 weekly intervals, and an issue URL that long stops
  // being a link, so the busy list is trimmed from the end until it fits.
  while (out.length > MAX_BLOCK && keep > 1) {
    keep -= 1;
    out = `${head}\n${fmt(all.slice(0, keep), all.length - keep)}`;
  }
  return out.length > MAX_BLOCK ? out.slice(0, MAX_BLOCK) : out;
}
