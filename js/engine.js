// How long a room is yours AFTER you finish walking to it.
//
// This is the whole differentiator, and it is not the number the README first
// reached for. Runs in the browser and under node, no imports.
//
// Two rules hold everywhere in this file. Every rounding breaks pessimistic, so
// the app never promises more time than the student gets. And "we do not know"
// is a third answer that never collapses into "free" or "closed".
//
// There is no `Date` in here on purpose. Times are wall-clock minutes since
// local midnight and dates are `YYYY-MM-DD` strings, so the engine cannot be
// wrong about a timezone it never sees. On the two Sundays a year Ohio moves
// its clocks a wall-clock minute and a real minute stop agreeing, which is what
// the `dst` option in `usableMinutes` is for.

// ------------------------------------------------------------------ config
// Every constant here is either measured or a guess, and says which.

// Metres per minute at an ordinary walking pace. GUESS. Average adult pace is
// about 1.34 m/s, which is 80.4 m/min, and this rounds it down because the
// student to design for is carrying a backpack up the Oval in February.
export const WALK_MPM = 78;

// Straight-line distance times this is roughly the real path. FUDGE FACTOR, not
// measured on OSU sidewalks. It sits near the 4/pi = 1.273 detour of a perfect
// grid, inside the 1.15 to 1.45 pedestrian circuity range.
export const DETOUR = 1.3;

// Minutes reserved at the end so you are not packing up while the next class
// files in. POLICY, and it is doing real work: OSU's passing period is 15
// minutes and 69.3% of all 2711 measured inter-class gaps are exactly that, so
// a 15 minute gap yields 5 usable minutes and the corridor shuffle drops out of
// every answer by arithmetic. Not a merge tolerance, which would also swallow
// the 1.3% of genuine 10 to 14 minute gaps and would report the second class's
// start as the moment the room frees, which is a lie.
export const PACKUP = 10;

// Default radius in minutes of walking. MEASURED: on a synthetic campus at 3x
// the real interval density the fallback ladder never fired once at 12 minutes,
// and only starts firing below 6.
export const MAX_WALK = 12;

// Do not offer a gap that opens further out than this. GUESS, and a product
// decision rather than a measurement: four hours from now is not an answer to
// "where can I sit". The "opens at" rung deliberately ignores it, because
// naming when the first building unlocks is that rung's whole job.
export const LOOKAHEAD = 240;

// How much a longer window is worth against a longer walk. UNMEASURED
// JUDGEMENT CALLS, both of them, and open questions in docs/DECISIONS.md. An
// hour of headroom buys six minutes of walking, and surplus past an hour buys
// nothing, because the student already said how long they needed.
export const SURPLUS_WEIGHT = 0.1;
export const SURPLUS_CAP = 60;

// The window the schedule can speak about. MEASURED on the committed index
// (data/rooms-1268.json, 12,168 intervals over 871 rooms): the earliest class
// starts at 05:30 and the latest ends at 23:00. The research note's 22:00 came
// from a 12-subject sample and clips 18 real intervals.
//
// DAY_START is a clamp, not a measurement. Without it a room with no morning
// class reports "free since 00:00", which is true and useless. It only ever
// shrinks what we offer.
//
// Neither of these is a claim that a door is unlocked. They bound the schedule,
// and a building with no published hours still reports no usable figure at all.
export const DAY_START = 420; // 07:00
export const DAY_END = 1380; // 23:00, the latest class end in the full harvest

// The rungs the requested duration falls back through. GUESS, and it mirrors
// the duration chips the UI offers.
export const RELAX_LADDER = [120, 90, 60, 45, 30, 20];

// A relaxed answer is still an answer, so it has to be worth the walk. GUESS.
export const MIN_RELAXED_USABLE = 20;

// A rung has answered once it has this many rooms. GUESS.
export const LADDER_QUORUM = 3;

// Room types worth offering by default, from docs/research/facility-types.md.
// MEASURED on the committed index: 520 of 871 rooms (59.7%) carry one of these.
// The rest are wet labs, studios, gyms and kitchens, which are not rooms you
// can sit down in with a laptop.
export const PREFERRED_TYPES = ['1B', '1C', '1A', 'LCTR', 'SMNR'];

