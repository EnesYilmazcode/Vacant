#!/usr/bin/env node
// Reproduce the figures in the "Routing over OSU's sidewalks" section of
// walking-routes-115.md.
//
//   node docs/research/walking-graph-sample.mjs           offline, no network
//   node docs/research/walking-graph-sample.mjs --osu     control against OSU's
//                                                         own routing service
//
// The default pass is the one that matters and it touches no network at all: it
// replays the shipped graph against the straight-line model it replaced, over a
// grid of standing points covering the campus envelope. The --osu pass is the
// control, and it is separate because OSU's Campusmap_Routing service is an
// observed public endpoint rather than a documented API, so a figure that
// depends on it can change without anybody being told.
//
// No real position is used or committed. The standing points are a deterministic
// grid over the published building envelope, which is what #115 asks for.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRouter, decodeWalkGraph, toPlane } from '../../js/route.js';
import { DETOUR, MAX_WALK, WALK_MPM, approachMetres, walkMinutes } from '../../js/engine.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

const FILE = read('data/walk-graph.json');
const BUILDINGS = read('data/buildings-1268.json').buildings;
const ROOMS = read('data/rooms-1268.json').rooms;
const HELD = [...new Set(Object.values(ROOMS).map((r) => r.b))].filter((c) => BUILDINGS[c]);

const GRAPH = decodeWalkGraph(FILE);
const ROUTER = createRouter(GRAPH, BUILDINGS);

// 13 x 13 points across the envelope of the buildings the term indexes. Coarse
// enough to run in a second, fine enough that the west bank, the medical
// campus and the north end each get their own rows.
const STEP = 12;
const lats = HELD.map((c) => BUILDINGS[c].lat);
const lons = HELD.map((c) => BUILDINGS[c].lon);
const BOX = {
  south: Math.min(...lats), north: Math.max(...lats),
  west: Math.min(...lons), east: Math.max(...lons),
};
const STANDING = [];
for (let i = 0; i <= STEP; i++) {
  for (let j = 0; j <= STEP; j++) {
    STANDING.push({
      lat: BOX.south + ((BOX.north - BOX.south) * i) / STEP,
      lon: BOX.west + ((BOX.east - BOX.west) * j) / STEP,
    });
  }
}

const pct = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};
const mean = (values) => values.reduce((s, x) => s + x, 0) / values.length;
const share = (n, of) => `${n} of ${of} (${((100 * n) / of).toFixed(1)}%)`;

