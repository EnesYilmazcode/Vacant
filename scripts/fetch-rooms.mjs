#!/usr/bin/env node
// Harvest a full term by walking the catalog-number buckets until stable.
//
// Vacant needs every section in a term, not a subject index. Finder walks 243
// subjects and pays about 1,142 requests, roughly 1,000 of which are its
// reconciliation loop. The catalog-number facet covers the same sections in 136
// requests with no reconciliation.
//
// Usage:  node scripts/fetch-rooms.mjs 1268
//         node scripts/fetch-rooms.mjs 1268 --dry-run
//
// Passes repeat until two in a row add nothing new. The research says two
// passes suffice because "sorted paging is about 98% deterministic", and
// budgets 0.5% drift. Measured over the whole of term 1268 that is wrong by
// about seven times:
//
//   pass 1 read 26,298 section rows but only 25,270 DISTINCT classNumbers.
//   1,028 rows were the same section served twice on different pages, while
//   others were dropped. pass 2 then found 937 sections pass 1 never saw at
//   all, 3.6%, and pass 1 in turn caught 612 that pass 2 missed.
//
// Neither pass is a superset of the other, so a fixed two-pass union is still
// incomplete. A dropped section is a room that falsely reads EMPTY, which is a
// wrong answer rather than a missing one, so this walks until it stops finding
// anything new. Each extra pass costs 136 requests.

import { gzipSync } from 'node:zlib';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config, fetchJson, requests, sleep } from './lib/fetch.mjs';
import { hasRealRoom, stripMeetingInstructors } from './lib/funnel.mjs';

const API = 'https://content.osu.edu/v2/classes/search';
const CAMPUS = 'col';
const SORT = 'catalogNumber';
const PAGE_SIZE = 200;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Search refuses to page past 10000 results, so 50 pages is the real ceiling
// and a bucket reporting the cap is a bucket being silently truncated.
const RESULT_CAP = 10000;
const MAX_PAGES = 50;
const PAUSE_MS = config.DELAY_MS;

// Walk until this many consecutive passes add no new meeting IN A REAL ROOM.
//
// Converging on every meeting instead took 7 passes and 953 requests for term
// 1268, and the last four of those passes added 42 meetings of which exactly
// ZERO were in a room. Roomless meetings cannot change an answer, so paying 272
// extra requests against a university's API to chase them is not politeness.
// Measured convergence, roomed meetings only:
//
//   pass 1  11443 roomed   pass 4  0
//   pass 2      7 roomed   pass 5  0
//   pass 3      4 roomed   -> stops here, 5 passes, ~680 requests
const STABLE_PASSES = 2;

// However stable it looks, fewer than this many passes has not earned the
// claim. Pass 2 found 7 roomed meetings pass 1 missed.
const MIN_PASSES = 3;

// A ceiling, not a target. Eight passes is 1,088 requests, still under the 1,142
// Finder pays for the same term by a different route, and well under
// MAX_REQUESTS. Running out of passes while still finding sections means paging
// has changed shape, and that should fail rather than ship a grid with holes.
const MAX_PASSES = 8;

const localDate = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

function die(message) {
  console.error(`\nFATAL  ${message}`);
  console.error(`       ${requests()} requests made before stopping.`);
  process.exit(1);
}

const searchUrl = (term, params = {}) =>
  `${API}?${new URLSearchParams({ q: '', campus: CAMPUS, term, sort: SORT, ...params })}`;

// The seven fields that identify one meeting. Anything less collides: a course
// with two meeting rows in the same room differs only by meetingNumber and
// time, and a section taught in two rooms differs only by facilityId.
export const meetingKey = (section, meeting) => {
  // The line that calls this already guards for a null row on the stated
  // principle that shape drift shows up as a moved number rather than a crash.
  // Dereferencing here unguarded would abort a fifteen minute harvest.
  if (typeof meeting !== 'object' || meeting === null) return null;
  return [
    section.classNumber,
    meeting.meetingNumber,
    meeting.facilityId,
    meeting.startTime,
    meeting.endTime,
    meeting.standingMeetingPattern,
    section?.startDate,
  ].join('|');
};

