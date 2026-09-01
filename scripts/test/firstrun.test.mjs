// The first-run tier decision. The rule this file enforces is that the decision
// reads CacheStorage and nothing else: a network call here would put the thing
// being decided about in front of the decision, which is the failure that turns
// a cold launch into a white screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CACHED, FETCHING, NETWORK_TIMEOUT_MS, OFFLINE, pickTier } from '../../js/firstrun.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = readFileSync(join(ROOT, 'js', 'firstrun.js'), 'utf8');

const POINTER = '/Vacant/data/current.json';
const ROOMS = '/Vacant/data/rooms-1268.json';
const BUILDINGS = '/Vacant/data/buildings-1268.json';
const HOURS = '/Vacant/data/buildings-hours.json';

// What a fully warmed data cache holds. Everything boot() awaits before it can
// put a row on screen.
const WARM = {
  [POINTER]: { rooms: 'data/rooms-1268.json', buildings: 'data/buildings-1268.json' },
  [ROOMS]: {},
  [BUILDINGS]: {},
  [HOURS]: {},
};

// A CacheStorage stub that records every lookup, so a test can prove what the
// decision read as well as what it decided.
function store(held) {
  const asked = [];
  return {
    asked,
    async match(url) {
      asked.push(url);
      if (!(url in held)) return undefined;
      const value = held[url];
      return { json: async () => value };
    },
  };
}

test('a whole cached term is tier 1', async () => {
  const cache = store(WARM);
  assert.equal(await pickTier({ store: cache, online: true }), CACHED);
  assert.equal(await pickTier({ store: cache, online: false }), CACHED);
  assert.deepEqual(cache.asked, [POINTER, ROOMS, BUILDINGS, HOURS, POINTER, ROOMS, BUILDINGS, HOURS]);
});

test('one file short of a whole term is not tier 1', async () => {
  // Every one of these is a state a real cache reaches. The worker's warm skips
  // a file that came back non-ok, so a single 503 on buildings-hours.json leaves
  // exactly the third case. Saying CACHED there hid the offline card behind a
  // screen with three disabled buttons: boot() awaits all three files together
  // and rejects if any one of them is missing.
  for (const gone of [ROOMS, BUILDINGS, HOURS]) {
    const held = { ...WARM };
    delete held[gone];
    assert.equal(await pickTier({ store: store(held), online: true }), FETCHING, gone);
    assert.equal(await pickTier({ store: store(held), online: false }), OFFLINE, gone);
  }
});

test('a pointer that names no buildings file is not tier 1 either', async () => {
  const held = { ...WARM, [POINTER]: { rooms: 'data/rooms-1268.json' } };
  assert.equal(await pickTier({ store: store(held), online: false }), OFFLINE);
});

test('nothing cached is tier 2 online and tier 3 offline', async () => {
  assert.equal(await pickTier({ store: store({}), online: true }), FETCHING);
  assert.equal(await pickTier({ store: store({}), online: false }), OFFLINE);
});

test('a pointer with no rooms file behind it is not tier 1', async () => {
  // Exactly the state a term rollover leaves: the pointer revalidated, the file
  // it names was never fetched.
  const held = { [POINTER]: { rooms: 'data/rooms-1272.json', buildings: 'data/buildings-1272.json' } };
  assert.equal(await pickTier({ store: store(held), online: true }), FETCHING);
  assert.equal(await pickTier({ store: store(held), online: false }), OFFLINE);
});

test('the decision makes no network request', async () => {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => {
    calls += 1;
    throw new Error('pickTier reached the network');
  };
  try {
    await pickTier({ store: store({}), online: true });
    await pickTier({ store: store(WARM), online: true });
  } finally {
    globalThis.fetch = real;
  }
  assert.equal(calls, 0);
});

test('a CacheStorage that throws or holds junk falls through, it does not blow up', async () => {
  const angry = {
    match() {
      throw new DOMException('site data is blocked', 'SecurityError');
    },
  };
  assert.equal(await pickTier({ store: angry, online: true }), FETCHING);
  assert.equal(await pickTier({ store: angry, online: false }), OFFLINE);

  const unparseable = {
    async match() {
      return { json: async () => { throw new SyntaxError('Unexpected token'); } };
    },
  };
  assert.equal(await pickTier({ store: unparseable, online: false }), OFFLINE);

  // No CacheStorage at all, which is what a browser with site data switched off
  // hands the page.
  assert.equal(await pickTier({ store: null, online: true }), FETCHING);
  assert.equal(await pickTier({ store: null, online: false }), OFFLINE);
});

