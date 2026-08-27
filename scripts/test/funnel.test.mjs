// Offline. Hand-built meeting objects using the shapes recorded in
// docs/research/facility-types.md. No network, no fixtures on disk.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatFunnel,
  isRealRoom,
  isUnplaceable,
  newCounter,
  stripMeetingInstructors,
  toMinutes,
} from '../lib/funnel.mjs';

const COL = { location: 'CS-COLMBUS', component: 'Lecture' };

const meeting = (over = {}) => ({
  meetingNumber: 1,
  facilityId: 'DL0357',
  facilityType: '1B',
  buildingCode: '279',
  startTime: '8:00 am',
  endTime: '8:55 am',
  monday: true,
  tuesday: false,
  wednesday: true,
  thursday: false,
  friday: false,
  saturday: false,
  sunday: false,
  standingMeetingPattern: 'MW',
  ...over,
});

test('an ordinary Columbus classroom meeting is kept', () => {
  const c = newCounter();
  assert.equal(isRealRoom(meeting(), COL, c), true);
  assert.equal(c.usable, 1);
  assert.equal(c.meetings, 1);
});

test('a meeting with no facilityId is dropped, and null is the only blank seen', () => {
  const c = newCounter();
  assert.equal(isRealRoom(meeting({ facilityId: null }), COL, c), false);
  assert.equal(c.blankFacilityId, 1);
});

test('ONLINE is dropped even with a real day and a real time', () => {
  // The whole point: it carries a facilityId, weekday flags and clock times, so
  // nothing upstream of the pseudo check catches it. 4,574 of these in the two
  // archives.
  const online = meeting({ facilityId: 'ONLINE', buildingCode: 'ONLINE', facilityType: null });
  const c = newCounter();
  assert.equal(isRealRoom(online, COL, c), false);
  assert.equal(c.pseudoRoom, 1);
  assert.equal(c.blankFacilityId, 0, 'it is NOT caught by the blank check');
});

test('OFFCAMPUS is dropped', () => {
  const c = newCounter();
  const off = meeting({ facilityId: 'OFFCAMPUS', buildingCode: 'OFFCAMPUS' });
  assert.equal(isRealRoom(off, COL, c), false);
  assert.equal(c.pseudoRoom, 1);
});

test('a section location outside Columbus does NOT drop a real Columbus room', () => {
  // The regression this stage was removed for. Study-abroad and off-campus
  // program sections carry CS-INTRNTL or CS-COLOFF and still meet in an
  // ordinary main-campus classroom. Filtering on location dropped 22 of these,
  // all inside 0.7 km of the Oval, so the room never entered the index and the
  // app reported it free with a class sitting in it.
  for (const location of ['CS-INTRNTL', 'CS-COLOFF', 'CS-MARION', 'CS-WOOSTER']) {
    const c = newCounter();
    assert.equal(isRealRoom(meeting(), { location }, c), true, location);
    assert.equal(c.usable, 1, location);
  }
});

test('a room in a building we cannot place is dropped, and that is the real filter', () => {
  // Stone Laboratory, building 118, 185 km away on Lake Erie. Its sections
  // report location CS-STONELB, but the five Wooster buildings report
  // CS-COLMBUS, so only the building join catches all of them.
  const known = (code) => code === '279';
  const c = newCounter();
  assert.equal(isRealRoom(meeting({ buildingCode: '118' }), COL, c, { isKnownBuilding: known }), false);
  assert.equal(c.unknownBuilding, 1);
  assert.equal(isRealRoom(meeting({ buildingCode: '8002' }), COL, c, { isKnownBuilding: known }), false);
  assert.equal(c.unknownBuilding, 2, 'Wooster reports CS-COLMBUS, so only this stage catches it');
  assert.equal(isRealRoom(meeting(), COL, c, { isKnownBuilding: known }), true);
});

test('with no predicate the building stage is skipped, not silently failing open', () => {
  const c = newCounter();
  assert.equal(isRealRoom(meeting({ buildingCode: '118' }), COL, c), true);
  assert.equal(c.unknownBuilding, 0);
});

test('a missing or malformed section no longer drops the meeting', () => {
  assert.equal(isRealRoom(meeting(), undefined, newCounter()), true);
  assert.equal(isRealRoom(meeting(), {}, newCounter()), true);
});

test('a null or non-object meeting moves a counter instead of crashing', () => {
  for (const bad of [null, undefined, 42, 'x']) {
    const c = newCounter();
    assert.doesNotThrow(() => isRealRoom(bad, COL, c), JSON.stringify(bad));
    assert.equal(isRealRoom(bad, COL, newCounter()), false);
  }
  assert.doesNotThrow(() => stripMeetingInstructors(42));
  assert.doesNotThrow(() => stripMeetingInstructors('x'));
});

