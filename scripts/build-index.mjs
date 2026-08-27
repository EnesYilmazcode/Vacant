#!/usr/bin/env node
// Turn a harvest into data/rooms-<term>.json, the file the phone holds offline.
//
// Usage:  node scripts/build-index.mjs 1268
//         node scripts/build-index.mjs 1268 --dry-run
//         node scripts/build-index.mjs 1264 --no-pointer
//
// Split out of fetch-rooms.mjs deliberately, against the issue's "fetch-rooms
// writes two files". A full harvest costs about 680 requests against a
// university's API, and every schema change to the index would otherwise mean
// paying that again to see the result. Reading the committed harvest instead
// makes the inversion free to iterate on, and it is the same input either way.

import { gunzipSync } from 'node:zlib';
import { rename, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isRealRoom, isUnplaceable, newCounter, formatFunnel, toMinutes } from './lib/funnel.mjs';
import { buildSessions, expandMeeting, mergeIntervals, propagateGroups } from './lib/rooms.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// A term that comes back with fewer rooms than this did not build, it collapsed.
// Measured: 871 rooms for 1268, 884 for 1262, 206 for the much smaller 1264.
const MIN_ROOMS = 150;

// Bookings with no recoverable weekday get their clock window blocked on all
// seven days, so a handful of them is honest and a flood of them would delete
// the index. Measured across the three archives: 0 in 1268, 4 in 1264, 1 in
// 1262. Twenty is far above anything seen and far below anything that matters.
const MAX_UNPLACEABLE = 20;

const TERM_NAMES = { 2: 'Spring', 4: 'Summer', 8: 'Autumn' };

function die(message) {
  console.error(`\nFATAL  ${message}`);
  process.exit(1);
}

// 1268 -> Autumn 2026. The last digit is the term and the middle two are the
// year offset from 1900, so 126 is 2026.
export function termName(term) {
  const season = TERM_NAMES[Number(term.slice(3))];
  const year = 1900 + Number(term.slice(0, 3));
  return season ? `${season} ${year}` : null;
}

async function writeAtomic(path, text) {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, path);
}

