// Registrar room holds (ROOM BLOCK) on the screens a student reads. Offline.
//
// The case that decided this: Lazenby Hall 001, an evening in November 2026.
// Classes ended at 2:05pm, the Room Matrix showed a "Room Block | Workshop"
// from 5:30pm to 11pm, and Vacant ignored it and said the room was free until
// the building locked. A student sat there from 5pm until a group that had
// booked the room inside that hold arrived at 7pm and asked them to leave.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { HOLD_LABEL, overlayForDate } from '../lib/club-occupancy.mjs';
import { rank } from '../../js/engine.js';
import { windowPhrase } from '../../js/state.js';
import { claimFor, holdsOn, timelineRows } from '../../js/room-timeline.js';
import { dayGridHtml } from '../../js/room-calendar.js';

const read = (rel) => JSON.parse(readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8'));
const INDEX = read('data/rooms-1268.json');
const BUILDINGS = read('data/buildings-1268.json').buildings;
const HOURS = read('data/buildings-hours.json').terms['autumn-2026-classroom-pool-building-schedule'];

// Wednesday 4 November 2026, the week the hold was observed, with the block
// exactly as the Room Matrix published it. Nothing else in the snapshot, so
// the test is about the hold and not about whatever else that week held.
const DATE = '2026-11-04';
const WED = new Date(2026, 10, 4, 17, 0);
const snapshot = {
  _meta: {
    term: '1268', weekStart: '2026-11-02', weekEnd: '2026-11-08', generated: '2026-11-01',
    source: 'https://courses.erppub.osu.edu/psc/ps/EMPLOYEE/PUB/c/OSR_CUSTOM_MENU.OSR_ROOM_MATRIX.GBL',
    partial: false,
  },
  rooms: {
    LZ0001: [{ kind: 'block', day: 3, start: 1050, end: 1380, type: null, eventId: '35693' }],
  },
};

const lazenby = () => {
  const index = { ...INDEX, rooms: { LZ0001: INDEX.rooms.LZ0001 } };
  return overlayForDate(index, snapshot, { date: DATE }).index;
};

const rankAt = (minute) => {
  const schedule = lazenby();
  const rooms = Object.entries(schedule.rooms).map(([id, r]) => ({ id, ...r }));
  return rank(rooms, {
    origin: { lat: BUILDINGS['041'].lat, lon: BUILDINGS['041'].lon },
    now: minute, day: 3, needed: 30, buildings: BUILDINGS,
    hoursFor: (code, day) => HOURS.buildings[code]?.hours[day],
    sessions: schedule.sessions, date: DATE, classesSuspended: false,
  });
};

test('Lazenby 001 at 5pm is free only until the hold, not until the doors lock', () => {
  // It used to come back usable for 349 minutes, to 10:50pm.
  const [row] = rankAt(17 * 60);
  assert.equal(row.usableUntil, 1040, 'packed up by 5:20pm, ten minutes before the hold');
  assert.equal(row.nextClassAt, 1050);
  assert.ok(row.usable < 30, `still offered for ${row.usable} minutes`);
  // At 3pm it is a real two-hour room, and the hold is what ends it.
  const [afternoon] = rankAt(15 * 60);
  assert.equal(afternoon.usableUntil, 1040);
  assert.ok(afternoon.usable > 120);
});

test('Lazenby 001 inside the hold is not offered at all', () => {
  assert.deepEqual(rankAt(19 * 60), [], 'a held room was offered at 7pm');
});

test('the room screen says "may be booked", never "in use" or a class name', () => {
  const schedule = lazenby();
  const room = schedule.rooms.LZ0001;
  const hours = HOURS.buildings['041'].hours[3];
  assert.deepEqual(holdsOn(room, WED, schedule), [[1050, 1380]]);

  const at7 = timelineRows(room, 'Lazenby', 19 * 60, WED, schedule, hours);
  assert.equal(claimFor(at7, 19 * 60, 100).head, 'May be booked till 11:00pm');

  const at5 = timelineRows(room, 'Lazenby', 17 * 60, WED, schedule, hours);
  const claim = claimFor(at5, 17 * 60, 100);
  assert.equal(claim.head, 'Free till 5:20pm');
  assert.match(claim.sub, /May be booked from 5:30pm/);

  const grid = dayGridHtml(room, 'Lazenby', WED, schedule, { hours, nowMin: 17 * 60, isToday: true });
  assert.ok(grid.includes(HOLD_LABEL), 'the calendar must draw the hold');
});

test('a class-ended window still reads the way it always did', () => {
  // The same room on the same afternoon with no hold in the snapshot.
  const schedule = overlayForDate({ ...INDEX, rooms: { LZ0001: INDEX.rooms.LZ0001 } },
    { ...snapshot, rooms: { LZ0001: [] } }, { date: DATE }).index;
  const room = schedule.rooms.LZ0001;
  const tl = timelineRows(room, 'Lazenby', 17 * 60, WED, schedule, HOURS.buildings['041'].hours[3]);
  const claim = claimFor(tl, 17 * 60, 100);
  assert.doesNotMatch(`${claim.head} ${claim.sub}`, /may be booked/i);
});

test('a row whose window ends at a hold says so, and one ending at a class does not', () => {
  const row = { wait: 0, hoursKnown: true, availableAt: 1020, usableUntil: 1040, nextClassAt: 1050, usable: 20 };
  const held = windowPhrase(row, 1380, 1050);
  assert.equal(held.text, 'free till 5:20pm, then may be booked');
  assert.match(held.say, /Registrar holds the room from/);
  assert.equal(windowPhrase(row, 1380, null).text, 'free till 5:20pm');
  assert.equal(windowPhrase(row, 1380, 1200).text, 'free till 5:20pm', 'a later hold is not the reason');
});
