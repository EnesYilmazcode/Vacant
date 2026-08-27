// The first-run tier decision. The rule this file enforces is that the decision
// reads CacheStorage and nothing else: a network call here would put the thing
// being decided about in front of the decision, which is the failure that turns
// a cold launch into a white screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CACHED, FETCHING, OFFLINE, pickTier } from '../../js/firstrun.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = readFileSync(join(ROOT, 'js', 'firstrun.js'), 'utf8');

const POINTER = '/Vacant/data/current.json';
const ROOMS = '/Vacant/data/rooms-1268.json';

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

test('a cached pointer and a cached rooms file is tier 1', async () => {
  const cache = store({ [POINTER]: { rooms: 'data/rooms-1268.json' }, [ROOMS]: {} });
  assert.equal(await pickTier({ store: cache, online: true }), CACHED);
  assert.equal(await pickTier({ store: cache, online: false }), CACHED);
  assert.deepEqual(cache.asked, [POINTER, ROOMS, POINTER, ROOMS]);
});

test('nothing cached is tier 2 online and tier 3 offline', async () => {
  assert.equal(await pickTier({ store: store({}), online: true }), FETCHING);
  assert.equal(await pickTier({ store: store({}), online: false }), OFFLINE);
});

test('a pointer with no rooms file behind it is not tier 1', async () => {
  // Exactly the state a term rollover leaves: the pointer revalidated, the file
  // it names was never fetched.
  const held = { [POINTER]: { rooms: 'data/rooms-1272.json' } };
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
    await pickTier({ store: store({ [POINTER]: { rooms: 'data/rooms-1268.json' }, [ROOMS]: {} }), online: true });
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
