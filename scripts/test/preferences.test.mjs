import { test } from 'node:test';
import assert from 'node:assert/strict';

import { roomFeatureLabels } from '../../js/preferences.js';

test('room labels use the user-facing vocabulary', () => {
  assert.deepEqual(roomFeatureLabels({ features: [44, 999, 32] }), [
    'Movable tables and chairs',
    'Whiteboards',
  ]);
});
