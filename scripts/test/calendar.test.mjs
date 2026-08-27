// Offline. The vendored ICS and the cached Registrar tables are read off disk;
// nothing here makes a request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  NO_CLASSES,
  OFFICES_CLOSED,
  addDays,
  closedDays,
  diffCalendars,
  eventName,
  examWindow,
  lowConfidence,
  parseFinalsWindow,
  parseFiveYear,
  parseFiveYearColumns,
  parseIcs,
  parseLongDates,
  stateOf,
  termWindow,
} from '../lib/calendar.mjs';

const file = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const ics = () => parseIcs(file('../../data/vendor/academic.ics'));
const fiveYear = () => file('../../data/cache/registrar/academic-calendar-5-year-view.html');
const index = () => JSON.parse(file('../../data/rooms-1268.json'));

const AUTUMN = ['2026-08-25', '2026-12-09'];
const SPRING = ['2026-01-12', '2026-04-27'];
const SUMMER = ['2026-05-11', '2026-07-30'];

test('DTEND is exclusive on a whole-day event', () => {
  // 20261015..20261017 is October 15 and 16. Reading it inclusive would put
  // Autumn Break on a day classes actually meet.
  const events = parseIcs(
    'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261015\r\n' +
      'DTEND;VALUE=DATE:20261017\r\nSUMMARY:Autumn Break - no classes\\, offices open\r\n' +
      'END:VEVENT\r\nEND:VCALENDAR\r\n',
  );
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].days, ['2026-10-15', '2026-10-16']);
  assert.equal(events[0].summary, 'Autumn Break - no classes, offices open');
});

test('an event with no DTEND is one day', () => {
  const events = parseIcs(
    'BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20260907\r\nSUMMARY:Labor Day - no classes\\, offices closed\r\nEND:VEVENT',
  );
  assert.deepEqual(events[0].days, ['2026-09-07']);
});

test('folded lines are unfolded before the fields are read', () => {
  // RFC 5545 folds anywhere and unfolds by deleting the CRLF and the one space
  // that follows, so the break here falls mid-word on purpose. The vendored
  // file has no folded lines today; this is here so it can grow some.
  const events = parseIcs(
    'BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261111\r\nSUMMARY:Veterans Day observed - no cla\r\n sses\\, offices closed\r\nEND:VEVENT',
  );
  assert.equal(events[0].summary, 'Veterans Day observed - no classes, offices closed');
  assert.equal(stateOf(events[0].summary), OFFICES_CLOSED);
});

test('September 7 comes out offices-closed and October 15 comes out no-classes', () => {
  // The one test the issue names, and the distinction the whole file exists
  // for. October 15 means free doors and free rooms, the best day of the term.
  // September 7 means the same rooms behind locked doors.
  const closed = closedDays(ics(), AUTUMN);
  const at = (date) => closed.find((c) => c.date === date)?.state;
  assert.equal(at('2026-09-07'), OFFICES_CLOSED);
  assert.equal(at('2026-10-15'), NO_CLASSES);
  assert.equal(at('2026-10-16'), NO_CLASSES);
});

test('a row that names neither state is not classified', () => {
  // "Spring Break" says nothing about offices, so it does not ship. Those five
  // days read busy, which is wrong in the safe direction. Recorded in
  // DECISIONS.md rather than guessed at here.
  assert.equal(stateOf('Spring Break'), null);
  assert.equal(stateOf('Second-session classes begin'), null);
  assert.equal(stateOf('Labor Day - no classes, offices closed'), OFFICES_CLOSED);
  assert.equal(stateOf('Autumn Break - no classes, offices open'), NO_CLASSES);
  assert.equal(stateOf(null), null);
});

test('the five-year view reads one term out of one column', () => {
  const autumn = parseFiveYear(fiveYear(), 'AUTUMN 2026');
  assert.ok(autumn.length >= 20, `only ${autumn.length} rows`);
  const closed = closedDays(autumn, AUTUMN);
  assert.deepEqual(closed, [
    { date: '2026-09-07', state: OFFICES_CLOSED, name: 'Labor Day' },
    { date: '2026-10-15', state: NO_CLASSES, name: 'Autumn Break' },
    { date: '2026-10-16', state: NO_CLASSES, name: 'Autumn Break' },
    { date: '2026-11-11', state: OFFICES_CLOSED, name: 'Veterans Day observed' },
    { date: '2026-11-25', state: NO_CLASSES, name: 'Thanksgiving Break begins' },
    { date: '2026-11-26', state: OFFICES_CLOSED, name: 'Thanksgiving Day' },
    {
      date: '2026-11-27',
      state: OFFICES_CLOSED,
      name: "Indigenous Peoples' Day/Columbus Day observed",
    },
  ]);
});

