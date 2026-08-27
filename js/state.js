// What the app is allowed to say today, decided before a single room is ranked.
//
// Everything here is pure and takes its clock as an argument. That is not a
// style preference. The exam-week refusal is the one behaviour nobody can check
// by opening the app, because the only way to reach exam week is to wait until
// December, so it has to be reachable from a test with a fake date.
//
// Runs in the browser and under node, and imports nothing that touches the DOM.

import { distanceMetres, walkMinutes } from './engine.js';

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

export function closedDayFor(today, current, index) {
  const closed = calendar('closed', current, index);
  const hit = closed?.[today];
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
      text: `Vacant last read the class schedule ${days} days ago. A build this old usually means the weekly job is broken, so treat everything below as a guess.`,
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
    const row = {
      code,
      name: b.name,
      rooms: count,
      metres: Math.round(metres),
      walk: walkMinutes(metres),
      opensAt: Array.isArray(hours) ? hours[0] : null,
      closesAt: Array.isArray(hours) ? hours[1] : null,
    };
    if (hours === null) closed.push(row);
    else if (!Array.isArray(hours)) unknown.push(row);
    else if (nowMin >= hours[0] && nowMin < hours[1]) open.push(row);
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
export function windowPhrase(row, close) {
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
      say: `free until ${spokenClock(row.usableUntil)} when a class starts`,
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
      rows.push(line('gap', `${clock(r.gapStart)}-${clock(r.gapEnd)} sess ${r.session ?? '?'}  ->  usable ${usable}`));
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
