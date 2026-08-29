// Refuse a build that lost busy time, and never count rooms to decide it.
//
// Vacant ships the ABSENCE of data as a positive claim. A healthy Autumn 2026
// harvest already reads 81% of campus free Mon-Fri 08:00 to 22:00, so a run that
// silently drops busy blocks does not look broken. It looks like good news.
//
//    Finder's failure                  Vacant's failure
//    ----------------                  ----------------
//    rows go missing                   busy blocks go missing
//         |                                 |
//         v                                 v
//    the picker is short               the grid says "free"
//         |                                 |
//         v                                 v
//    ROOM COUNT catches it             ROOM COUNT DOES NOT
//                                      block count does
//
// Measured: only 18 of 290 rooms carry a single block all week, so a run that
// drops a fifth of its blocks moves room count by 6.2%, under Finder's own
// MAX_DROP. Every threshold here is keyed on blocks and minutes.
//
// Pure. The counting and the deciding live here; scripts/build-index.mjs reads
// the files and prints. scripts/guards.mjs holds the shared refusal shapes and
// is a verbatim copy of Finder's, so nothing Vacant-specific belongs in it.

import { countRefusal, fatal, forceable, residueRefusal } from '../guards.mjs';

// Floors only bite on a term's FIRST run. From run two the previous-committed
// comparison does the work, and it is much sharper. Every number here is
// PROVISIONAL, and each is about 60% of a real measured build so a normal term
// clears it without thinking.
export const FLOORS = {
  // Spring. Measured on the committed 1262 archive: 607 rooms, 75 buildings,
  // 9,342 blocks, 718,466 busy minutes.
  2: { rooms: 364, buildings: 45, blocks: 5600, minutes: 431000 },
  // Summer, which is a seventh of Autumn by busy time and needs its own floor.
  // Measured on 1264: 142 rooms, 39 buildings, 668 blocks, 93,025 minutes.
  4: { rooms: 85, buildings: 23, blocks: 400, minutes: 55000 },
  // Autumn. Measured on 1268: 581 rooms, 78 buildings, 9,561 blocks,
  // 708,848 busy minutes.
  8: { rooms: 349, buildings: 47, blocks: 5700, minutes: 425000 },
};

export const floorsFor = (term) => FLOORS[Number(String(term).slice(-1))] ?? null;

// Building codes the harvest names and data/buildings.json will never hold.
//
// All six are the OARDC campus at Wooster or Stone Laboratory on Lake Erie, 126
// and 185 km out, and the GIS join drops them on distance. Without this list the
// unresolved-code guard fires on every single build, which trains you to ignore
// it. A code NOT in here is the thing worth stopping for: it means the geo layer
// went stale and real Columbus rooms are vanishing.
export const KNOWN_UNRESOLVED = new Map([
  ['118', 'Stone Laboratory, Lake Erie, 185 km'],
  ['404', 'Gerlaugh Hall, OARDC Wooster, 126.6 km'],
  ['405', 'OARDC Wooster'],
  ['410', 'Selby Hall, OARDC Wooster'],
  ['414', 'Williams Hall, OARDC Wooster, 126.5 km'],
  ['549', 'CFAES Wooster Administration Building, 126.2 km'],
  ['8002', 'Wooster Laboratory Building'],
]);

// Everything the refusals are decided on, read off one built index.
//
// `exclude` is a set of room ids to leave out. It is how a DELIBERATE filter
// change is told apart from a collapse. Every refusal here is a comparison
// against the committed file, and the committed file was built by the previous
// filter, so tightening the filter reads as 66 rooms losing all their blocks:
// the exact shape of the failure this module exists to catch. Excluding the
// rooms the new filter names, from BOTH sides, leaves every other room's block
// count under the full strength of the guard. A harvest that collapses in the
// same run still trips it, because the collapse lands on rooms nobody excluded.
export function measure(rooms, { exclude } = {}) {
  const entries = Object.entries(rooms ?? {}).filter(([id]) => !exclude?.has(id));
  const buildings = new Set();
  const blocksByRoom = new Map();
  const minutesByDay = new Array(7).fill(0);
  let blocks = 0;
  let minutes = 0;

  for (const [id, room] of entries) {
    buildings.add(room.b);
    blocksByRoom.set(id, room.busy.length);
    for (const b of room.busy) {
      blocks++;
      minutes += b[2] - b[1];
      minutesByDay[b[0]] += b[2] - b[1];
    }
  }

  // Monday to Friday only. The divisor is not zero at weekends any more but it
  // is close: Autumn 1268 has 1,800 Saturday minutes against 166,895 on
  // Tuesday, so a ratio over all seven days divides by a near-zero Saturday
  // every week and refuses a perfectly good build.
  const weekdays = minutesByDay.slice(1, 6);
  const high = Math.max(...weekdays);
  const weekdayBalance = high ? Math.min(...weekdays) / high : 0;

  return {
    rooms: entries.length,
    buildings: buildings.size,
    blocks,
    minutes,
    blocksByRoom,
    minutesByDay,
    weekdayBalance,
  };
}

