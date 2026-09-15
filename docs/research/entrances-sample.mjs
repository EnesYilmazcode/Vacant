#!/usr/bin/env node
// Reproduce every figure in entrances.md. Offline, no network, nothing written.
//
// Two passes, the same shape as walking-route-sample.mjs. The default compares
// distances and building order from a fixed set of public origins. --ranking
// replays the shipped rank() and shape() over the real Autumn 2026 schedule and
// asks the product question: how often does the card change.
//
//   node docs/research/entrances-sample.mjs
//   node docs/research/entrances-sample.mjs --ranking
//
// The origins are the six in walking-routes-115.md, so the two studies can be
// read against each other. They are public buildings, not anybody's location.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { approachMetres, distanceMetres, rank, shape, walkMinutes } from '../../js/engine.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

// Ohio Union, Thompson Library, RPAC, Ohio Stadium, Prior Hall, Vet Med.
const ORIGIN_IDS = ['161', '050', '246', '082', '302', '136'];

const index = read('data/rooms-1268.json');
const slice = read('data/buildings-1268.json').buildings;
const full = read('data/buildings.json').buildings;
const roomBuildingIds = [...new Set(Object.values(index.rooms).map((r) => r.b))].sort();

// The origins are not all room-bearing buildings, so they come from the full
// table. Stripped of `d`: an origin is a student standing somewhere, not a door.
const originOf = (id) => ({ lat: full[id].lat, lon: full[id].lon });

// The before and after. `centroid` is what the app measured until 2026-09-15.
const centroid = (origin, b) => distanceMetres(origin, b);
const door = (origin, b) => approachMetres(origin, b);

const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
const pct = (v, p) => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
};

// --------------------------------------------------------------- distances

const deltas = [];
const minuteDeltas = [];
const rows = [];
for (const originId of ORIGIN_IDS) {
  const origin = originOf(originId);
  for (const id of roomBuildingIds) {
    if (id === originId) continue;
    const b = slice[id];
    const c = centroid(origin, b);
    const d = door(origin, b);
    deltas.push(d - c);
    minuteDeltas.push(walkMinutes(d) - walkMinutes(c));
    rows.push({
      originId,
      origin: full[originId].name,
      destinationId: id,
      destination: b.name,
      doors: (b.d?.length ?? 0) / 2,
      centroidMetres: Math.round(c),
      doorMetres: Math.round(d),
      centroidMinutes: walkMinutes(c),
      doorMinutes: walkMinutes(d),
    });
  }
}

console.log(['origin', 'destination', 'doors', 'centroid_m', 'door_m', 'centroid_min', 'door_min'].join('\t'));
for (const r of rows) {
  console.log([r.origin, r.destination, r.doors, r.centroidMetres, r.doorMetres, r.centroidMinutes, r.doorMinutes].join('\t'));
}

// Within one origin, how often do two buildings swap places once the walk ends
// at a door. This is the ordering signal, separate from how much shorter the
// walks got: a change that shortened every walk by the same amount would move
// no rows at all.
function inversions(group) {
  let count = 0;
  let pairs = 0;
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      pairs++;
      const before = Math.sign(group[i].centroidMetres - group[j].centroidMetres);
      const after = Math.sign(group[i].doorMetres - group[j].doorMetres);
      if (before !== 0 && after !== 0 && before !== after) count++;
    }
  }
  return { count, pairs };
}
const groups = ORIGIN_IDS.map((id) => rows.filter((r) => r.originId === id));
const inv = groups.reduce(
  (acc, g) => {
    const { count, pairs } = inversions(g);
    return { count: acc.count + count, pairs: acc.pairs + pairs };
  },
  { count: 0, pairs: 0 },
);