async function writeAtomic(path, buffer) {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, buffer);
  await rename(tmp, path);
}

// One complete walk of every bucket, keyed by meeting. Pages are parsed and
// discarded rather than accumulated: holding 136 of them per pass across up to
// eight passes is hundreds of megabytes for data already in the map.
async function walk(term, buckets, { label }) {
  const meetings = new Map();
  let cumulative = 0;

  for (const { slug, facetCount } of buckets) {
    let first = await fetchJson(searchUrl(term, { 'catalog-number': slug, p: 1 }));
    await sleep(PAUSE_MS);

    // The whole premise of this script is that the API is nondeterministic under
    // paging, so treating one zero-count as fatal is the brittle reading of its
    // own evidence. A run is now 5 to 8 passes and 15 minutes with nothing
    // written until the end, so a single blip would discard ~950 requests and
    // restart from zero. Ask twice before believing it.
    if ((first?.data?.totalItems ?? 0) === 0) {
      console.warn(`  warn  ${slug}: totalItems 0 on ${label}, asking once more`);
      await sleep(PAUSE_MS * 4);
      first = await fetchJson(searchUrl(term, { 'catalog-number': slug, p: 1 }));
      await sleep(PAUSE_MS);
    }

    const items = first?.data?.totalItems ?? 0;
    if (items === 0) die(`bucket ${slug} returned totalItems 0 twice on ${label}.`);
    if (items >= RESULT_CAP) {
      die(`bucket ${slug} reports ${items} items, at or past the ${RESULT_CAP} paging cap.`);
    }

    const computed = Math.ceil(items / PAGE_SIZE);
    const reported = first?.data?.totalPages ?? 0;
    if (computed !== reported) {
      console.warn(`  warn  ${slug}: ceil(${items}/${PAGE_SIZE})=${computed} but totalPages=${reported}`);
    }
    const count = Math.min(Math.max(computed, reported), MAX_PAGES);

    let sections = 0;
    for (let p = 1; p <= count; p++) {
      const page = p === 1 ? first : await fetchJson(searchUrl(term, { 'catalog-number': slug, p }));
      if (p > 1) await sleep(PAUSE_MS);

      for (const course of page?.data?.courses ?? []) {
        for (const section of course.sections ?? []) {
          sections++;
          // At the parse boundary, the moment the meeting is first read.
          delete section.instructors;
          for (const meeting of section.meetings ?? []) {
            stripMeetingInstructors(meeting);
            const key = meetingKey(section, meeting);
            if (key === null) continue;
            meetings.set(key, { section, meeting });
          }
        }
      }
    }

    cumulative += count;
    console.log(
      `  ${label}  ${slug}  ${String(count).padStart(2)} pages  facet ${String(facetCount).padStart(5)}  ` +
        `sections ${String(sections).padStart(5)}  cumulative requests ${cumulative}`,
    );
  }

  return { meetings };
}

