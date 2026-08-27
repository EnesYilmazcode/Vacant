// Offline. Fixtures plus the committed data, no network and no DOM.
//
// These cover the screens' decisions, not their markup: which state the app is
// in, what a row is allowed to say, and what the diagnostics block gives a
// maintainer. The one thing they exist for above all is the exam-week refusal,
// which cannot be reached by opening the app in August.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  allWeekCodes,
  busyDayOf,
  diagnosticsBlock,
  inScheduledHours,
  indexFloorCheck,
  rankBuildings,
  resolveState,
  roomsPerBuilding,
  staleness,
  windowPhrase,
} from '../../js/state.js';
import { rank } from '../../js/engine.js';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = (f) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));

const CURRENT = read('data/current.json');
const INDEX = read('data/rooms-1268.json');
const SLICE = read('data/buildings-1268.json').buildings;
const FULL = read('data/buildings.json').buildings;
const HOURS = read('data/buildings-hours.json');

// Local midnight, because every state decision is made against a wall clock the
// student is standing in, not against UTC.
const at = (iso, h = 12, m = 0) => {
  const [y, mo, d] = iso.split('-').map(Number);
  return new Date(y, mo - 1, d, h, m);
};

// The calendar the term index is meant to carry once the harvest emits it. The
// dates are the real Autumn 2026 ones from the issue.
const CAL = {
  ...INDEX,
  exams: { start: '2026-12-11', end: '2026-12-17' },
  closed: {
    '2026-09-07': { state: 'offices-closed', name: 'Labor Day' },
    '2026-10-15': { state: 'no-classes', name: 'Autumn break' },
    '2026-10-16': { state: 'no-classes', name: 'Autumn break' },
  },
  lowConfidence: [{ start: '2026-10-13', end: '2026-10-16', why: 'session 1 finals' }],
  sessions: INDEX.sessions.map((s) => (s[1] === '2026-12-11' ? ['2026-08-10', '2026-12-09'] : s)),
};
const CUR = { ...CURRENT, instruction: ['2026-08-10', '2026-12-09'] };

// ------------------------------------------------------------------ #19 state

test('exam week refuses, and names the day it can answer again', () => {
  const s = resolveState({ now: at('2026-12-15'), current: CUR, index: CAL });
  assert.equal(s.kind, 'EXAM_REFUSAL');
  assert.equal(s.ranked, false);
  assert.match(s.body, /Dec 18/);
});

test('the exam check runs before the between-terms check', () => {
  // Finals sits outside every session range, so the naive order sends Dec 11 to
  // 17 to "campus is empty", which reads as every room being free.
  const withNext = { ...CUR, next: { termName: 'Spring 2027', instruction: ['2027-01-11', '2027-04-24'] } };
  for (const day of ['2026-12-11', '2026-12-13', '2026-12-17']) {
    assert.equal(resolveState({ now: at(day), current: withNext, index: CAL }).kind, 'EXAM_REFUSAL');
  }
});

test('a closed campus is one message and no ranked rows', () => {
  const s = resolveState({ now: at('2026-09-07'), current: CUR, index: CAL });
  assert.equal(s.kind, 'CAMPUS_CLOSED');
  assert.equal(s.ranked, false);
  assert.match(s.heading, /Labor Day/);
});

test('a no-classes day still ranks, and says why campus is quiet', () => {
  const s = resolveState({ now: at('2026-10-15'), current: CUR, index: CAL });
  assert.equal(s.kind, 'RANKED');
  assert.equal(s.ranked, true);
  assert.match(s.note, /quiet/);
  // Oct 15 sits in both tables. One message, not two stacked banners.
  assert.doesNotMatch(s.note, /Session 1/);
});

test('the low-confidence window names both failure modes', () => {
  for (const day of ['2026-10-13', '2026-10-14']) {
    const s = resolveState({ now: at(day), current: CUR, index: CAL });
    assert.equal(s.ranked, true);
    assert.match(s.note, /finals/i);
    assert.match(s.note, /full term/i);
  }
});

