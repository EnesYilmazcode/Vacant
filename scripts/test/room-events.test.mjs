// Offline. The sweep's parsers on trimmed live markup, and the shipped file.
//
// The fixture is real SIS room matrix HTML from a sweep's own cache, cut down to
// sixteen rows. The sweep writes 425 gzipped pages, 5.2 MB, and they are not
// committed because they refetch in four minutes, so the shapes that matter are
// inlined here the way scripts/test/roomix.test.mjs does it. The free text on
// the event lines is the one thing changed: it is dropped at the parse boundary
// so nothing here reads it, and some of the real ones name a person.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  analyse,
  cacheName,
  classify,
  isInvalid,
  looksLikeSignon,
  parseGrid,
  parseHidden,
  parseRoom,
  splitBookings,
  toMinutes,
  unescapeHtml,
} from '../fetch-room-events.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------------------------------------------------------------- the fixture

const CLS = "class='PSLEVEL3GRIDODDROW'";
const GREEN = 'color:rgb(0,0,0);background-color:rgb(182,209,146);text-align: center;';
// The one background the page uses to mark a combined section or a time conflict.
const TAN = 'color:rgb(0,0,0);background-color:rgb(222,184,135);text-align: center;';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DATES = ['Aug 31', 'Sep 1', 'Sep 2', 'Sep 3', 'Sep 4', 'Sep 5', 'Sep 6'];

// The live header cell is "Monday<br>\rAug 31", with a bare carriage return in it.
const head = (days = DAYS) =>
  `<tr><th scope='col' align='center' ${CLS} >Time</th>` +
  days
    .map((d, i) => `<th scope='col' align='center' ${CLS} >${d}<br>\r${DATES[i] ?? ''}</th>`)
    .join('') +
  '</tr>';

const blank = `<td ${CLS}>&nbsp;</td>`;
const clock = (t) => `<td ${CLS} rowspan='4' scope="row"><span class='' >${t}</span></td>`;
const cell = (rowspan, lines, style = GREEN) =>
  `<td ${CLS} rowspan='${rowspan}' STYLE="${style}"><span class='' STYLE="${style}">${lines.join('<br>')}</span></td>`;
const row = (...tds) => `<tr>${tds.join('')}</tr>`;
const blanks = (n) => Array.from({ length: n }, () => blank);
const table = (rows) =>
  `<table cellspacing='0' cellpadding='2' width='100%' ${CLS} id='WEEKLY_SCHED_HTMLAREA' summary='Weekly Schedule'>` +
  `<colgroup span='1' width='9%' align='center' valign='middle'>` +
  `<colgroup span='7' width='13%' align='center' valign='middle'>${rows.join('')}</table>`;

const HERE = 'Enarson Classroom Building 204';
const klass = (id) => [`ENGR 1181 - ${id}`, 'Fund of Engr I', 'Lecture', '10:00AM - 12:00PM', HERE];
const TOUR = ['TOUR - Campus Tours', '( 000652112 )', '10:00AM - 12:00PM', HERE];
const MTG = ['MTG - Student Organization Meeting', '( 000657000 )', '1:00PM - 2:00PM', HERE];
// "ROOM     BLOCK - 38762" verbatim, five spaces and all.
const BLOCK = ['ROOM     BLOCK - 38762', 'Room Block', 'Workshop', '10:00AM - 12:00PM', HERE];
// A combined section: two bookings in one cell, split by an empty line and the
// page's own time-conflict icon, which strips to a second empty line.
const ICON =
  "<img border='0' src='/cs/ps/cache86209/PTADS_WARNING_ICN_1.gif' alt='Time Conflict' TITLE = 'Time Conflict'>";
const COMBINED = [
  'AGRCOMM 5530 - 30974', 'Adv Ag Com Tech', 'Lecture', '10:00AM - 12:00PM', HERE,
  '', ICON,
  'AGRCOMM 5530 - 30975', 'Adv Ag Com Tech', 'Lecture', '10:00AM - 12:00PM', HERE,
];

