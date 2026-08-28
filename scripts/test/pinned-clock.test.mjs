// The clock the screenshots are taken on, checked without a browser.
//
// The shim is a string that runs inside the page, so the test runs it inside a
// vm realm and then asks the realm the questions js/app.js asks: what time is
// it, and how long has the flyover been running.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import { pinnedClockSource } from '../lib/pinned-clock.mjs';

const WHEN = new Date('2026-09-16T10:20:00-04:00').getTime();

// A realm with the three globals the shim touches. `frames` collects what each
// requestAnimationFrame callback was handed, which is the number the flyover
// camera is actually driven by.
function realm({ withRaf = true, withPerformance = true } = {}) {
  const frames = [];
  const context = { frames, handles: 0 };
  if (withPerformance) context.performance = { now: () => 1234.5 };
  if (withRaf) {
    context.requestAnimationFrame = (fn) => {
      context.handles += 1;
      fn(9876.5);
      return context.handles;
    };
  }
  vm.createContext(context);
  vm.runInContext(pinnedClockSource(WHEN), context);
  return context;
}

test('the wall clock reads the pinned instant', () => {
  const c = realm();
  assert.equal(vm.runInContext('Date.now()', c), WHEN);
  assert.equal(vm.runInContext('new Date().getTime()', c), WHEN);
  assert.equal(vm.runInContext('new Date().getFullYear()', c), 2026);
});

test('a Date built from an argument is left alone', () => {
  const c = realm();
  assert.equal(vm.runInContext('new Date(0).getTime()', c), 0);
  assert.equal(vm.runInContext("Date.parse('2026-01-02T03:04:05Z')", c), 1767323045000);
  assert.equal(vm.runInContext('Date.UTC(2026, 0, 2)', c), 1767312000000);
  assert.equal(vm.runInContext('new Date(2026, 0, 2).getMonth()', c), 0);
});

test('Date called without new still returns a string, as the real one does', () => {
  const c = realm();
  assert.equal(typeof vm.runInContext('Date()', c), 'string');
});

test('a pinned Date is still a Date, so instanceof and the prototype hold', () => {
  const c = realm();
  assert.equal(vm.runInContext('new Date() instanceof Date', c), true);
  assert.equal(typeof vm.runInContext('new Date().toISOString()', c), 'string');
});

// The one that matters. js/app.js does `flyoverStart = performance.now()` at
// boot and then `(frameTimestamp - flyoverStart) / 1000` inside the frame loop.
// If that difference is not zero on every run, the ask frame is a different
// image on every run, which is what shipped.
test('the flyover clock reads zero however long the boot took', () => {
  const c = realm();
  const elapsed = vm.runInContext(
    `(() => {
       const start = performance.now();
       let seen = null;
       requestAnimationFrame((t) => { seen = t - start; });
       return seen;
     })()`,
    c,
  );
  assert.equal(elapsed, 0);
});

test('performance.now is pinned, not merely slowed', () => {
  const c = realm();
  assert.equal(vm.runInContext('performance.now()', c), 0);
  assert.equal(vm.runInContext('performance.now() - performance.now()', c), 0);
});

test('the frame handle still comes back, so a cancel would still work', () => {
  const c = realm();
  assert.equal(vm.runInContext('requestAnimationFrame(() => {})', c), 1);
  assert.equal(vm.runInContext('requestAnimationFrame(() => {})', c), 2);
});

test('a realm with no requestAnimationFrame or performance is left standing', () => {
  const c = realm({ withRaf: false, withPerformance: false });
  assert.equal(vm.runInContext('Date.now()', c), WHEN);
  assert.equal(vm.runInContext('typeof requestAnimationFrame', c), 'undefined');
});

test('a timestamp is required, because a NaN clock fails silently', () => {
  assert.throws(() => pinnedClockSource(undefined), TypeError);
  assert.throws(() => pinnedClockSource(NaN), TypeError);
});
