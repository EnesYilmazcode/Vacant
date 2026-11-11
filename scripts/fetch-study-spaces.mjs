#!/usr/bin/env node
// Write data/study-spaces.json: the Columbus libraries and the Ohio Union, with
// the hours each publishes by date.
//
// The classroom answer has a hole exactly where students need it most. In
// finals week Ohio State reassigns rooms for exams and publishes nothing, so
// Vacant refuses, correctly. These are the places that stay open around that
// refusal, and in finals week they stay open longest: Thompson publishes
// 7:30am-2am for Dec 10-16 2026 and the 18th Avenue Library is open around the
// clock. They are not rooms, and the app never calls them free; it says the
// door is open.
//
// Two requests:
//   osul.libcal.com/api_hours_grid.php   every library, structured, eight weeks
//                                        ahead, the same feed library.osu.edu
//                                        renders its own hours page from
//   ohiounion.osu.edu/visiting/hours     prose: a regular table, a break table,
//                                        and lists of break and closed dates
//
// Usage:  node scripts/fetch-study-spaces.mjs
//         node scripts/fetch-study-spaces.mjs --dry-run   (prints, requests nothing)
//
// Fails, and writes nothing, when either source stops looking like itself.
// The app reads a date missing from the file as "no hours published", so a
// failed week ages the list out rather than keeping stale hours alive.

import { rename, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchJson, fetchText, requests } from './lib/fetch.mjs';
import { UNION, parseLibcal, parseUnionPage, unionDays } from './lib/study-spaces.mjs';
import { smallIndex } from './fetch-buildings.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'study-spaces.json');

export const LIBCAL_URL = 'https://osul.libcal.com/api_hours_grid.php?iid=0&format=json&weeks=8';
export const UNION_URL = 'https://ohiounion.osu.edu/visiting/hours';

// Thompson alone publishes every day of the grid. Fewer than three weeks of it
// means the feed came back truncated, not that the library closed.
const MIN_THOMPSON_DAYS = 21;

function die(message) {
  console.error(`\nFATAL  ${message}`);
  process.exit(1);
}

const localDate = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Everything the file holds, from the two responses and the building tables.
// Exported so the test can build the file from fixtures without a network.
export function buildStudySpaces({ grid, unionHtml, buildings, entrances, generated }) {
  const libraries = parseLibcal(grid, buildings);
  const thompson = libraries.find((s) => s.b === '050');
  const dates = Object.keys(thompson?.days ?? {}).sort();
  if (dates.length < MIN_THOMPSON_DAYS) {
    throw new Error(`LibCal returned ${dates.length} days for Thompson, expected at least ${MIN_THOMPSON_DAYS}`);
  }
  const from = dates[0];
  const to = dates.at(-1);
  const union = {
    id: 'union',
    kind: 'union',
    name: UNION.name,
    b: UNION.code,
    days: unionDays(parseUnionPage(unionHtml), from, to),
  };
  const spaces = [...libraries, union];
  const codes = new Set(spaces.map((s) => s.b));
  const { small, missing } = smallIndex(buildings, codes, entrances);
  if (missing.length) throw new Error(`no building record for ${missing.join(', ')}`);

  return {
    generated,
    from,
    to,
    sources: { libraries: LIBCAL_URL, union: UNION_URL },
    note:
      'Places to study that are not classrooms, with the hours each one publishes by date. ' +
      'days[date] is a list of [open, close] in minutes from local midnight; close may pass 1440 ' +
      'when the day ends after midnight. An empty list is published as closed. A date that is ' +
      'absent has no published hours and must not be shown as open. Nothing here says a seat is free.',
    buildings: small,
    spaces,
  };
}

async function main() {
  if (process.argv.includes('--dry-run')) {
    console.log(`  would GET ${LIBCAL_URL}
  would GET ${UNION_URL}
  and write ${OUT}`);
    return;
  }
  const buildings = JSON.parse(readFileSync(join(ROOT, 'data', 'buildings.json'), 'utf8')).buildings;
  const entrances = JSON.parse(readFileSync(join(ROOT, 'data', 'entrances.json'), 'utf8')).entrances ?? {};

  const grid = await fetchJson(LIBCAL_URL);
  const unionHtml = await fetchText(UNION_URL);
  const file = buildStudySpaces({ grid, unionHtml, buildings, entrances, generated: localDate() });

  for (const s of file.spaces) {
    const known = Object.keys(s.days).length;
    const shut = Object.values(s.days).filter((d) => d.length === 0).length;
    console.log(`  ${s.name.padEnd(24)} ${known} days, ${shut} closed`);
  }
  console.log(`  ${file.from} to ${file.to}, ${requests()} requests`);
  const tmp = `${OUT}.tmp`;
  await writeFile(tmp, `${JSON.stringify(file)}\n`);
  await rename(tmp, OUT);
  console.log(`  wrote ${OUT}`);
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('fetch-study-spaces.mjs');
if (invokedDirectly) main().catch((err) => die(err.message));
