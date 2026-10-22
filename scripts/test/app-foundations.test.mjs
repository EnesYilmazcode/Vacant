import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WARP_BOTTOM, WARP_WIDTH, warpPower } from '../../js/card-photo.js';

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