// Sixteen rows in the live shape. The six bare <tr></tr> rows are real: 22 of
// EC0204's 66 rows carry no <td> at all, because every column is still held by a
// rowspan from an earlier row.
const GRID = table([
  head(),
  row(clock('10:00AM'), cell(8, klass('11111')), cell(8, TOUR), cell(8, COMBINED, TAN),
    cell(8, klass('11112')), cell(8, klass('11113')), cell(8, BLOCK), cell(8, BLOCK)),
  row(), row(), row(),
  row(clock('11:00AM')),
  row(), row(), row(),
  row(clock('12:00PM'), ...blanks(7)),
  row(...blanks(7)),
  row(...blanks(7)),
  row(...blanks(7)),
  row(clock('1:00PM'), blank, blank, blank, cell(4, MTG), blank, blank, blank),
  row(...blanks(6)),
  row(...blanks(6)),
  row(...blanks(6)),
]);

const PAGE = `<html><body><form name='win0'>${GRID}</form></body></html>`;
// data/rooms-1268.json's own row for EC0204: building 072, room 204.
const EC0204 = { b: '072', n: '204' };
const run = (html = PAGE, where = EC0204, seen = new Map()) => parseRoom(html, 'EC0204', where, seen);

// ---------------------------------------------------------------- html helpers

test('entities decode after the tags are stripped, never before', () => {
  // A Registrar label containing an escaped &lt;b&gt; would be eaten as markup
  // the other way round, and the booking would silently lose a line.
  const html = table([
    head(),
    row(clock('10:00AM'), cell(4, ['MTG - A &lt;b&gt; Group', '( 000652112 )', '10:00AM - 11:00AM', HERE]), ...blanks(6)),
  ]);
  const { cells } = parseGrid(html);
  assert.equal(cells.length, 1);
  assert.ok(cells[0].text.startsWith('MTG - A <b> Group |'), cells[0].text);
});

test('unescapeHtml covers the three forms the page uses', () => {
  assert.equal(unescapeHtml('&amp;&lt;&gt;&quot;'), '&<>"');
  assert.equal(unescapeHtml('a&nbsp;b'), 'a b', 'nbsp is an ordinary space, not U+00A0');
  assert.equal(unescapeHtml('&#65;&#x42;'), 'AB');
  assert.equal(unescapeHtml('&bogus;'), '&bogus;', 'an unknown entity is left alone');
});

test('every hidden field is read, not the handful whose names we know', () => {
  // ICStateNum advances on every response and PeopleSoft rejects a replayed one,
  // and a field the POST fails to echo is a field the server misses. Reading the
  // tags rather than a list is the whole point.
  const html =
    "<input type='hidden' name='ICSID' id='ICSID' value='abc123' />" +
    "<input type='hidden' name='ICStateNum' id='ICStateNum' value='143' />" +
    '<input type="hidden" name="ICAction" value="None" />' +
    "<input type='hidden' name='ICStateNumSaved' value='' />" +
    "<input type='hidden' name='DERIVED_CLASS_S_MONDAY_LBL$30$$chk' value='Y' />" +
    "<input type='hidden' name='win0divTitle' value='A &amp; B' />" +
    "<input type='text' name='OSR_DERIVED_RM_FACILITY_ID' value='EC0204' />" +
    "<input type='checkbox' name='DERIVED_CLASS_S_MONDAY_LBL$30$' value=\"Y\" checked='checked' />";
  const hidden = parseHidden(html);
  assert.equal(hidden.size, 6, 'the text box and the checkbox are not hidden fields');
  assert.equal(hidden.get('ICStateNum'), '143');
  assert.equal(hidden.get('ICSID'), 'abc123');
  assert.equal(hidden.get('ICStateNumSaved'), '', 'an empty value is a value, not a missing field');
  assert.equal(hidden.get('DERIVED_CLASS_S_MONDAY_LBL$30$$chk'), 'Y', 'a $ in the name survives');
  assert.equal(hidden.get('win0divTitle'), 'A & B', 'decoded here, re-encoded by URLSearchParams');
  assert.equal(hidden.has('OSR_DERIVED_RM_FACILITY_ID'), false);
});

