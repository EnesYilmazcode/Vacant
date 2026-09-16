#!/usr/bin/env node
// Build data/walk-graph.json from Ohio State's own sidewalk centreline layer.
//
// WHY THIS EXISTS
//
// js/engine.js quoted a walk as `straight-line metres x DETOUR 1.3 / 78`. The
// 1.3 was never fitted -- the comment above it says GUESS -- and one constant
// cannot see a river, a stadium, a rail corridor or a fence. #115 measured what
// that costs against OSU's own routing service: its pedestrian network runs
// 1.49x the straight line at the median and 2.15x at the 90th percentile, and
// replaying the real ranking over 238 weekday scenarios changed the first
// building 14.3% of the time.
//
// The research note ended by recommending an offline pedestrian graph. Layer 9
// of Data/ReferenceData_RO is one, already published, on the same read-only
// server data/buildings.json comes from (layer 15 of the sibling service) and
// data/entrances.json comes from (layer 10), under the same attribution. It is
// the sidewalk network maps.osu.edu itself routes on.
//
// Usage:  node scripts/fetch-sidewalks.mjs
//         node scripts/fetch-sidewalks.mjs --dry-run
//
// Eight requests: 15,531 features in the campus envelope against a 2,000
// maxRecordCount. Run it after scripts/fetch-buildings.mjs, which writes the
// doors this script prunes the graph around.

import { gzipSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchJson, requests } from './lib/fetch.mjs';
import { OVAL } from './lib/geo.mjs';
import {
  contract,
  encodeGraph,
  largestComponent,
  nodeGraph,
  pruneToReach,
} from './lib/walk-graph.mjs';

const SERVICE =
  'https://gissvc.osu.edu/arcgis/rest/services/Data/ReferenceData_RO/MapServer/9/query';

// The envelope, not the whole layer. Layer 9 is a statewide table: 47,745
// features from Lake Erie to the Ohio River, and the Columbus campus is a
// sixteen-thousandth of it. The box is the 50 buildings in the term subset
// (39.9965..40.0055 N, -83.0286..-83.0086 W) plus roughly 900 m on every side,
// which is MAX_WALK 12 minutes x WALK_MPM 78. A node further out than that
// cannot appear in an answer, so fetching it would only be paid for twice, once
// over the wire here and once in the committed file.
const BOX = { west: -83.04, south: 39.9885, east: -83.0, north: 40.0135 };

// resultRecordCount above maxRecordCount is silently clamped, so a script that
// asked for 20,000 and checked nothing would commit a tenth of campus and no
// error. This pages and counts.
const PAGE = 2000;
const MAX_PAGES = 20;

// Every Descriptio value is kept, and this is MEASURED rather than lazy.
// Filtering felt obviously right -- "Building" and "No Sidewalk" do not sound
// walkable -- so it was tried, scored against 220 routes from OSU's own routing
// service, and every filter is worse:
//
//     kept                     mean abs err   median   pair inversions
//     everything                     43.6 m   28.8 m        90 / 990
//     without "Building"             57.9 m   50.3 m       151 / 990
//     without "No Sidewalk"          43.7 m   28.8 m        91 / 990
//     without "Warning Pad"         359.4 m  109.6 m       245 / 990
//
// "Building" segments are the paths that run along and into a building, not
// routes through its middle; dropping 1,270 of them forces detours OSU's own
// network does not make. "Warning Pad" is the tactile pad at a kerb, averaging
// 1.7 m, and it is the piece that JOINS a sidewalk to its crosswalk: dropping
// 2,010 of them shatters the graph from 6,069 junctions to 2,139, and the
// largest component that survives holds 1,820.
//
// "No Sidewalk" is the one that is arguably wrong to keep and is kept anyway.
// It marks 34.6 km where a road has no pavement, which is a real thing to know
// and a thing this graph has no way to say: an edge is an edge. Dropping it
// changes the control almost not at all -- one pair in 990 -- because those
// stretches are not on the way to a classroom. It goes back on the table the
// day the graph can carry a cost per edge rather than a length.
//
// The one filter that is applied is geometric rather than by attribute: the
// largest connected component, below.
const OUT_FIELDS = 'OBJECTID,Descriptio';

// Metres of routed distance from a published door, past which a node cannot
// reach an answer. MAX_WALK 12 x WALK_MPM 78 is 936; 1,000 leaves room for the
// leg from a standing point onto the network. Drops 13.6% of the nodes.
const REACH = 1000;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PATH = join(ROOT, 'data', 'walk-graph.json');