// Rooms the note puts behind a toggle: computer labs and departmental seminar
// rooms, real rooms with chairs and tables but access controlled or socially
// awkward, and 5K holds at least one working dental clinic. MEASURED on the
// committed index: 101 of 871 rooms (11.6%) carry one of these. The ladder may
// offer them once the preferred ones run out, and it says so when it does.
export const SECONDARY_TYPES = ['2P', '2Q', '5K', '6L', '2J', '5C'];

// Within the preferred set, ordered by how likely the room is to be an ordinary
// classroom rather than something held for an event. 1B is the confident
// general classroom, 1C the lecture hall, 1A the seminar room.
const TYPE_ORDER = { '1B': 0, LCTR: 1, '1C': 1, SMNR: 2, '1A': 2 };
const PREFERRED = new Set(PREFERRED_TYPES);

// Everything the ladder is allowed to reach, in any rung. The 250 rooms of the
// committed index that are in neither list are wet labs, dissection labs, gyms,
// studios, kitchens and the online pseudo-room, and an unrecognised code lands
// here too: the type space is not closed, and the cost of guessing wrong is
// sending someone into a cadaver lab. A caller that wants them has to say so.
const OFFERABLE = new Set([...PREFERRED_TYPES, ...SECONDARY_TYPES]);

const R = 6371008.8;
const rad = (deg) => (deg * Math.PI) / 180;

// ---------------------------------------------------------------- distance

// Equirectangular, not haversine. This runs over every building on every query
// and at campus scale the error is under a metre, checked against a haversine
// reference over every building in data/buildings.json in the tests.
export function distanceMetres(a, b) {
  const x = rad(b.lon - a.lon) * Math.cos(rad((a.lat + b.lat) / 2));
  const y = rad(b.lat - a.lat);
  return Math.sqrt(x * x + y * y) * R;
}

export const walkMinutes = (metres) => Math.ceil((metres * DETOUR) / WALK_MPM);

// ----------------------------------------------------------------- the maths

// Wall-clock minutes lost inside a window, on the one Sunday a year Ohio skips
// an hour. Gains in November are ignored on purpose: handing back an extra hour
// would be the only optimistic rounding in the engine.
function dstLoss(dst, from, to) {
  if (!dst || !(dst.lost > 0)) return 0;
  return from < dst.at && dst.at < to ? dst.lost : 0;
}

// THE formula.
//
//   usable = (gapEnd - PACKUP) - max(arrival, gapStart)
//
// NOT `gapEnd - now - walkTime`, which the README used. That version counts the
// time you spend standing in the corridor waiting for the previous class to end
// as time you get to study, and overstates by exactly the wait. For a gap of
// 14:00 to 16:00 with now 13:50 and a 6 minute walk it says 124 minutes. You
// arrive at 13:56, the room frees at 14:00, and you get 120.
//
// It is wrong in the other direction too. Subtracting the walk from a window
// you have not reached yet understates it: a room that frees in 5 minutes and
// is a 6 minute walk away is simply free when you get there, and the walk cost
// nothing because you spent it waiting anyway.
//
// `dst` is `{ at, lost }`, the wall-clock minute the clocks jump forward and by
// how much. A window spanning it holds fewer real minutes than the clock says,
// and this is the one place wall-clock arithmetic overstates.
export function usableMinutes({ now, gapStart, gapEnd, metres, packup = PACKUP, dst }) {
  const usableStart = Math.max(now + walkMinutes(metres), gapStart);
  const usableEnd = gapEnd - packup;
  return usableEnd - usableStart - dstLoss(dst, usableStart, usableEnd);
}

// When to get up. If the gap has not started there is no rush, so the card can
// say "free at 2:00, leave by 1:54" instead of implying you should sprint.
export function leaveBy({ now, gapStart, metres }) {
  return Math.max(now, gapStart - walkMinutes(metres));
}

// ---------------------------------------------------------------- sessions

// Which sessions are running on a given date. `sessions` is the array from
// rooms-<term>.json, each entry [startDate, endDate] as ISO days.
//
// A term is not one continuous block. The committed Autumn 2026 index carries
// 10 sessions, and the seven-week ones do not overlap: the second half starts
// 2026-10-19. Measured on the shipped index, 287 busy tuples on a November date
// belong to a session that has already ENDED, and 3 rooms have their entire
// busy list drawn from a session that is not running. Without this mask those
// rooms read fully booked while they are free all day.
//
// String comparison, not dates. `YYYY-MM-DD` sorts correctly as text, and a
// `Date` here would drag a timezone into a question that has none.
export function activeSessions(sessions, isoDate) {
  return (sessions ?? []).map(([start, end]) => isoDate >= start && isoDate <= end);
}

