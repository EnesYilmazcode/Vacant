#!/usr/bin/env node
// Refuse a weekly publish whose Room Matrix snapshot expires before the week
// the Sunday job is preparing. This checks the committed-shaped files after the
// scraper writes them, before the workflow can push a new current.json.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultWeek } from './fetch-room-events.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function checkEventCoverage({ current, index, events, now = new Date() }) {
  const week = defaultWeek(now);
  const [month, day, year] = week.split('/').map(Number);
  const monday = new Date(Date.UTC(year, month - 1, day));
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  const start = monday.toISOString().slice(0, 10);
  const end = sunday.toISOString().slice(0, 10);
  const meta = events?._meta;
  if (!current || !index || !meta || meta.partial || meta.term !== current.term || index.term !== current.term) {
    throw new Error('Room Matrix snapshot is partial or belongs to another term.');
  }
  if (meta.week !== week || meta.weekStart !== start || meta.weekEnd !== end) {
    throw new Error(`Room Matrix covers ${meta.weekStart ?? '?'} through ${meta.weekEnd ?? '?'}, expected ${start} through ${end}.`);
  }
  const roomIds = Object.keys(index.rooms ?? {}).sort();
  const sweptIds = Object.keys(events.rooms ?? {}).sort();
  if (JSON.stringify(roomIds) !== JSON.stringify(sweptIds)) {
    throw new Error(`Room Matrix swept ${sweptIds.length} of ${roomIds.length} indexed rooms.`);
  }
  if (meta.counts?.roomsParsed !== roomIds.length || meta.counts?.noGrid || meta.counts?.invalidValue) {
    throw new Error('Room Matrix parser did not produce a complete valid sweep.');
  }
  // The weeks ahead are a cushion, not a requirement: a failed second sweep
  // still publishes the first. What is checked is that whatever IS there is
  // the next consecutive week of the same term, complete, over the same rooms,
  // so the app can never lay one week's bookings over another week's dates.
  let through = end;
  for (const next of events.ahead ?? []) {
    const m = next?._meta;
    const wantStart = addDays(through, 1);
    const wantEnd = addDays(through, 7);
    if (!m || m.partial || m.term !== current.term) {
      throw new Error('A week ahead in the Room Matrix file is partial or belongs to another term.');
    }
    if (m.weekStart !== wantStart || m.weekEnd !== wantEnd) {
      throw new Error(`A week ahead covers ${m.weekStart ?? '?'} through ${m.weekEnd ?? '?'}, expected ${wantStart} through ${wantEnd}.`);
    }
    if (JSON.stringify(Object.keys(next.rooms ?? {}).sort()) !== JSON.stringify(roomIds)
      || m.counts?.roomsParsed !== roomIds.length || m.counts?.noGrid || m.counts?.invalidValue) {
      throw new Error(`The week of ${m.weekStart} is not a complete valid sweep of the indexed rooms.`);
    }
    through = wantEnd;
  }
  return { start, end, through, rooms: roomIds.length };
}

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function main() {
  const current = JSON.parse(readFileSync(join(ROOT, 'data/current.json')));
  const index = JSON.parse(readFileSync(join(ROOT, current.rooms)));
  const events = JSON.parse(readFileSync(join(ROOT, current.events)));
  const result = checkEventCoverage({ current, index, events });
  console.log(`Room Matrix covers ${result.start} through ${result.through}, ${result.rooms} rooms.`);
  if (result.through === result.end) {
    console.warn('  warn  no week ahead in the file: a missed Sunday would leave next week class-only.');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { main(); } catch (error) { console.error(`FATAL  ${error.message}`); process.exitCode = 1; }
}
