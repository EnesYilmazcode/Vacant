import { test } from 'node:test';
import assert from 'node:assert/strict';

import { driftSummary, occupiedRoomDays, scheduleDrift } from '../report-schedule-drift.mjs';

const index = (rooms) => ({ rooms });

test('schedule drift compares occupied room-days rather than mutable room totals', () => {
  const before = index({
    AA0101: { busy: [[1, 480, 535, 0], [2, 600, 655, 0]] },
    BB0202: { busy: [[3, 720, 775, 0]] },
  });
  const after = index({
    AA0101: { busy: [[1, 500, 555, 0], [4, 600, 655, 0]] },
    CC0303: { busy: [] },
  });

  assert.deepEqual([...occupiedRoomDays(before)].sort(), ['Mon AA0101', 'Tue AA0101', 'Wed BB0202']);
  assert.deepEqual(scheduleDrift(before, after), {
    added: ['Thu AA0101'],
    removed: ['Tue AA0101', 'Wed BB0202'],
    beforeRooms: 2,
    afterRooms: 2,
  });
});

test('the workflow summary is explicit that drift does not block publication', () => {
  const summary = driftSummary({
    added: ['Thu AA0101'], removed: ['Tue AA0101'], beforeRooms: 425, afterRooms: 426,
  });
  assert.match(summary, /Added room-days: Thu AA0101/);
  assert.match(summary, /Removed room-days: Tue AA0101/);
  assert.match(summary, /non-blocking/i);
});