function offlinePass() {
  const rows = [];
  let unsnapped = 0;
  for (const where of STANDING) {
    const field = ROUTER.from(where.lat, where.lon, Infinity);
    if (!field) { unsnapped++; continue; }
    for (const code of HELD) {
      const building = BUILDINGS[code];
      const routed = field.metresTo(code);
      if (routed == null) continue;
      const estimated = approachMetres(where, building) * DETOUR;
      const routedMin = walkMinutes(routed);
      const estimatedMin = walkMinutes(estimated);
      if (routedMin > MAX_WALK && estimatedMin > MAX_WALK) continue;
      rows.push({ where, code, routed, estimated, routedMin, estimatedMin });
    }
  }

  console.log(`standing points      ${STANDING.length}, ${unsnapped} of them off the network`);
  console.log(`buildings            ${HELD.length} holding a room this term`);
  console.log(`rows inside ${MAX_WALK} min  ${rows.length}\n`);

  console.log('--- how far the old constant was out, in the minutes the card prints');
  const diffs = rows.map((r) => r.routedMin - r.estimatedMin);
  const counts = new Map();
  for (const d of diffs) counts.set(d, (counts.get(d) ?? 0) + 1);
  for (const [d, n] of [...counts].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${d > 0 ? '+' : ''}${d} min   ${String(n).padStart(5)}  ${((100 * n) / rows.length).toFixed(1)}%`);
  }
  console.log(`  exact      ${share(counts.get(0) ?? 0, rows.length)}`);
  for (const k of [1, 2, 3, 5]) {
    console.log(`  understated by >= ${k} min  ${share(diffs.filter((d) => d >= k).length, rows.length)}`);
  }
  const metreError = rows.map((r) => r.estimated - r.routed);
  console.log(`  metres: mean signed ${mean(metreError).toFixed(1)}  median abs ${pct(metreError.map(Math.abs), 0.5).toFixed(1)}  p90 abs ${pct(metreError.map(Math.abs), 0.9).toFixed(1)}\n`);

  console.log(`--- rooms the ${MAX_WALK} minute bound lets through, and keeps out`);
  const phantom = rows.filter((r) => r.estimatedMin <= MAX_WALK && r.routedMin > MAX_WALK).length;
  const missed = rows.filter((r) => r.estimatedMin > MAX_WALK && r.routedMin <= MAX_WALK).length;
  console.log(`  offered but out of reach   ${share(phantom, rows.length)}`);
  console.log(`  excluded but reachable     ${share(missed, rows.length)}\n`);

  console.log('--- the order, which is what decides the card');
  const byPoint = new Map();
  for (const r of rows) {
    const key = `${r.where.lat},${r.where.lon}`;
    const list = byPoint.get(key);
    if (list) list.push(r); else byPoint.set(key, [r]);
  }
  let points = 0; let firstChanged = 0; let topThree = 0;
  for (const list of byPoint.values()) {
    if (list.length < 3) continue;
    points++;
    const was = [...list].sort((a, b) => a.estimated - b.estimated).map((r) => r.code);
    const now = [...list].sort((a, b) => a.routed - b.routed).map((r) => r.code);
    if (was[0] !== now[0]) firstChanged++;
    if (was.slice(0, 3).join() !== now.slice(0, 3).join()) topThree++;
  }
  console.log(`  nearest building changes  ${share(firstChanged, points)}`);
  console.log(`  ordered top three changes ${share(topThree, points)}\n`);

  console.log('--- the worst of it');
  for (const r of [...rows].sort((a, b) => (b.routedMin - b.estimatedMin) - (a.routedMin - a.estimatedMin)).slice(0, 8)) {
    console.log(
      `  ${BUILDINGS[r.code].name.padEnd(40)} quoted ${r.estimatedMin} min, walks ${r.routedMin}` +
      `  (${r.estimated.toFixed(0)} m estimated, ${r.routed.toFixed(0)} m routed)` +
      `  from ${r.where.lat.toFixed(5)}, ${r.where.lon.toFixed(5)}`,
    );
  }
}

// ---------------------------------------------------------------- the control

const ROUTE_URL =
  'https://gissvc.osu.edu/arcgis/rest/services/Apps/Campusmap_Routing/NAServer/Route/solve';

async function osuRoute(from, to) {
  const body = new URLSearchParams({
    f: 'json',
    stops: JSON.stringify({
      features: [from, to].map((p, i) => ({
        geometry: { x: p.lon, y: p.lat, spatialReference: { wkid: 4326 } },
        attributes: { Name: String(i) },
      })),
    }),
    returnRoutes: 'true', returnDirections: 'false', returnStops: 'false',
    outSR: '4326', impedanceAttributeName: 'Length', accumulateAttributeNames: 'Time_Cost',
  });
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(ROUTE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', connection: 'close' },
        body,
        signal: AbortSignal.timeout(30000),
      });
      const payload = await res.json();
      const route = payload.routes?.features?.[0]?.attributes;
      if (route) return route.Total_Length * 0.3048; // the service reports feet
    } catch { /* retried below */ }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  return null;
}

// Centroid to centroid, both sides, because that is the only endpoint OSU's
// service can be given. The doors are Vacant's own improvement and comparing a
// routed door against a routed centroid measures the doors, not the routing.
async function osuPass() {
  let seed = 771;
  const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const origins = [];
  for (let i = 0; i < 12; i++) {
    const code = HELD[Math.floor(random() * HELD.length)];
    origins.push({ label: BUILDINGS[code].name, lat: BUILDINGS[code].lat, lon: BUILDINGS[code].lon });
  }
  for (let i = 0; i < 12; i++) {
    origins.push({
      label: `standing point ${i + 1}`,
      lat: BOX.south + random() * (BOX.north - BOX.south),
      lon: BOX.west + random() * (BOX.east - BOX.west),
    });
  }

  const rows = [];
  for (const origin of origins) {
    const field = ROUTER.from(origin.lat, origin.lon, Infinity);
    if (!field) continue;
    const here = toPlane(FILE.origin, origin.lat, origin.lon);
    const near = HELD
      .map((code) => {
        const there = toPlane(FILE.origin, BUILDINGS[code].lat, BUILDINGS[code].lon);
        return { code, straight: Math.hypot(there.x - here.x, there.y - here.y) };
      })
      .sort((a, b) => a.straight - b.straight)
      .slice(0, 10);

    for (const { code, straight } of near) {
      const osu = await osuRoute(origin, BUILDINGS[code]);
      if (osu == null) continue;
      // The router's own answer to the centroid, not to a door.
      const centroid = toPlane(FILE.origin, BUILDINGS[code].lat, BUILDINGS[code].lon);
      const routed = field.metresToPoint(centroid);
      if (routed == null) continue;
      rows.push({ origin: origin.label, code, osu, routed, estimated: straight * DETOUR });
      await new Promise((r) => setTimeout(r, 150));
    }
    process.stderr.write(`  ${origin.label}: ${rows.length} rows\n`);
  }

  const score = (label, pick) => {
    const err = rows.map((r) => pick(r) - r.osu);
    const abs = err.map(Math.abs);
    let pairs = 0; let inverted = 0;
    for (const origin of new Set(rows.map((r) => r.origin))) {
      const set = rows.filter((r) => r.origin === origin);
      for (let i = 0; i < set.length; i++) {
        for (let j = i + 1; j < set.length; j++) {
          if (set[i].osu === set[j].osu) continue;
          pairs++;
          if ((pick(set[i]) < pick(set[j])) !== (set[i].osu < set[j].osu)) inverted++;
        }
      }
    }
    console.log(
      `  ${label.padEnd(26)} signed ${mean(err).toFixed(1).padStart(7)}  mean abs ${mean(abs).toFixed(1).padStart(6)}` +
      `  median abs ${pct(abs, 0.5).toFixed(1).padStart(6)}  p90 abs ${pct(abs, 0.9).toFixed(1).padStart(6)}` +
      `  inverted ${inverted}/${pairs}`,
    );
  };

  console.log(`\n--- against OSU's own router, ${rows.length} centroid-to-centroid walks, metres`);
  score('straight line x 1.30', (r) => r.estimated);
  score('this graph', (r) => r.routed);

  // A single multiplier cannot reorder anything, so the inversion count above
  // is the same for any constant. Print the best one anyway: it is the honest
  // ceiling on what recalibrating alone could have bought.
  let best = 1.3; let bestError = Infinity;
  for (let k = 1; k <= 2.2; k += 0.005) {
    const value = mean(rows.map((r) => Math.abs((r.estimated / DETOUR) * k - r.osu)));
    if (value < bestError) { bestError = value; best = k; }
  }
  score(`straight line x ${best.toFixed(2)}`, (r) => (r.estimated / DETOUR) * best);
  // Skip the rows where the origin IS the destination's own published point:
  // a straight line of zero metres has no ratio, and twelve of the origins are
  // buildings.
  const circuity = rows
    .filter((r) => r.estimated > 1)
    .map((r) => r.osu / (r.estimated / DETOUR));
  console.log(`  OSU circuity: median ${pct(circuity, 0.5).toFixed(2)}  p90 ${pct(circuity, 0.9).toFixed(2)}`);
}

if (process.argv.includes('--osu')) await osuPass();
else offlinePass();