// A room that had blocks in the committed file and has none now.
export function lostRooms(now, before) {
  const gone = [];
  for (const [id, count] of before.blocksByRoom) {
    if (!count) continue;
    if (!now.blocksByRoom.get(id)) gone.push(id);
  }
  return gone.sort();
}

// A room that kept under half the blocks it had. One is churn; six is a pattern.
export function guttedRooms(now, before) {
  const hurt = [];
  for (const [id, count] of before.blocksByRoom) {
    if (count < 2) continue;
    const kept = now.blocksByRoom.get(id);
    if (kept === undefined) continue;
    if (kept * 2 < count) hurt.push(`${id} ${count}->${kept}`);
  }
  return hurt.sort();
}

// An address in the shipped file is a public, offline-cached record of which
// professor is in which room at which minute. meeting.instructors carries real
// osu.edu addresses, 208 occurrences on one page of one subject, and it is
// deleted at the parse boundary. This is the last line, and FORCE_WRITE=1 must
// never reach it.
export const PII = /[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+/;

export function piiRefusal(serialized) {
  const hit = PII.exec(String(serialized ?? ''));
  if (!hit) return null;
  // The match itself is not printed. It is the thing we are refusing to publish.
  const at = hit.index;
  return fatal(
    `an address reached the index at character ${at}. Nothing is written and ` +
      'FORCE_WRITE does not clear this. Check that stripMeetingInstructors runs at the parse boundary.',
  );
}

// The whole refusal list for one term.
//
// `before` is null on a term with no committed file, which leaves the floors in
// charge and turns a shortfall into NOT READY rather than a collapse.
export function indexRefusals({
  term,
  now,
  before,
  clockStrings = { parsed: 0, failed: 0 },
  unresolvedCodes = [],
  noCoordRooms = 0,
  serialized = '',
}) {
  const floor = floorsFor(term);
  if (!floor) return [fatal(`term ${term} has an unknown season digit, so there is no floor to check.`)];

  const refusals = [
    // Blocks and minutes first, because they are the ones that catch the
    // failure this project actually has.
    countRefusal('busy blocks', now.blocks, floor.blocks, before?.blocks),
    countRefusal('busy minutes', now.minutes, floor.minutes, before?.minutes),
    countRefusal('rooms', now.rooms, floor.rooms, before?.rooms),
    countRefusal('buildings', now.buildings, floor.buildings, before?.buildings),
  ];

  if (before) {
    const gone = lostRooms(now, before);
    if (gone.length) {
      refusals.push(
        fatal(
          `${gone.length} room(s) had busy blocks in the committed index and have none now: ` +
            gone.join(' '),
        ),
      );
    }
    const gutted = guttedRooms(now, before);
    if (gutted.length > 5) {
      refusals.push(
        forceable(`${gutted.length} room(s) kept under half their committed blocks: ${gutted.join(' ')}`),
      );
    }
  }

  if (now.weekdayBalance < 0.3) {
    refusals.push(
      forceable(
        `weekday balance ${now.weekdayBalance.toFixed(2)}, under 0.30. Monday to Friday busy ` +
          `minutes are ${now.minutesByDay.slice(1, 6).join(' / ')}, so one weekday lost most of its classes.`,
      ),
    );
  }

  // Strict on purpose: 0 of 34,244 clock strings across the three archives fail
  // to parse. If toMinutes starts returning null the "8:00 am" format moved and
  // nothing about this run should ship.
  refusals.push(
    residueRefusal('meeting times', clockStrings.parsed, clockStrings.failed, 0.002),
  );

  const surprising = unresolvedCodes.filter((c) => !KNOWN_UNRESOLVED.has(c));
  if (surprising.length) {
    refusals.push(
      fatal(
        `harvested building code(s) with no entry in data/buildings.json: ${surprising.join(' ')}. ` +
          'Every room in them is silently missing from the index.',
      ),
    );
  }

  if (now.rooms) {
    const rate = noCoordRooms / now.rooms;
    if (rate > 0.1) {
      refusals.push(
        fatal(
          `${noCoordRooms} of ${now.rooms} rooms (${(rate * 100).toFixed(1)}%) resolve to a ` +
            'building with no lat/lon, over the 10% bound. Nothing can rank by distance.',
        ),
      );
    }
  }

  refusals.push(piiRefusal(serialized));
  return refusals.filter(Boolean);
}

// A term that has never been built is NOT READY, not collapsed. Skip it and
// exit 0. A term that IS committed and now falls short is a collapse: refuse,
// keep the committed file, exit 1.
//
// FORCE_WRITE=1 over a collapse is unrecoverable. A term deleted from
// searchableTermsV2 returns zero sections forever, so the committed file is the
// only copy of that term's grid that will ever exist. Term 1258 already answers
// totalItems 0.
export function notReady(refusals, hasCommittedFile) {
  if (hasCommittedFile) return false;
  return refusals.some((r) => r && /the floor is/.test(r.reason));
}