test('between terms names the last class, the next start and the gap', () => {
  const withNext = { ...CUR, next: { termName: 'Spring 2027', instruction: ['2027-01-11', '2027-04-24'] } };
  const s = resolveState({ now: at('2026-12-20'), current: withNext, index: CAL });
  assert.equal(s.kind, 'BETWEEN_TERMS');
  assert.equal(s.ranked, false);
  assert.match(s.body, /Dec 9/);
  assert.match(s.body, /Jan 11/);
  assert.match(s.body, /22 days/);
  assert.ok(s.action, 'between terms offers the nearest buildings');
});

test('with no next term it is TERM_ENDED, and it prints when it last checked', () => {
  const s = resolveState({ now: at('2026-12-20'), current: CUR, index: CAL });
  assert.equal(s.kind, 'TERM_ENDED');
  assert.equal(s.ranked, false);
  assert.match(s.detail, new RegExp(CUR.generated));
  // Between-terms is not staleness and must not borrow its words.
  const between = resolveState({
    now: at('2026-12-20'),
    current: { ...CUR, next: { instruction: ['2027-01-11', '2027-04-24'] } },
    index: CAL,
  });
  const shared = s.body.split('. ').filter((line) => between.body.includes(line));
  assert.deepEqual(shared, []);
});

test('an index under its term-digit floor refuses and prints observed against expected', () => {
  const rooms = Object.fromEntries(Object.entries(INDEX.rooms).slice(0, 198));
  const s = resolveState({ now: at('2026-09-04'), current: CUR, index: { ...CAL, rooms } });
  assert.equal(s.kind, 'INDEX_REFUSED');
  assert.equal(s.ranked, false);
  assert.equal(s.detail, 'rooms 198 < 400');
});

test('the floor is per term digit, so a Summer index is not held to a full term', () => {
  // Measured on the shipped builds: 871 rooms for 1268, 884 for 1262, 206 for
  // the much smaller Summer 1264.
  const rooms = Object.fromEntries(Object.entries(INDEX.rooms).slice(0, 206));
  assert.equal(indexFloorCheck({ term: '1264', rooms }).ok, true);
  assert.equal(indexFloorCheck({ term: '1262', rooms }).ok, false);
});