test('the holiday name is cut off the row whether or not a dash separates it', () => {
  // A refusal that says "Thanksgiving Day, campus is closed" is a fact a
  // student can check. "Campus is closed today" is the app asking to be
  // believed. The Indigenous Peoples' Day row runs the two halves together with
  // no punctuation at all, which is why the state words are cut as well.
  assert.equal(eventName('Labor Day - no classes, offices closed'), 'Labor Day');
  assert.equal(
    eventName("Indigenous Peoples' Day/Columbus Day observed no classes, offices closed"),
    "Indigenous Peoples' Day/Columbus Day observed",
  );
  assert.equal(eventName("President's Day Observed - offices closed"), "President's Day Observed");
  assert.equal(eventName('Autumn Break - no classes, offices open'), 'Autumn Break');
  assert.equal(eventName(null), null);
});

test('a column that is not on the page parses to nothing rather than to the wrong term', () => {
  assert.deepEqual(parseFiveYear(fiveYear(), 'AUTUMN 2099'), []);
  assert.deepEqual(parseFiveYear('<p>no tables</p>', 'AUTUMN 2026'), []);
});

test('the winter recess row is a range, not two days', () => {
  assert.deepEqual(parseLongDates('Monday, December 28, 2026 - Thursday, December 31, 2026'), [
    '2026-12-28',
    '2026-12-29',
    '2026-12-30',
    '2026-12-31',
  ]);
  assert.deepEqual(parseLongDates('Monday, September 7, 2026'), ['2026-09-07']);
  assert.deepEqual(parseLongDates('Not Applicable'), []);
});

test('the teaching window comes from the Registrar, not from meeting dates', () => {
  // Anatomy 6511 runs to 2026-12-11 and Pharmacy 7110 to 2026-12-10, both past
  // the last day of instruction, because the professional colleges keep their
  // own calendars. Taking the max over meetings stretches the term through the
  // exam window it is supposed to end before.
  assert.deepEqual(termWindow(parseFiveYear(fiveYear(), 'AUTUMN 2026')), {
    first: '2026-08-25',
    last: '2026-12-09',
  });
  assert.deepEqual(termWindow(parseFiveYear(fiveYear(), 'SPRING 2026')), {
    first: '2026-01-12',
    last: '2026-04-27',
  });
  assert.deepEqual(termWindow(parseFiveYear(fiveYear(), 'SUMMER 2026')), {
    first: '2026-05-11',
    last: '2026-07-30',
  });
});

test('the exam window starts after the last day of instruction, for all three terms', () => {
  for (const [column, expected] of [
    ['AUTUMN 2026', { start: '2026-12-11', end: '2026-12-17' }],
    ['SPRING 2026', { start: '2026-04-29', end: '2026-05-05' }],
    ['SUMMER 2026', { start: '2026-08-03', end: '2026-08-05' }],
  ]) {
    const rows = parseFiveYear(fiveYear(), column);
    const exams = examWindow(rows);
    const window = termWindow(rows);
    assert.deepEqual(exams, expected, column);
    assert.ok(exams.start > window.last, `${column}: ${exams.start} is not after ${window.last}`);
  }
});

test('the finals page gives the same window, read two ways on the same page', () => {
  // "Monday Dec 14" in the three lookup tables and "Monday 12/14" in the matrix
  // header. Reading both means a change to one spelling is caught by the other.
  const autumn = parseFinalsWindow(file('../../data/cache/registrar/autumn-2026-finals-schedule.html'), 2026);
  assert.deepEqual(autumn.days, [
    '2026-12-11',
    '2026-12-14',
    '2026-12-15',
    '2026-12-16',
    '2026-12-17',
  ]);
  const spring = parseFinalsWindow(file('../../data/cache/registrar/spring-2027-finals-schedule.html'), 2027);
  assert.equal(spring.start, '2027-04-28');
  assert.equal(spring.end, '2027-05-04');
});