// Invert harvested meeting records into room -> when it is busy.
//
// Pure and exported so the whole inversion can be tested on hand-built records
// without a 0.5 MB harvest on disk. main() below only reads files, prints and
// refuses.
export function invert(records, { isKnownBuilding } = {}) {
  // Sessions are built from the rows that SURVIVE the funnel, not from all
  // 27,074 harvested meetings. Building them from everything emitted 12
  // sessions of which only 10 were referenced by any busy tuple: two came from
  // online and room-less sections and carried zero blocks. Since `instruction`
  // is min/max over sessions, current.json then claimed the term starts
  // 2026-08-03 when the earliest real classroom booking is 2026-08-10, a week
  // of "in term" with no room in the index holding a single block.
  const counter = newCounter();
  const kept = records.filter((r) => isRealRoom(r.m, r, counter, { isKnownBuilding }));

  // Real occupancy in a real room with no weekday anywhere in the payload. The
  // funnel drops these because they cannot be placed; the index picks them back
  // up because a room we know is used must not read free. See DECISIONS.md.
  const unplaceable = records.filter((r) => isUnplaceable(r.m, { isKnownBuilding }));

  // Sessions come from both lists. An unplaceable booking is a real booking, so
  // a room reachable only through one still needs its date pair on the table.
  const sessions = buildSessions([...kept, ...unplaceable]);
  const sessionIndex = new Map(sessions.map(([s, e], i) => [`${s}|${e}`, i]));

  const rooms = {};
  let intervalsIn = 0;
  let noSession = 0;

  const sessionOf = (record) => {
    const m = record.m;
    return sessionIndex.get(`${m.startDate ?? record.startDate}|${m.endDate ?? record.endDate}`);
  };

  const roomFor = (m) => {
    const id = m.facilityId;
    if (!rooms[id]) {
      rooms[id] = {
        // The raw buildingCode. It is NOT reconstructable from facilityId:
        // room "N048" becomes SON0048, and buildingCode 148 maps to both SOE
        // and SON, so 331 of 1813 meetings disagree.
        b: m.buildingCode,
        n: m.room ?? null,
        // The raw facilityCapacity, including 0. 0 means unknown and 998 means
        // online; neither is a real seat count and neither is invented here.
        cap: Number.isFinite(m.facilityCapacity) ? m.facilityCapacity : null,
        type: m.facilityType ?? null,
        group: m.facilityGroup === true,
        busy: [],
      };
    }
    // facilityGroup can be true on any one of a room's meetings.
    if (m.facilityGroup === true) rooms[id].group = true;
    return rooms[id];
  };

  for (const record of kept) {
    const m = record.m;
    const si = sessionOf(record);
    // The one silent drop in an otherwise fully instrumented pipeline. A row
    // that passed the funnel and then vanishes has to move a number, or a
    // partial upstream drift empties whole rooms while the funnel still prints
    // a healthy usable count.
    if (si === undefined) {
      noSession++;
      continue;
    }

    const expanded = expandMeeting(m, toMinutes(m.startTime), toMinutes(m.endTime), si);
    intervalsIn += expanded.length;
    roomFor(m).busy.push(...expanded);
  }

  // Block an unplaceable booking on every day of its session.
  //
  // The alternative is the bug this exists to kill: Dreese Lab 280 reading free
  // through four Summer lab slots it is actually teaching in. Over-blocking
  // costs a student a room that was free on four of the five days. Under-
  // blocking walks them into a class. Only one of those is a lie in the
  // direction this app promises never to lie in.
  //
  // Seven days rather than Monday to Friday because nothing in the row says the
  // booking is on a weekday. Weekend meetings are rare (0.12% of day-expanded
  // blocks in 1268, 3.31% in 1264) but they are not zero, and rare is not a
  // fact about this particular row.
  let unplaceableBookings = 0;
  for (const record of unplaceable) {
    const m = record.m;
    const si = sessionOf(record);
    if (si === undefined) {
      noSession++;
      continue;
    }
    const start = toMinutes(m.startTime);
    const end = toMinutes(m.endTime);
    const room = roomFor(m);
    if (!room.unplaceable) room.unplaceable = [];
    room.unplaceable.push([start, end, si]);
    for (let day = 0; day < 7; day++) room.busy.push([day, start, end, si]);
    intervalsIn += 7;
    unplaceableBookings++;
  }

  // Cross-listed sections repeat the identical booking, so DL0280's four Summer
  // slots arrive as eight rows. Same dedupe the busy list gets, one level up.
  const unplaceableIds = [];
  for (const id of Object.keys(rooms)) {
    const room = rooms[id];
    if (!room.unplaceable) continue;
    unplaceableIds.push(id);
    const seen = new Map();
    for (const u of room.unplaceable) seen.set(u.join('|'), u);
    room.unplaceable = [...seen.values()].sort((a, b) => a[2] - b[2] || a[0] - b[0] || a[1] - b[1]);
  }
  unplaceableIds.sort();

  let dropped = 0;
  let merges = 0;
  for (const id of Object.keys(rooms)) {
    const result = mergeIntervals(rooms[id].busy);
    rooms[id].busy = result.intervals;
    dropped += result.dropped;
    merges += result.merges;
  }

  const { down, up } = propagateGroups(rooms);

  // `own` is scaffolding for idempotent propagation and must not ship.
  for (const room of Object.values(rooms)) delete room.own;

  return {
    rooms,
    sessions,
    counter,
    stats: {
      intervalsIn,
      dropped,
      merges,
      down,
      up,
      noSession,
      unplaceableBookings,
      unplaceableIds,
    },
  };
}

