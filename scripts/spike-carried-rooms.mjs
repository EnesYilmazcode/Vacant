#!/usr/bin/env node
// SPIKE: does a genuinely never-scheduled room exist in our own data?
//
// Usage:  node scripts/spike-carried-rooms.mjs
//         node scripts/spike-carried-rooms.mjs --live   (one request, for the term list)
//
// Roomix's index for term 1268 has 190 of its 1,067 rooms carrying an empty
// `courses` array. One reading is that those are the best study rooms on campus.
// The other is that they are cross-term residue inside Roomix's own index, in
// which case unioning our snapshots manufactures the same artifact and we cite
// it back to ourselves. This settles it before tripling harvest cost.
//
// Reads the committed archives. The 1262 and 1264 raw snapshots are the only
// copies of those terms that exist anywhere, so this never writes to data/.

import { gunzipSync } from 'node:zlib';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hasRealRoom, isRealRoom, newCounter } from './lib/funnel.mjs';
import { TYPE_VISIBILITY } from './lib/room-safety.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TERMS = ['1262', '1264', '1268'];

// Every meeting in one term, from whichever committed form that term has. The
// expired terms are raw search pages; the live one is a harvest.
export function* meetingsOf(term) {
  const raw = join(ROOT, 'data', 'raw', term);
  if (existsSync(raw)) {
    for (const file of readdirSync(raw).filter((f) => f.endsWith('.json.gz'))) {
      const page = JSON.parse(gunzipSync(readFileSync(join(raw, file))));
      for (const course of page?.data?.courses ?? []) {
        for (const section of course.sections ?? []) {
          for (const m of section.meetings ?? []) yield { ...section, m };
        }
      }
    }
    return;
  }
  const harvest = join(ROOT, 'data', `harvest-${term}.json.gz`);
  if (!existsSync(harvest)) return;
  yield* JSON.parse(gunzipSync(readFileSync(harvest))).meetings;
}

function main() {
  const buildings = JSON.parse(readFileSync(join(ROOT, 'data', 'buildings.json'), 'utf8')).buildings;
  const isKnownBuilding = (code) => Object.prototype.hasOwnProperty.call(buildings, code);
  const ga = new Set(JSON.parse(readFileSync(join(ROOT, 'data', 'ga-rooms.json'), 'utf8')).rooms);

  // Two identities per term, because they answer different questions.
  //   funnelled: rooms that survive the funnel, which is what an index holds
  //   named:     rooms the term names at all, even in a building we cannot place
  const funnelled = {};
  const named = {};
  const facts = new Map();

  for (const term of TERMS) {
    const counter = newCounter();
    funnelled[term] = new Set();
    named[term] = new Set();
    for (const record of meetingsOf(term)) {
      const m = record.m;
      if (hasRealRoom(m)) {
        named[term].add(m.facilityId);
        if (!facts.has(m.facilityId)) facts.set(m.facilityId, {});
        facts.get(m.facilityId)[term] = {
          b: m.buildingCode,
          type: m.facilityType ?? null,
          cap: m.facilityCapacity,
        };
      }
      if (isRealRoom(m, record, counter, { isKnownBuilding })) funnelled[term].add(m.facilityId);
    }
    console.log(`${term}: ${funnelled[term].size} rooms through the funnel, ${named[term].size} named at all`);
  }

  const carried = [...new Set([...funnelled['1262'], ...funnelled['1264']])]
    .filter((id) => !funnelled['1268'].has(id))
    .sort();

  console.log(`\ncarried forward: ${carried.length} room(s) in 1262 or 1264 and not in 1268`);
  console.log('id         lastSeen  building  type  visibility  ga');
  let strong = 0;
  let weak = 0;
  for (const id of carried) {
    const lastSeen = funnelled['1264'].has(id) ? '1264' : '1262';
    const f = facts.get(id)[lastSeen];
    const vis = TYPE_VISIBILITY[f.type] ?? 'hidden';
    const onGa = ga.has(id);
    if (vis === 'shown' && onGa) strong++;
    else if (vis === 'shown') weak++;
    console.log(
      `${id.padEnd(10)} ${lastSeen}      ${String(f.b).padEnd(8)}  ${String(f.type).padEnd(4)}  ` +
        `${vis.padEnd(10)}  ${onGa}   ${buildings[f.b]?.name ?? '(unplaceable)'}`,
    );
  }
  console.log(
    `\nstrong positives (shown type AND on the GA list): ${strong}\n` +
      `weak positives   (shown type, off the GA list):   ${weak}\n` +
      `noise            (everything else):               ${carried.length - strong - weak}`,
  );

  // The cheaper half, and it does not depend on the class schedule at all.
  const everNamed = new Set([...named['1262'], ...named['1264'], ...named['1268']]);
  const missing = [...ga].filter((id) => !everNamed.has(id)).sort();
  console.log(
    `\nof the ${ga.size} Registrar general assignment rooms, ${missing.length} never appear ` +
      `in ANY of the three terms${missing.length ? `: ${missing.join(' ')}` : '.'}`,
  );
  const missingFrom1268 = [...ga].filter((id) => !named['1268'].has(id)).sort();
  console.log(
    `${missingFrom1268.length} never appear in 1268 alone` +
      `${missingFrom1268.length ? `: ${missingFrom1268.join(' ')}` : '.'}`,
  );
}

if (process.argv[1] && process.argv[1].endsWith('spike-carried-rooms.mjs')) main();