// The same answer as a Uint8Array, built once per day and reused by every query
// that day. Both shapes are accepted everywhere a mask is taken, because
// `0 === false` is false and an engine that tested for `false` would silently
// ignore a typed mask and report a room booked all day.
export function activeMask(sessions, isoDate) {
  const list = sessions ?? [];
  const mask = new Uint8Array(list.length);
  for (let i = 0; i < list.length; i++) {
    mask[i] = list[i][0] <= isoDate && isoDate <= list[i][1] ? 1 : 0;
  }
  return mask;
}

// ------------------------------------------------------------------- gaps

function withMalformed(gaps, count) {
  // Non-enumerable so the gaps still compare as a plain array, while a caller
  // that wants to assert on data quality can still read the count.
  Object.defineProperty(gaps, 'malformed', { value: count, enumerable: false });
  return gaps;
}

// Busy blocks for one room on one weekday, as
// [dayIndex, startMinute, endMinute, sessionIndex].
//
// Returns the free gaps between them inside [open, close], plus a count of
// blocks that arrived malformed. `active` is the mask from activeSessions or
// activeMask; when omitted every session counts, which is only correct if the
// index has one.
//
// One sweep. Duplicates, containment, partial overlap and back-to-back chaining
// all fall out of the merge, and none of them needs a branch of its own.
export function freeGaps(busy, day, open, close, active) {
  // `day` reaches this from a <select> value or a query string, where it is a
  // string. A strict === against a number then matches nothing, every block is
  // filtered out, and the room reports the whole day free with no error.
  const d = Number(day);
  let malformed = 0;

  // A window that does not run forwards is not a window. Published hours are
  // clean today, 486 day cells and none inverted, but an overnight building
  // would arrive as close <= open and the complement of nothing is a free day.
  if (!(Number.isFinite(open) && Number.isFinite(close) && close > open)) {
    return withMalformed([], 0);
  }

  const blocks = [];
  for (const b of busy) {
    if (Number(b[0]) !== d) continue;
    // A block from a session that is not running today is not a booking today.
    // A session index the mask does not cover stays busy: not knowing which
    // half of the term a class belongs to is not a licence to call the room
    // free.
    if (active && b[3] !== undefined) {
      const live = active[b[3]];
      if (live !== undefined && !live) continue;
    }
    let [, start, end] = b;
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      malformed++;
      continue;
    }
    // An end at or before the start is either a midnight crossing or corrupt
    // data. Dropping it reports an occupied room as free, which is the worst
    // failure this app has, so it is read conservatively as running to the end
    // of the day instead. The hours after midnight that a crossing block also
    // occupies belong to tomorrow, and this index has no way to say that.
    if (end <= start) {
      malformed++;
      end = 1440;
    }
    const clipped = [Math.max(start, open), Math.min(end, close)];
    if (clipped[1] > clipped[0]) blocks.push(clipped);
  }
  blocks.sort((a, b) => a[0] - b[0]);

  // Merge overlapping and touching blocks, so an 8:00-9:00 followed by a
  // 9:00-10:00 is one block and not two with an empty gap between them.
  const merged = [];
  for (const block of blocks) {
    const last = merged[merged.length - 1];
    if (last && block[0] <= last[1]) last[1] = Math.max(last[1], block[1]);
    else merged.push([...block]);
  }

  const gaps = [];
  let cursor = open;
  for (const [start, end] of merged) {
    if (start > cursor) gaps.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < close) gaps.push([cursor, close]);

  return withMalformed(gaps, malformed);
}

