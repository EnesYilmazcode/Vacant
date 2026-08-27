// How long a room is yours AFTER you finish walking to it.
//
// This is the whole differentiator, and it is not the number the README first
// reached for. Runs in the browser and under node, no imports.

// Metres per minute at an ordinary walking pace.
export const WALK_MPM = 78;

// Straight-line distance times this is roughly the real path. Campus paths are
// not straight, and understating the walk overstates the room.
export const DETOUR = 1.3;

// Minutes reserved at the end so you are not packing up while the next class
// files in.
export const PACKUP = 10;

const R = 6371008.8;
const rad = (deg) => (deg * Math.PI) / 180;

// Equirectangular, not haversine. This runs over every room on every query and
// at campus scale the error is under a metre, checked against a haversine
// reference in the tests.
export function distanceMetres(a, b) {
  const x = rad(b.lon - a.lon) * Math.cos(rad((a.lat + b.lat) / 2));
  const y = rad(b.lat - a.lat);
  return Math.sqrt(x * x + y * y) * R;
}

export const walkMinutes = (metres) => Math.ceil((metres * DETOUR) / WALK_MPM);

// THE formula.
//
//   usable = (gapEnd - PACKUP) - max(arrival, gapStart)
//
// NOT `gapEnd - now - walkTime`, which the README used. That version counts the
// time you spend standing in the corridor waiting for the previous class to end
// as time you get to study, and overstates by exactly the wait. For a gap of
// 14:00 to 16:00 with now 13:50 and a 6 minute walk it says 124 minutes. You
// arrive at 13:56, the room frees at 14:00, and you get 120.
export function usableMinutes({ now, gapStart, gapEnd, metres, packup = PACKUP }) {
  const arrival = now + walkMinutes(metres);
  const usableStart = Math.max(arrival, gapStart);
  return gapEnd - packup - usableStart;
}

// Busy blocks for one room on one weekday, as [dayIndex, startMinute, endMinute].
// Returns the free gaps between them inside [open, close], plus a count of
// blocks that arrived malformed.
//
// Blocks are neither sorted nor disjoint in the source: a room can hold two
// sections booked over each other, and back-to-back classes must not produce a
// zero-length gap between them.
export function freeGaps(busy, day, open, close) {
  // `day` reaches this from a <select> value or a query string, where it is a
  // string. A strict === against a number then matches nothing, every block is
  // filtered out, and the room reports the whole day free with no error.
  const d = Number(day);
  let malformed = 0;

  const blocks = [];
  for (const b of busy) {
    if (Number(b[0]) !== d) continue;
    let [, start, end] = b;
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      malformed++;
      continue;
    }
    // An end at or before the start is either a midnight crossing or corrupt
    // data. Dropping it reports an occupied room as free, which is the worst
    // failure this app has, so it is read conservatively as running to the end
    // of the day instead.
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

  // Non-enumerable so the gaps still compare as a plain array, while a caller
  // that wants to assert on data quality can still read the count.
  Object.defineProperty(gaps, 'malformed', { value: malformed, enumerable: false });
  return gaps;
}

// The gap you would actually get in this room. Returns null when the room gives
// you nothing.
//
// A gap that has not started when you arrive is NOT equivalent to one that has.
// Picking purely by length sends someone on a seven minute walk to a room with
// a class in it for the next four hours, because that room's afternoon gap is
// longer than the gap the room next door has free right now. So a gap you can
// walk into wins over a longer one you would have to wait for, and the wait is
// reported either way.
export function bestGap(room, { now, day, open, close, metres, needed = 0, packup = PACKUP }) {
  const arrival = now + walkMinutes(metres);
  const gaps = freeGaps(room.busy ?? [], day, open, close);
  let best = null;

  for (const [gapStart, gapEnd] of gaps) {
    if (gapEnd <= now) continue; // entirely in the past
    const usable = usableMinutes({ now, gapStart, gapEnd, metres, packup });
    if (!(usable > 0)) continue; // NaN fails this too, which `<= 0` does not
    const wait = Math.max(0, gapStart - arrival);
    const meetsNeed = usable >= needed;
    const candidate = { usable, gapStart, gapEnd, wait, meetsNeed };

    if (!best) {
      best = candidate;
      continue;
    }
    // Open on arrival beats waiting. Then meeting the need. Then length.
    const better =
      Number(candidate.wait === 0) - Number(best.wait === 0) ||
      Number(candidate.meetsNeed) - Number(best.meetsNeed) ||
      candidate.usable - best.usable;
    if (better > 0) best = candidate;
  }

  if (!best) return null;
  return { ...best, malformed: gaps.malformed };
}

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

// Rank rooms for one query.
//
// `hoursFor(buildingCode, day)` returns:
//   an [open, close] pair   the building publishes hours for that day
//   null                    the building publishes that day as CLOSED
//   undefined               the building publishes no hours at all
//
// Those three are NOT interchangeable. `null` is a fact and removes the room.
// `undefined` is an absence, and the room is shown, tiered below every
// published-hours room, and never given an assumed window.
export function rank(rooms, opts) {
  const { origin, now, day, needed = 0, buildings, hoursFor, packup = PACKUP } = opts;
  const out = [];

  for (const room of rooms) {
    const building = buildings[room.b];
    if (!building) continue;
    // A building row with no usable coordinate is the same as no building. The
    // old guard checked only that the row existed, so a null lat produced a NaN
    // distance, and `NaN <= 0` is false, so the room shipped with NaN minutes
    // and an arbitrary sort position.
    if (!Number.isFinite(building.lat) || !Number.isFinite(building.lon)) continue;

    const metres = distanceMetres(origin, building);
    // A geolocation fix that never resolved reaches here as NaN. Without this
    // every room comes back with NaN minutes in arbitrary order.
    if (!Number.isFinite(metres)) continue;

    const hours = hoursFor ? hoursFor(room.b, day) : undefined;
    if (hours === null) continue;
    const hoursKnown = Array.isArray(hours);

    // For an unknown-hours building the window is the whole day, but ONLY so
    // the class schedule can be swept. No usable figure is emitted from it,
    // because "free for 20 hours" at 3am in a building nobody knows is open is
    // an assumed window wearing a different hat.
    const [open, close] = hoursKnown ? hours : [0, 1440];

    const gap = bestGap(room, { now, day, open, close, metres, needed, packup });
    if (!gap) continue;

    out.push({
      id: room.id,
      building: room.b,
      name: building.name,
      seats: room.cap ?? null,
      metres: Math.round(metres),
      walk: walkMinutes(metres),
      // Minutes you actually get, once you have walked there and left the
      // packup buffer. Null when the building publishes no hours, because we
      // cannot know when it locks.
      usable: hoursKnown ? gap.usable : null,
      // The end of the free window you could use, packup already removed. Not
      // the raw gap end, which disagrees with `usable` by exactly PACKUP and
      // makes a countdown hand back the buffer.
      usableUntil: hoursKnown ? gap.gapEnd - packup : null,
      // When the next class starts, or the building closes. Raw, for display.
      nextClassAt: gap.gapEnd,
      // When the room actually opens up, and how long you would wait after
      // arriving. Without these a caller cannot tell "available now" from
      // "available from 1:00 PM".
      availableAt: gap.gapStart,
      wait: gap.wait,
      meetsNeed: hoursKnown ? gap.meetsNeed : null,
      hoursKnown,
      malformedBlocks: gap.malformed,
    });
  }

  for (const row of out) row.tier = tierOf(row);
  out.sort((a, b) => a.tier - b.tier || a.walk - b.walk || (b.usable ?? 0) - (a.usable ?? 0));
  return out;
}