test('staleness climbs at 14 and 35 days, and past the term it gates', () => {
  const gen = (days) => {
    const d = new Date(2026, 8, 4);
    d.setDate(d.getDate() - days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T07:00:00Z`;
  };
  const level = (days) =>
    staleness({ now: at('2026-09-04'), current: { ...CUR, generated: gen(days) } }).level;
  assert.equal(level(13), 'silent');
  assert.equal(level(14), 'line');
  assert.equal(level(34), 'line');
  assert.equal(level(35), 'banner');
  assert.equal(staleness({ now: at('2026-12-20'), current: CUR }).level, 'gated');
});

test('resolveState is pure: the same inputs twice give the same answer', () => {
  const args = { now: at('2026-12-15'), current: CUR, index: CAL };
  assert.deepEqual(resolveState(args), resolveState(args));
});

// ------------------------------------------------------------ #20 unscheduled

test('the scheduled window is measured off the index when the build omits it', () => {
  const busyDay = busyDayOf({}, INDEX);
  assert.deepEqual(busyDay.weekdays, [false, true, true, true, true, true, false]);
  assert.equal(busyDay.earliestStart, 480);
  assert.equal(busyDay.latestEnd, 1290);
});

test('current.json wins over the measurement when it carries busyDay', () => {
  const given = { earliestStart: 500, latestEnd: 1000, weekdays: [false, true, true, true, true, true, false] };
  assert.deepEqual(busyDayOf({ busyDay: given }, INDEX), given);
});

test('the unscheduled trigger flips when latestEnd moves', () => {
  const thu = at('2026-09-03', 21, 40);
  const early = { ...CUR, busyDay: { earliestStart: 480, latestEnd: 1290, weekdays: [false, true, true, true, true, true, false] } };
  const late = { ...CUR, busyDay: { ...early.busyDay, latestEnd: 1380 } };
  assert.equal(inScheduledHours({ now: thu, current: early, index: CAL }), false);
  assert.equal(inScheduledHours({ now: thu, current: late, index: CAL }), true);
});

test('a weekend evening is never in scheduled hours', () => {
  assert.equal(inScheduledHours({ now: at('2026-09-05', 20, 0), current: CUR, index: CAL }), false);
  assert.equal(inScheduledHours({ now: at('2026-09-03', 14, 2), current: CUR, index: CAL }), true);
});

test('a shut campus is not scheduled hours, but a no-classes day still is', () => {
  // Autumn break really does leave the buildings open, so the ranked list is
  // still the right answer there and the quiet-campus line says why.
  assert.equal(inScheduledHours({ now: at('2026-09-07', 12, 0), current: CUR, index: CAL }), false);
  assert.equal(inScheduledHours({ now: at('2026-10-15', 12, 0), current: CUR, index: CAL }), true);
});

test('buildings rank in three groups and unknown hours never sort among the open', () => {
  const counts = roomsPerBuilding(INDEX);
  const term = HOURS.terms['autumn-2026-classroom-pool-building-schedule'];
  const hoursFor = (code, day) => term.buildings[code]?.hours[day];
  const groups = rankBuildings({
    origin: { lat: 39.99944, lon: -83.01502 },
    buildings: SLICE,
    counts,
    hoursFor,
    day: 4,
    nowMin: 14 * 60,
  });
  assert.ok(groups.open.length > 0);
  assert.ok(groups.unknown.length > 0);
  for (const row of groups.open) assert.ok(Number.isFinite(row.closesAt));
  for (const row of groups.unknown) assert.equal(row.closesAt, null);
  // Every building the screen lists carries a classroom count and a walk.
  for (const row of [...groups.open, ...groups.unknown, ...groups.closed]) {
    assert.ok(row.rooms >= 1);
    assert.ok(Number.isFinite(row.walk));
  }
  assert.equal(
    groups.open.length + groups.unknown.length + groups.closed.length,
    Object.keys(counts).filter((c) => SLICE[c]).length,
  );
});

test('with no hours table at all every building reads unknown, never open', () => {
  const counts = roomsPerBuilding(INDEX);
  const groups = rankBuildings({
    origin: { lat: 39.99944, lon: -83.01502 },
    buildings: SLICE,
    counts,
    hoursFor: () => undefined,
    day: 6,
    nowMin: 21 * 60,
  });
  assert.equal(groups.open.length, 0);
  assert.equal(groups.closed.length, 0);
  assert.equal(groups.unknown.length, Object.keys(counts).filter((c) => SLICE[c]).length);
});

test('the all-week list comes out of the hours table, not out of the source', () => {
  const term = HOURS.terms['autumn-2026-classroom-pool-building-schedule'];
  const codes = allWeekCodes(term);
  assert.ok(codes.length >= 4);
  for (const code of codes) {
    assert.ok(term.buildings[code].hours.every((d) => Array.isArray(d)));
  }
});

// Comments are stripped first. A comment naming Sullivant is a record of the
// measurement that produced a rule; a name in the code is a hardcoded building
// that survives a term rollover it should not have survived.
const codeOnly = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('no building name is typed into the app source', () => {
  const dir = join(ROOT, 'js');
  const names = ['Enarson', 'Hitchcock', 'Independence', 'Sullivant', '18th Avenue'];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const text = codeOnly(readFileSync(join(dir, file), 'utf8'));
    for (const name of names) {
      assert.equal(text.includes(name), false, `${file} names ${name}`);
    }
  }
});

test('the app source assumes nothing about an unpublished door', () => {
  // The whole word, not just "usually open". A hedge anywhere in this app is
  // one edit away from being a hedge about a door.
  const dir = join(ROOT, 'js');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    assert.doesNotMatch(readFileSync(join(dir, file), 'utf8'), /usually/i, `${file} hedges`);
  }
  assert.doesNotMatch(readFileSync(join(ROOT, 'index.html'), 'utf8'), /usually/i, 'index.html hedges');
});

// ---------------------------------------------------------------- #18 the row

test('a room with no later class says so, and never invents an end time', () => {
  const row = {
    wait: 0,
    hoursKnown: true,
    nextClassAt: 1290,
    usableUntil: 1280,
    availableAt: 800,
    usable: 480,
  };
  assert.equal(windowPhrase(row, 1290).text, 'no class rest of today');
  assert.equal(windowPhrase(row, 1290).tier, 'medium');
  // The lock time is still in the accessible name, because it is the one fact
  // the phrase drops.
  assert.match(windowPhrase(row, 1290).say, /locks at 9:30 pm/);
});

test('a class-bounded room prints a clock time and no duration', () => {
  const row = { wait: 0, hoursKnown: true, nextClassAt: 835, usableUntil: 825, availableAt: 700, usable: 125 };
  const p = windowPhrase(row, 1290);
  assert.equal(p.tier, 'strong');
  assert.equal(p.text, 'free till 1:45pm');
  assert.doesNotMatch(p.text, /\dh\d\d/);
});

test('the 9h44 case: an unpublished door never gets a window', () => {
  // The room really is free from 14:16 to midnight as far as the schedule
  // knows, and the naive read of that is "9h44 free", which is a claim about a
  // door nobody publishes. rank() returns usable null here on purpose.
  const rooms = [{ id: 'XX0001', b: '900', cap: 40, busy: [[4, 600, 700]] }];
  const buildings = { 900: { name: 'Nowhere Hall', lat: 39.9995, lon: -83.013 } };
  const [row] = rank(rooms, {
    origin: { lat: 39.9995, lon: -83.013 },
    now: 856,
    day: 4,
    needed: 30,
    buildings,
    hoursFor: () => undefined,
  });
  assert.equal(row.hoursKnown, false);
  assert.equal(row.usable, null);
  assert.equal(row.usableUntil, null);
  const p = windowPhrase(row, null);
  assert.equal(p.text, 'hours not published');
  assert.doesNotMatch(p.text, /\dh\d\d/);
});

test('no row phrase ever names a time past the end of the day', () => {
  const counts = roomsPerBuilding(INDEX);
  const term = HOURS.terms['autumn-2026-classroom-pool-building-schedule'];
  const hoursFor = (code, day) => term.buildings[code]?.hours[day];
  const rows = rank(
    Object.entries(INDEX.rooms).map(([id, r]) => ({ id, ...r })),
    {
      origin: { lat: 39.99944, lon: -83.01502 },
      now: 735,
      day: 4,
      needed: 60,
      buildings: SLICE,
      hoursFor,
      sessions: INDEX.sessions,
      date: '2026-09-03',
    },
  );
  assert.ok(rows.length > 100, `expected a busy Thursday, got ${rows.length} rows`);
  assert.ok(Object.keys(counts).length > 0);
  for (const row of rows) {
    const hours = hoursFor(row.building, 4);
    const p = windowPhrase(row, Array.isArray(hours) ? hours[1] : null);
    const clockHit = p.text.match(/(\d+):(\d\d)(am|pm)/);
    if (!clockHit) continue;
    const [, h, m, ap] = clockHit;
    const minute = ((Number(h) % 12) + (ap === 'pm' ? 12 : 0)) * 60 + Number(m);
    assert.ok(minute < 1440, `${row.id} printed ${p.text}`);
  }
});

// ------------------------------------------------------------ #17 the picker

test('the picker list is the intersection of the harvest and buildings.json', () => {
  const counts = roomsPerBuilding(INDEX);
  const codes = Object.keys(counts).filter((c) => SLICE[c]);
  assert.ok(codes.length >= 60 && codes.length <= 200, `picker would list ${codes.length} buildings`);
  for (const code of codes) {
    assert.ok(SLICE[code], `${code} missing from the term slice`);
    assert.ok(FULL[code], `${code} missing from buildings.json`);
    assert.ok(counts[code] >= 1);
  }
});

test('every picked building resolves to a coordinate', () => {
  const counts = roomsPerBuilding(INDEX);
  for (const code of Object.keys(counts)) {
    const b = SLICE[code];
    if (!b) continue;
    assert.ok(Number.isFinite(b.lat) && Number.isFinite(b.lon), `${code} has no coordinate`);
  }
});

test('a picked origin ranks rooms from more than one building', () => {
  // Roomix seeds from a building and then expands outward until it breaks at
  // 200 m, so picking narrows the answer. A picked building here is only where
  // you are standing.
  const term = HOURS.terms['autumn-2026-classroom-pool-building-schedule'];
  const home = SLICE['279'];
  const rows = rank(
    Object.entries(INDEX.rooms).map(([id, r]) => ({ id, ...r })),
    {
      origin: { lat: home.lat, lon: home.lon, accuracy: 50, source: 'picked' },
      now: 735,
      day: 4,
      needed: 30,
      buildings: SLICE,
      hoursFor: (code, day) => term.buildings[code]?.hours[day],
      sessions: INDEX.sessions,
      date: '2026-09-03',
    },
  );
  const distinct = new Set(rows.slice(0, 20).map((r) => r.building));
  assert.ok(distinct.size >= 3, `top 20 came from ${distinct.size} buildings`);
});

// -------------------------------------------------------- #24 diagnostics

const DIAG = {
  build: 'a3f9c21',
  controlling: true,
  term: '1268',
  termName: 'Autumn 2026',
  generated: '2026-08-30T07:41:12Z',
  ageDays: 5,
  stateKind: 'RANKED',
  rooms: 871,
  buildings: 96,
  sessions: 10,
  originSource: 'gps',
  accuracy: 32,
  originAgeS: 14,
  lat: 40.0022951,
  lon: -83.0158317,
  hoursSource: 'registrar',
  hoursGenerated: '2026-08-26',
  clock: '2026-09-04 14:02',
  zone: 'America/New_York',
  caches: ['vacant-shell-a3f9c21', 'vacant-data-1268'],
  room: {
    id: 'DL0357',
    type: '1B',
    cap: 46,
    building: '279',
    metres: 412,
    walk: 7,
    gapStart: 835,
    gapEnd: 970,
    session: 0,
    usable: 123,
  },
  dayName: 'Thu',
  busy: [[480, 535], [550, 605], [780, 835], [970, 1025]],
};

test('the block prints what a maintainer needs to reproduce a wrong answer', () => {
  const block = diagnosticsBlock(DIAG);
  for (const want of ['a3f9c21', '1268', 'Autumn 2026', '5 days old', '871 rooms', '96 buildings', '10 sessions',
    'gps', '+/-32 m', 'age 14 s', 'America/New_York', 'vacant-data-1268', 'DL0357', 'type 1B', 'cap 46',
    'bldg 279', '412 m -> 7 min', 'sess 0', 'usable 2h03']) {
    assert.ok(block.includes(want), `block is missing ${want}`);
  }
  assert.match(block, /busy Thu\s+8:00am-8:55am/);
});

test('no coordinate leaves the device unless it is ticked, and then only to 4 places', () => {
  const withheld = diagnosticsBlock(DIAG);
  assert.ok(withheld.includes('[location withheld]'));
  assert.doesNotMatch(withheld, /[0-9]{2}\.[0-9]/);

  const shared = diagnosticsBlock({ ...DIAG, includeLocation: true });
  assert.ok(shared.includes('40.0023, -83.0158'), shared);
  for (const hit of shared.match(/-?\d+\.\d+/g) ?? []) {
    const places = hit.split('.')[1].length;
    assert.ok(places <= 4, `${hit} carries ${places} decimal places`);
  }
});

test('a room carrying 57 weekly intervals still fits under the cap whole', () => {
  const busy = Array.from({ length: 57 }, (_, i) => [480 + i * 10, 485 + i * 10]);
  const block = diagnosticsBlock({ ...DIAG, busy });
  assert.ok(block.length <= 4000, `block is ${block.length} characters`);
  assert.doesNotMatch(block, /\.\.\. \d+ more/);
  assert.equal((block.match(/-/g) ?? []).length >= 57, true);
});

test('past the cap the busy list is what loses entries, and it says how many', () => {
  // An issue URL carrying a 4000 character block is already at the edge of what
  // survives a redirect, so the unbounded line is the one that gives way.
  const busy = Array.from({ length: 400 }, (_, i) => [480 + (i % 90) * 10, 485 + (i % 90) * 10]);
  const block = diagnosticsBlock({ ...DIAG, busy });
  assert.ok(block.length <= 4000, `block is ${block.length} characters`);
  assert.match(block, /\.\.\. \d+ more/);
  assert.ok(block.startsWith('build'), 'the head survives the cap');
  assert.ok(block.includes('DL0357'), 'the room line survives the cap');
});
