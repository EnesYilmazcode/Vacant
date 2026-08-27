#!/usr/bin/env node
// Notice a term appearing in, or leaving, Ohio State's searchable list.
//
// This is the half of the watch that a stale timestamp cannot cover. A term
// that leaves searchableTermsV2 is gone: the API returns zero sections for it
// forever, so the committed rooms-<strm>.json is the only copy of that grid
// anywhere. Measured 2026-08-27 against the live API: term 1258, Autumn 2025,
// comes back with totalItems 0.
//
// Usage:  node scripts/check-terms.mjs           compare and exit 1 on any change
//         node scripts/check-terms.mjs --write    re-baseline data/terms.json
//
// It never commits and it never kicks off a harvest. On the day a term becomes
// searchable its rooms are not assigned yet, so a human decides when it is
// ready and re-baselines with --write.

import { writeFileSync, readFileSync, existsSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchJson, requests } from './lib/fetch.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TERMS_URL = 'https://content.osu.edu/v2/classes/searchableTermsV2';
const TERMS_PATH = join(ROOT, 'data', 'terms.json');

// startDate and endDate on this endpoint are SEARCH VISIBILITY, not academic
// dates: Autumn 2026 "starts" 2026-02-09 and its first class is 2026-08-25.
// Renamed on the way in so nothing downstream mistakes them for a calendar.
export function normalise(payload) {
  const rows = payload?.data?.data;
  if (!Array.isArray(rows)) return null;
  return rows
    .filter((r) => typeof r?.strm === 'string')
    .map((r) => ({
      strm: r.strm,
      descr: r.descr ?? null,
      searchableFrom: r.startDate ?? null,
      searchableUntil: r.endDate ?? null,
    }))
    .sort((a, b) => a.strm.localeCompare(b.strm));
}

export function diffTerms(committed, live) {
  const before = new Set((committed ?? []).map((t) => t.strm));
  const after = new Set((live ?? []).map((t) => t.strm));
  const label = (list, strm) => {
    const hit = list.find((t) => t.strm === strm);
    return hit?.descr ? `${strm} (${hit.descr})` : strm;
  };
  return {
    appeared: [...after].filter((s) => !before.has(s)).sort().map((s) => label(live, s)),
    left: [...before].filter((s) => !after.has(s)).sort().map((s) => label(committed, s)),
  };
}

async function main() {
  const write = process.argv.includes('--write');

  let live;
  try {
    live = normalise(await fetchJson(TERMS_URL));
  } catch (err) {
    // Rule 8 of the refusal list in docs/research/ops-freshness.md. Every
    // downstream decision reads from this endpoint, so a failure here is not a
    // shrug, it is the whole term picture going dark.
    console.error(`FATAL  searchableTermsV2 did not answer: ${err.message}`);
    process.exit(1);
  }

  if (live === null) {
    console.error('FATAL  searchableTermsV2 answered, but data.data was not an array.');
    process.exit(1);
  }
  if (live.length === 0) {
    console.error('FATAL  searchableTermsV2 returned an empty term list. Three terms are searchable at all times.');
    process.exit(1);
  }

  console.log(`${requests()} request. ${live.length} searchable: ${live.map((t) => `${t.strm} ${t.descr}`).join(', ')}`);

  if (write) {
    const payload = {
      source: TERMS_URL,
      checked: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      note: 'searchableFrom and searchableUntil are search visibility windows, not academic dates.',
      terms: live,
    };
    // Temp then rename. A truncate-in-place write that dies half way leaves the
    // watcher with no baseline at all, which reads as "nothing changed".
    const tmp = `${TERMS_PATH}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(payload, null, 1)}\n`);
    renameSync(tmp, TERMS_PATH);
    console.log('wrote data/terms.json');
    return;
  }

  if (!existsSync(TERMS_PATH)) {
    console.error('FATAL  data/terms.json is missing, so there is nothing to compare against.');
    console.error('       Run: node scripts/check-terms.mjs --write');
    process.exit(1);
  }

  const committed = JSON.parse(readFileSync(TERMS_PATH, 'utf8')).terms;
  const { appeared, left } = diffTerms(committed, live);

  if (appeared.length === 0 && left.length === 0) {
    console.log('OK     the searchable term list matches data/terms.json.');
    return;
  }

  console.error('\nFATAL  the searchable term list moved.');
  if (appeared.length) console.error(`       appeared: ${appeared.join(', ')}`);
  if (left.length) {
    console.error(`       left:     ${left.join(', ')}`);
    console.error('       A term that left the list returns zero sections forever. The committed');
    console.error('       rooms file is now the only copy of that grid, so do not force a rebuild.');
  }
  console.error('\n       Nothing was fetched beyond the term list and nothing was written.');
  console.error('       Decide what to do, then re-baseline: node scripts/check-terms.mjs --write');
  process.exit(1);
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('check-terms.mjs');
if (invokedDirectly) main();