test('a pseudo-room is caught by facilityId even if buildingCode drifts', () => {
  // ONLINE already carries real weekday flags and clock times, so if its
  // buildingCode ever changes shape it would sail through every other stage and
  // become a 998-seat room in the grid.
  const c = newCounter();
  const drifted = meeting({ facilityId: 'ONLINE', buildingCode: '999' });
  assert.equal(isRealRoom(drifted, COL, c), false);
  assert.equal(c.pseudoRoom, 1);
});

test('Hybrid Delivery in a real room is kept', () => {
  // 81 of these. Filtering on instructionMode would delete every one.
  const m = meeting({ instructionMode: 'Hybrid Delivery' });
  assert.equal(isRealRoom(m, { ...COL, instructionMode: 'Hybrid Delivery' }, newCounter()), true);
});

test('Independent Study with a real room and a real weekly slot is kept', () => {
  const m = meeting({ facilityId: 'SM5097' });
  assert.equal(isRealRoom(m, { ...COL, component: 'Independent Study' }, newCounter()), true);
});

test('a Laboratory component in an ordinary classroom is kept', () => {
  // 296 of these sit in ordinary 1B rooms.
  assert.equal(isRealRoom(meeting(), { ...COL, component: 'Laboratory' }, newCounter()), true);
});

test('a room with no weekday flag at all is dropped', () => {
  // 28 of these across the three archives, all with a null
  // standingMeetingPattern.
  const c = newCounter();
  const noDay = meeting({
    monday: false,
    wednesday: false,
    standingMeetingPattern: null,
    startTime: null,
    endTime: null,
  });
  assert.equal(isRealRoom(noDay, COL, c), false);
  assert.equal(c.noWeekday, 1);
  assert.equal(c.noWeekdayTimed, 0, 'no clock window, so it holds no occupancy');
  assert.equal(c.badTime, 0, 'the weekday stage runs before the time stage');
});

test('a no-weekday row that DOES carry a clock window is counted apart', () => {
  // Issue #33. Nine of these exist and they are real occupancy, so the count
  // that matters is the timed one. A jump in it means the upstream shape moved.
  const c = newCounter();
  const dreese = meeting({
    facilityId: 'DL0280',
    monday: false,
    wednesday: false,
    standingMeetingPattern: null,
    startTime: '9:10 am',
    endTime: '10:05 am',
  });
  assert.equal(isRealRoom(dreese, COL, c), false, 'still not a placeable busy block');
  assert.equal(c.noWeekday, 1);
  assert.equal(c.noWeekdayTimed, 1);
  assert.match(formatFunnel(c), /noWeekday 1 \(1 timed\)/);
});

test('isUnplaceable picks up exactly the rows the app must not call free', () => {
  const noDay = (over = {}) =>
    meeting({ monday: false, wednesday: false, standingMeetingPattern: null, ...over });

  assert.equal(isUnplaceable(noDay()), true, 'real room, real window, no day');
  assert.equal(isUnplaceable(meeting()), false, 'Monday and Wednesday are placeable');
  assert.equal(isUnplaceable(noDay({ startTime: null })), false, 'no window, no occupancy');
  assert.equal(isUnplaceable(noDay({ endTime: '8:00 am' })), false, 'zero-length is not a booking');
  assert.equal(isUnplaceable(noDay({ endTime: '7:00 am' })), false, 'inverted is not a booking');
  assert.equal(isUnplaceable(noDay({ facilityId: null })), false);
  assert.equal(isUnplaceable(noDay({ facilityId: 'ONLINE', buildingCode: 'ONLINE' })), false);
  assert.equal(isUnplaceable(noDay({ buildingCode: 'OFFCAMPUS' })), false);
  for (const bad of [null, undefined, 42, 'x']) assert.equal(isUnplaceable(bad), false);

  const known = (code) => code === '279';
  assert.equal(isUnplaceable(noDay({ buildingCode: '118' }), { isKnownBuilding: known }), false);
  assert.equal(isUnplaceable(noDay(), { isKnownBuilding: known }), true);
});

test('standingMeetingPattern is never read as a weekday source', () => {
  // Measured over all 68,600 meetings in the three archives: non-null on 0 of
  // the 47,490 no-weekday rows, and disagreeing with the day flags on 135 of
  // the 3,741 rows carrying both. It is not a second source anywhere.
  const c = newCounter();
  const withPattern = meeting({
    monday: false,
    wednesday: false,
    standingMeetingPattern: 'MWF',
  });
  assert.equal(isRealRoom(withPattern, COL, c), false);
  assert.equal(c.noWeekday, 1);
});

test('unparseable, missing or inverted times are dropped as badTime', () => {
  for (const [start, end] of [
    [null, '9:00 am'],
    ['8:00 am', null],
    ['noon', '1:00 pm'],
    ['9:00 am', '8:00 am'],
    ['9:00 am', '9:00 am'],
  ]) {
    const c = newCounter();
    assert.equal(isRealRoom(meeting({ startTime: start, endTime: end }), COL, c), false, `${start}-${end}`);
    assert.equal(c.badTime, 1, `${start}-${end}`);
  }
});

