#!/usr/bin/env node
// The dead man's switch.
//
// rooms.yml can tell you it failed. It cannot tell you it never ran, and a
// scheduled workflow stops running for three ordinary reasons: GitHub disables
// schedules in a repository with 60 days of no activity, a bad YAML edit kills
// the trigger without a word, or the cron line gets deleted. A workflow cannot
// alert on its own absence, so something else has to notice the silence.
//
// This reads the committed data/current.json and fails when its `generated`
// stamp is too old, whatever the reason it stopped moving.
//
// Usage:  node scripts/check-freshness.mjs
//         node scripts/check-freshness.mjs --max-days 20
//
// Read the limit of this honestly. stale-watch.yml is itself a scheduled
// workflow, so the 60-day disable silences the build and this watch together.
// It also reads the committed file, not the deployed one, so a Pages deployment
// that stopped publishing looks fine from here. The check that would survive
// both is written down in .github/OPS.md and is not running anywhere yet.

import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Ten days, not seven. rooms.yml runs weekly and GitHub starts scheduled jobs 31
// to 62 minutes late on this account (n=10, median 48, measured in
// docs/research/ops-freshness.md), so one skipped build plus an hour of slop
// must not cry wolf. Ten is one missed Sunday plus three days, so a single
// silent week is still caught four days before the next build is due.
export const MAX_DAYS = 10;

// rooms.yml's cron. Only used to count how many builds an age has swallowed.
const WEEKLY_DAYS = 7;

// A stamp from the future is a broken clock or a bad build, not freshness. An
// hour of tolerance covers runner clock skew and nothing else.
const FUTURE_TOLERANCE_DAYS = 1 / 24;

export function ageInDays(generated, now = new Date()) {
  if (typeof generated !== 'string') return null;
  const t = Date.parse(generated);
  if (!Number.isFinite(t)) return null;
  return (now.getTime() - t) / 86400000;
}

// Returns { ok, days, reason }. "We cannot tell how old this is" counts as
// stale. A screen that reports free rooms off data of unknown age is the exact
// failure this project exists to avoid, so unknown never resolves to fine.
export function freshness(current, now = new Date(), maxDays = MAX_DAYS) {
  if (typeof current !== 'object' || current === null) {
    return { ok: false, days: null, reason: 'current.json did not parse into an object.' };
  }
  const days = ageInDays(current.generated, now);
  if (days === null) {
    return {
      ok: false,
      days: null,
      reason: `current.json has no readable "generated" stamp (saw ${JSON.stringify(current.generated)}).`,
    };
  }
  const rounded = days.toFixed(1);
  if (days < -FUTURE_TOLERANCE_DAYS) {
    return {
      ok: false,
      days,
      reason: `current.json is stamped ${current.generated}, which is ${(-days).toFixed(1)} days in the future.`,
    };
  }
  if (days > maxDays) {
    // Counted, not assumed. At the 10 day limit exactly one Sunday has gone by
    // without a write, and saying two would be a wrong number in a workflow log
    // that a human reads once and acts on.
    const missed = Math.floor(days / WEEKLY_DAYS);
    return {
      ok: false,
      days,
      reason:
        `current.json was generated ${rounded} days ago, past the ${maxDays} day limit.` +
        (missed >= 1 ? ` The weekly build has missed ${missed} run${missed === 1 ? '' : 's'}.` : ''),
    };
  }
  return { ok: true, days, reason: `current.json was generated ${rounded} days ago.` };
}

function main() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--max-days');
  const maxDays = i === -1 ? MAX_DAYS : Number(argv[i + 1]);
  if (!Number.isFinite(maxDays) || maxDays <= 0) {
    console.error('usage: node scripts/check-freshness.mjs [--max-days <n>]');
    process.exit(2);
  }

  // The workflow puts this straight into an issue title. A file that will not
  // parse has not "gone stale", and saying so files a wrong claim somewhere
  // nobody goes back to correct it.
  const alert = (title) => {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `alert=${title}\n`);
  };

  const path = join(ROOT, 'data', 'current.json');
  let current;
  try {
    current = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    console.error(`FATAL  cannot read data/current.json: ${err.message}`);
    alert('current.json cannot be read');
    process.exit(1);
  }

  const result = freshness(current, new Date(), maxDays);
  console.log(`term ${current.term ?? '?'} (${current.termName ?? '?'})`);
  console.log(result.ok ? `OK     ${result.reason}` : `STALE  ${result.reason}`);
  if (!result.ok) alert(result.days === null ? 'current.json cannot be read' : 'Room index has gone stale');
  process.exit(result.ok ? 0 : 1);
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('check-freshness.mjs');
if (invokedDirectly) main();