test('navigator.onLine picks the starting tier and never proves the network works', () => {
  // Measured on this box: with Chrome emulating an offline page, onLine stayed
  // true and every request refused. It reports the same lie on a captive portal.
  assert.match(source, /nav\.onLine !== false/);
  const reachable = source.slice(source.indexOf('async function reachable'), source.indexOf('async function retry'));
  assert.match(reachable, /await fetch\(/);
  assert.match(reachable, /return response\.ok;/);
  assert.match(reachable, /return false;/);
  assert.equal(reachable.includes('onLine'), false, 'reachable() trusts the flag');
  // A request that is accepted and never answered never rejects, so this probe
  // is one of the two places the app can wait forever. The catch above turns
  // the abort back into "no network", which is what it means.
  assert.match(reachable, /signal: AbortSignal\.timeout\(NETWORK_TIMEOUT_MS\)/);
  // Still exactly one file, and the cheap one. Probing the room index instead
  // would re-download 222 KB to decide whether the network is up.
  assert.equal((reachable.match(/fetch\(/g) ?? []).length, 1, 'reachable() asks for more than one file');
  assert.match(reachable, /data\/current\.json/);
});

test('the retry button tries, and says so when there is still nothing', () => {
  const retry = source.slice(source.indexOf('async function retry'), source.indexOf('function open()'));
  assert.match(retry, /await reachable\(\)/);
  assert.match(retry, /win\.location\.reload\(\)/);
  assert.match(retry, /'Still no connection\.'/);
  // A second tap while the first request is in flight must not start another.
  assert.match(retry, /if \(busy\) return;/);
});

test('both online and visibilitychange retry, and neither runs once the app is up', () => {
  assert.match(source, /win\.addEventListener\('online', reconsider\)/);
  assert.match(source, /doc\.addEventListener\('visibilitychange'/);
  // iOS freezes a backgrounded web app, so the online event can be missed
  // outright and coming back to the foreground is the retry that fires.
  assert.match(source, /visibilityState === 'visible'\) reconsider\(\)/);
  const reconsider = source.slice(source.indexOf('async function reconsider'), source.indexOf('  // iOS freezes'));
  assert.match(reconsider, /if \(ready\) return;/);
});

test('storage.persist is asked once and nothing branches on the answer', () => {
  const persist = source.slice(source.indexOf('function persist('));
  assert.match(persist, /try \{/);
  assert.match(persist, /nav\.storage\?\.persist\?\.\(\)/);
  assert.equal(/persist\(\)\s*\.then|await nav\.storage|if \(.*persist/.test(persist), false);
  assert.match(source, /onReady\(doc, \(\) => \{\s*ready = true;\s*close\(\);\s*persist\(nav\);/);
});

// Issue #23 asked for the cold start to fire geolocation in the same tick as the
// data fetch, so the two waits overlap instead of queueing. They do, but boot()
// in js/app.js is what does it, and until this test nothing held that in place.
// Measured on a cold load at 393x852: geolocation at 60 ms, the first fetch at
// 60 ms, the first response back at 71 ms.
test('geolocation starts before any data fetch resolves, and only one module asks', () => {
  const app = readFileSync(join(ROOT, 'js', 'app.js'), 'utf8');
  const boot = app.slice(app.indexOf('async function boot()'), app.indexOf("window.addEventListener('DOMContentLoaded'"));
  const started = boot.indexOf('const fix = locate();');
  assert.ok(started > 0, 'boot() no longer starts geolocation');
  // Anything awaited above this line makes the fix wait for a response.
  assert.ok(started < boot.indexOf('await '), 'geolocation now queues behind an await');
  // And it is collected with the data rather than ahead of it.
  const all = boot.indexOf('await Promise.all([');
  assert.match(boot.slice(all, boot.indexOf(']', all)), /\bfix,/);

  // Two modules asking would prompt twice on the one visit where the app has
  // nothing, which is the visit this whole file is about.
  for (const file of ['firstrun.js', 'install.js', 'pwa.js']) {
    const other = readFileSync(join(ROOT, 'js', file), 'utf8');
    assert.equal(/geolocation|getCurrentPosition/.test(other), false, `js/${file} asks for a position too`);
  }
});

// ------- the deadline, and what counts as an answer

// A stalled network is not a failed one. Nothing rejects, so a fetch without a
// deadline waits on it for the length of the visit, and this app's first answer
// hangs off four of them. One deadline covers them all, which means a fetch
// added to boot() without the signal is a fetch that can still hang forever.
test('every fetch on the path to a first answer carries the boot deadline', () => {
  const app = readFileSync(join(ROOT, 'js', 'app.js'), 'utf8');
  const boot = app.slice(app.indexOf('async function boot()'), app.indexOf('function bootFailed()'));
  assert.match(boot, /const signal = AbortSignal\.timeout\(NETWORK_TIMEOUT_MS\)/);
  const calls = boot.match(/fetch\([^)]*\)/g) ?? [];
  assert.ok(calls.length >= 2, `boot() has ${calls.length} fetches, the scan is wrong`);
  for (const call of calls) assert.match(call, /signal/, `${call} has no deadline on it`);

  // The one fetch on that path boot() does not make itself.
  const parsed = app.slice(app.indexOf('async function parsedIndex('), app.indexOf('async function boot()'));
  assert.match(parsed, /fetch\(url, \{ signal \}\)/);

  // And the deadline needs somewhere to land, or it swaps a hang for a silence.
  assert.match(app, /boot\(\)\.catch\(bootFailed\)/);

  // Not on the picker's building table. That one is fetched when the picker
  // opens, which can be long after boot(), and the boot deadline would abort it.
  const shorts = app.slice(app.indexOf('function loadShorts()'), app.indexOf('async function parsedIndex('));
  assert.equal(shorts.includes('signal'), false, 'the picker fetch is on the boot deadline');

  // The other half of the same rule. A deadline covers a request that never
  // comes back; this covers one that comes back wrong. fetch resolves on a 5xx,
  // so without the check a 503 body reaches JSON.parse as the schedule and the
  // app blames its own weekly build for someone else's server. The guard is
  // lifted out and run rather than matched, because it is the throw that matters.
  const guard = app.slice(app.indexOf('function answered(r)'), app.indexOf('async function boot()'));
  const answered = new Function(`${guard}\nreturn answered;`)();
  assert.throws(() => answered({ ok: false, status: 503, url: '/data/rooms-1268.json' }), /503/);
  assert.equal(answered({ ok: true }).ok, true, 'a good response no longer passes through');

  // And every fetch on the path to a first answer goes through it. Two in
  // boot(), the json() helper and the buildings table, plus the room index.
  assert.match(parsed, /\.then\(answered\)/, 'a 503 body reaches JSON.parse as the schedule');
  assert.equal((boot.match(/\.then\(answered\)/g) ?? []).length, 2, 'a boot fetch skips the status check');
});

// The number, not just its name. A deadline shorter than the load it is
// watching calls every working connection dead, which is the lie the comment
// beside it exists not to tell.
// data/rooms-1268.json is 60 percent of the figure and is rebuilt every week, so
// this number goes stale on its own with nobody touching the file it is in.
// scripts/test/sw.test.mjs holds its own byte figures the same way.
test('the byte figure beside the deadline is still the size of what boot() reads', () => {
  const prose = source.replace(/^\s*\/\/ ?/gm, '').replace(/\s+/g, ' ');
  const claimed = Number((prose.match(/The ([0-9,]+) bytes boot\(\) reads/) ?? [])[1]?.replace(/,/g, ''));
  assert.ok(claimed, 'no measured payload figure beside NETWORK_TIMEOUT_MS');
  const current = JSON.parse(readFileSync(join(ROOT, 'data', 'current.json'), 'utf8'));
  const real = ['data/current.json', 'data/campus.json', 'data/buildings-hours.json', current.rooms, current.buildings]
    .reduce((total, file) => total + readFileSync(join(ROOT, file)).length, 0);
  // One percent wide, because a Windows checkout carries CRLF and the server
  // that produced the figure served exactly that: measured 379,144 with the CR
  // in and 375,776 with it out, which is 0.9 percent.
  const off = Math.abs(claimed - real) / real;
  assert.ok(off < 0.01, `the comment says ${claimed} bytes and the five files are ${real}, ${(off * 100).toFixed(1)}% out`);
});

test('the boot deadline still clears the slowest load it was measured against', () => {
  const slow3g = 9590; // ms, the Slow 3G figure the comment on the constant carries
  assert.ok(
    NETWORK_TIMEOUT_MS >= 2 * slow3g,
    `${NETWORK_TIMEOUT_MS} ms does not leave room over the ${slow3g} ms it was measured against`,
  );
  // Unwrapped first, so a reflowed comment does not read as a deleted one.
  const prose = source.replace(/^\s*\/\/ ?/gm, '').replace(/\s+/g, ' ');
  assert.match(prose, /9\.59 s over CDP at Chrome's Slow 3G preset/, 'the measurement behind the number is gone');
});
