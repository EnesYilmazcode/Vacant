// Defect 3. The drift check cried DRIFT when js/engine.js was merely missing.
// A 404 body is a string, so `mine === theirs` was false and the page printed
// its strongest wording, "these picks are not the app's picks", over a walk
// nothing was wrong with. The third state existed and was unreachable for the
// most likely failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compareEngine, ENGINE_COPY, ENGINE_APP } from '../drift.js';

const at = (p) => fileURLToPath(new URL(p, import.meta.url));

// Enough of the fetch Response surface for the compare.
const serve = (bodies) => async (url) => {
  const hit = bodies[url];
  if (hit === undefined) throw new TypeError('Failed to fetch');
  if (typeof hit === 'number') return { ok: false, status: hit, text: async () => `${hit} ${url}` };
  return { ok: true, status: 200, text: async () => hit };
};

test('identical files read as match', async () => {
  assert.equal(await compareEngine(serve({ [ENGINE_COPY]: 'export const A = 1;', [ENGINE_APP]: 'export const A = 1;' })), 'match');
});

test('a different app file is DRIFT, which is the one claim worth making', async () => {
  assert.equal(await compareEngine(serve({ [ENGINE_COPY]: 'export const A = 1;', [ENGINE_APP]: 'export const A = 2;' })), 'DRIFT');
});

test('a 404 on js/engine.js is unchecked, not DRIFT', async () => {
  assert.equal(await compareEngine(serve({ [ENGINE_COPY]: 'export const A = 1;', [ENGINE_APP]: 404 })), 'unchecked');
});

test('a 500, and a missing vendored copy, are unchecked too', async () => {
  assert.equal(await compareEngine(serve({ [ENGINE_COPY]: 'export const A = 1;', [ENGINE_APP]: 500 })), 'unchecked');
  assert.equal(await compareEngine(serve({ [ENGINE_COPY]: 404, [ENGINE_APP]: 'export const A = 1;' })), 'unchecked');
});

test('an aborted request stays unchecked', async () => {
  assert.equal(await compareEngine(serve({ [ENGINE_COPY]: 'export const A = 1;' })), 'unchecked');
});

test('the shipped pair really does match, read off disk', async () => {
  const copy = readFileSync(at('../engine.vendor.js'), 'utf8');
  const app = readFileSync(at('../../js/engine.js'), 'utf8');
  assert.equal(await compareEngine(serve({ [ENGINE_COPY]: copy, [ENGINE_APP]: app })), 'match');
});

test('walk.html routes its check through this file rather than fetching raw', () => {
  const page = readFileSync(at('../walk.html'), 'utf8');
  assert.ok(page.includes("import { compareEngine } from './drift.js';"));
  assert.ok(
    !page.includes("fetch('../js/engine.js').then((r) => r.text())"),
    'walk.html is fetching js/engine.js without checking the status again. A 404 body is a string and it will read as DRIFT.',
  );
});
