// The three raster verdicts on the launch spike are sentences, not numbers, and
// a sentence nobody checks is a sentence somebody wrote once. These pin the two
// failures that look identical from outside the browser and the one that is a
// race rather than an API call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { allocation, backing, blit } from '../raster.js';

const at = (p) => fileURLToPath(new URL(p, import.meta.url));

// The shipped raster: MAX_RASTER_PX in js/map.js caps at 6.00 Mpx and the clamp
// in js/app.js pins dpr to 2, so 2693x2229 is what every device shape produces.
const SHIPPED = { wantedWidth: 2693, wantedHeight: 2229, gotWidth: 2693, gotHeight: 2229 };

test('the page imports exactly the three verdicts this file tests', () => {
  const page = readFileSync(at('../launch.html'), 'utf8');
  const line = page.match(/import \{([^}]+)\} from '\.\/raster\.js'/);
  assert.ok(line, 'launch.html no longer imports raster.js, so nothing on screen comes from here');
  const named = line[1].split(',').map((s) => s.trim()).sort();
  assert.deepEqual(named, ['allocation', 'backing', 'blit']);
});

test('a device that caps the size is caught by the dimensions', () => {
  const r = allocation({ ...SHIPPED, gotWidth: 4096, gotHeight: 2229, colours: 400 });
  assert.equal(r.ok, false);
  assert.match(r.line, /capped it/);
});

// The failure this file exists for. iOS out of canvas memory keeps the size it
// was given and drops every draw, so only the colour count sees it.
test('a canvas that accepted the size and dropped the drawing is caught by the colours', () => {
  const r = allocation({ ...SHIPPED, colours: 1 });
  assert.equal(r.ok, false);
  assert.match(r.line, /running out of canvas memory/);
  assert.equal(r.megapixels.toFixed(2), '6.00');
  // 4 bytes a pixel is the RGBA backing store, not a file size.
  assert.equal(r.bytes, 2693 * 2229 * 4);
});

test('a raster that allocated and drew is ok, and reports what it cost', () => {
  const r = allocation({ ...SHIPPED, colours: 431 });
  assert.equal(r.ok, true);
  assert.match(r.line, /6\.00 MP/);
  assert.match(r.line, /22\.9 MB/);
});

test('the readback race refuses the middle rather than guessing', () => {
  assert.equal(backing({ plainMs: 40, cpuMs: 10, renderer: 'Apple GPU' }).verdict, 'gpu');
  assert.equal(backing({ plainMs: 10.5, cpuMs: 10 }).verdict, 'software');
  // 1.25x to 2x means opposite things for the packed binary, so it says nothing.
  assert.equal(backing({ plainMs: 15, cpuMs: 10 }).verdict, 'unclear');
  assert.equal(backing({ plainMs: 0, cpuMs: 0 }).verdict, 'unmeasured');
});

test('the renderer string is reported beside the race, never instead of it', () => {
  const named = backing({ plainMs: 40, cpuMs: 10, renderer: 'Apple GPU' });
  const bare = backing({ plainMs: 40, cpuMs: 10 });
  assert.match(named.line, /Renderer reports "Apple GPU"/);
  assert.match(bare.line, /not readable here/);
  assert.equal(named.verdict, bare.verdict, 'the verdict is the race, so the string must not move it');
});

test('the first blit is reported against the ones after it, not on its own', () => {
  const paid = blit([18, 1.2, 1.1, 1.3, 1.2, 1.1]);
  assert.ok(paid.extra > 16);
  assert.match(paid.line, /more than the rest/);

  // Under a millisecond is inside performance.now() noise on a phone.
  const free = blit([1.6, 1.2, 1.1, 1.3, 1.2, 1.1]);
  assert.match(free.line, /Nothing is being uploaded on it/);
});

test('one blit is not a first blit, and no blit says so', () => {
  assert.match(blit([4]).line, /needs something to be first against/);
  assert.equal(blit([4]).later, null);
  assert.match(blit([]).line, /No blit was recorded/);
  assert.equal(blit(undefined).n, 0);
});
