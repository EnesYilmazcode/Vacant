#!/usr/bin/env node
// Describe ordinary production-schedule movement without deciding whether the
// refreshed data may publish. Structural and completeness checks stay in the
// blocking test suite; this report is deliberately observational.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function occupiedRoomDays(index) {
  const pairs = new Set();
  for (const [id, room] of Object.entries(index?.rooms ?? {})) {
    for (const meeting of room.busy ?? []) {
      const day = Number(meeting?.[0]);
      if (Number.isInteger(day) && day >= 0 && day < DAYS.length) {
        pairs.add(`${DAYS[day]} ${id}`);
      }
    }
  }
  return pairs;
}

export function scheduleDrift(before, after) {
  const previous = occupiedRoomDays(before);
  const current = occupiedRoomDays(after);
  return {
    added: [...current].filter((pair) => !previous.has(pair)).sort(),
    removed: [...previous].filter((pair) => !current.has(pair)).sort(),
    beforeRooms: Object.keys(before?.rooms ?? {}).length,
    afterRooms: Object.keys(after?.rooms ?? {}).length,
  };
}

const line = (label, values) => `- ${label}: ${values.length ? values.join(', ') : 'none'}`;

export function driftSummary(drift, { limit = 100 } = {}) {
  const clipped = (values) => values.length > limit
    ? [...values.slice(0, limit), `… and ${values.length - limit} more`]
    : values;
  return [
    '## Production schedule drift',
    '',
    `Previous harvest: ${drift.beforeRooms} rooms. Refreshed harvest: ${drift.afterRooms} rooms.`,
    '',
    line('Added room-days', clipped(drift.added)),
    line('Removed room-days', clipped(drift.removed)),
    '',
    '_This report is non-blocking. Structural integrity checks still gate publication._',
  ].join('\n');
}

function fromHead(path) {
  return JSON.parse(execFileSync('git', ['show', `HEAD:${path}`], { cwd: ROOT, encoding: 'utf8' }));
}

function main() {
  try {
    const current = JSON.parse(readFileSync(join(ROOT, 'data/current.json'), 'utf8'));
    const after = JSON.parse(readFileSync(join(ROOT, current.rooms), 'utf8'));
    let before;
    try {
      before = fromHead(current.rooms);
    } catch {
      console.log([
        '## Production schedule drift',
        '',
        `No previous ${current.rooms} exists on HEAD; this is the first harvest baseline.`,
        '',
        '_This report is non-blocking. Structural integrity checks still gate publication._',
      ].join('\n'));
      return;
    }
    console.log(driftSummary(scheduleDrift(before, after)));
  } catch (error) {
    // A reporter must never become a publishing gate. The blocking integrity
    // checks run separately and will still reject malformed data.
    console.log(`## Production schedule drift\n\nCould not produce the non-blocking report: ${error.message}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
