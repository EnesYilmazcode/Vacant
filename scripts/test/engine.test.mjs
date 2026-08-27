// Offline. Pure functions, no fixtures, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DETOUR,
  PACKUP,
  WALK_MPM,
  bestGap,
  distanceMetres,
  freeGaps,
  rank,
  usableMinutes,
  walkMinutes,
} from '../../js/engine.js';
import { haversineMetres } from '../lib/geo.mjs';

const at = (h, m = 0) => h * 60 + m;

test('the usable-minutes formula does not count corridor waiting as study time', () => {
  // The case that decides the whole differentiator. Gap 14:00-16:00, now 13:50,
  // a 6 minute walk. You arrive at 13:56 and wait 4 minutes for the previous
  // class to clear, so you get 120 minutes, not 124.
  const metres = 6 * WALK_MPM / DETOUR; // exactly a 6 minute walk
  const usable = usableMinutes({
    now: at(13, 50),
    gapStart: at(14),
    gapEnd: at(16),
    metres,
    packup: 0,
  });
  assert.equal(usable, 120);

  // The formula the README reached for. Kept as an explicit counter-assertion so
  // nobody quietly reintroduces it.
  const readmeAnswer = at(16) - at(13, 50) - walkMinutes(metres);
  assert.equal(readmeAnswer, 124);
  assert.notEqual(usable, readmeAnswer);
});

test('arriving after the gap has already started costs only the walk', () => {
  // now 14:30, gap 14:00-16:00, 6 minute walk: you arrive at 14:36 and the room
  // is already free, so there is no waiting to discount.
  const metres = 6 * WALK_MPM / DETOUR;
  assert.equal(
    usableMinutes({ now: at(14, 30), gapStart: at(14), gapEnd: at(16), metres, packup: 0 }),
    84,
  );
});

test('packup comes off the end, not the start', () => {
  const usable = usableMinutes({ now: at(14), gapStart: at(14), gapEnd: at(16), metres: 0 });
  assert.equal(usable, 120 - PACKUP);
});

test('a gap you cannot reach in time yields a non-positive number', () => {
  const metres = 60 * WALK_MPM / DETOUR; // an hour of walking
  assert.ok(usableMinutes({ now: at(15, 30), gapStart: at(14), gapEnd: at(16), metres }) <= 0);
});

test('walk time rounds up and includes the detour factor', () => {
  assert.equal(walkMinutes(0), 0);
  assert.equal(walkMinutes(78), 2, '78 m straight line is 101 m walked, so 2 minutes');
  assert.equal(walkMinutes(1), 1, 'never zero for a non-zero distance');
  assert.ok(walkMinutes(1000) > (1000 / WALK_MPM), 'the detour makes it longer than straight line');
});

test('equirectangular distance matches haversine at campus scale', () => {
  const oval = { lat: 39.9995, lon: -83.013 };
  for (const b of [
    { lat: 40.002295, lon: -83.015831 }, // Dreese
    { lat: 39.9986, lon: -83.0087 },
    { lat: 40.0075, lon: -83.0301 },
  ]) {
    const fast = distanceMetres(oval, b);
    const exact = haversineMetres(oval, b);
    assert.ok(Math.abs(fast - exact) < 1, `off by ${Math.abs(fast - exact).toFixed(3)} m`);
  }
});

test('distance is zero on itself and symmetric', () => {
  const a = { lat: 39.9995, lon: -83.013 };
  assert.equal(distanceMetres(a, a), 0);
  const b = { lat: 40.002295, lon: -83.015831 };
  assert.ok(Math.abs(distanceMetres(a, b) - distanceMetres(b, a)) < 1e-9);
});

test('free gaps are the complement of the busy blocks inside opening hours', () => {
  const busy = [
    [1, at(9), at(10)],
    [1, at(13), at(14)],
  ];
  assert.deepEqual(freeGaps(busy, 1, at(8), at(18)), [
    [at(8), at(9)],
    [at(10), at(13)],
    [at(14), at(18)],
  ]);
});

test('back-to-back classes do not produce a zero-length gap between them', () => {
  const busy = [
    [1, at(8), at(9)],
    [1, at(9), at(10)],
  ];
  assert.deepEqual(freeGaps(busy, 1, at(8), at(12)), [[at(10), at(12)]]);
});

test('overlapping bookings in the same room are merged, not double counted', () => {
  // Two sections booked over each other is real, and treating them as separate
  // blocks invents a gap between them.
  const busy = [
    [1, at(9), at(11)],
    [1, at(10), at(12)],
  ];
  assert.deepEqual(freeGaps(busy, 1, at(8), at(13)), [
    [at(8), at(9)],
    [at(12), at(13)],
  ]);
});

test('busy blocks are not assumed sorted', () => {
  const busy = [
    [1, at(13), at(14)],
    [1, at(9), at(10)],
  ];
  assert.deepEqual(freeGaps(busy, 1, at(8), at(18))[0], [at(8), at(9)]);
});

test('blocks are clipped to opening hours, and other days are ignored', () => {
  const busy = [
    [1, at(6), at(9)], // starts before open
    [2, at(10), at(11)], // a different day
  ];
  assert.deepEqual(freeGaps(busy, 1, at(8), at(18)), [[at(9), at(18)]]);
});

