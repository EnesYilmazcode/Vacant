#!/usr/bin/env node
// Stamp the service worker's shell cache with the commit it was built from.
//
// The cache name is the only thing that makes a deploy land. A worker whose
// SHELL_CACHE never changes serves the same precached app.js to an installed
// icon forever, and the student never learns why the app stopped matching the
// screenshots.
//
// Run this in whatever job commits, before `git add`. That means the harvest
// workflow, and it means any human-pushed shell fix too: a deploy that skips the
// stamp keeps the previous SHA and the old shell stays pinned.
// scripts/test/sw.test.mjs is the backstop, not the mechanism.
//
// Run: node scripts/stamp-sw.mjs

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SW = join(ROOT, 'sw.js');

// Matches the authored placeholder and any previous stamp, so re-running is
// idempotent and always writes the current HEAD.
const LINE = /const SHELL_CACHE = 'vacant-shell-[^']*';/;

export function stamp(source, build) {
  if (!LINE.test(source)) throw new Error('sw.js has no SHELL_CACHE line to stamp');
  return source.replace(LINE, `const SHELL_CACHE = 'vacant-shell-${build}';`);
}

export function headShort(cwd = ROOT) {
  return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const build = headShort();
  if (!/^[0-9a-f]{7,}$/.test(build)) throw new Error(`not a commit sha: ${build}`);
  const before = readFileSync(SW, 'utf8');
  const after = stamp(before, build);
  if (after === before) {
    console.log(`sw.js already stamped vacant-shell-${build}`);
  } else {
    writeFileSync(SW, after);
    console.log(`sw.js stamped vacant-shell-${build}`);
  }
}