test('toMinutes puts noon at 720 and midnight at 0', () => {
  // The %12 is what makes 12PM 720 rather than 1440. Dropping it moves every
  // afternoon booking twelve hours.
  assert.equal(toMinutes('12', '00', 'AM'), 0);
  assert.equal(toMinutes('12', '30', 'PM'), 750);
  assert.equal(toMinutes('7', '00', 'AM'), 420);
  assert.equal(toMinutes('11', '00', 'PM'), 1380);
  assert.equal(toMinutes('1', '05', 'pm'), 785, 'the page is upper case but the regex is not');
});

// ---------------------------------------------------------------- grid parsing

test('a row with no <td> at all still runs the rowspan countdown', () => {
  // THE trap this parser exists to avoid. 22 of EC0204's 66 rows are a bare
  // <tr></tr>, emitted where every column is still covered by an earlier
  // rowspan. Skipping them leaves `held` too high for every later row, and the
  // next row's cells then either overflow the eight columns or land a day late.
  const { days, cells, overflow } = parseGrid(GRID);
  assert.equal(days.length, 7);
  assert.equal(overflow, 0, 'no row overflowed the 8-column grid');
  assert.equal(cells.length, 8, 'the opening row of seven, then the Thursday meeting');
  assert.deepEqual(cells.map((c) => c.dayLabel.split(' ')[0]),
    ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Thursday']);
  const mtg = run().occ.find((o) => o.type === 'MTG');
  assert.equal(mtg.day, 4, 'Thursday, counting Sunday as 0');
});

test('the time column never becomes a booking', () => {
  const { cells } = parseGrid(GRID);
  assert.equal(cells.some((c) => /^\d{1,2}:\d{2}(AM|PM)$/.test(c.text)), false,
    'a bare clock label as a cell means the time column drifted into the days');
});

test('a row with more cells than free columns is an error, never a guess', () => {
  // Drift files a booking under the wrong day and every number downstream still
  // looks plausible, so the parser refuses rather than pick a column.
  const bad = table([head(), row(clock('10:00AM'), ...blanks(8))]);
  assert.equal(parseGrid(bad).overflow, 1);
  assert.match(run(bad).error, /overflowed the 8-column grid/);
});

test('a day header that is not seven weekdays stops the parse', () => {
  const six = table([head(DAYS.slice(0, 6)), row(clock('10:00AM'), ...blanks(6))]);
  assert.match(run(six).error, /day header is/);
  const renamed = table([head(['Mon', ...DAYS.slice(1)]), row(clock('10:00AM'), ...blanks(7))]);
  assert.match(run(renamed).error, /expected seven weekdays/);
});

test('a response with no schedule table is noGrid, not an empty week', () => {
  // An empty week and a moved page look identical downstream, and only one of
  // them means the room is free.
  assert.deepEqual(run('<html><body>nothing here</body></html>'), { noGrid: true });
});

// ---------------------------------------------------------------- classifying

test('one cell can hold several bookings, split by an empty line', () => {
  assert.deepEqual(splitBookings('A | B | | C | D'), [['A', 'B'], ['C', 'D']]);
  assert.deepEqual(splitBookings('A | | | B'), [['A'], ['B']], 'the icon leaves a second empty line');
  assert.deepEqual(splitBookings(''), []);
  assert.deepEqual(splitBookings('A | B | '), [['A', 'B']], 'a trailing separator opens nothing');
});

test('the second line decides: nine digits in parentheses is an event', () => {
  assert.equal(classify(['TOUR - Campus Tours', '( 000652112 )', '10:15AM - 11:20AM', HERE]), 'event');
  assert.equal(classify(['ROOM     BLOCK - 33544', 'Room Block', 'Workshop', '11:30AM - 6:45PM', HERE]), 'block');
  // A class's second line is its title and its own number sits on line one with
  // five digits, not nine. Reading line one would make every class an event.
  assert.equal(classify(['ENGR 1181 - 11111', 'Fund of Engr I', 'Lecture', '8:00AM - 8:55AM', HERE]), 'class');
  assert.equal(classify(['MTG - x', '( 12345 )', '8:00AM - 8:55AM', HERE]), 'class',
    'five digits is not a reservation id');
  assert.equal(classify(['ROOM 204 SEMINAR', 'x', '8:00AM - 8:55AM', HERE]), 'class',
    'ROOM without BLOCK is not a room block');
});

// ---------------------------------------------------------------- room parsing

test('the fixture parses to the two events, the two blocks and nothing else', () => {
  const { occ, classCells, classBookings, combined } = run();
  assert.deepEqual(occ, [
    { kind: 'block', day: 0, start: 600, end: 720, type: null, eventId: '38762' },
    { kind: 'event', day: 2, start: 600, end: 720, type: 'TOUR', eventId: '000652112' },
    { kind: 'event', day: 4, start: 780, end: 840, type: 'MTG', eventId: '000657000' },
    { kind: 'block', day: 6, start: 600, end: 720, type: null, eventId: '38762' },
  ], 'sorted by day, Sunday first');
  // A combined-section cell is one cell and two bookings, so the two counters
  // are different numbers and neither may wear the other's name.
  assert.equal(classCells, 4, 'Monday, Wednesday, Thursday and Friday');
  assert.equal(classBookings, 5, 'Wednesday holds two');
  assert.equal(combined, 1, 'only the tan cell');
});

test('no free-text label survives parseRoom, only the type code', () => {
  // 23 of the 189 distinct event labels on the week of 08/31/2026 name a real
  // person and no heuristic separates those from the org names. The words are
  // dropped here, at the parse boundary, and this is what keeps them dropped.
  const { occ } = run();
  assert.deepEqual([...new Set(occ.flatMap((o) => Object.keys(o)))].sort(),
    ['day', 'end', 'eventId', 'kind', 'start', 'type']);
  const text = JSON.stringify(occ);
  for (const word of ['Campus Tours', 'Student Organization', 'Room Block', 'Workshop', 'Enarson', 'AGRCOMM']) {
    assert.equal(text.includes(word), false, `"${word}" reached the parsed output`);
  }
});

test('a block keeps its ROOM BLOCK number and an event its reservation id', () => {
  // Different id spaces. 8 block numbers cover 347 cells; 209 reservation ids
  // cover 327 events. Merging them collapses a term of blocks into one.
  const blocks = run().occ.filter((o) => o.kind === 'block');
  assert.deepEqual(blocks.map((o) => o.eventId), ['38762', '38762']);
  assert.equal(blocks.every((o) => o.type === null), true, 'a block has no type code');
});

test('TRAP 2: a grid naming another room is refused, whatever the response said', () => {
  // An unknown facility id makes the server re-render the PREVIOUS room's grid
  // with "Invalid value" dropped into the page. This check is independent of
  // that sentinel: every booking names its own building and room, so one room's
  // bookings cannot be filed under another room even if the sentinel moves.
  assert.match(run(PAGE, { b: '072', n: '322' }).error, /names room "204", expected "322"/);
});

test('TRAP 2: the building label is learned from the page, not from the repo', () => {
  // SIS abbreviates seven of the 46 buildings differently from the GIS names in
  // data/buildings-1268.json, so the repo's own names cannot be the reference.
  // An unfamiliar label is accepted the first time and pinned after that.
  const seen = new Map();
  const other = PAGE.split('Enarson Classroom Building').join('Enarson Class Bldg');
  assert.equal(run(other, EC0204, seen).error, undefined, 'a name the repo has never seen is fine');
  assert.equal(seen.get('072'), 'Enarson Class Bldg');
  assert.match(run(PAGE, EC0204, seen).error,
    /building 072 is "Enarson Classroom Building" here but was "Enarson Class Bldg" earlier/);
});

test('a booking with no time range stops the parse instead of being dropped', () => {
  const noTime = table([
    head(),
    row(clock('10:00AM'), cell(4, ['MTG - x', '( 000652112 )', HERE]), ...blanks(6)),
  ]);
  assert.match(run(noTime).error, /booking with no time range/);
});

test('TRAP 1: "Invalid value" is the sentinel, and it is not case folded', () => {
  assert.equal(isInvalid('<span>Invalid value</span>'), true);
  assert.equal(isInvalid(PAGE), false);
});

test('the cookie-error page is caught even though it arrives as a healthy 200', () => {
  // The reason this script keeps its own HTTP client. Without the jar echoed
  // across the redirect chain PeopleSoft answers 200 with this page, and a
  // parser reading it reports a campus with no events and no error.
  assert.equal(looksLikeSignon('<p>You must have cookies enabled to use this site.</p>'), true);
  assert.equal(looksLikeSignon('<td>An error has occurred.</td>'), true);
  assert.equal(looksLikeSignon(PAGE), false);
});

test('a facility id with a slash still gets its own cache file', () => {
  // FL2125/35 is one room made of two, and the slash is legal in a facility id
  // and not in a filename. A collision here overwrites one room's page with
  // another's and the sweep never notices.
  assert.equal(cacheName('FL2125/35'), 'FL2125_35');
  assert.equal(cacheName('EC0204'), 'EC0204');
  const ids = Object.keys(JSON.parse(readFileSync(join(ROOT, 'data', 'rooms-1268.json'), 'utf8')).rooms);
  assert.ok(ids.some((id) => /[^A-Za-z0-9]/.test(id)), 'the shipped index still carries the case this guards');
  assert.equal(new Set(ids.map(cacheName)).size, ids.length, 'no two rooms share a cache filename');
});

// ---------------------------------------------------------------- the analysis

const idx = (busy, sessions = [['2026-08-25', '2026-12-09']]) =>
  ({ term: '1268', sessions, rooms: { R1: { busy } } });

test('two overlapping blocks in one room are unioned, never added twice', () => {
  // Overlapping room-block reservations are the normal case, not the exception,
  // and summing them reports more busy minutes than the window holds.
  const a = analyse(idx([]), {
    R1: [
      { kind: 'block', day: 1, start: 1020, end: 1200, type: null, eventId: '1' },
      { kind: 'block', day: 1, start: 1080, end: 1260, type: null, eventId: '2' },
    ],
  }, '08/31/2026');
  const [weeknight] = a.windows;
  assert.equal(weeknight.windowMinutes, 1500, 'one room, five weeknights, five hours each');
  assert.equal(weeknight.freeMinutes, 1500, 'nothing in the index is busy');
  assert.equal(weeknight.blockMinutesInWindow, 240, '1020 to 1260 once, not 180 + 180');
  assert.equal(weeknight.blockPctOfFree, 16);
});

test('an occurrence overlapping a busy row does not count as landing in free time', () => {
  const rooms = {
    R1: [
      { kind: 'event', day: 1, start: 1030, end: 1100, type: 'MTG', eventId: 'a' },
      { kind: 'event', day: 2, start: 1030, end: 1100, type: 'MTG', eventId: 'b' },
    ],
  };
  const a = analyse(idx([[1, 1020, 1080, 0]]), rooms, '08/31/2026');
  assert.equal(a.landInFreeWindow.events, '1/2', 'Monday is covered, Tuesday is not');
});

test('a session that does not meet this week is ignored by the scoped pair', () => {
  // The claim is "Vacant calls this free". A busy row from a session that has
  // not started does not make the app call the room busy this week, so the
  // scoped number is the honest one and both are shipped.
  const rooms = { R1: [{ kind: 'event', day: 1, start: 1030, end: 1100, type: 'MTG', eventId: 'a' }] };
  const a = analyse(idx([[1, 1020, 1080, 0]], [['2026-10-19', '2026-12-09']]), rooms, '08/31/2026');
  assert.deepEqual(a.activeSessions, [], 'the only session starts seven weeks later');
  assert.equal(a.landInFreeWindow.events, '0/1');
  assert.equal(a.landInFreeWindow.eventsSessionScoped, '1/1');
});

test('the week is reported as the Monday and the Sunday it renders', () => {
  const a = analyse(idx([]), {}, '08/31/2026');
  assert.equal(a.weekStart, '2026-08-31');
  assert.equal(a.weekEnd, '2026-09-06');
});

// ---------------------------------------------------------- the shipped file

const shipped = JSON.parse(readFileSync(join(ROOT, 'data', 'room-events-1268.json'), 'utf8'));
const index = JSON.parse(readFileSync(join(ROOT, 'data', 'rooms-1268.json'), 'utf8'));
const records = Object.values(shipped.rooms).flat();

test('the shipped file is a full sweep of the shipped index, not a subset', () => {
  // --rooms writes room-events-<term>.subset.json for exactly this reason: a
  // three-room spot check used to land on this path and replace all 425.
  assert.equal(shipped._meta.partial, false);
  assert.equal(shipped._meta.term, '1268');
  assert.equal(shipped._meta.counts.roomsRequested, 425);
  assert.equal(shipped._meta.counts.roomsParsed, 425);
  assert.deepEqual(Object.keys(shipped.rooms).sort(), Object.keys(index.rooms).sort(),
    'every room in the index was swept, and nothing that is not in it');
});

test('a swept room with nothing on it keeps its key, so absent means not swept', () => {
  assert.equal(Object.keys(shipped.rooms).length, 425);
  assert.equal(Object.values(shipped.rooms).filter((v) => v.length).length, 215);
  assert.equal(Object.values(shipped.rooms).filter((v) => v.length === 0).length, 210,
    'an empty array is evidence of nothing; an absent key is no evidence');
  assert.equal(records.length, 674);
});

test('the headline counts are the ones the sweep measured', () => {
  // This is what catches a bad regeneration: either the numbers move together
  // or the parse collapsed.
  const c = shipped._meta.counts;
  assert.equal(c.events, 327);
  assert.equal(c.distinctEventIds, 209);
  assert.equal(c.roomsWithEvents, 174);
  assert.deepEqual(c.eventTypes, { MTG: 236, TOUR: 76, INFO: 8, WRKS: 6, SMNR: 1 });
  assert.equal(c.blockCells, 347);
  assert.equal(c.distinctBlockIds, 8);
  assert.equal(c.roomsWithBlocks, 56);
  assert.equal(c.invalidValue, 0);
  assert.equal(c.noGrid, 0);
  assert.deepEqual(shipped._meta.invalidValueRooms, []);
  assert.deepEqual(shipped._meta.noGridRooms, []);
  assert.equal(shipped._meta.requests, 427, '1 GET, 1 redirect hop, 425 POSTs');
  // Recounted from the records rather than trusted from the header.
  const events = records.filter((r) => r.kind === 'event');
  const blocks = records.filter((r) => r.kind === 'block');
  assert.equal(events.length, c.events);
  assert.equal(blocks.length, c.blockCells);
  assert.equal(new Set(events.map((e) => e.eventId)).size, c.distinctEventIds);
  assert.equal(new Set(blocks.map((b) => b.eventId)).size, c.distinctBlockIds);
  assert.equal(Object.values(shipped.rooms).filter((v) => v.some((o) => o.kind === 'event')).length,
    c.roomsWithEvents);
  assert.equal(Object.values(shipped.rooms).filter((v) => v.some((o) => o.kind === 'block')).length,
    c.roomsWithBlocks);
});

test('classes are counted and discarded, and the two class counters differ', () => {
  const c = shipped._meta.counts;
  assert.equal(c.classCellsSeenAndDiscarded, 8288);
  assert.equal(c.classBookingsSeenAndDiscarded, 9647);
  assert.equal(c.combinedSectionCells, 1124);
  assert.ok(c.classBookingsSeenAndDiscarded > c.classCellsSeenAndDiscarded,
    'a combined-section cell holds more than one booking');
  assert.equal(records.some((r) => r.kind === 'class'), false, 'no class reached the file');
});

test('the shipped file carries no free-text label and no raw field', () => {
  // The Registrar's booking labels name a person on 23 of 189 distinct strings
  // in one week. Only `type` survives, and this asserts it about the bytes that
  // ship rather than about the parser.
  const keys = new Set(records.flatMap((r) => Object.keys(r)));
  assert.deepEqual([...keys].sort(), ['day', 'end', 'eventId', 'kind', 'start', 'type']);
  for (const forbidden of ['label', 'raw', 'text', 'title', 'name', 'description', 'summary']) {
    assert.equal(keys.has(forbidden), false, `records carry a "${forbidden}" field`);
  }
  const json = readFileSync(join(ROOT, 'data', 'room-events-1268.json'), 'utf8');
  const body = json.slice(json.indexOf('"rooms":'));
  // The same three scans fetch-building-hours.mjs runs before it writes.
  assert.doesNotMatch(body, /\b\d{3}[-.]\d{3}[-.]\d{4}\b/, 'a phone number is in the file');
  assert.doesNotMatch(body, /[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+/, 'an email address is in the file');
  assert.doesNotMatch(body, /\b[a-z]+\.\d{1,4}\b/i, 'an OSU name.n identifier is in the file');
  assert.doesNotMatch(body, /(MTG|TOUR|INFO|WRKS|SMNR) - /, 'a raw label prefix is in the file');
});

test('the clock times come from the booking label, not from the query window', () => {
  // _meta.windowNote says a booking outside 7:00AM-11:00PM is "clipped to those
  // bounds". It is not: the grid places the cell inside the queried rows but the
  // cell's own label still carries the true times, and toMinutes reads the
  // label. One record on the week of 08/31/2026 starts at 390, which is 6:30AM.
  // Anything downstream that assumes a 420 floor is wrong about that room.
  const early = records.filter((r) => r.start < 7 * 60);
  assert.equal(early.length, 1, JSON.stringify(early));
  assert.equal(Math.min(...records.map((r) => r.start)), 390);
  assert.equal(Math.max(...records.map((r) => r.end)), 1380);
  assert.match(shipped._meta.windowNote, /7:00AM-11:00PM/);
});

test('every record is a weekday, a clock range and one of the five type codes', () => {
  for (const r of records) {
    assert.ok(Number.isInteger(r.day) && r.day >= 0 && r.day <= 6, JSON.stringify(r));
    assert.ok(r.start >= 0 && r.end <= 1440 && r.start < r.end, JSON.stringify(r));
    if (r.kind === 'event') {
      assert.ok(['MTG', 'TOUR', 'INFO', 'WRKS', 'SMNR'].includes(r.type), JSON.stringify(r));
      assert.match(r.eventId, /^\d{9}$/, 'a reservation id is nine digits');
    } else {
      assert.equal(r.kind, 'block');
      assert.equal(r.type, null);
      assert.match(r.eventId, /^\d+$/, 'a ROOM BLOCK number');
    }
  }
});

test('the week rendered is a Monday', () => {
  // The matrix renders Mon-Sun from whatever date it is handed. Any other day
  // renders seven days the caller did not ask for, and never says so.
  assert.match(shipped._meta.week, /^\d{2}\/\d{2}\/\d{4}$/);
  const [m, d, y] = shipped._meta.week.split('/');
  assert.equal(new Date(`${y}-${m}-${d}T12:00:00`).getDay(), 1, shipped._meta.week);
  assert.equal(shipped._analysis.weekStart, '2026-08-31');
  assert.equal(shipped._analysis.weekEnd, '2026-09-06');
});

test('the gap against the shipped index is the one that was measured', () => {
  // The reason the file exists: almost all of this occupancy lands in a window
  // Vacant currently calls entirely free.
  const a = shipped._analysis;
  assert.deepEqual(a.activeSessions, [0, 1], 'the third session starts 2026-10-19');
  assert.equal(a.landInFreeWindow.events, '323/327');
  assert.equal(a.landInFreeWindow.blocks, '343/347');
  assert.equal(a.landInFreeWindow.eventsSessionScoped, '327/327');
  const [weeknight, saturday] = a.windows;
  assert.equal(weeknight.freeMinutes, 588395);
  assert.equal(weeknight.blockMinutesInWindow, 62985);
  assert.equal(weeknight.blockPctOfFree, 10.7);
  assert.equal(saturday.freeMinutes, 356580);
  assert.equal(saturday.blockMinutesInWindow, 31920);
  assert.equal(saturday.blockPctOfFree, 8.95);
});

test('recomputing the analysis from the shipped rooms gives the shipped numbers', () => {
  // _analysis was written by the same run that wrote the rooms, so it can drift
  // from them silently. This recomputes it offline against the shipped index.
  const again = analyse(index, shipped.rooms, shipped._meta.week);
  assert.deepEqual(again.landInFreeWindow, shipped._analysis.landInFreeWindow);
  assert.deepEqual(again.windows, shipped._analysis.windows);
});