console.error('\nsummary');
console.error(`pairs\t${deltas.length}`);
console.error(`mean_door_minus_centroid_m\t${mean(deltas).toFixed(1)}`);
console.error(`median_door_minus_centroid_m\t${pct(deltas, 0.5).toFixed(1)}`);
console.error(`p10_door_minus_centroid_m\t${pct(deltas, 0.1).toFixed(1)}`);
console.error(`p90_door_minus_centroid_m\t${pct(deltas, 0.9).toFixed(1)}`);
console.error(`shorter\t${deltas.filter((d) => d < 0).length}`);
console.error(`longer\t${deltas.filter((d) => d > 0).length}`);
console.error(`lost_a_walk_minute\t${minuteDeltas.filter((m) => m < 0).length}`);
console.error(`gained_a_walk_minute\t${minuteDeltas.filter((m) => m > 0).length}`);
console.error(`building_order_inversions\t${inv.count} / ${inv.pairs}`);

// ----------------------------------------------------------- the card itself

if (process.argv.includes('--ranking')) {
  const allRooms = Object.entries(index.rooms).map(([id, room]) => ({ id, ...room }));
  const hours = read('data/buildings-hours.json');
  const current = read('data/current.json');
  const slug = current.termName.toLowerCase().replace(/\s+/g, '-');
  const termHours = Object.entries(hours.terms).find(([name]) => name.startsWith(slug))?.[1];
  if (!termHours) throw new Error(`no building-hours table for ${current.termName}`);
  const hoursFor = (code, day) => termHours.buildings[code]?.hours[day];

  // rank() owns the distance calculation and reads `d` off the building, so the
  // before case is the shipped table with the doors taken away. Every other
  // room, building and schedule fact stays exactly as it ships.
  const withoutDoors = Object.fromEntries(
    Object.entries(slice).map(([code, b]) => {
      const { d, ...rest } = b;
      return [code, rest];
    }),
  );

  const answer = (origin, buildings, opts) =>
    shape(rank(allRooms, { origin, buildings, hoursFor, sessions: index.sessions, ...opts })).rows;

  const firstBuildings = (list, count = 3) => {
    const seen = new Set();
    for (const row of list) {
      seen.add(row.building);
      if (seen.size === count) break;
    }
    return [...seen];
  };

  const weekdays = [
    ['2026-09-14', 1],
    ['2026-09-15', 2],
    ['2026-09-16', 3],
    ['2026-09-17', 4],
    ['2026-09-18', 5],
  ];
  const minutes = [550, 730, 910, 1090]; // 09:10, 12:10, 15:10, 18:10
  const needs = [30, 60];

  const comparisons = [];
  const skipped = [];
  for (const originId of ORIGIN_IDS) {
    const origin = originOf(originId);
    for (const [date, day] of weekdays) {
      for (const now of minutes) {
        for (const needed of needs) {
          const opts = { date, day, now, needed };
          const before = answer(origin, withoutDoors, opts);
          const after = answer(origin, slice, opts);
          if (!before.length || !after.length) {
            skipped.push({ origin: full[originId].name, ...opts, rows: [before.length, after.length] });
            continue;
          }
          const sameRoom = after.find((row) => row.id === before[0].id);
          comparisons.push({
            before,
            after,
            kept: !!sameRoom,
            usableDelta: sameRoom ? sameRoom.usable - before[0].usable : NaN,
          });
        }
      }
    }
  }

  const count = (p) => comparisons.filter(p).length;
  const share = (n) => `${n} / ${comparisons.length} (${((100 * n) / comparisons.length).toFixed(1)}%)`;
  const usable = comparisons.map((c) => c.usableDelta).filter(Number.isFinite);

  console.error('\nranking summary');
  console.error(`attempted_scenarios\t${comparisons.length + skipped.length}`);
  console.error(`scenarios\t${comparisons.length}`);
  console.error(`skipped\t${JSON.stringify(skipped)}`);
  console.error(`first_building_changed\t${share(count((c) => c.before[0].building !== c.after[0].building))}`);
  console.error(`first_room_changed\t${share(count((c) => c.before[0].id !== c.after[0].id))}`);
  console.error(
    `top_three_order_changed\t${share(count((c) => firstBuildings(c.before).join() !== firstBuildings(c.after).join()))}`,
  );
  console.error(`baseline_room_still_shown\t${count((c) => c.kept)} / ${comparisons.length}`);
  console.error(`mean_usable_delta_min\t${mean(usable).toFixed(2)}`);
  console.error(`usable_changed\t${usable.filter((d) => d !== 0).length} / ${usable.length}`);
}
