#!/usr/bin/env node
// Roll Vacant onto the next term, in two halves, so the switch is one command
// instead of a sequence somebody has to remember in December.
//
// Usage:  node scripts/roll-term.mjs 1272              print the plan, run nothing
//         node scripts/roll-term.mjs 1272 --prepare    stage the term beside the live one
//         node scripts/roll-term.mjs 1272 --flip       point the app at it
//         node scripts/roll-term.mjs 1272 --flip --early
//
// Why two halves. The weekly job (rooms.yml) only rebuilds the term
// current.json names, and only once data/buildings-<term>.json is committed,
// which nothing in the workflow can produce. So a new term has to be built here
// first. But building it the old way, with build-index.mjs and no flag, also
// rewrites current.json, which points every phone at the new term the moment it
// is pushed. Before Autumn's finals are over that is a wrong answer: the app
// would say "Spring 2027 has not started yet" in the middle of a teaching week.
//
//   --prepare  calendar, building hours, the harvest, the room index with
//              --no-pointer, and the term's buildings subset. current.json is
//              not touched, so this can be committed any time and the live
//              term keeps working. About 690 requests, almost all the harvest.
//
//   --flip     refuses until the live term's finals are over (--early skips
//              that), then pulls the two single-term Registrar files (the
//              general assignment list and room features), rebuilds the index
//              WITH the pointer, sweeps next week's registered events, and runs
//              the same checks rooms.yml runs before it pushes. If a required
//              step fails, the shared files it may have rewritten are put back,
//              so the checkout is never left pointing at a half-built term.
//
// Nothing here commits or pushes. Each half ends by printing the git commands.
// After the flip is pushed, rooms.yml picks the new term up on its own every
// Sunday, because it rebuilds whatever current.json names.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { termName } from './build-index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// The slug rule build-index.mjs and js/app.js both use to pick a term's table
// out of data/buildings-hours.json. Kept identical on purpose; a test checks.
export function hoursSlugFor(term) {
  return (termName(term) ?? '').toLowerCase().replace(/\s+/g, '-');
}

export function hasHoursTable(term, hoursFile) {
  const want = hoursSlugFor(term);
  return Boolean(want) && Object.keys(hoursFile?.terms ?? {}).some((slug) => slug.startsWith(want));
}

// The step list, as data, so a test can hold the order without running it.
// `optional` means a failure is reported and the roll carries on, because the
// file it would refresh has a committed copy the build already tolerates.
export function planSteps(term, mode) {
  const node = (...args) => ['node', ...args];
  if (mode === 'prepare') {
    return [
      { cmd: node('scripts/fetch-calendar.mjs'), why: "closed days and the finals window for the new term" },
      { cmd: node('scripts/fetch-building-hours.mjs'), why: "the new term's door hours, added beside the live term's" },
      { cmd: node('scripts/fetch-rooms.mjs', term), why: 'the harvest, about 680 requests' },
      { cmd: node('scripts/build-index.mjs', term, '--no-pointer'), why: 'the room index, leaving current.json alone' },
      { cmd: node('scripts/fetch-buildings.mjs', '--term', term), why: "the buildings subset the weekly job requires" },
      { cmd: node('scripts/check-term-assets.mjs', term), why: 'the subset matches the index' },
    ];
  }
  if (mode === 'flip') {
    return [
      { cmd: node('scripts/fetch-ga-rooms.mjs', term), why: 'the general assignment list for the new term', optional: true },
      {
        cmd: node('scripts/fetch-room-features.mjs', '--term', term, '--rooms', `data/rooms-${term}.json`),
        why: 'room characteristics for the new term',
        optional: true,
      },
      { cmd: node('scripts/build-index.mjs', term), why: 'the index again, this time writing current.json' },
      // Again, because the hours table can land between the two halves, and
      // the hours rule drops rooms, which changes which buildings the subset
      // must carry.
      { cmd: node('scripts/fetch-buildings.mjs', '--term', term), why: 'the buildings subset against the final index' },
      { cmd: node('scripts/check-term-assets.mjs', term), why: 'the subset still matches the index' },
      { cmd: node('scripts/fetch-room-events.mjs'), why: "next week's registered events for the new rooms" },
      { cmd: node('scripts/check-event-coverage.mjs'), why: 'the events cover the week the app is about to serve' },
      { cmd: node('--test'), why: 'the suite rooms.yml runs before it pushes' },
    ];
  }
  throw new Error(`unknown mode ${mode}`);
}

// The files a flip may rewrite that the live term also depends on. Restored
// byte for byte if a required step fails.
export function flipTouches(term) {
  return [
    'data/current.json',
    'data/ga-rooms.json',
    'data/room-features.json',
    'data/buildings.json',
    `data/rooms-${term}.json`,
    `data/buildings-${term}.json`,
    `data/room-events-${term}.json`,
  ];
}

// The date the live term stops needing the live index: the last day of finals,
// or the last day of instruction when the index carries no exam window.
export function liveTermEnds(currentIndex, current) {
  return currentIndex?.exams?.end ?? current?.instruction?.[1] ?? null;
}

