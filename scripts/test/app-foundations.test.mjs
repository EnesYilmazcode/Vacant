import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WARP_BOTTOM, WARP_WIDTH, warpPower } from '../../js/card-photo.js';
import { NO_WALK_OVAL, OVAL, locate } from '../../js/location.js';

test('the card warp stays straight when the source already fits', () => {
  assert.equal(warpPower(400, 300, 400, 300), 1);
});

test('the card warp derives its exponent from the chosen crop and bottom scale', () => {
  const width = 390;
  const height = 700;
  const sourceWidth = 1200 * WARP_WIDTH;
  const sourceHeight = 800;
  const power = warpPower(width, height, sourceWidth, sourceHeight);
  assert.ok(power > 1);
  assert.ok(Math.abs((height * sourceWidth) / (sourceHeight * power * width) - WARP_BOTTOM) < 1e-12);
});

const timers = { setTimer: () => 1, clearTimer: () => {} };

test('location falls back honestly when the browser has no provider', async () => {
  const result = await locate({ geolocation: null, picked: null, now: () => 42, ...timers });
  assert.equal(result.origin.source, 'oval');
  assert.equal(result.origin.at, 42);
  assert.match(result.note, /No location on this device/);
});

test('location accepts an on-campus fix and rejects an unreachable one', async () => {
  const provider = (coords) => ({ getCurrentPosition: (yes) => yes({ coords }) });
  const here = await locate({
    geolocation: provider({ latitude: OVAL.lat + 0.001, longitude: OVAL.lon, accuracy: 30 }),
    picked: null,
    now: () => 84,
    ...timers,
  });
  assert.equal(here.origin.source, 'gps');
  assert.equal(here.origin.at, 84);
  assert.equal(here.note, null);

  const far = await locate({
    geolocation: provider({ latitude: OVAL.lat + 0.1, longitude: OVAL.lon, accuracy: 30 }),
    picked: null,
    ...timers,
  });
  assert.equal(far.origin.source, 'oval');
  assert.equal(far.note, NO_WALK_OVAL);
});
