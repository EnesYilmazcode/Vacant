// Offline. No network, no writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { indexAssets, missingAssets } from '../check-term-assets.mjs';

const script = fileURLToPath(new URL('../check-term-assets.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

test('a term whose buildings subset is committed passes', () => {
  assert.deepEqual(missingAssets('1268', () => true), []);
});

test('a term with no buildings subset is refused, by name', () => {
  // The failure this guards is a dispatch for a term nobody fetched buildings
  // for. It commits a current.json naming a 404 and the app never boots.
  assert.deepEqual(missingAssets('1272', () => false), ['data/buildings-1272.json']);
  assert.deepEqual(
    missingAssets('1272', (p) => p !== 'data/buildings-1272.json'),
    ['data/buildings-1272.json'],
  );
});

test('the filenames still match what build-index.mjs writes', () => {
  // Two files apart, one template. If build-index renames either path this
  // guard would start checking a name nothing uses, and pass on a dead build.
  const src = readFileSync(new URL('../build-index.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes('rooms: `data/rooms-${term}.json`'), 'rooms path moved');
  assert.ok(src.includes('buildings: `data/buildings-${term}.json`'), 'buildings path moved');
});

test('the committed current.json names exactly these two paths', () => {
  const current = JSON.parse(readFileSync(new URL('../../data/current.json', import.meta.url), 'utf8'));
  const want = indexAssets(current.term);
  assert.equal(current.rooms, want.rooms);
  assert.equal(current.buildings, want.buildings);
});

test('the CLI exits 0 for the committed term and 1 for one with no buildings file', () => {
  const good = run('1268');
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /data\/buildings-1268\.json is committed/);

  const bad = run('1272');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Missing: data\/buildings-1272\.json/);
  assert.match(bad.stderr, /fetch-buildings/, 'the refusal has to say how to fix it');
});

test('the CLI refuses anything that is not a four digit term', () => {
  for (const arg of ['', '126', '12688', 'autumn', '../etc']) {
    assert.equal(run(arg).status, 2, `${JSON.stringify(arg)} should be a usage error`);
  }
});
