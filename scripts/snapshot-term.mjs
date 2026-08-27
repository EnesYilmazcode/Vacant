#!/usr/bin/env node
// Archive one whole term of the class search, verbatim, before the API deletes it.
//
// A term that drops out of searchableTermsV2 is deleted from the search index,
// not hidden: term=1258 returns totalItems 0 today. Spring 2026 (1262) leaves on
// 2026-08-31 and Summer 2026 (1264) on 2027-01-01, and after that nothing can
// re-fetch them at any price. Whatever this writes is the only copy that will
// ever exist, so it is deliberately crude: no inversion, no schema, no dedupe.
//
// Usage:  node scripts/snapshot-term.mjs 1262
//         node scripts/snapshot-term.mjs 1262 --dry-run
//
// Re-running is safe and cheap. A page already on disk is not re-fetched, so an
// interrupted run resumes where it stopped.

import { gzipSync } from 'node:zlib';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchJson, requests, sleep } from './lib/fetch.mjs';

const API = 'https://content.osu.edu/v2/classes/search';
const CAMPUS = 'col';
const SORT = 'catalogNumber';
const PAGE_SIZE = 200;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Search refuses to page past 10000 results, so a bucket reporting 10000 is a
// bucket we are silently truncating. That is missing sections in an archive that
// can never be refetched, which is worse than no archive at all.
const RESULT_CAP = 10000;

const PAUSE_MS = 500;

function searchUrl(term, params = {}) {
  const qs = new URLSearchParams({ q: '', campus: CAMPUS, term, sort: SORT, ...params });
  return `${API}?${qs}`;
}

function die(message) {
  console.error(`\nFATAL  ${message}`);
  console.error(`       ${requests()} requests made before stopping.`);
  process.exit(1);
}

// The PII is on meeting.instructors, NOT section.instructors. Section-level is
// empty on every page measured; meeting-level carried 164 distinct real osu.edu
// addresses on one page of one bucket. Stripping the documented-but-wrong path
// would publish every one of them.
export function stripInstructors(page) {
  let removed = 0;
  for (const course of page?.data?.courses ?? []) {
    for (const section of course.sections ?? []) {
      if (Array.isArray(section.instructors)) {
        removed += section.instructors.length;
        delete section.instructors;
      }
      for (const meeting of section.meetings ?? []) {
        if (Array.isArray(meeting.instructors)) {
          removed += meeting.instructors.length;
          delete meeting.instructors;
        }
      }
    }
  }
  return removed;
}

export function countSections(page) {
  let n = 0;
  for (const course of page?.data?.courses ?? []) n += (course.sections ?? []).length;
  return n;
}