test('toMinutes handles all four observed formats and both noon edges', () => {
  assert.equal(toMinutes('8:00 am'), 480);
  assert.equal(toMinutes('9:05 am'), 545);
  assert.equal(toMinutes('11:30 am'), 690);
  assert.equal(toMinutes('12:00 pm'), 720, 'noon is 720, not 1440');
  assert.equal(toMinutes('12:40 pm'), 760);
  assert.equal(toMinutes('12:00 am'), 0, 'midnight is 0, not 720');
  assert.equal(toMinutes('12:30 am'), 30);
  assert.equal(toMinutes('1:50 pm'), 830);
  assert.equal(toMinutes('11:59 pm'), 1439);
  assert.equal(toMinutes('8:00 AM'), 480, 'case insensitive');
});

test('toMinutes rejects rather than guesses', () => {
  for (const bad of [null, undefined, 42, '', 'noon', '25:00 am', '8:60 am', '0:30 am', '8:00', '8am']) {
    assert.equal(toMinutes(bad), null, JSON.stringify(bad));
  }
});

test('instructors are deleted at the parse boundary', () => {
  const m = meeting({ instructors: [{ email: 'buckeye.1@osu.edu', name: 'A' }] });
  stripMeetingInstructors(m);
  assert.ok(!('instructors' in m), 'the key is gone, not just emptied');
  assert.ok(!/@osu\.edu/.test(JSON.stringify(m)));
  assert.doesNotThrow(() => stripMeetingInstructors(meeting()));
  assert.doesNotThrow(() => stripMeetingInstructors(null));
});

test('a serialised index built through the funnel has no pseudo-room and no address', () => {
  const rows = [
    { m: meeting({ instructors: [{ email: 'a.1@osu.edu' }] }), s: COL },
    { m: meeting({ facilityId: 'ONLINE', buildingCode: 'ONLINE' }), s: COL },
    { m: meeting({ facilityId: 'OFFCAMPUS', buildingCode: 'OFFCAMPUS' }), s: COL },
  ];
  const index = {};
  for (const { m, s } of rows) {
    stripMeetingInstructors(m);
    if (!isRealRoom(m, s)) continue;
    index[m.facilityId] = { b: m.buildingCode, busy: [[1, toMinutes(m.startTime), toMinutes(m.endTime)]] };
  }
  const json = JSON.stringify(index);
  assert.equal(json.match(/ONLINE|OFFCAMPUS/g), null, 'no pseudo-room reaches the index');
  assert.equal(json.match(/[A-Za-z0-9._+-]+@osu\.edu/g), null, 'no address reaches the index');
  assert.deepEqual(Object.keys(index), ['DL0357']);
});

test('the funnel line prints every counter and the surviving ratio', () => {
  const c = newCounter();
  isRealRoom(meeting(), COL, c);
  isRealRoom(meeting({ facilityId: null }), COL, c);
  const line = formatFunnel(c);
  for (const k of ['meetings', 'blankFacilityId', 'pseudoRoom', 'unknownBuilding', 'noWeekday', 'badTime', 'usable']) {
    assert.match(line, new RegExp(k), `missing ${k}`);
  }
  assert.match(line, /usable 1 \(50\.0%\)/);
  assert.match(formatFunnel(newCounter()), /usable 0 \(0\.0%\)/, 'no divide by zero on an empty run');
});

test('the counters account for every meeting exactly once', () => {
  const c = newCounter();
  isRealRoom(meeting(), COL, c);
  isRealRoom(meeting({ facilityId: null }), COL, c);
  isRealRoom(meeting({ buildingCode: 'ONLINE' }), COL, c);
  isRealRoom(meeting({ buildingCode: 'ZZZ' }), COL, c, { isKnownBuilding: (x) => x === '279' });
  isRealRoom(meeting({ monday: false, wednesday: false }), COL, c);
  isRealRoom(meeting({ endTime: '7:00 am' }), COL, c);
  const sum =
    c.blankFacilityId + c.pseudoRoom + c.unknownBuilding + c.noWeekday + c.badTime + c.usable;
  assert.equal(sum, c.meetings);
  assert.equal(c.meetings, 6);
});

test('funnel.mjs imports nothing from node and calls no fetch', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../lib/funnel.mjs', import.meta.url), 'utf8');
  assert.ok(!/from 'node:/.test(src), 'no node builtins');
  assert.ok(!/\bfetch\s*\(/.test(src), 'no fetch');
  assert.ok(!/instructionMode\s*[!=]==/.test(src), 'instructionMode is never filtered on');
  assert.ok(!/\bcomponent\s*[!=]==/.test(src), 'component is never filtered on');
});