async function main() {
  const term = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  if (!/^\d{4}$/.test(term ?? '')) {
    console.error('usage: node scripts/fetch-rooms.mjs <term> [--dry-run]');
    process.exit(2);
  }

  await mkdir(join(ROOT, 'data'), { recursive: true });
  const manifestPath = join(ROOT, 'data', `harvest-${term}.manifest.json`);
  const previousRuns = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, 'utf8')).runs ?? 0)
    : 0;

  const head = await fetchJson(searchUrl(term));
  if ((head?.data?.totalItems ?? 0) === 0) die(`term ${term} returns totalItems 0. It has expired.`);

  // Never hardcode 1xxx..8xxx. A smaller term may not have all eight.
  const facet = (head.data.filters ?? []).find((f) => f.slug === 'catalog-number');
  const buckets = (facet?.items ?? []).map((i) => ({ slug: i.term, facetCount: i.count }));
  if (!buckets.length) die(`the catalog-number facet is absent or empty for term ${term}.`);

  const facetTotal = buckets.reduce((a, b) => a + b.facetCount, 0);
  console.log(`term ${term}: ${buckets.length} buckets, ${facetTotal} sections by facet count\n`);

  const union = new Map();
  const history = [];
  let stable = 0;
  let passNo = 0;

  while ((stable < STABLE_PASSES || passNo < MIN_PASSES) && passNo < MAX_PASSES) {
    passNo++;
    const pass = await walk(term, buckets, { label: `pass ${passNo}` });

    let added = 0;
    let addedWithRoom = 0;
    for (const [key, value] of pass.meetings) {
      if (union.has(key)) continue;
      union.set(key, value);
      added++;
      // Only a meeting in a real room can change an answer, and a bare
      // `facilityId != null` is not that test: ONLINE and OFFCAMPUS carry a
      // facilityId of their own and are 26% of the rows that pass it. Counting
      // them meant one drifted ONLINE row could reset stability and buy two
      // more passes, 272 requests, for a meeting build-index.mjs discards.
      if (hasRealRoom(value.meeting)) addedWithRoom++;
    }

    history.push({ pass: passNo, saw: pass.meetings.size, added, addedWithRoom, unionAfter: union.size });
    // Roomed, not total. A roomless meeting arriving late cannot change what the
    // app tells anyone.
    stable = addedWithRoom === 0 ? stable + 1 : 0;

    console.log(
      `\npass ${passNo}: saw ${pass.meetings.size}, added ${added} new ` +
        `(${addedWithRoom} in a real room), union now ${union.size}` +
        (addedWithRoom ? '' : `  [${stable} of ${STABLE_PASSES} clean passes]`),
    );
    console.log();
  }

  if (stable < STABLE_PASSES) {
    die(
      `still finding rooms after ${MAX_PASSES} passes. Paging has changed shape, ` +
        `and shipping this would put holes in the grid.`,
    );
  }

  // hasRealRoom, not a null check. The manifest's own headline number was
  // overstating by 26% because ONLINE and OFFCAMPUS pass a null check.
  const roomed = [...union.values()].filter((v) => hasRealRoom(v.meeting));
  const missedByOnePass = union.size - history[0].saw;
  const roomedMissed = history.slice(1).reduce((a, h) => a + h.addedWithRoom, 0);
  console.log(
    `converged after ${passNo} passes: ${union.size} distinct meetings, ` +
      `${roomed.length} in a real room.\n` +
      `a single pass would have missed ${missedByOnePass} meetings ` +
      `(${((missedByOnePass / union.size) * 100).toFixed(2)}%), ` +
      `${roomedMissed} of them in a real room.`,
  );

  console.log(`\n${requests()} requests total.`);
  if (dryRun) {
    console.log('DRY RUN, nothing written.');
    return;
  }

  // The union is the output. Writing any single pass's pages would reintroduce
  // exactly the gaps the extra passes exist to close.
  const payload = {
    term,
    generated: localDate(),
    source: API,
    passes: passNo,
    history,
    meetings: [...union.values()].map(({ section, meeting }) => ({
      classNumber: section.classNumber,
      subject: section.subject,
      catalogNumber: section.catalogNumber,
      component: section.component,
      location: section.location,
      campus: section.campus,
      sessionCode: section.sessionCode,
      startDate: section.startDate,
      endDate: section.endDate,
      m: meeting,
    })),
  };

  const body = JSON.stringify(payload);
  if (/@osu\.edu/i.test(body)) die('an @osu.edu address survived the instructor strip.');
  await writeAtomic(join(ROOT, 'data', `harvest-${term}.json.gz`), gzipSync(body, { level: 9 }));

  await writeAtomic(
    manifestPath,
    Buffer.from(
      `${JSON.stringify(
        {
          term,
          runs: previousRuns + 1,
          facetTotal,
          passes: passNo,
          history,
          distinctMeetings: union.size,
          meetingsInARealRoom: roomed.length,
          missedBySinglePass: missedByOnePass,
          roomedMissedBySinglePass: roomedMissed,
          requests: requests(),
          buckets,
        },
        null,
        2,
      )}\n`,
    ),
  );
  console.log(
    `wrote data/harvest-${term}.json.gz (${(Buffer.byteLength(body) / 1024 / 1024).toFixed(1)} MB raw) ` +
      `and data/harvest-${term}.manifest.json`,
  );
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('fetch-rooms.mjs');
if (invokedDirectly) main().catch((err) => die(err.message));