// Every reason not to start. An empty list means go.
export function blockers({ term, mode, today, current, currentIndex, terms, hoursFile, exists, early = false }) {
  const out = [];
  if (!/^\d{4}$/.test(term ?? '')) return ['the term has to be a four digit code, like 1272'];
  if (!termName(term)) out.push(`term ${term} has no season Vacant knows, so it cannot be named`);
  const searchable = (terms?.terms ?? []).map((t) => String(t.strm));
  if (searchable.length && !searchable.includes(term)) {
    out.push(`term ${term} is not in data/terms.json's searchable list (${searchable.join(', ')}). Run check-terms.mjs.`);
  }
  if (String(current?.term) === term) out.push(`current.json already names ${term}. Nothing to roll.`);

  if (mode === 'flip') {
    for (const path of [`data/rooms-${term}.json`, `data/buildings-${term}.json`]) {
      if (!exists(path)) out.push(`${path} is missing. Run --prepare first.`);
    }
    if (!hasHoursTable(term, hoursFile)) {
      out.push(
        `data/buildings-hours.json has no "${hoursSlugFor(term)}" table. The Registrar has not posted the ` +
          "new term's building schedule, or fetch-building-hours.mjs has not run since. Without it every " +
          'room in a locked building ships as open, so the flip waits.',
      );
    }
    const ends = liveTermEnds(currentIndex, current);
    if (!early && ends && today <= ends) {
      out.push(
        `${current?.termName ?? 'The live term'} runs until ${ends}. Flipping now would tell students ` +
          `the next term has not started, in the middle of this one. Wait until after ${ends}, or pass --early.`,
      );
    }
  }
  return out;
}

// Campus time, because "after finals" is a date in Columbus, not in UTC.
export function campusToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
}

const readJson = (rel) => {
  const path = join(ROOT, rel);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
};

function run(step) {
  console.log(`\n==> ${step.cmd.join(' ')}\n    ${step.why}`);
  const [bin, ...args] = step.cmd;
  const res = spawnSync(bin === 'node' ? process.execPath : bin, args, { cwd: ROOT, stdio: 'inherit' });
  return res.status === 0;
}

function snapshot(paths) {
  return new Map(paths.map((p) => [p, existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p)) : null]));
}

function restore(saved) {
  for (const [p, bytes] of saved) {
    const path = join(ROOT, p);
    if (bytes === null) rmSync(path, { force: true });
    else writeFileSync(path, bytes);
  }
}

function main() {
  const [term] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
  const mode = flags.has('--flip') ? 'flip' : flags.has('--prepare') ? 'prepare' : 'plan';
  if (flags.has('--flip') && flags.has('--prepare')) {
    console.error('Pick one: --prepare stages the term, --flip points the app at it.');
    process.exit(2);
  }
  if (!/^\d{4}$/.test(term ?? '')) {
    console.error('usage: node scripts/roll-term.mjs <term> [--prepare | --flip [--early]]');
    process.exit(2);
  }

  const current = readJson('data/current.json');
  const ctx = {
    term,
    today: campusToday(),
    current,
    currentIndex: current?.rooms ? readJson(current.rooms) : null,
    terms: readJson('data/terms.json'),
    hoursFile: readJson('data/buildings-hours.json'),
    exists: (rel) => existsSync(join(ROOT, rel)),
    early: flags.has('--early'),
  };

  if (mode === 'plan') {
    const ends = liveTermEnds(ctx.currentIndex, current);
    console.log(`Rolling ${current?.termName ?? '?'} (${current?.term ?? '?'}) to ${termName(term) ?? '?'} (${term}).`);
    console.log(`Live term ends ${ends ?? 'unknown'}; today in Columbus is ${ctx.today}.\n`);
    for (const m of ['prepare', 'flip']) {
      console.log(`--${m}`);
      for (const s of planSteps(term, m)) console.log(`  ${s.cmd.join(' ')}${s.optional ? '   (optional)' : ''}\n      ${s.why}`);
      const why = blockers({ ...ctx, mode: m });
      console.log(why.length ? `  would refuse right now:\n${why.map((w) => `    - ${w}`).join('\n')}` : '  would run right now.');
      console.log('');
    }
    return;
  }

  const why = blockers({ ...ctx, mode });
  if (why.length) {
    console.error(`Refusing to ${mode} ${term}:`);
    for (const w of why) console.error(`  - ${w}`);
    process.exit(1);
  }

  const saved = mode === 'flip' ? snapshot(flipTouches(term)) : null;
  const skipped = [];
  for (const step of planSteps(term, mode)) {
    if (run(step)) continue;
    if (step.optional) {
      skipped.push(step);
      console.warn(`    optional step failed; the committed file stays as it is.`);
      continue;
    }
    if (saved) {
      restore(saved);
      console.error(`\nFAILED at: ${step.cmd.join(' ')}`);
      console.error(`Put back ${[...saved.keys()].join(', ')}. current.json still names ${current?.term}.`);
    } else {
      console.error(`\nFAILED at: ${step.cmd.join(' ')}. current.json was not touched.`);
    }
    process.exit(1);
  }

  console.log(`\n${mode === 'prepare' ? 'Prepared' : 'Flipped to'} ${termName(term)} (${term}).`);
  for (const s of skipped) console.log(`  skipped (optional): ${s.cmd.join(' ')}`);
  if (mode === 'prepare') {
    console.log('The live term is untouched. Commit the staged files, then flip after finals:');
    console.log('  git add data/ && git commit -m "Stage the next term"');
    console.log(`  node scripts/roll-term.mjs ${term} --flip`);
  } else {
    console.log('current.json now names the new term. Review, commit and push:');
    console.log('  git status data/ && git add data/ && git commit -m "Roll the app onto the next term"');
  }
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('roll-term.mjs');
if (invokedDirectly) main();
