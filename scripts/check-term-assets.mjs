#!/usr/bin/env node
// Refuse to rebuild a term the app could not then load.
//
// build-index.mjs writes `buildings: data/buildings-<term>.json` into
// current.json for whatever term it is handed. That file comes from
// fetch-buildings.mjs, which rooms.yml does not run, so a dispatch naming a
// term nobody has fetched buildings for commits a current.json pointing at a
// file that is not in the repository.
//
// That is not a degraded map, it is a dead site. js/app.js asks for the rooms,
// the buildings and the hours in one Promise.all, so the 404 rejects the whole
// boot. Measured 2026-08-27 at 393x852 against a current.json naming
// data/buildings-1272.json: #ask never reached .ready inside 15 seconds, all
// three duration buttons stayed disabled, and the screen sat on "finding
// campus…" under "Could not load the schedule."
//
// The workflow cannot fix this itself. fetch-buildings.mjs reads the term out
// of current.json and needs data/rooms-<term>.json to already exist, so a new
// term is two local runs in order before anything is committed.
//
// Usage:  node scripts/check-term-assets.mjs 1268

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// The two paths build-index.mjs writes into current.json. A test reads that
// file and fails if either template moves out from under this one.
export function indexAssets(term) {
  return { rooms: `data/rooms-${term}.json`, buildings: `data/buildings-${term}.json` };
}

// Only the buildings subset can be missing. The harvest writes the room index
// itself and the commit step stages it.
export function missingAssets(term, exists) {
  const { buildings } = indexAssets(term);
  return exists(buildings) ? [] : [buildings];
}

function main() {
  const term = process.argv[2] ?? '';
  if (!/^\d{4}$/.test(term)) {
    console.error('usage: node scripts/check-term-assets.mjs <four digit term code>');
    process.exit(2);
  }

  const missing = missingAssets(term, (p) => existsSync(join(ROOT, p)));
  if (missing.length === 0) {
    console.log(`term ${term}: ${indexAssets(term).buildings} is committed.`);
    process.exit(0);
  }

  for (const path of missing) console.error(`Missing: ${path}`);
  console.error(`Refusing to build term ${term}. current.json would name that file, the site cannot fetch`);
  console.error('it, and the app loads everything current.json names at once, so it would not start.');
  console.error('A term is added by hand, in this order, before this workflow can touch it:');
  console.error(`  node scripts/fetch-rooms.mjs ${term} && node scripts/build-index.mjs ${term}`);
  console.error('  node scripts/fetch-buildings.mjs      # reads the term from current.json');
  console.error('  git add data/ && git commit');
  process.exit(1);
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('check-term-assets.mjs');
if (invokedDirectly) main();
