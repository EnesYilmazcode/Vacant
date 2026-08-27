// Reproduces every headline number in result-screen-v2.md.
// Run from the repo root:  node docs/research/result-screen-v2.repro.mjs
import fs from 'node:fs';
import { rank } from '../../js/engine.js';
const R = (f) => JSON.parse(fs.readFileSync(new URL(`../../data/${f}`, import.meta.url), 'utf8'));
const rooms = R('rooms-1268.json'), buildings = R('buildings.json').buildings;
const hours = R('buildings-hours.json'), current = R('current.json');
const slug = current.termName.toLowerCase().replace(/\s+/g, '-');
const term = Object.entries(hours.terms).find(([s]) => s.startsWith(slug))[1];
const hoursFor = (c, d) => term.buildings[c]?.hours[d];
const list = Object.entries(rooms.rooms).map(([id, r]) => ({ id, ...r }));
const q = (o, need, min, day, date) =>
  rank(list, { origin: o, now: min, day, needed: need, buildings, hoursFor,
               sessions: rooms.sessions, date }).filter((r) => r.wait <= 90);
const UNION = { lon: -83.0086, lat: 39.9976 };

// 1. duration never changes the result SET
for (const n of [15, 30, 60, 120, 180])
  console.log(`need ${String(n).padStart(3)} -> ${q(UNION, n, 735, 4, '2026-09-10').length} rooms`);

// 2. the top 40 covers how many buildings
const top = q(UNION, 60, 735, 4, '2026-09-10').slice(0, 40);
console.log(`top 40 rows cover ${new Set(top.map((r) => r.building)).size} buildings`);

// 3. what actually bounds a row: the doors, or a class
let doors = 0, klass = 0;
for (const day of [1, 2, 3, 4, 5, 6, 0]) {
  const date = ['2026-09-20','2026-09-14','2026-09-15','2026-09-16','2026-09-17','2026-09-18','2026-09-19'][day];
  for (let h = 8; h <= 21; h++)
    for (const r of q(UNION, 60, h * 60, day, date).slice(0, 40)) {
      if (!r.hoursKnown) continue;
      r.nextClassAt >= term.buildings[r.building].hours[day][1] ? doors++ : klass++;
    }
}
console.log(`bounded by the doors ${doors}, by a class ${klass} -> ${(100 * doors / (doors + klass)).toFixed(1)}% doors`);