test('the Summer finals page writes the same day three other ways', () => {
  // "Monday, August 3" in its lookup tables and "Monday August 3, 2026" in its
  // matrix header, where Autumn writes "Monday Dec 14" and "Monday 12/14".
  // Requiring Autumn's spelling parsed this page to zero days, and a finals
  // page that parses to nothing kills the build that fetched it.
  const summer = parseFinalsWindow(file('../../data/cache/registrar/summer-2026-finals-schedule.html'), 2026);
  assert.deepEqual(summer.days, ['2026-08-03', '2026-08-04', '2026-08-05']);

  // The three Registrar sources for that window, and they agree exactly.
  const rows = parseFiveYear(fiveYear(), 'SUMMER 2026');
  assert.deepEqual(examWindow(rows, termWindow(rows).last), { start: summer.start, end: summer.end });

  // A year on the cell has to be the year asked for, or the page is not the
  // term it was cached as.
  assert.equal(parseFinalsWindow('<table><tr><td>Monday August 3, 2026</td></tr></table>', 2027), null);
});

test('a page with no tables parses to null rather than to an empty window', () => {
  assert.equal(parseFinalsWindow('<p>coming soon</p>', 2026), null);
  assert.deepEqual(parseIcs('nothing here'), []);
  assert.deepEqual(parseIcs(null), []);
});

test('the ICS agrees with the Registrar on Autumn 2026 and slides everywhere else', () => {
  // Measured 2026-08-27. The vendored ICS is a third-party regeneration of the
  // Registrar calendar and it is wrong outside Autumn: Martin Luther King Jr.
  // Day a day early in Spring, all three Summer holidays wrong, Summer finals
  // starting on a Sunday.
  const events = ics();
  const autumn = diffCalendars(parseFiveYear(fiveYear(), 'AUTUMN 2026'), events, AUTUMN);
  assert.deepEqual(autumn, { shifted: [], unexplained: [] });

  const spring = diffCalendars(parseFiveYear(fiveYear(), 'SPRING 2026'), events, SPRING, {
    tolerance: 7,
  });
  assert.deepEqual(spring.unexplained, []);
  assert.deepEqual(spring.shifted, [
    'Martin Luther King Jr. Day: registrar 2026-01-19, ics 2026-01-18, 1 day(s) off',
  ]);

  const summer = diffCalendars(parseFiveYear(fiveYear(), 'SUMMER 2026'), events, SUMMER, {
    tolerance: 7,
  });
  assert.deepEqual(summer.unexplained, []);
  assert.equal(summer.shifted.length, 3);
  assert.ok(summer.shifted.some((l) => l.startsWith('Memorial Day: registrar 2026-05-25, ics 2026-05-31, 6')));

  // With no tolerance every one of those is news, which is what the build
  // fed the ICS before Spring and Summer stopped building at all.
  assert.equal(diffCalendars(parseFiveYear(fiveYear(), 'SUMMER 2026'), events, SUMMER).unexplained.length, 6);

  // And the Summer exam window, which is the one that would send someone into a
  // final: the ICS starts it on Sunday August 2.
  assert.deepEqual(examWindow(events, '2026-07-30'), { start: '2026-08-02', end: '2026-08-04' });
});

test('every Spring and Summer column on the page is a slid holiday, never a new one', () => {
  // The measurement the ICS_SHIFT_DAYS table in build-index.mjs rests on. All
  // fifteen columns of the committed five-year view, diffed against the
  // vendored ICS: Autumn is identical five years running, and every one of the
  // 30 Spring and Summer disagreements pairs up as the same holiday on a
  // nearby day. Nothing is left over. If that ever stops being true, the build
  // is meant to refuse and this is the test that says so first.
  const events = ics();
  const html = fiveYear();
  const columns = parseFiveYearColumns(html);
  assert.equal(columns.length, 15);

  let shifted = 0;
  for (const column of columns) {
    const rows = parseFiveYear(html, column);
    const w = termWindow(rows);
    assert.ok(w, `${column} has no teaching window`);
    const tolerance = column.startsWith('AUTUMN') ? 0 : 7;
    const d = diffCalendars(rows, events, [w.first, w.last], { tolerance });
    assert.deepEqual(d.unexplained, [], `${column} has a disagreement no slide explains`);
    shifted += d.shifted.length;
  }
  assert.equal(shifted, 15);
});