// Pick one gap out of a room's day, from the list the single sweep produced.
//
// A gap that has not started when you arrive is NOT equivalent to one that has.
// Picking purely by length sends someone on a seven minute walk to a room with
// a class in it for the next four hours, because that room's afternoon gap is
// longer than the gap the room next door has free right now. So a gap you can
// walk into wins over a longer one you would have to wait for, and the wait is
// reported either way.
//
// `mode` is 'fit' for the answer and 'soon' for the "opens at" rung, which
// skips the gap you could walk into so it can offer the later one that is
// actually long enough. Both come out of the same gap list, so the ladder never
// touches the busy intervals twice.
function pickGap(gaps, opts) {
  const { now, arrival, need = 0, packup = PACKUP, dst, mode = 'fit', lookahead = Infinity } = opts;
  const floor = Math.max(need, 1);
  const horizon = now + lookahead;
  let open = null; // the gap you are inside on arrival, and there is at most one
  let fitting = null; // the earliest later gap that is long enough
  let longest = null; // the best later gap when none of them is long enough

  for (const [gapStart, gapEnd] of gaps) {
    if (gapEnd <= now) continue; // entirely in the past
    const usableStart = Math.max(arrival, gapStart);
    const usableEnd = gapEnd - packup;
    const usable = usableEnd - usableStart - dstLoss(dst, usableStart, usableEnd);
    if (!(usable > 0)) continue; // NaN fails this too, which `<= 0` does not

    if (gapStart <= arrival) {
      if (mode !== 'soon') open = [gapStart, gapEnd, usable];
      continue;
    }
    if (gapStart > horizon) break; // gaps are ordered, so nothing later qualifies
    if (usable >= floor) {
      if (!fitting) fitting = [gapStart, gapEnd, usable];
    } else if (!longest || usable > longest[2]) {
      longest = [gapStart, gapEnd, usable];
    }
  }

  const chosen = mode === 'soon' ? fitting : open ?? fitting ?? longest;
  if (!chosen) return null;
  const [gapStart, gapEnd, usable] = chosen;
  return {
    gapStart,
    gapEnd,
    usable,
    wait: Math.max(0, gapStart - arrival),
    meetsNeed: usable >= need,
  };
}

// The gap you would actually get in this room. Returns null when the room gives
// you nothing. The single-room entry point; `query` reuses the same sweep
// across the whole campus without going through it.
export function bestGap(room, opts) {
  const { now, day, open, close, metres, needed = 0, packup = PACKUP, active, dst, mode, lookahead } = opts;
  const arrival = now + walkMinutes(metres);
  const gaps = freeGaps(room.busy ?? [], day, open, close, active);
  const picked = pickGap(gaps, { now, arrival, need: needed, packup, dst, mode, lookahead });
  if (!picked) return null;
  return { ...picked, malformed: gaps.malformed };
}

// ------------------------------------------------------------------ ranking

// Which tier a row sits in. Lower is better, and the order encodes two
// decisions the project already made rather than a preference:
//
//   published hours beat unknown hours, always. 565 of 612 buildings have no
//   published hours, so this is the majority path and the ranking has to carry
//   the honesty rather than leaving it to a label the eye skips.
//
//   a room open when you arrive beats one you would wait for, even a longer one.
export function tierOf(row) {
  if (row.hoursKnown) {
    if (row.wait === 0) return row.meetsNeed ? 0 : 1;
    return 2;
  }
  return row.wait === 0 ? 3 : 4;
}

// Classroom before lecture hall before seminar room before everything else.
export function typeRank(type) {
  const t = TYPE_ORDER[type];
  return t === undefined ? 3 : t;
}

// Distance and window in the same unit, so a big surplus can buy a short
// detour. Lower is better. Pure distance ranks a 3 minute walk giving exactly
// the time asked above a 4 minute walk giving twice as much, which is the wrong
// answer, and an hour of headroom is worth six minutes of walking and no more.
//
// The penalty side is uncapped deliberately: among rooms that fall short of the
// need, this orders by how badly they miss.
export function scoreOf(row, need = 0) {
  if (row.usable == null) return row.walk; // unknown hours emit no window to trade
  return row.walk - SURPLUS_WEIGHT * Math.min(row.usable - need, SURPLUS_CAP);
}

