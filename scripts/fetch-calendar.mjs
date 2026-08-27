#!/usr/bin/env node
// Vendor the academic calendar so nothing fetches it at runtime.
//
// Usage:  node scripts/fetch-calendar.mjs
//         node scripts/fetch-calendar.mjs --dry-run
//
// Three files, three requests, and none of them is on the critical path of a
// build: build-index.mjs reads what this writes. Run it when a term rolls over.
//
//   data/vendor/academic.ics                     mcmanning.github.io, third party
//   data/cache/registrar/academic-calendar-5-year-view.html   the publisher
//   data/cache/registrar/<term>-finals-schedule.html          the exam window
//
// The ICS is vendored rather than trusted. See DECISIONS.md: it agrees with the
// Registrar on every Autumn 2026 date and disagrees on every Spring 2026 and
// Summer 2026 one.

import { mkdir, rename, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchText } from './lib/fetch.mjs';
import { parseFiveYear, parseIcs } from './lib/calendar.mjs';

const ICS_URL = 'https://mcmanning.github.io/ohio-state-ics/academic.ics';
const FIVE_YEAR_URL =
  'https://registrar.osu.edu/academic-calendar/academic-calendar-5-year-view-2023-2028/';
const FINALS_INDEX_URL =
  'https://registrar.osu.edu/staff-resources/class-catalog-and-space/final-exams-schedule/';
const ORIGIN = 'https://registrar.osu.edu';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR_DIR = join(ROOT, 'data', 'vendor');
const CACHE_DIR = join(ROOT, 'data', 'cache', 'registrar');

export const FIVE_YEAR_SLUG = 'academic-calendar-5-year-view';

function die(message) {
  console.error(`\nFATAL  ${message}`);
  process.exit(1);
}

const localDate = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

async function writeAtomic(path, text) {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, path);
}

// The finals page for one term, discovered from the index. Never a built slug:
// the index also carries session-1 pages whose names break the season-year
// pattern, and a constructed URL 404s silently as a themed error page.
export function findFinalsLink(indexHtml, name) {
  const want = String(name ?? '').toLowerCase().replace(/\s+/g, '-');
  const links = new Map();
  for (const m of String(indexHtml ?? '').matchAll(/href="([^"]*finals-schedule[^"]*)"/gi)) {
    const href = m[1];
    if (/^https?:/i.test(href) && !href.startsWith(ORIGIN)) continue;
    const slug = href.replace(/\/+$/, '').split('/').pop();
    if (!slug || slug === 'final-exams-schedule') continue;
    links.set(slug, href.startsWith('http') ? href : `${ORIGIN}${href}`);
  }
  const hit = [...links.keys()].find((slug) => slug.startsWith(want));
  return { slug: hit ?? null, url: hit ? links.get(hit) : null, all: [...links.keys()] };
}

async function save(url, path, { validate, dryRun, label }) {
  let text;
  try {
    text = await fetchText(url);
    if (!text || text.length < 1000) throw new Error(`suspiciously short response (${text?.length} bytes)`);
    const problem = validate(text);
    if (problem) throw new Error(`response failed validation: ${problem}`);
  } catch (err) {
    if (existsSync(path)) {
      console.warn(`  warn  ${label}: fetch failed (${err.message}), keeping the committed copy`);
      return readFileSync(path, 'utf8');
    }
    throw err;
  }
  if (!dryRun) await writeAtomic(path, text);
  console.log(`${label}: ${(text.length / 1024).toFixed(0)} KB`);
  return text;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  await mkdir(VENDOR_DIR, { recursive: true });
  await mkdir(CACHE_DIR, { recursive: true });

  const icsPath = join(VENDOR_DIR, 'academic.ics');
  const ics = await save(ICS_URL, icsPath, {
    label: 'academic.ics',
    dryRun,
    validate: (t) => (t.includes('BEGIN:VEVENT') ? null : 'no VEVENT'),
  });
  const events = parseIcs(ics);
  if (!events.length) die('the ICS parsed to zero events.');
  console.log(`  ${events.length} events`);

  const fivePath = join(CACHE_DIR, `${FIVE_YEAR_SLUG}.html`);
  const five = await save(FIVE_YEAR_URL, fivePath, {
    label: 'academic-calendar-5-year-view',
    dryRun,
    validate: (t) => (/<table/i.test(t) ? null : 'no tables'),
  });
  // The rendered text needs JavaScript, but the table markup sits in the raw
  // HTML, which is why this scrapes rather than driving a browser.
  const autumn = parseFiveYear(five, 'AUTUMN 2026');
  if (!autumn.length) die('the five-year view parsed to zero Autumn 2026 rows.');
  console.log(`  ${autumn.length} Autumn 2026 rows`);

  const finalsIndex = await save(FINALS_INDEX_URL, join(CACHE_DIR, 'finals-index.html'), {
    label: 'finals index',
    dryRun,
    validate: (t) => (/finals-schedule/i.test(t) ? null : 'no finals links'),
  });

  for (const name of ['Autumn 2026', 'Spring 2027']) {
    const { slug, url, all } = findFinalsLink(finalsIndex, name);
    if (!url) {
      console.warn(`  warn  no finals page for ${name}. The index lists: ${all.join(', ')}`);
      continue;
    }
    await save(url, join(CACHE_DIR, `${slug}.html`), {
      label: slug,
      dryRun,
      validate: (t) => (/<table/i.test(t) ? null : 'no tables'),
    });
  }

  const meta = {
    fetched: localDate(),
    ics: { source: ICS_URL, events: events.length, bytes: ics.length },
    fiveYear: { source: FIVE_YEAR_URL, slug: FIVE_YEAR_SLUG },
    finals: { index: FINALS_INDEX_URL },
    note:
      'Vendored, never fetched at runtime. The ICS is a third-party regeneration ' +
      'of the Registrar calendar and is the cross-check, not the source. See DECISIONS.md.',
  };
  if (dryRun) {
    console.log('DRY RUN, nothing written.');
    return;
  }
  await writeAtomic(join(VENDOR_DIR, 'academic.meta.json'), `${JSON.stringify(meta, null, 1)}\n`);
  console.log('wrote data/vendor/academic.ics and data/vendor/academic.meta.json');
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('fetch-calendar.mjs');
if (invokedDirectly) main().catch((err) => die(err.message));
