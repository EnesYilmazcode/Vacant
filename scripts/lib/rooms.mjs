// Invert course -> section -> meeting into room -> when it is busy.
//
// Pure. No node builtins, no fetch.
//
// The raw busy list lies in three directions at once and all three are fixed
// here, at build time, so the phone never has to:
//
//   cross-listed sections repeat the identical interval
//   one section can list the same meeting ten times, the last ending early
//   a divisible room's parent booking silently occupies its halves

// 0 = Sunday through 6 = Saturday. This MUST match the day index in
// data/buildings-hours.json, or a room's busy blocks are compared against
// another day's opening hours.
export const DAY_INDEX = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const DAY_NAMES = Object.keys(DAY_INDEX);

// Observed (startDate, endDate) pairs, deduped and ordered. Never sessionCode:
// nine LAW sections labelled 7W1 actually run 2026-08-24 to 2026-10-09, and
// Summer carries eight different codes for overlapping windows.
export function buildSessions(records) {
  const seen = new Map();
  for (const r of records) {
    const start = r.m?.startDate ?? r.startDate;
    const end = r.m?.endDate ?? r.endDate;
    if (!start || !end) continue;
    seen.set(`${start}|${end}`, [start, end]);
  }
  return [...seen.values()].sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
}

// Merge one room's intervals.
//
// Grouped by (weekday, sessionIndex) and NEVER merged across groups: two
// intervals at the same clock time in different sessions are different
// bookings, and collapsing them deletes one of them.
//
// Within a group, `next.start <= current.end` covers all three lies at once.
// An exact duplicate, a partial overlap and an abutting pair all fold, which is
// why the ten-copy case falls out for free.
export function mergeIntervals(intervals) {
  const groups = new Map();
  for (const iv of intervals) {
    const key = `${iv[0]}|${iv[3]}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(iv);
  }

  const out = [];
  let dropped = 0;
  let merges = 0;

  for (const group of groups.values()) {
    group.sort((a, b) => a[1] - b[1] || a[2] - b[2]);
    let current = null;
    for (const iv of group) {
      if (!current) {
        current = [...iv];
        continue;
      }
      if (iv[1] <= current[2]) {
        // A duplicate contributes nothing; an overlap or abutment extends.
        if (iv[2] <= current[2]) dropped++;
        else merges++;
        current[2] = Math.max(current[2], iv[2]);
      } else {
        out.push(current);
        current = [...iv];
      }
    }
    if (current) out.push(current);
  }

  out.sort((a, b) => a[0] - b[0] || a[3] - b[3] || a[1] - b[1]);
  return { intervals: out, dropped, merges };
}

// The halves of a divisible room, given the parent's id.
//
// Two shapes exist and the issue's spec only covers the first:
//
//   MALC0100     -> MALC0100N, MALC0100S     a suffix EXTENDS the parent id
//   BO0410/420   -> BO0410, BO0420           a slash NAMES both halves
//
// The second is invisible to a prefix test, because 'BO0410'.startsWith(
// 'BO0410/420') is false. Measured on term 1268: BO0410/420 is a facilityGroup
// parent and BOTH BO0410 (7 blocks) and BO0420 (4 blocks) are separate rooms in
// the index, so a combined booking left both halves reading FREE. That is
// exactly the failure this propagation exists to prevent.
//
// The digits after the slash replace the last N of the base number, which is
// how the Registrar writes them: BO0410/420 -> 0410 and 0420, FL2125/35 ->
// 2125 and 2135.
export function halvesOf(parentId, allIds) {
  const slash = /^(.*?)(\d+)\/(\d+)$/.exec(parentId);
  if (slash) {
    const [, prefix, base, suffix] = slash;
    const sibling = base.slice(0, Math.max(0, base.length - suffix.length)) + suffix;
    return [prefix + base, prefix + sibling].filter((id) => id !== parentId && id in allIds);
  }
  // A suffix that extends the id. Gated on facilityGroup by the caller and
  // NEVER a bare prefix scan on its own: KH0333/KH0333C and HC0346/HC0346D are
  // both facilityGroup false and genuinely separate rooms, and a bare scan
  // would mark real free rooms busy.
  return Object.keys(allIds).filter((id) => id !== parentId && id.startsWith(parentId));
}

// A divisible room's parent booking occupies its halves, and a half being
// booked makes the whole room unusable. Both directions are real and the issue
// leaves the second as an explicit decision rather than an omission.
//
// Decided: propagate BOTH ways. If MALC0100 is booked, neither half is free. If
// MALC0100N is booked, MALC0100 is not available as a whole room either, since
// half of it has a class in it. Sending someone to the whole room in that state
// is the same wrong answer in the other direction.
export function propagateGroups(rooms) {
  let down = 0;
  let up = 0;
  const parents = Object.keys(rooms).filter((id) => rooms[id].group === true);

  for (const parentId of parents) {
    const parent = rooms[parentId];
    const halves = halvesOf(parentId, rooms);
    // Snapshot the parent's own blocks before any child pushes into it, so an
    // upward-propagated block is not immediately sent back down.
    const parentOwn = parent.busy.map((iv) => [...iv]);

    for (const childId of halves) {
      const child = rooms[childId];
      const childOwn = child.busy.map((iv) => [...iv]);
      for (const iv of parentOwn) {
        child.busy.push([...iv]);
        down++;
      }
      for (const iv of childOwn) {
        parent.busy.push([...iv]);
        up++;
      }
    }
  }

  // Re-merge every room that received intervals, or a propagated block sits
  // unmerged beside an identical one the room already had.
  for (const id of Object.keys(rooms)) {
    rooms[id].busy = mergeIntervals(rooms[id].busy).intervals;
  }
  return { down, up };
}

// Day-expand one meeting into [weekday, start, end, sessionIndex] tuples.
export function expandMeeting(meeting, start, end, sessionIndex) {
  const out = [];
  for (const day of DAY_NAMES) {
    if (meeting[day] !== true) continue;
    out.push([DAY_INDEX[day], start, end, sessionIndex]);
  }
  return out;
}