const query = (params) => {
  const url = new URL(SERVICE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return url.toString();
};

async function fetchSegments() {
  const base = {
    geometry: `${BOX.west},${BOX.south},${BOX.east},${BOX.north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: 4326,
    spatialRel: 'esriSpatialRelIntersects',
    where: '1=1',
    outFields: OUT_FIELDS,
    returnGeometry: true,
    // Seven decimal places is about 11 mm of longitude at this latitude. The
    // graph quantises to the metre in the end, so this only has to survive the
    // 0.5 m snap that decides which endpoints are the same junction.
    geometryPrecision: 7,
    outSR: 4326,
    orderByFields: 'OBJECTID',
    f: 'json',
  };

  const features = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const payload = await fetchJson(
      query({ ...base, resultOffset: page * PAGE, resultRecordCount: PAGE }),
    );
    if (payload?.error) throw new Error(payload.error.message ?? 'query failed');
    const got = payload?.features ?? [];
    features.push(...got);
    if (got.length < PAGE && !payload?.exceededTransferLimit) return features;
  }
  throw new Error(`layer 9 did not end inside ${MAX_PAGES} pages`);
}

// Every door the app can send somebody to, as metres east and north of the
// Oval. data/buildings-<term>.json already stores them as whole-metre offsets
// from the building's published point, which is the same plane this graph uses.
function doorsFrom(buildings) {
  const R = 6371008.8;
  const rad = (deg) => (deg * Math.PI) / 180;
  const out = [];
  for (const b of Object.values(buildings)) {
    const x = rad(b.lon - OVAL.lon) * Math.cos(rad((OVAL.lat + b.lat) / 2)) * R;
    const y = rad(b.lat - OVAL.lat) * R;
    const doors = b.d ?? [];
    if (!doors.length) out.push([x, y]);
    for (let i = 0; i < doors.length; i += 2) out.push([x + doors[i], y + doors[i + 1]]);
  }
  return out;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  // data/current.json names the term's building slice, which is the same file
  // js/app.js boots with. Reading data/terms.json instead would name a term the
  // index has not been built for.
  const current = JSON.parse(readFileSync(join(ROOT, 'data', 'current.json'), 'utf8'));
  const buildings = JSON.parse(readFileSync(join(ROOT, current.buildings), 'utf8')).buildings;

  const features = await fetchSegments();
  const nodes = nodeGraph(features, OVAL);
  const component = largestComponent(nodes);
  const graph = contract(nodes, component);
  const doors = doorsFrom(buildings);
  const pruned = pruneToReach(graph, doors, REACH);
  const encoded = encodeGraph(pruned);

  const funnel = {
    features: features.length,
    vertices: nodes.vertices,
    nodedTo: nodes.count,
    segments: nodes.segments,
    components: nodes.components,
    largestComponent: component.length,
    afterContraction: graph.count,
    beyondReach: graph.count - pruned.count,
    kept: pruned.count,
  };

  const file = {
    generated: new Date().toISOString().slice(0, 10),
    source: SERVICE,
    layer: 'Data/ReferenceData_RO/MapServer/9 (Sidewalk Centerline)',
    attribution:
      'Ohio State University Facilities Information and Technology Services, GIS',
    envelope: BOX,
    origin: { lat: OVAL.lat, lon: OVAL.lon },
    note:
      'a pedestrian routing graph, not a drawable map. Nodes are junctions in whole metres east and north of origin; the geometry BETWEEN two junctions is discarded and survives only as the edge weight, because the app quotes a walk and never draws one. Decode with js/route.js.',
    units: 'metres',
    nodes: pruned.count,
    edges: encoded.edges,
    funnel,
    graph: encoded.base64,
  };

  const text = `${JSON.stringify(file)}\n`;
  const gz = gzipSync(Buffer.from(text), { level: 9 }).length;

  process.stderr.write(
    [
      `features        ${funnel.features}`,
      `vertices        ${funnel.vertices} -> ${funnel.nodedTo} noded at 0.5 m`,
      `components      ${funnel.components}, largest ${funnel.largestComponent}`,
      `contraction     ${funnel.largestComponent} -> ${funnel.afterContraction} junctions`,
      `reach prune     -${funnel.beyondReach} beyond ${REACH} m of a door`,
      `kept            ${funnel.kept} nodes, ${encoded.edges} edges`,
      `payload         ${text.length} B, ${gz} B gzipped`,
      `requests        ${requests()}`,
      '',
    ].join('\n'),
  );

  if (dryRun) {
    process.stderr.write('--dry-run: nothing written\n');
    return;
  }
  await writeFile(OUT_PATH, text);
  process.stderr.write(`wrote ${OUT_PATH}\n`);
}

await main();
