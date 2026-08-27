// Offline. Hand-built meeting objects using the shapes recorded in
// docs/research/facility-types.md. No network, no fixtures on disk.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatFunnel,
  isRealRoom,
  newCounter,
  stripInstructors,
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

test('a CS-MARION section is dropped', () => {
  const c = newCounter();
  assert.equal(isRealRoom(meeting(), { location: 'CS-MARION' }, c), false);
  assert.equal(c.offCampus, 1);
});

test('the other real satellite locations are dropped too', () => {
  // All measured in the archives: CS-WOOSTER 148, CS-INTRNTL 159, CS-STONELB 12.
  for (const location of ['CS-WOOSTER', 'CS-INTRNTL', 'CS-STONELB', 'CS-WASHDC']) {
    const c = newCounter();
    assert.equal(isRealRoom(meeting(), { location }, c), false, location);
    assert.equal(c.offCampus, 1, location);
  }
});

test('a missing section, or one with no location, is dropped rather than thrown on', () => {
  const c = newCounter();
  assert.equal(isRealRoom(meeting(), undefined, c), false);
  assert.equal(isRealRoom(meeting(), {}, c), false);
  assert.equal(c.offCampus, 2);
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
  // 23 of these across both archives, all with a null standingMeetingPattern.
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
  assert.equal(c.badTime, 0, 'the weekday stage runs before the time stage');
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
  stripInstructors(m);
  assert.ok(!('instructors' in m), 'the key is gone, not just emptied');
  assert.ok(!/@osu\.edu/.test(JSON.stringify(m)));
  assert.doesNotThrow(() => stripInstructors(meeting()));
  assert.doesNotThrow(() => stripInstructors(null));
});

test('a serialised index built through the funnel has no pseudo-room and no address', () => {
  const rows = [
    { m: meeting({ instructors: [{ email: 'a.1@osu.edu' }] }), s: COL },
    { m: meeting({ facilityId: 'ONLINE', buildingCode: 'ONLINE' }), s: COL },
    { m: meeting({ facilityId: 'OFFCAMPUS', buildingCode: 'OFFCAMPUS' }), s: COL },
  ];
  const index = {};
  for (const { m, s } of rows) {
    stripInstructors(m);
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
  for (const k of ['meetings', 'blankFacilityId', 'pseudoRoom', 'offCampus', 'noWeekday', 'badTime', 'usable']) {
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
  isRealRoom(meeting(), { location: 'CS-WOOSTER' }, c);
  isRealRoom(meeting({ monday: false, wednesday: false }), COL, c);
  isRealRoom(meeting({ endTime: '7:00 am' }), COL, c);
  const sum =
    c.blankFacilityId + c.pseudoRoom + c.offCampus + c.noWeekday + c.badTime + c.usable;
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