// The total order. It ends on the room id so the list cannot reshuffle between
// two identical queries: Finder's own API notes record that non-deterministic
// ordering cost it 6% of results per pull, and a stable final key costs nothing.
// A plain string compare, not localeCompare, because the collation of a room id
// should not depend on the phone's language.
function compareRows(a, b) {
  return (
    a.tier - b.tier ||
    a.score - b.score ||
    (b.usable ?? 0) - (a.usable ?? 0) ||
    typeRank(a.type) - typeRank(b.type) ||
    (b.seats ?? 0) - (a.seats ?? 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

// -------------------------------------------------------------------- marks
//
// The app fetches an index, parses it and answers once. Those three are the
// whole cold launch, so they are the three things worth a mark. The engine can
// only mark the two it owns; `mark` and `measure` are exported so the loader
// can wrap the fetch and the parse with the same names.

// `performance` is missing in a few embedded runtimes and the engine is not
// worth crashing over a timer.
const perf = typeof performance !== 'undefined' && performance.mark ? performance : null;

export function mark(name) {
  if (perf) perf.mark(name);
}

export function measure(name, start, end) {
  if (!perf || !perf.measure) return null;
  try {
    return perf.measure(name, start, end).duration;
  } catch {
    return null; // a missing start mark is not worth an exception
  }
}

const nowMs = () => (perf && perf.now ? perf.now() : 0);

// ------------------------------------------------------------------ the sweep

// One pass over the room table. Every room that survives geography and the
// hours fact gets its busy list swept exactly once, and the gap list is kept so
// the fallback ladder can ask the same room a different question without
// touching the intervals again.
//
// `hoursFor(buildingCode, day)` returns:
//   an [open, close] pair   the building publishes hours for that day
//   null                    the building publishes that day as CLOSED
//   undefined               the building publishes no hours at all
//
// Those three are NOT interchangeable. `null` is a fact and removes the room.
// `undefined` is an absence, and the room is shown, tiered below every
// published-hours room, and never given an assumed window.
function sweep(rooms, opts) {
  const {
    origin, now, day, buildings, hoursFor, active,
    dayStart = DAY_START, dayEnd = DAY_END, classesSuspended = false,
  } = opts;
  const walkCache = new Map();
  const out = [];
  const dropped = { noBuilding: 0, noCoordinate: 0, badOrigin: 0, closed: 0, noWindow: 0 };

  for (const room of rooms) {
    const building = buildings[room.b];
    if (!building) {
      dropped.noBuilding++;
      continue;
    }
    // A building row with no usable coordinate is the same as no building. The
    // old guard checked only that the row existed, so a null lat produced a NaN
    // distance, and `NaN <= 0` is false, so the room shipped with NaN minutes
    // and an arbitrary sort position.
    if (!Number.isFinite(building.lat) || !Number.isFinite(building.lon)) {
      dropped.noCoordinate++;
      continue;
    }

    // 871 rooms sit in 96 buildings, so the distance is the same answer nine
    // times out of ten.
    let cached = walkCache.get(room.b);
    if (cached === undefined) {
      const metres = distanceMetres(origin, building);
      // A geolocation fix that never resolved reaches here as NaN. Without this
      // every room comes back with NaN minutes in arbitrary order.
      cached = Number.isFinite(metres) ? { metres, walk: walkMinutes(metres) } : null;
      walkCache.set(room.b, cached);
    }
    if (!cached) {
      dropped.badOrigin++;
      continue;
    }

    const hours = hoursFor ? hoursFor(room.b, day) : undefined;
    if (hours === null) {
      dropped.closed++;
      continue;
    }
    // A pair that is not two finite minutes is not published hours. Reading it
    // as a window would invent a door time out of a parse failure.
    const hoursKnown =
      Array.isArray(hours) && Number.isFinite(hours[0]) && Number.isFinite(hours[1]);

    // For an unknown-hours building the window is the schedule's own bounds,
    // and ONLY so the class schedule can be swept. No usable figure is emitted
    // from it, because "free for 20 hours" at 3am in a building nobody knows is
    // open is an assumed window wearing a different hat.
    //
    // The start is clamped to DAY_START or to now, whichever is earlier. The
    // clamp is there so a room with no morning class does not report "free
    // since 00:00", which is true and useless. Clamping it past now instead
    // would put the room in a WAIT and make the row read "from 7:00 AM", and
    // 7:00 AM is a bound on the class schedule, not an hour anybody published
    // for that door.
    const [open, close] = hoursKnown ? hours : [Math.min(dayStart, now), dayEnd];

    // On a day the registrar publishes as having no classes, the busy grid is
    // not a description of the room. 788 of 863 sampled Wednesday rows are
    // still active on Veterans Day, so trusting it hides 91% of campus.
    const gaps = classesSuspended
      ? withMalformed([[open, close]], 0)
      : freeGaps(room.busy ?? [], day, open, close, active);
    if (!gaps.length) {
      dropped.noWindow++;
      continue;
    }

    out.push({
      room,
      building,
      metres: cached.metres,
      walk: cached.walk,
      arrival: now + cached.walk,
      hoursKnown,
      gaps,
    });
  }
  return { candidates: out, dropped };
}

// Turn one swept candidate into a result row for a given need and mode.
function rowFrom(c, { now, need, packup, dst, mode, lookahead }) {
  const gap = pickGap(c.gaps, { now, arrival: c.arrival, need, packup, dst, mode, lookahead });
  if (!gap) return null;
  const row = {
    id: c.room.id,
    building: c.room.b,
    name: c.building.name,
    type: c.room.type ?? null,
    // cap 0 is the index's sentinel for UNKNOWN, not a room with no seats, and
    // 44 of 871 rooms carry it. `?? null` passes 0 straight through, so those
    // rooms would render a confident "0 seats".
    seats: c.room.cap === 0 || c.room.cap == null ? null : c.room.cap,
    metres: Math.round(c.metres),
    walk: c.walk,
    // Minutes you actually get, once you have walked there and left the packup
    // buffer. Null when the building publishes no hours, because we cannot know
    // when it locks.
    usable: c.hoursKnown ? gap.usable : null,
    // The end of the free window you could use, packup already removed. Not the
    // raw gap end, which disagrees with `usable` by exactly PACKUP and makes a
    // countdown hand back the buffer.
    usableUntil: c.hoursKnown ? gap.gapEnd - packup : null,
    // When the next class starts, or the building closes. Raw, for display.
    nextClassAt: gap.gapEnd,
    // When the room actually opens up, and how long you would wait after
    // arriving. Without these a caller cannot tell "available now" from
    // "available from 1:00 PM".
    availableAt: gap.gapStart,
    wait: gap.wait,
    // When to get up, which is now if the room is already free.
    leaveBy: leaveBy({ now, gapStart: gap.gapStart, metres: c.metres }),
    meetsNeed: c.hoursKnown ? gap.meetsNeed : null,
    hoursKnown: c.hoursKnown,
    malformedBlocks: c.gaps.malformed,
  };
  row.tier = tierOf(row);
  row.score = scoreOf(row, need);
  return row;
}

// Rank rooms for one query. The shape every caller has used since the walking
// skeleton: an array of rows, best first, no ladder and no radius.
//
// `lookahead` defaults to the whole day here rather than LOOKAHEAD, because the
// result screen uses the far-out rows to name the first building that opens,
// and a horizon would hand it back an empty answer at 6am.
export function rank(rooms, opts) {
  const {
    now, needed = 0, packup = PACKUP, dst, sessions, date, active: given,
    lookahead = Infinity,
  } = opts;
  mark('vacant:answer:start');
  // The index's sessions array and today's ISO date. Without both, every block
  // counts regardless of whether its session is running.
  mark('vacant:index:start');
  const active = given ?? (sessions && date ? activeMask(sessions, date) : undefined);
  mark('vacant:index:end');
  measure('vacant:index', 'vacant:index:start', 'vacant:index:end');

  const { candidates } = sweep(rooms, { ...opts, active });
  const out = [];
  for (const c of candidates) {
    const row = rowFrom(c, { now, need: needed, packup, dst, lookahead });
    if (row) out.push(row);
  }
  out.sort(compareRows);
  mark('vacant:answer:end');
  measure('vacant:answer', 'vacant:answer:start', 'vacant:answer:end');
  return out;
}

// -------------------------------------------------------- what today can be

// How much of the index is talking about a given date.
//
// A busy block carries a session index, and a session carries the dates it
// runs. So the share of blocks whose session is live is a fact about whether
// the schedule still describes today, and it costs one pass.
//
// Returns share null when there is nothing to measure: an index with no busy
// blocks, or a caller that passed no mask. Null is not zero. An engine that
// read "I cannot tell" as "nothing is running" would refuse to answer a small
// index that is perfectly healthy.
export function scheduleCoverage(rooms, active) {
  let total = 0;
  let live = 0;
  for (const room of rooms ?? []) {
    for (const b of room.busy ?? []) {
      total++;
      if (!active || b[3] === undefined || active[b[3]] === undefined || active[b[3]]) live++;
    }
  }
  return { total, live, share: total && active ? live / total : null };
}

// Below this share of the index live, the schedule has stopped describing the
// date and an empty room is not evidence of anything.
//
// MEASURED on the committed Autumn index, 12,168 blocks over 10 sessions, every
// date from August 1 to December 31: on all 77 days classes meet the live share
// sits between 94.98% and 97.64%, and on every other day it is at or below
// 1.50%. Two clusters three orders of magnitude apart with nothing in between,
// so this sits an order of magnitude clear of each. December 10, the first day
// of the wrong week, measures 0.066%.
export const SILENT_SHARE = 0.1;

// Everything that has to be settled before a single room is swept.
//
// Three of these come from a calendar the class API does not publish and one
// comes from the index itself. They are separate because they fail in different
// directions: an exam window makes an occupied room look free, a closed campus
// makes a reachable room look reachable, and a date the schedule has stopped
// covering makes all of campus look free at once.
//
// Returns null when today can be answered normally.
export function refusalFor({ now, rooms = [], sessions, date, active: given, calendar }) {
  // Wall-clock minutes since local midnight, and nothing else. A value outside
  // that range is an epoch subtraction, which is a whole hour wrong for the rest
  // of the day on the two Sundays a year Ohio changes its clocks. Computing an
  // answer from it would be confidently wrong rather than usefully wrong.
  if (!Number.isFinite(now) || now < 0 || now > 1440) {
    return {
      refused: 'clock',
      reason: 'Vacant could not read the time on this device, so it cannot say what is free.',
    };
  }

  // During the exam window the API's busy grid is empty for every room while
  // 200 people sit a final in it, and OSU publishes the exam room assignments
  // nowhere the app can read, so there is nothing to compute from. Refusing is
  // the only honest answer.
  if (calendar?.exams) {
    return {
      refused: 'exams',
      reason: calendar.reason
        ?? 'Finals week. Ohio State reassigns rooms for exams and does not publish the assignments, so Vacant cannot tell you what is free.',
    };
  }
  if (calendar?.buildingsClosed) {
    return {
      refused: 'closed',
      reason: calendar.reason ?? 'The university is closed today, so the buildings are locked.',
    };
  }

  // A day the registrar publishes as having no classes is a day the grid is
  // wrong the other way, marking rooms busy that nobody is in, and that one is
  // an answer rather than a refusal.
  if (calendar?.noClasses) return null;

  const active = given ?? (sessions && date ? activeMask(sessions, date) : undefined);
  const coverage = scheduleCoverage(rooms, active);
  if (coverage.share !== null && coverage.share < SILENT_SHARE) {
    return {
      refused: 'no-schedule',
      reason: 'The class schedule has nothing for today, in any room on campus. That is what a break or finals week looks like from here, not an empty campus, so Vacant is not answering.',
      coverage,
    };
  }
  return null;
}

// ------------------------------------------------------------------- ladder

// The whole answer for one query, including the fallback ladder.
//
// Never returns a blank screen without saying why. Every relaxed answer carries
// `relaxed: true` and names the rung that produced it, because an answer to a
// question the student did not ask has to admit that.
export function query(rooms, opts) {
  mark('vacant:query:start');
  mark('vacant:answer:start');
  const started = nowMs();
  const {
    now, needed = 0, packup = PACKUP, dst, sessions, date, active: given,
    maxWalk = MAX_WALK, limit = 40, calendar,
    dayStart = DAY_START, dayEnd = DAY_END,
  } = opts;

  const base = {
    dayStart,
    dayEnd,
    need: needed,
    askedNeed: needed,
    maxWalk,
    relaxed: false,
    rung: null,
    rows: [],
    total: 0,
    counts: { rooms: rooms.length, considered: 0, dropped: null },
    known: 0,
    unknown: 0,
    refused: null,
    reason: null,
    ms: 0,
  };

  mark('vacant:index:start');
  const active = given ?? (sessions && date ? activeMask(sessions, date) : undefined);
  mark('vacant:index:end');
  measure('vacant:index', 'vacant:index:start', 'vacant:index:end');

  // The clock, the calendar and the index's own coverage of today, all settled
  // before a room is swept. Same function the app calls, so a refusal reads the
  // same whether it came from the ladder or from the screen above it.
  const refusal = refusalFor({ now, rooms, active, calendar });
  if (refusal) {
    return finish({ ...base, refused: refusal.refused, reason: refusal.reason }, started);
  }

  const { candidates, dropped } = sweep(rooms, {
    ...opts, active, dayStart, dayEnd, classesSuspended: !!calendar?.noClasses,
  });
  base.counts = { rooms: rooms.length, considered: candidates.length, dropped };

  // Not knowing where the student is standing is a different failure from there
  // being nothing free, and it has a different fix. Collapsing the two would
  // send someone home when the geolocation fix simply never resolved.
  if (rooms.length && dropped.badOrigin === rooms.length) {
    return finish({
      ...base,
      refused: 'location',
      reason: 'Vacant does not know where you are, so it cannot say what is nearby.',
    }, started);
  }

  // `types` defaults to everything the ladder may reach rather than to no
  // filter at all. A rung that drops the preference has to land on the wider
  // list of rooms you can sit in, not on the whole facility inventory.
  const rung = (need, { mode, types = OFFERABLE, radius, lookahead = LOOKAHEAD, floor = 0, openNow } = {}) => {
    const out = [];
    for (const c of candidates) {
      if (radius !== undefined && c.walk > radius) continue;
      if (types && !types.has(c.room.type)) continue;
      const row = rowFrom(c, { now, need, packup, dst, mode, lookahead });
      if (!row) continue;
      // Free when you get there is the question the app was opened to answer.
      // A room you would wait for is a different answer and gets its own rung.
      if (openNow && row.wait > 0) continue;
      // A room we cannot promise a window for is never a near miss, so the
      // floor cannot be applied to it. It carries its honesty in `hoursKnown`.
      if (row.usable != null && row.usable < floor) continue;
      if (need > 0 && row.hoursKnown && !row.meetsNeed) continue;
      out.push(row);
    }
    out.sort(compareRows);
    return out;
  };

  // Rungs in the order the research note settled on: drop the room-type filter
  // before shortening the time, shorten the time before offering a room that is
  // not free yet, and only then walk further. The first four all mean "free when
  // you get there", which is the question the app was opened to answer.
  const shorter = RELAX_LADDER.filter((n) => n < needed);
  const rungs = [
    ['asked', needed, false, () => rung(needed, { types: PREFERRED, radius: maxWalk, openNow: true })],
    // Dropping the room-type preference is a relaxation like any other. The
    // rows it adds are computer labs, departmental seminar rooms and, in one
    // building, a dental clinic, so an answer built from them is not the
    // question the student asked and has to admit it.
    ['any-type', needed, true, () => rung(needed, { radius: maxWalk, openNow: true })],
    ...shorter.map((n) => [
      `shorter:${n}`,
      n,
      true,
      () => rung(n, { radius: maxWalk, openNow: true, floor: MIN_RELAXED_USABLE }),
    ]),
    // The README's "the room that frees up in twelve minutes". No horizon on
    // this one: naming when something opens is the whole point of the rung.
    ['opens-at', needed, true, () => rung(needed, {
      mode: 'soon', radius: maxWalk, floor: MIN_RELAXED_USABLE, lookahead: Infinity,
    })],
    ['further', needed, true, () => rung(needed, { radius: maxWalk * 2, openNow: true })],
    ['anywhere', needed, true, () => rung(needed, { lookahead: Infinity })],
    // Last resort: one room, and the UI is expected to lead with "nothing near
    // you is free" rather than presenting it as an answer.
    ['longest', 0, true, () => rung(0, { floor: MIN_RELAXED_USABLE, lookahead: Infinity }).slice(0, 1)],
  ];

  // The first rung that reaches quorum wins. A rung that finds one or two rooms
  // is not nothing, so it is held as the fallback, but the ladder keeps going to
  // see whether relaxing something turns it into a real list. Holding the FIRST
  // such rung matters: the rungs get worse as they go, so overwriting it would
  // answer a three-room question with the last resort.
  let answer = null;
  for (const [name, need, relaxed, run] of rungs) {
    const found = run();
    if (!found.length) continue;
    if (!answer) answer = { name, need, relaxed, found };
    if (found.length >= LADDER_QUORUM) {
      answer = { name, need, relaxed, found };
      break;
    }
  }

  if (!answer) {
    return finish({ ...base, reason: 'Nothing on campus is free for long enough today.' }, started);
  }

  const rows = answer.found.slice(0, limit);
  return finish({
    ...base,
    rung: answer.name,
    relaxed: answer.relaxed,
    need: answer.need,
    total: answer.found.length,
    rows,
    // Shown rooms whose building publishes hours, against those it does not.
    // 565 of 612 buildings publish nothing, so a screen can be all unknowns and
    // the caller has to be able to see that without walking the rows.
    known: rows.filter((r) => r.hoursKnown).length,
    unknown: rows.filter((r) => !r.hoursKnown).length,
  }, started);
}

function finish(payload, started) {
  mark('vacant:query:end');
  mark('vacant:answer:end');
  measure('vacant:query', 'vacant:query:start', 'vacant:query:end');
  measure('vacant:answer', 'vacant:answer:start', 'vacant:answer:end');
  payload.ms = nowMs() - started;
  return payload;
}