test('a holiday the ICS invents is never explained away as a slide', () => {
  const registrar = [{ summary: 'Labor Day - no classes, offices closed', days: ['2026-09-07'] }];
  const far = [{ summary: 'Labor Day - no classes, offices closed', days: ['2026-09-21'] }];
  const both = [
    ...registrar,
    { summary: 'Something - no classes, offices closed', days: ['2026-10-20'] },
  ];

  // Outside the tolerance, so it is news rather than a slide.
  assert.deepEqual(diffCalendars(registrar, far, AUTUMN, { tolerance: 7 }).unexplained, [
    '2026-09-07  registrar=offices-closed  ics=nothing',
    '2026-09-21  registrar=nothing  ics=offices-closed',
  ]);

  // An extra day with no partner at all.
  assert.deepEqual(diffCalendars(registrar, both, AUTUMN, { tolerance: 7 }).unexplained, [
    '2026-10-20  registrar=nothing  ics=offices-closed',
  ]);

  // Same day, two states. A locked door against an open one is never a slide.
  const open = [{ summary: 'Labor Day - no classes, offices open', days: ['2026-09-07'] }];
  assert.deepEqual(diffCalendars(registrar, open, AUTUMN, { tolerance: 7 }), {
    shifted: [],
    unexplained: ['2026-09-07  registrar=offices-closed  ics=no-classes'],
  });
});

test('contiguous session-1 final days merge into one window', () => {
  // The five-year view writes one row per exam day and the ICS writes a range.
  // Both have to land on the same shape or the diff is noise.
  const expected = [{ start: '2026-10-13', end: '2026-10-14', reason: 'session-1-finals' }];
  assert.deepEqual(lowConfidence(parseFiveYear(fiveYear(), 'AUTUMN 2026'), AUTUMN), expected);
  assert.deepEqual(lowConfidence(ics(), AUTUMN), expected);
});

test('offices-closed wins when two rows land on the same day', () => {
  const events = [
    { summary: 'Something - no classes, offices open', days: ['2026-11-26'] },
    { summary: 'Thanksgiving Day - no classes, offices closed', days: ['2026-11-26'] },
  ];
  const expected = [{ date: '2026-11-26', state: OFFICES_CLOSED, name: 'Thanksgiving Day' }];
  assert.deepEqual(closedDays(events, AUTUMN), expected);
  assert.deepEqual(closedDays(events.slice().reverse(), AUTUMN), expected);
});

test('addDays crosses months and years without a timezone', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
});

test('the shipped index carries the calendar the issue asked for', () => {
  const d = index();
  assert.deepEqual(d.teaching, ['2026-08-25', '2026-12-09']);
  assert.deepEqual(d.exams, { start: '2026-12-11', end: '2026-12-17' });
  assert.deepEqual(d.lowConfidence, [
    { start: '2026-10-13', end: '2026-10-14', reason: 'session-1-finals' },
  ]);

  // Keyed by date. A screen asking "is today closed" does one lookup, and a
  // reader that thinks it is a list gets undefined rather than a wrong answer.
  const days = Object.entries(d.closed);
  assert.equal(days.length, 7);
  assert.equal(d.closed['2026-11-26'].name, 'Thanksgiving Day');
  for (const [date, day] of days) {
    assert.ok(date >= d.teaching[0] && date <= d.teaching[1], `${date} is outside the term`);
    assert.ok(day.state === OFFICES_CLOSED || day.state === NO_CLASSES, day.state);
    assert.ok(day.name && day.name.length > 2, `${date} ships with no holiday name`);
  }
  assert.ok(d.exams.start > d.teaching[1], 'finals start after the last day of instruction');
  assert.equal(days.filter(([, c]) => c.state === NO_CLASSES).length, 3);
  assert.equal(days.filter(([, c]) => c.state === OFFICES_CLOSED).length, 4);
});

test('the vendored ICS ships with the date it was fetched', () => {
  const meta = JSON.parse(file('../../data/vendor/academic.meta.json'));
  assert.match(meta.fetched, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(meta.ics.source, /^https:\/\/mcmanning\.github\.io\//);
  assert.ok(meta.ics.events > 400);
});
