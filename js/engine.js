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
// Returns the free gaps between them inside [open, close].
//
// Blocks are neither sorted nor disjoint in the source: a room can hold two
// sections booked over each other, and back-to-back classes must not produce a
// zero-length gap between them.
export function freeGaps(busy, day, open, close) {
  const blocks = busy
    .filter((b) => b[0] === day)
    .map((b) => [Math.max(b[1], open), Math.min(b[2], close)])
    .filter((b) => b[1] > b[0])
    .sort((a, b) => a[0] - b[0]);

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
  return gaps;
}

// The gap you would actually get in this room, given where you are and when.
// Returns null when the room gives you nothing.
export function bestGap(room, { now, day, open, close, metres, needed = 0, packup = PACKUP }) {
  let best = null;
  for (const [gapStart, gapEnd] of freeGaps(room.busy ?? [], day, open, close)) {
    // A gap entirely in the past is not a gap.
    if (gapEnd <= now) continue;
    const usable = usableMinutes({ now, gapStart, gapEnd, metres, packup });
    if (usable <= 0) continue;
    if (!best || usable > best.usable) best = { usable, gapStart, gapEnd };
  }
  if (!best) return null;
  return { ...best, meetsNeed: best.usable >= needed };
}

// Rank rooms for one query.
//
// A room in a building with no published hours is never given assumed hours.
// The caller passes `open`/`close` per building, or null to mean "we do not
// know", and an unknown-hours room is tiered below every known one rather than
// dropped or guessed at.
export function rank(rooms, opts) {
  const { origin, now, day, needed = 0, buildings, hoursFor, packup = PACKUP } = opts;
  const out = [];

  for (const room of rooms) {
    const building = buildings[room.b];
    if (!building) continue; // no coordinates means no walk time means no answer

    const metres = distanceMetres(origin, building);
    const hours = hoursFor ? hoursFor(room.b, day) : undefined;

    // undefined means the building has no published hours. null means it is
    // published as CLOSED, which is a fact and removes the room.
    if (hours === null) continue;
    const known = Array.isArray(hours);
    const [open, close] = known ? hours : [0, 1440];

    const gap = bestGap(room, { now, day, open, close, metres, needed, packup });
    if (!gap) continue;

    out.push({
      id: room.id,
      building: room.b,
      name: building.name,
      seats: room.cap ?? null,
      metres: Math.round(metres),
      walk: walkMinutes(metres),
      usable: gap.usable,
      freeUntil: gap.gapEnd,
      meetsNeed: gap.meetsNeed,
      hoursKnown: known,
    });
  }

  // Rooms that meet the need first, then rooms in buildings we know are open,
  // then by walk time. An unknown-hours room can never outrank a known-open one
  // on the same walk, which is the ranking doing the honesty rather than a
  // label doing it.
  out.sort(
    (a, b) =>
      Number(b.meetsNeed) - Number(a.meetsNeed) ||
      Number(b.hoursKnown) - Number(a.hoursKnown) ||
      a.walk - b.walk ||
      b.usable - a.usable,
  );
  return out;
}
