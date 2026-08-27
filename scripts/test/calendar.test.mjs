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
  examWindow,
  lowConfidence,
  parseFinalsWindow,
  parseFiveYear,
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
    { date: '2026-09-07', state: OFFICES_CLOSED },
    { date: '2026-10-15', state: NO_CLASSES },
    { date: '2026-10-16', state: NO_CLASSES },
    { date: '2026-11-11', state: OFFICES_CLOSED },
    { date: '2026-11-25', state: NO_CLASSES },
    { date: '2026-11-26', state: OFFICES_CLOSED },
    { date: '2026-11-27', state: OFFICES_CLOSED },
  ]);
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

test('a page with no tables parses to null rather than to an empty window', () => {
  assert.equal(parseFinalsWindow('<p>coming soon</p>', 2026), null);
  assert.deepEqual(parseIcs('nothing here'), []);
  assert.deepEqual(parseIcs(null), []);
});

test('the ICS agrees with the Registrar on Autumn 2026 and on nothing else', () => {
  // Measured 2026-08-27. The vendored ICS is a third-party regeneration of the
  // Registrar calendar and it is wrong outside Autumn: Martin Luther King Jr.
  // Day a day early in Spring, all three Summer holidays wrong, Summer finals
  // starting on a Sunday. This is why the build refuses instead of merging.
  const events = ics();
  assert.deepEqual(diffCalendars(parseFiveYear(fiveYear(), 'AUTUMN 2026'), events, AUTUMN), []);

  const spring = diffCalendars(parseFiveYear(fiveYear(), 'SPRING 2026'), events, SPRING);
  assert.deepEqual(spring, [
    '2026-01-18  registrar=nothing  ics=offices-closed',
    '2026-01-19  registrar=offices-closed  ics=nothing',
  ]);

  const summer = diffCalendars(parseFiveYear(fiveYear(), 'SUMMER 2026'), events, SUMMER);
  assert.equal(summer.length, 6);
  assert.ok(summer.some((l) => l.startsWith('2026-05-25  registrar=offices-closed')));
  assert.ok(summer.some((l) => l.startsWith('2026-05-31  registrar=nothing')));

  // And the Summer exam window, which is the one that would send someone into a
  // final: the ICS starts it on Sunday August 2.
  assert.deepEqual(examWindow(events, '2026-07-30'), { start: '2026-08-02', end: '2026-08-04' });
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
  assert.deepEqual(closedDays(events, AUTUMN), [{ date: '2026-11-26', state: OFFICES_CLOSED }]);
  assert.deepEqual(closedDays(events.slice().reverse(), AUTUMN), [
    { date: '2026-11-26', state: OFFICES_CLOSED },
  ]);
});

test('addDays crosses months and years without a timezone', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
});

test('the shipped index carries the calendar the issue asked for', () => {
  const d = index();
  assert.deepEqual(d.teaching, ['2026-08-25', '2026-12-09']);
  assert.equal(d.closed.length, 7);
  assert.deepEqual(d.exams, { start: '2026-12-11', end: '2026-12-17' });
  assert.deepEqual(d.lowConfidence, [
    { start: '2026-10-13', end: '2026-10-14', reason: 'session-1-finals' },
  ]);
  for (const day of d.closed) {
    assert.ok(day.date >= d.teaching[0] && day.date <= d.teaching[1], `${day.date} is outside the term`);
    assert.ok(day.state === OFFICES_CLOSED || day.state === NO_CLASSES, day.state);
  }
  assert.ok(d.exams.start > d.teaching[1], 'finals start after the last day of instruction');
  assert.equal(d.closed.filter((c) => c.state === NO_CLASSES).length, 3);
  assert.equal(d.closed.filter((c) => c.state === OFFICES_CLOSED).length, 4);
});

test('the vendored ICS ships with the date it was fetched', () => {
  const meta = JSON.parse(file('../../data/vendor/academic.meta.json'));
  assert.match(meta.fetched, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(meta.ics.source, /^https:\/\/mcmanning\.github\.io\//);
  assert.ok(meta.ics.events > 400);
});
