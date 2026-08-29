// The dev clock, and the promises js/dev.js makes about it.
//
// The panel itself needs a browser and is checked by driving the real app in
// scripts/shoot.mjs's harness. What is checkable here is the seam: that the
// clock is a real switch rather than a mock, that it defaults to the real one,
// and that js/dev.js is genuinely absent from what a student downloads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { clockIsPinned, now, pinClock } from '../../js/state.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('the clock is the real one until something pins it', () => {
  pinClock(null);
  assert.equal(clockIsPinned(), false);
  const before = Date.now();
  const drift = Math.abs(now().getTime() - before);
  assert.ok(drift < 1000, `the unpinned clock is ${drift} ms off the real one`);
});

test('a pinned clock is the same instant every time it is read', () => {
  const at = Date.parse('2026-11-26T11:00:00-05:00');
  pinClock(at);
  assert.equal(clockIsPinned(), true);
  assert.equal(now().getTime(), at);
  assert.equal(now().getTime(), at, 'it does not tick');
  // A Date, not a number, because every caller in js/app.js reads getDay,
  // getHours or hands it to isoDate.
  assert.ok(now() instanceof Date);
  assert.equal(now().getUTCDay(), 4, 'Thanksgiving 2026 is a Thursday');
  pinClock(null);
  assert.equal(clockIsPinned(), false, 'null goes back to the real clock');
});

test('a nonsense pin is refused rather than producing an Invalid Date', () => {
  // `new Date(NaN)` is a Date whose every getter is NaN, and it would spread
  // silently through isoDate into a query for room availability on "NaN-NaN".
  for (const bad of [NaN, undefined, 'Tuesday', Infinity]) {
    pinClock(bad);
    assert.equal(clockIsPinned(), false, String(bad));
    assert.ok(Number.isFinite(now().getTime()), String(bad));
  }
});

test('nothing in js/app.js reads the wall clock behind the app clock', () => {
  // This is the whole reason dev mode can exist at all. Eleven `new Date()`
  // calls used to sit in js/app.js, so a simulated minute would have been a lie
  // on whichever screen still called the real one.
  const app = read('js/app.js');
  const stripped = app.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(
    /new Date\(\s*\)/.test(stripped),
    false,
    'js/app.js calls new Date() directly again; it must read clockNow() so dev mode can move it',
  );
});

test('the clock is imported under a name that cannot shadow a local', () => {
  // Six functions in js/app.js hold a `const now`. Importing the clock as `now`
  // makes every one of them a temporal dead zone error at the line that reads
  // it, and the app does not boot at all.
  const app = read('js/app.js');
  assert.match(app, /now as clockNow/);
  assert.equal(/^\s*now,\s*$/m.test(app.slice(0, app.indexOf("} from './state.js';"))), false);
});

test('js/dev.js is never downloaded by a student who did not ask for it', () => {
  // It is loaded with import() from js/app.js and is deliberately not in the
  // service worker's shell list, so it costs the shipped app nothing.
  const html = read('index.html');
  assert.equal(html.includes('js/dev.js'), false, 'index.html loads dev.js as a script tag');
  const sw = read('sw.js');
  assert.equal(sw.includes('dev.js'), false, "dev.js is in the service worker's cache list");
  assert.match(read('js/app.js'), /import\('\.\/dev\.js'\)/);
});

test('the dev seam is three exports and no more', () => {
  // A widening seam is how a debug tool ends up load bearing. If this grows,
  // the thing to ask is whether the app grew a state the screens cannot reach.
  const app = read('js/app.js');
  const named = [...app.matchAll(/^export (?:function |\{ )(\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(named.sort(), ['devApply', 'devReadout', 'state']);
});
