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
  tierOf,
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

test('a gap you can walk straight into beats a longer one you must wait for', () => {
  // This test used to assert the opposite, and the opposite is a bug: it sends
  // someone on a walk to a room that has a class in it, because that room's
  // afternoon gap is longer than the one free right now.
  const room = { busy: [[1, at(9), at(10)], [1, at(11), at(12)]] };
  const gap = bestGap(room, { now: at(8), day: 1, open: at(8), close: at(18), metres: 0 });
  assert.equal(gap.gapStart, at(8), 'the 8-9 window is open now');
  assert.equal(gap.wait, 0);
});

test('when nothing is open on arrival, the best later gap is offered with its wait', () => {
  const room = { busy: [[1, at(8), at(13)]] };
  const gap = bestGap(room, { now: at(9), day: 1, open: at(8), close: at(18), metres: 0 });
  assert.equal(gap.gapStart, at(13));
  assert.equal(gap.wait, at(13) - at(9), 'four hours of waiting, reported not hidden');
});

test('among gaps open on arrival, the one that meets the need wins, then length', () => {
  const room = { busy: [[1, at(9), at(10)], [1, at(14), at(15)]] };
  const gap = bestGap(room, {
    now: at(8), day: 1, open: at(8), close: at(18), metres: 0, needed: 30,
  });
  assert.equal(gap.wait, 0);
  assert.equal(gap.meetsNeed, true);
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
  assert.equal(row.nextClassAt, at(22));
  assert.equal(row.availableAt, at(7), 'already open when the query runs');
  assert.equal(row.wait, 0);
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

// --- regressions found by the PR #36 review ---

test('a room occupied right now never outranks one that is free now', () => {
  // The failure: you ask for two hours at 9:00, and are sent on a seven minute
  // walk to Dreese, which has a class in it until 13:00, because its afternoon
  // gap is longer than Caldwell's morning one.
  const rooms = [
    { id: 'CL0177', b: '26', busy: [[1, at(10, 45), at(18)]] }, // free now, 105 min
    { id: 'DL0357', b: '279', busy: [[1, at(9), at(13)]] }, // occupied now
  ];
  const out = rank(rooms, {
    origin: ORIGIN, now: at(9), day: 1, needed: 120, buildings: BUILDINGS,
    hoursFor: () => [at(8), at(18)],
  });
  assert.equal(out[0].id, 'CL0177', 'the room you can actually walk into');
  assert.equal(out[0].wait, 0);
  assert.ok(out[1].wait > 0, 'the occupied room is still offered, with its wait');
  assert.ok(out[0].tier < out[1].tier);
});

test('every row carries when the room opens and how long you would wait', () => {
  const [row] = rank([{ id: 'DL0357', b: '279', busy: [[1, at(9), at(13)]] }], {
    origin: ORIGIN, now: at(9), day: 1, buildings: BUILDINGS, hoursFor: () => [at(8), at(18)],
  });
  assert.equal(row.availableAt, at(13));
  assert.ok(row.wait > 0);
  // Without these two a result screen cannot tell "available now" from
  // "available from 1:00 PM" -- the rows are otherwise identical.
  assert.ok('availableAt' in row && 'wait' in row);
});

test('a geolocation fix that never resolved returns nothing, not NaN rooms', () => {
  // NaN <= 0 is false, so the old guard let every room through with NaN
  // minutes, and a NaN comparator makes Array.sort return arbitrary order.
  for (const origin of [{ lat: NaN, lon: NaN }, { lat: undefined, lon: -83 }, {}]) {
    const out = rank([{ id: 'DL0357', b: '279', busy: [] }], {
      origin, now: at(9), day: 1, buildings: BUILDINGS, hoursFor: () => [at(8), at(18)],
    });
    assert.deepEqual(out, [], JSON.stringify(origin));
  }
});

test('a building row with a null coordinate is dropped like a missing one', () => {
  const buildings = { ...BUILDINGS, 500: { name: 'Broken Hall', lat: null, lon: null } };
  const out = rank([{ id: 'BR0100', b: '500', busy: [] }], {
    origin: ORIGIN, now: at(9), day: 1, buildings, hoursFor: () => [at(8), at(18)],
  });
  assert.deepEqual(out, []);
});

test('an unknown-hours room never reports a usable figure', () => {
  // At 3am the old code said "free for 1243 minutes" in a building nobody knows
  // is open. A 0-1440 fallback IS an assumed window, and the most generous one
  // available, which the project decided explicitly against.
  const [row] = rank([{ id: 'X', b: '279', busy: [] }], {
    origin: ORIGIN, now: at(3), day: 1, buildings: BUILDINGS, hoursFor: () => undefined,
  });
  assert.equal(row.hoursKnown, false);
  assert.equal(row.usable, null, 'we cannot know when it locks, so we do not say');
  assert.equal(row.usableUntil, null);
  assert.equal(row.meetsNeed, null);
  assert.ok(row.nextClassAt != null, 'what we DO know is when the next class is');
});

test('usableUntil and usable agree; nextClassAt is the raw end', () => {
  const [row] = rank([{ id: 'DL0357', b: '279', busy: [] }], {
    origin: ORIGIN, now: at(9), day: 1, buildings: BUILDINGS, hoursFor: () => [at(8), at(18)],
  });
  assert.equal(row.nextClassAt, at(18));
  assert.equal(row.usableUntil, at(18) - PACKUP);
  // The inconsistency that made a countdown hand back the packup buffer.
  assert.equal(row.usable, row.usableUntil - at(9) - row.walk);
});

test('an inverted busy block is treated as busy, never as free', () => {
  // freeGaps([[1,840,600]], ...) used to return the whole day free. A meeting
  // crossing midnight, or any upstream time-parse glitch, produces this shape,
  // and reporting it free sends someone to a room with a class in it.
  const gaps = freeGaps([[1, at(14), at(10)]], 1, at(8), at(18));
  assert.notDeepEqual(gaps, [[at(8), at(18)]], 'the whole day is NOT free');
  assert.deepEqual(gaps, [[at(8), at(14)]], 'read conservatively as running to end of day');
  assert.equal(gaps.malformed, 1, 'and counted, so a build can assert on it');
});

test('a non-numeric busy time is counted and dropped rather than trusted', () => {
  const gaps = freeGaps([[1, NaN, at(10)], [1, at(12), at(13)]], 1, at(8), at(18));
  assert.equal(gaps.malformed, 1);
  assert.deepEqual(gaps, [[at(8), at(12)], [at(13), at(18)]]);
});

test('a day arriving as a string still matches its blocks', () => {
  // freeGaps is browser-facing and `day` comes out of a <select> or a query
  // string. A strict === matched nothing and reported the whole day free.
  assert.deepEqual(freeGaps([[1, at(9), at(10)]], '1', at(8), at(12)), [
    [at(8), at(9)],
    [at(10), at(12)],
  ]);
});

test('the tier order encodes both decisions the project already made', () => {
  const t = (hoursKnown, wait, meetsNeed) => tierOf({ hoursKnown, wait, meetsNeed });
  assert.equal(t(true, 0, true), 0);
  assert.equal(t(true, 0, false), 1);
  assert.equal(t(true, 60, true), 2);
  assert.equal(t(false, 0, null), 3);
  assert.equal(t(false, 60, null), 4);
  // Published hours beat unknown hours even when the unknown room is free now
  // and the published one is not.
  assert.ok(t(true, 60, true) < t(false, 0, null));
});
