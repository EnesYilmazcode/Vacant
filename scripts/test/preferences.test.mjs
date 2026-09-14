import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  describeRoomPreferences,
  filterRoomsByPreferences,
  hasRoomPreferences,
  normalizeRoomPreferences,
  roomFeatureCoverage,
  roomFeatureLabels,
  roomMatchesPreferences,
} from '../../js/preferences.js';

test('normalization removes invalid requirements and repeated features', () => {
  assert.deepEqual(
    normalizeRoomPreferences({
      minSeats: '40',
      features: ['windows', 'made-up', 'windows', 'whiteboards'],
    }),
    { minSeats: 40, features: ['windows', 'whiteboards'] },
  );
  assert.deepEqual(normalizeRoomPreferences({ minSeats: '-2', features: null }), {
    minSeats: 0,
    features: [],
  });
  assert.equal(normalizeRoomPreferences({ minSeats: '1e2' }).minSeats, 100);
  assert.equal(normalizeRoomPreferences({ minSeats: '40.1' }).minSeats, 41);
});

test('an unknown capacity does not satisfy a minimum-seat requirement', () => {
  assert.equal(roomMatchesPreferences({ cap: 0 }, { minSeats: 1 }), false);
  assert.equal(roomMatchesPreferences({ cap: 998 }, { minSeats: 20 }), false);
  assert.equal(roomMatchesPreferences({}, { minSeats: 1 }), false);
  assert.equal(roomMatchesPreferences({ cap: 39 }, { minSeats: 40 }), false);
  assert.equal(roomMatchesPreferences({ cap: 40 }, { minSeats: 40 }), true);
});

test('every checked room feature is required', () => {
  const room = { cap: 48, features: [32, 39, 44] };
  assert.equal(roomMatchesPreferences(room, { features: ['movable-tables'] }), true);
  assert.equal(roomMatchesPreferences(room, { features: ['movable-tables', 'windows'] }), true);
  assert.equal(roomMatchesPreferences(room, { features: ['movable-tables', 'chalkboards'] }), false);
});

test('missing feature data is unknown and never passes a feature requirement', () => {
  assert.equal(roomMatchesPreferences({ cap: 40 }, { features: ['whiteboards'] }), false);
  assert.equal(roomMatchesPreferences({ cap: 40 }, {}), true);
});

test('filtering preserves the ranking input order', () => {
  const rooms = [
    { id: 'first', cap: 50, features: [39, 44] },
    { id: 'second', cap: 80, features: [39, 43] },
    { id: 'third', cap: 60, features: [39, 44] },
  ];
  assert.deepEqual(
    filterRoomsByPreferences(rooms, { minSeats: 55, features: ['windows', 'whiteboards'] })
      .map((room) => room.id),
    ['third'],
  );
});

test('coverage distinguishes missing data from a published empty list', () => {
  assert.deepEqual(roomFeatureCoverage([{ features: [] }, {}, { features: [32] }]), {
    known: 2,
    total: 3,
  });
});

test('descriptions and room labels use the user-facing vocabulary', () => {
  assert.equal(hasRoomPreferences({}), false);
  assert.equal(hasRoomPreferences({ minSeats: 20 }), true);
  assert.deepEqual(
    describeRoomPreferences({ minSeats: 20, features: ['movable-tables', 'whiteboards'] }),
    ['20+ seats', 'movable tables and chairs', 'whiteboards'],
  );
  assert.deepEqual(roomFeatureLabels({ features: [44, 999, 32] }), [
    'Movable tables and chairs',
    'Whiteboards',
  ]);
});