test('a room with no bookings is free for the whole opening window', () => {
  assert.deepEqual(freeGaps([], 1, at(7), at(22)), [[at(7), at(22)]]);
});

test('bestGap picks the longest usable gap, not the earliest', () => {
  const room = { busy: [[1, at(9), at(10)], [1, at(11), at(12)]] };
  const gap = bestGap(room, { now: at(8), day: 1, open: at(8), close: at(18), metres: 0 });
  assert.equal(gap.gapStart, at(12), 'the afternoon block is longer than 8-9 or 10-11');
  assert.equal(gap.usable, 360 - PACKUP);
});

test('bestGap ignores gaps that have already passed', () => {
  const room = { busy: [] };
  const gap = bestGap(room, { now: at(17), day: 1, open: at(8), close: at(18), metres: 0 });
  assert.equal(gap.usable, 60 - PACKUP);
  assert.equal(bestGap(room, { now: at(18), day: 1, open: at(8), close: at(18), metres: 0 }), null);
});

test('meetsNeed reflects the requested duration without filtering the room out', () => {
  const room = { busy: [] };
  const opts = { now: at(8), day: 1, open: at(8), close: at(9), metres: 0 };
  assert.equal(bestGap(room, { ...opts, needed: 30 }).meetsNeed, true);
  assert.equal(bestGap(room, { ...opts, needed: 120 }).meetsNeed, false, 'still returned, just flagged');
});

const BUILDINGS = {
  279: { name: 'Dreese Laboratories', lat: 40.002295, lon: -83.015831 },
  26: { name: 'Caldwell Laboratory', lat: 40.0018, lon: -83.0157 },
  999: { name: 'Nowhere Hall', lat: 40.0, lon: -83.0 },
};
const ORIGIN = { lat: 39.9995, lon: -83.013 };

test('a room whose building has no coordinates is dropped, never ranked', () => {
  const out = rank([{ id: 'XX0100', b: '404', busy: [] }], {
    origin: ORIGIN, now: at(9), day: 1, buildings: BUILDINGS,
  });
  assert.deepEqual(out, [], 'no coordinates means no walk time means no answer');
});

test('a building published as CLOSED removes the room; unknown hours does not', () => {
  const rooms = [{ id: 'DL0357', b: '279', busy: [] }];
  const base = { origin: ORIGIN, now: at(9), day: 6, buildings: BUILDINGS };

  const closed = rank(rooms, { ...base, hoursFor: () => null });
  assert.deepEqual(closed, [], 'published closed is a fact and it wins');

  const unknown = rank(rooms, { ...base, hoursFor: () => undefined });
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].hoursKnown, false, 'shown, and labelled as not published');
});

test('unknown hours never outrank a known-open building on the same walk', () => {
  // The ranking does the honesty here, not a label. 565 of 612 buildings have
  // no published hours, so this ordering is the majority path.
  const rooms = [
    { id: 'NW0100', b: '999', busy: [] },
    { id: 'DL0357', b: '279', busy: [] },
  ];
  const out = rank(rooms, {
    origin: ORIGIN,
    now: at(9),
    day: 1,
    buildings: BUILDINGS,
    hoursFor: (code) => (code === '279' ? [at(7), at(22)] : undefined),
  });
  assert.equal(out[0].building, '279', 'the building we know is open comes first');
  assert.equal(out[0].hoursKnown, true);
  assert.equal(out[1].hoursKnown, false);
});

test('rooms meeting the requested duration outrank closer rooms that do not', () => {
  const rooms = [
    { id: 'CL0177', b: '26', busy: [[1, at(9), at(17)]] }, // closer, barely free
    { id: 'DL0357', b: '279', busy: [] }, // further, wide open
  ];
  const out = rank(rooms, {
    origin: ORIGIN, now: at(9), day: 1, needed: 120, buildings: BUILDINGS,
    hoursFor: () => [at(8), at(18)],
  });
  assert.equal(out[0].id, 'DL0357');
  assert.equal(out[0].meetsNeed, true);
  assert.equal(out[1].meetsNeed, false);
});

test('a ranked row carries everything the result screen needs', () => {
  const out = rank([{ id: 'DL0357', b: '279', cap: 46, busy: [] }], {
    origin: ORIGIN, now: at(9), day: 1, buildings: BUILDINGS, hoursFor: () => [at(7), at(22)],
  });
  const row = out[0];
  assert.equal(row.id, 'DL0357');
  assert.equal(row.name, 'Dreese Laboratories');
  assert.equal(row.seats, 46);
  assert.ok(row.walk >= 1 && row.metres > 0);
  assert.equal(row.freeUntil, at(22));
  // The room is already free at 9:00, so usable is the window minus packup
  // minus the walk. Forgetting the walk here is the same mistake the README
  // formula makes, one level up.
  assert.equal(row.usable, at(22) - at(9) - PACKUP - row.walk);
  assert.ok(row.usable < at(22) - at(9) - PACKUP, 'the walk really is taken off');
});

test('a room with no seat count reports null rather than inventing one', () => {
  const [row] = rank([{ id: 'DL0357', b: '279', busy: [] }], {
    origin: ORIGIN, now: at(9), day: 1, buildings: BUILDINGS,
  });
  assert.equal(row.seats, null);
});
