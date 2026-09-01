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

import { appendFileSync, writeFileSync, readFileSync, existsSync, renameSync } from 'node:fs';
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

// normalise reads startDate and endDate by name, so an upstream rename does not
// throw. It lands as null in the baseline and the strm diff below never looks at
// it. Both fields were on every row on 2026-08-27 (3 terms) and 2026-09-01 (2).
export function fieldDrift(payload) {
  return (payload?.data?.data ?? [])
    .filter((r) => r && typeof r === 'object' && (r.startDate == null || r.endDate == null))
    .map((r) => `${r.strm ?? '?'} carries ${Object.keys(r).join(', ') || 'no fields'}`);
}

// A term that leaves on the date it published is the annual rollover, and one
// that leaves early is a surprise. On the last day itself, call it ordinary: the
// window closes that day either way, and a wrong "left early" sends someone
// hunting for a problem that is not there.
export function departure(term, today) {
  const until = term?.searchableUntil ?? null;
  if (!until) return 'published no searchableUntil, so nothing predicted this';
  if (until <= today) return `published searchableUntil ${until}, so this is the ordinary expiry`;
  return `published searchableUntil ${until}, which has not passed. This one left early`;
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

// The workflow puts this straight into an issue title, so it has to say which
// thing broke. "Searchable term list changed" on a morning when Ohio State was
// simply down is a false claim, filed somewhere nobody goes back to correct it.
function fail(alert, lines) {
  for (const line of lines) console.error(line);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `alert=${alert}\n`);
  process.exit(1);
}

async function main() {
  const write = process.argv.includes('--write');

  let payload;
  try {
    payload = await fetchJson(TERMS_URL);
  } catch (err) {
    // Rule 8 of the refusal list in docs/research/ops-freshness.md. Every
    // downstream decision reads from this endpoint, so a failure here is not a
    // shrug, it is the whole term picture going dark.
    fail('Term list endpoint is not answering', [`FATAL  searchableTermsV2 did not answer: ${err.message}`]);
  }

  const live = normalise(payload);
  if (live === null) {
    fail('Term list endpoint is not answering', ['FATAL  searchableTermsV2 answered, but data.data was not an array.']);
  }
  if (live.length === 0) {
    fail('Term list endpoint is not answering', [
      'FATAL  searchableTermsV2 returned an empty term list. It held 3 terms on 2026-08-27 and 2 on 2026-09-01.',
    ]);
  }

  console.log(`${requests()} request. ${live.length} searchable: ${live.map((t) => `${t.strm} ${t.descr}`).join(', ')}`);

  const drift = fieldDrift(payload);
  if (drift.length) {
    fail('Term list is missing its date fields', [
      'FATAL  searchableTermsV2 rows have no startDate/endDate, which normalise reads by name.',
      '       Baselining this would write nulls over the only record of the visibility windows.',
      ...drift.map((d) => `       ${d}`),
    ]);
  }

  if (write) {
    const baseline = {
      source: TERMS_URL,
      checked: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      note: 'searchableFrom and searchableUntil are search visibility windows, not academic dates.',
      terms: live,
    };
    // Temp then rename. A truncate-in-place write that dies half way leaves the
    // watcher with no baseline at all, which reads as "nothing changed".
    const tmp = `${TERMS_PATH}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(baseline, null, 1)}\n`);
    renameSync(tmp, TERMS_PATH);
    console.log('wrote data/terms.json');
    return;
  }

  if (!existsSync(TERMS_PATH)) {
    fail('Term list has no committed baseline', [
      'FATAL  data/terms.json is missing, so there is nothing to compare against.',
      '       Run: node scripts/check-terms.mjs --write',
    ]);
  }

  const committed = JSON.parse(readFileSync(TERMS_PATH, 'utf8')).terms;
  const { appeared, left } = diffTerms(committed, live);

  if (appeared.length === 0 && left.length === 0) {
    console.log('OK     the searchable term list matches data/terms.json.');
    return;
  }

  const lines = ['\nFATAL  the searchable term list moved.'];
  if (appeared.length) lines.push(`       appeared: ${appeared.join(', ')}`);
  if (left.length) {
    lines.push(`       left:     ${left.join(', ')}`);
    const today = new Date().toISOString().slice(0, 10);
    for (const t of committed.filter((c) => !live.some((l) => l.strm === c.strm))) {
      lines.push(`                 ${t.strm} ${departure(t, today)}`);
    }
    lines.push('       A term that left the list returns zero sections forever. The committed');
    lines.push('       rooms file is now the only copy of that grid, so do not force a rebuild.');
  }
  lines.push('\n       Nothing was fetched beyond the term list and nothing was written.');
  lines.push('       Decide what to do, then re-baseline: node scripts/check-terms.mjs --write');
  fail('Searchable term list changed', lines);
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('check-terms.mjs');
if (invokedDirectly) main();