async function main() {
  const term = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  // Writing current.json points the app at this term. Building an expired
  // archive for a diff should not do that, which is what --no-pointer is for.
  const noPointer = process.argv.includes('--no-pointer');
  if (!/^\d{4}$/.test(term ?? '')) {
    console.error('usage: node scripts/build-index.mjs <term> [--dry-run] [--no-pointer]');
    process.exit(2);
  }

  const harvestPath = join(ROOT, 'data', `harvest-${term}.json.gz`);
  if (!existsSync(harvestPath)) {
    die(`no harvest at data/harvest-${term}.json.gz. Run fetch-rooms.mjs ${term} first.`);
  }
  const buildingsPath = join(ROOT, 'data', 'buildings.json');
  if (!existsSync(buildingsPath)) die('data/buildings.json is missing.');

  const harvest = JSON.parse(gunzipSync(readFileSync(harvestPath)));
  const buildings = JSON.parse(readFileSync(buildingsPath, 'utf8')).buildings;
  const isKnownBuilding = (code) => Object.prototype.hasOwnProperty.call(buildings, code);

  const { rooms, sessions, counter, stats } = invert(harvest.meetings, { isKnownBuilding });

  const roomCount = Object.keys(rooms).length;
  console.log(formatFunnel(counter));
  if (stats.unplaceableBookings) {
    console.log(
      `${stats.unplaceableBookings} booking(s) with no recoverable weekday, blocked on all ` +
        `seven days in ${stats.unplaceableIds.length} room(s): ${stats.unplaceableIds.join(' ')}`,
    );
  }
  console.log(
    `${roomCount} rooms, ${stats.intervalsIn} intervals in, ` +
      `${stats.dropped} exact duplicates dropped, ${stats.merges} merged, ` +
      `${stats.down} propagated to facilityGroup halves, ${stats.up} back to parents`,
  );
  console.log(`${sessions.length} sessions from observed date pairs`);
  if (stats.noSession) {
    console.warn(`  warn  ${stats.noSession} meeting(s) passed the funnel but matched no session`);
  }

  if (roomCount < MIN_ROOMS) die(`only ${roomCount} rooms, under the ${MIN_ROOMS} floor.`);
  if (stats.unplaceableBookings > MAX_UNPLACEABLE) {
    die(
      `${stats.unplaceableBookings} bookings have no recoverable weekday, over the ` +
        `${MAX_UNPLACEABLE} cap. Each one blocks its clock window on all seven days, so this ` +
        'many would delete the index rather than protect it. The upstream shape has moved: ' +
        'read the noWeekday stage in scripts/lib/funnel.mjs before raising the cap.',
    );
  }

  // The instruction window is the min and max of harvested meeting dates, never
  // searchableTermsV2, whose dates are eleven-month search visibility windows:
  // Autumn 2026 "starts" 2026-02-09 by that field.
  const allDates = sessions.flat().sort();
  const instruction = [allDates[0], allDates[allDates.length - 1]];

  const name = termName(term);
  if (!name) die(`cannot name term ${term}. Refusing to guess rather than shipping a wrong label.`);

  // Room keys sorted, for the diff rather than the bytes. Non-deterministic key
  // order turns every weekly rebuild into a full-file rewrite, so nothing can
  // tell you whether the data actually moved.
  const sorted = {};
  for (const id of Object.keys(rooms).sort()) sorted[id] = rooms[id];

  const payload = {
    term,
    // 0 = Sunday .. 6 = Saturday, matching data/buildings-hours.json.
    // busy is [weekday, startMinute, endMinute, sessionIndex], all integers.
    // cap 0 means unknown, 998 means online.
    schema:
      'busy=[day,start,end,session] day 0=Sun cap 0=unknown 998=online; ' +
      'unplaceable=[start,end,session] is a real booking whose weekday the API never gave, ' +
      'blocked on all seven days of that session',
    sessions,
    rooms: sorted,
  };
  const json = `${JSON.stringify(payload)}\n`;

  // `generated` lives only in current.json. If it appeared here, every weekly
  // rebuild would differ even when no schedule changed.
  if (/"generated"/.test(json)) die('generated must not appear inside the room index.');
  if (/@osu\.edu/i.test(json)) die('an address reached the room index.');
  if (/"lat"|"lon"|"name"/.test(json)) die('geography belongs in buildings.json, not here.');
  if (/\d{1,2}:\d{2}\s*[ap]m/i.test(json)) die('a raw clock string reached the room index.');

  const current = {
    term,
    termName: name,
    generated: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    rooms: `data/rooms-${term}.json`,
    // The launch subset from fetch-buildings.mjs, named here so the app never
    // has to build a filename out of the term itself.
    buildings: `data/buildings-${term}.json`,
    instruction,
  };

  console.log(`\n${name}, instruction ${instruction[0]} to ${instruction[1]}`);
  console.log(`index ${(json.length / 1024).toFixed(0)} KB raw`);

  if (dryRun) {
    console.log('DRY RUN, nothing written.');
    return;
  }
  await writeAtomic(join(ROOT, 'data', `rooms-${term}.json`), json);
  if (noPointer) {
    console.log(`wrote data/rooms-${term}.json, left current.json alone`);
    return;
  }
  await writeAtomic(join(ROOT, 'data', 'current.json'), `${JSON.stringify(current, null, 1)}\n`);
  console.log(`wrote data/rooms-${term}.json and data/current.json`);
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('build-index.mjs');
if (invokedDirectly) main().catch((err) => die(err.message));