async function main() {
  const term = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  if (!/^\d{4}$/.test(term ?? '')) {
    console.error('usage: node scripts/snapshot-term.mjs <term> [--dry-run]');
    process.exit(2);
  }

  const outDir = join(ROOT, 'data', 'raw', term);
  await mkdir(outDir, { recursive: true });

  console.log(`term ${term} -> data/raw/${term}/${dryRun ? '   (DRY RUN, nothing written)' : ''}`);

  // The head request does two jobs: prove the term has not expired, and read the
  // bucket list off the facet. Never hardcode 1xxx..8xxx, a smaller term may not
  // have all eight.
  const head = await fetchJson(searchUrl(term));
  const totalItems = head?.data?.totalItems ?? 0;
  if (totalItems === 0) {
    die(`term ${term} returns totalItems 0. It has already left searchableTermsV2 and is gone.`);
  }

  const facet = (head.data.filters ?? []).find((f) => f.slug === 'catalog-number');
  const buckets = (facet?.items ?? []).map((i) => ({ slug: i.term, facetCount: i.count }));
  if (!buckets.length) die(`term ${term} has no catalog-number facet, so there is nothing to walk.`);

  // The unfiltered head reports the 10000 cap, not the real total. The facet
  // counts are the ground truth: they sum to 25274 for term 1262 against a head
  // that says 10000.
  const facetTotal = buckets.reduce((a, b) => a + b.facetCount, 0);
  const capNote = totalItems === RESULT_CAP ? ', the cap, not a total' : '';
  console.log(
    `${buckets.length} buckets, ${facetTotal} sections by facet count ` +
      `(head reports ${totalItems}${capNote})\n`,
  );

  const report = [];
  let piiRemoved = 0;
  let skipped = 0;

  for (const { slug, facetCount } of buckets) {
    const first = await fetchJson(searchUrl(term, { 'catalog-number': slug, p: 1 }));
    await sleep(PAUSE_MS);

    const bucketItems = first?.data?.totalItems ?? 0;
    if (bucketItems === 0) die(`bucket ${slug} of term ${term} returned totalItems 0.`);
    if (bucketItems >= RESULT_CAP) {
      die(
        `bucket ${slug} reports ${bucketItems} items, at or past the ${RESULT_CAP} paging cap. ` +
          `The walk would silently drop sections from an archive that cannot be refetched.`,
      );
    }

    const computed = Math.ceil(bucketItems / PAGE_SIZE);
    const reported = first?.data?.totalPages ?? 0;
    if (computed !== reported) {
      console.warn(
        `  warn  ${slug}: ceil(${bucketItems}/${PAGE_SIZE})=${computed} but totalPages=${reported}`,
      );
    }
    const pages = Math.max(computed, reported);

    let written = 0;
    for (let p = 1; p <= pages; p++) {
      const name = `${slug}-p${String(p).padStart(2, '0')}.json.gz`;
      const path = join(outDir, name);

      if (existsSync(path)) {
        skipped++;
        continue;
      }

      const page =
        p === 1 ? first : await fetchJson(searchUrl(term, { 'catalog-number': slug, p }));
      if (p > 1) await sleep(PAUSE_MS);

      piiRemoved += stripInstructors(page);
      written += countSections(page);

      const body = JSON.stringify(page);
      // Cheap insurance, and fatal on purpose. If the strip ever misses a path
      // the API adds later, this stops the run instead of committing addresses.
      if (/@osu\.edu/i.test(body)) {
        die(`${name} still contains an @osu.edu address after the instructor strip.`);
      }

      if (!dryRun) await writeFile(path, gzipSync(body, { level: 9 }));
    }

    const status = written === 0 && skipped ? 'cached' : written >= facetCount ? 'ok' : 'SHORT';
    report.push({ bucket: slug, facetCount, bucketItems, pages, written, status });
    console.log(
      `  ${slug}  ${String(pages).padStart(2)} pages  facet ${String(facetCount).padStart(5)}  ` +
        `head ${String(bucketItems).padStart(5)}  written ${String(written).padStart(5)}  ${status}`,
    );
  }

  const onDisk = (await readdir(outDir)).filter((f) => f.endsWith('.json.gz')).length;
  const totalWritten = report.reduce((a, b) => a + b.written, 0);

  if (!dryRun) {
    const manifest = {
      term,
      source: API,
      campus: CAMPUS,
      sort: SORT,
      facetTotal,
      sectionsWritten: totalWritten,
      pagesOnDisk: onDisk,
      instructorRecordsRemoved: piiRemoved,
      requests: requests(),
      buckets: report,
    };
    await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  }

  console.log(`\n${requests()} requests, ${onDisk} page files on disk, ${skipped} already cached.`);
  console.log(`${totalWritten} sections written this run, ${facetTotal} expected by facet count.`);
  console.log(`${piiRemoved} instructor records stripped before writing.`);

  const short = report.filter((r) => r.status === 'SHORT');
  if (short.length) {
    die(`${short.length} bucket(s) came back short: ${short.map((r) => r.bucket).join(', ')}`);
  }
}

// Importing this file for its helpers must not kick off a 215 request run.
const invokedDirectly = process.argv[1] && process.argv[1].endsWith('snapshot-term.mjs');
if (invokedDirectly) main().catch((err) => die(err.message));
