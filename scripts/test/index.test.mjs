// Offline. Hand-built harvest records, no fixtures on disk, no network.
//
// The shapes here are copied from the real archives. The DL0280 rows are the
// nine timed bookings with no recoverable weekday, verbatim except for the
// instructors array the funnel strips.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { invert, termName } from '../build-index.mjs';

const SESSION = { startDate: '2026-05-11', endDate: '2026-07-30' };

const record = (m, over = {}) => ({
  classNumber: '4608',
  component: 'Laboratory',
  location: 'CS-COLMBUS',
  ...SESSION,
  ...over,
  m: { ...SESSION, ...m },
});

// Dreese Lab 280, a 44-seat computer teaching lab. Four Summer 2026 CSE lab
// slots, each cross-listed under a second course number, none carrying a day.
const dreese = (startTime, endTime) => ({
  meetingNumber: 1,
  facilityId: 'DL0280',
  facilityType: '2P',
  facilityGroup: false,
  facilityCapacity: 44,
  buildingCode: '279',
  room: '280',
  startTime,
  endTime,
  monday: false,
  tuesday: false,
  wednesday: false,
  thursday: false,
  friday: false,
  saturday: false,
  sunday: false,
  standingMeetingPattern: null,
});

const ordinary = (over = {}) => ({
  meetingNumber: 1,
  facilityId: 'DL0357',
  facilityType: '1B',
  facilityGroup: false,
  facilityCapacity: 46,
  buildingCode: '279',
  room: '357',
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

const LABS = [
  ['9:10 am', '10:05 am'],
  ['10:20 am', '11:15 am'],
  ['11:30 am', '12:25 pm'],
  ['12:40 pm', '1:35 pm'],
];

// The real archive carries each of the four twice, under CSE 2221/2231 and
// again under CSE 5022/5023.
const nineRows = () => [
  ...LABS.map(([s, e]) => record(dreese(s, e))),
  ...LABS.map(([s, e]) => record(dreese(s, e), { classNumber: '7153' })),
  record(
    {
      meetingNumber: 2,
      facilityId: 'DE0368',
      facilityType: '5J',
      facilityGroup: false,
      facilityCapacity: 0,
      buildingCode: '030',
      room: '368',
      startTime: '12:15 pm',
      endTime: '3:00 pm',
      monday: false,
      tuesday: false,
      wednesday: false,
      thursday: false,
      friday: false,
      saturday: false,
      sunday: false,
      standingMeetingPattern: null,
    },
    { classNumber: '24628' },
  ),
];

test('a timed booking with no weekday is blocked on all seven days, never left free', () => {
  // Issue #33. This is the failure the whole project exists to prevent: Dreese
  // 280 reading free all Summer morning while it teaches four CSE labs.
  const { rooms, stats } = invert(nineRows());

  assert.equal(stats.unplaceableBookings, 9);
  assert.deepEqual(stats.unplaceableIds, ['DE0368', 'DL0280']);

  const dl = rooms.DL0280;
  // Four distinct slots, deduped from the eight cross-listed rows.
  assert.equal(dl.unplaceable.length, 4);
  assert.deepEqual(
    dl.unplaceable.map(([s, e]) => [s, e]),
    [
      [550, 605],
      [620, 675],
      [690, 745],
      [760, 815],
    ],
  );

  // Every day, including the weekend, because nothing in the row says weekday.
  for (let day = 0; day < 7; day++) {
    const onDay = dl.busy.filter((b) => b[0] === day);
    assert.equal(onDay.length, 4, `day ${day}`);
  }
  assert.equal(dl.busy.length, 28);
});

test('the room the app would have called free reads busy at the lab hour', () => {
  const { rooms } = invert(nineRows());
  const covered = (day, minute) =>
    rooms.DL0280.busy.some((b) => b[0] === day && b[1] <= minute && minute < b[2]);

  // 9:30 am on a Wednesday, mid-lab. This was the lie.
  assert.equal(covered(3, 570), true);
  // And on a Saturday, which the payload does not rule out.
  assert.equal(covered(6, 570), true);
  // 2:00 pm is after the last slot ends, so the room is genuinely free again.
  assert.equal(covered(3, 840), false);
});

test('an unplaceable booking never fabricates a weekday for an ordinary room', () => {
  const { rooms } = invert([record(ordinary()), ...nineRows()]);
  assert.equal(rooms.DL0357.unplaceable, undefined);
  assert.deepEqual(
    rooms.DL0357.busy.map((b) => b[0]),
    [1, 3],
    'Monday and Wednesday only',
  );
});

test('unplaceable and placeable blocks in the same room merge like any other pair', () => {
  // DL0280 also teaches a real Tuesday class over the same window in this
  // fixture. The overlap folds rather than shipping twice.
  const real = record({ ...dreese('9:10 am', '10:05 am'), tuesday: true });
  const { rooms } = invert([real, record(dreese('9:10 am', '10:05 am'))]);
  assert.equal(rooms.DL0280.busy.filter((b) => b[0] === 2).length, 1);
  assert.equal(rooms.DL0280.unplaceable.length, 1);
});

test('a room reachable only through an unplaceable booking still enters the index', () => {
  const { rooms } = invert([record(dreese('9:10 am', '10:05 am'))]);
  assert.deepEqual(Object.keys(rooms), ['DL0280']);
  assert.equal(rooms.DL0280.cap, 44, 'the room record is built the same way');
  assert.equal(rooms.DL0280.type, '2P');
});

test('a no-weekday row with no usable time is dropped, not blocked', () => {
  // 19 of the 28 no-weekday rows across the archives are this. They hold no
  // occupancy, so blocking seven days on them would invent busy time.
  const { rooms, stats, counter } = invert([
    record(dreese(null, null)),
    record(dreese('9:10 am', '9:10 am')),
  ]);
  assert.deepEqual(rooms, {});
  assert.equal(stats.unplaceableBookings, 0);
  assert.equal(counter.noWeekday, 2);
  assert.equal(counter.noWeekdayTimed, 0);
});

test('the funnel counts the timed no-weekday rows separately, as the canary', () => {
  const { counter } = invert(nineRows());
  assert.equal(counter.noWeekday, 9);
  assert.equal(counter.noWeekdayTimed, 9, 'a jump here means the day became recoverable');
  assert.equal(counter.usable, 0);
});

test('an unplaceable booking outside the funnel building filter is dropped too', () => {
  const known = (code) => code === '279';
  const { rooms, stats } = invert(nineRows(), { isKnownBuilding: known });
  assert.equal(stats.unplaceableBookings, 8, 'Denney is building 030, not 279');
  assert.deepEqual(Object.keys(rooms), ['DL0280']);
});

test('an unplaceable booking brings its own session onto the table', () => {
  const { sessions, rooms } = invert([
    record({ ...ordinary(), startDate: '2026-05-11', endDate: '2026-07-02' }),
    record(dreese('9:10 am', '10:05 am')),
  ]);
  assert.deepEqual(sessions, [
    ['2026-05-11', '2026-07-02'],
    ['2026-05-11', '2026-07-30'],
  ]);
  assert.equal(rooms.DL0280.unplaceable[0][2], 1);
});

test('termName refuses a term it cannot name rather than guessing', () => {
  assert.equal(termName('1268'), 'Autumn 2026');
  assert.equal(termName('1262'), 'Spring 2026');
  assert.equal(termName('1264'), 'Summer 2026');
  assert.equal(termName('1263'), null);
});
