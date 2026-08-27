// The only file in this suite that touches the network, and it does not unless
// you ask. Without VACANT_LIVE=1 all four tests report as skipped, so `node
// --test` on a contributor's laptop and on every pull request makes zero
// requests to Ohio State, and the API having a bad morning cannot turn the
// repository's checks red.
//
//   node --test scripts/test/live-rot.live.test.mjs              skips
//   VACANT_LIVE=1 node --test scripts/test/live-rot.live.test.mjs runs, 2 requests
//
// Two requests, shared by all four tests. There is no cheap change detector to
// use instead: X-Target-Hash fingerprints the request URL, not the body, so it
// is identical across two responses whose contents differ. The body has to be
// read.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fetchJson, requests } from '../lib/fetch.mjs';
import { buildingJoin, distanceLearningMode, fieldShape, harvestAxis, onlineStillExists } from '../live-rot-checks.mjs';

const skip = process.env.VACANT_LIVE === '1' ? false : 'set VACANT_LIVE=1 to call Ohio State';

const API = 'https://content.osu.edu/v2/classes/search';
const root = (p) => new URL(`../../${p}`, import.meta.url);
const read = (p) => JSON.parse(readFileSync(root(p), 'utf8'));

// The term the app is actually serving, not a hardcoded one that expires.
const TERM = read('data/current.json').term;

const url = (params) =>
  `${API}?${new URLSearchParams({ q: '', campus: 'col', term: TERM, sort: 'catalogNumber', p: '1', ...params })}`;

// lib/fetch.mjs rather than a second retry wrapper: three attempts with
// exponential backoff already, plus the User-Agent that tells Ohio State who is
// calling and the per-run request cap. One bad morning is not a red run.
const once = (fn) => {
  let promise;
  return () => (promise ??= fn());
};

const plainPage = once(() => fetchJson(url({})));

// Narrowed to online teaching because an arbitrary page can hold zero ONLINE
// rows. The slug is read off the plain page's own facet, never hardcoded: a
// hardcoded "dl" would make this test fail for the very drift it exists to
// report, and blame itself for it.
const onlinePage = once(async () => {
  const mode = distanceLearningMode(await plainPage());
  assert.ok(
    mode.slug,
    `no instruction-mode facet value looks like distance learning. Observed: ${mode.observed.join(', ') || 'no facet at all'}`,
  );
  return fetchJson(url({ 'instruction-mode': mode.slug }));
});

test('every field the room index is built from is still on the meeting', { skip }, async () => {
  const r = fieldShape(await plainPage());
  assert.ok(r.ok, r.detail);
  console.log(`   ${r.detail}`);
});

test('the ONLINE pseudo-room still exists and is still excluded', { skip }, async () => {
  const r = onlineStillExists(await onlinePage());
  assert.ok(r.ok, r.detail);
  console.log(`   ${r.detail}`);
});

test('every building code still resolves in buildings.json', { skip }, async () => {
  const r = buildingJoin(await plainPage(), read('data/buildings.json').buildings);
  assert.ok(r.ok, r.detail);
  console.log(`   ${r.detail}`);
});

test('the catalog-number facet the harvest walks is still there', { skip }, async () => {
  const r = harvestAxis(await plainPage());
  assert.ok(r.ok, r.detail);
  console.log(`   ${r.detail}`);
});

after(() => {
  // The budget is the promise. A whole term is 136 requests per pass and this
  // file runs weekly, so it has to stay small enough not to matter.
  console.log(`live-rot made ${requests()} request(s) to content.osu.edu`);
  assert.ok(requests() <= 5, `live-rot made ${requests()} requests, over the 5 it is allowed`);
});
