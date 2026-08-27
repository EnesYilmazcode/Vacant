#!/usr/bin/env node
// Build data/campus.json: the campus map, as vector shapes, with no tiles.
//
// A tile map (Mapbox, Google) means network requests on the critical path, an
// API key, an account and a rate limit. That breaks the one promise Vacant
// makes that nobody else does, which is that it answers with no signal. Ohio
// State publishes its own campus as polygons on the same GIS server
// data/buildings.json already uses, so the map is drawn from data we ship.
//
// Usage:  node scripts/fetch-campus.mjs
//         node scripts/fetch-campus.mjs --dry-run
//
// This is a one-off. Campus geometry does not change weekly, so it does not
// belong in the Sunday cron.

import { gzipSync } from 'node:zlib';
import { rename, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchJson, requests, sleep } from './lib/fetch.mjs';
import { kmFromOval } from './lib/geo.mjs';

const SERVICE = 'https://gissvc.osu.edu/arcgis/rest/services/Data/FacilitiesStreets_RO/MapServer';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PATH = join(ROOT, 'data', 'campus.json');

// The map covers where somebody actually walks between classes, not every
// building the schedule mentions. Measured against the room index:
//
//   1.5 km   85 buildings   96.9% of rooms   2.2 km span
//   2.0 km   86 buildings   97.1% of rooms   2.4 km span
//   2.5 km   90 buildings   98.6% of rooms   3.8 km span
//
// 2.5 km triples the area for 1.5% more rooms, almost all of it empty. Rooms
// outside the map still appear in the list; they simply have no pin, and a room
// 5 km away was never a walk-to-it answer.
const MAP_RADIUS_KM = 2;
const PAD_DEG = 0.004;

// Per layer: how hard to simplify, and how small a shape has to be before it is
// not worth a byte. Buildings carry the most detail because they are the only
// layer that is load bearing; the rest exist so the shape of campus is legible.
// Tuned to what is visible, not to what is available. The map shows about
// 2.4 km across a ~390 px phone, so ONE PIXEL IS ROUGHLY 6 METRES, which is
// 0.00006 degrees of latitude. Detail finer than that cannot be seen and is
// pure payload. The first pass used offsets ten times smaller and came back at
// 263 KB gzipped against a 140 KB budget, almost all of it street and landscape
// vertices nobody can resolve.
//
// Buildings keep the most detail because they are the only load-bearing layer:
// the app points at them. The rest exist so the shape of campus is legible.
const LAYERS = [
  { id: 11, key: 'building', offset: 0.00002, minPoints: 4, minSpan: 0.00004 },
  { id: 12, key: 'street', offset: 0.00008, minPoints: 2, minSpan: 0.0005 },
  { id: 9, key: 'landscape', offset: 0.0001, minPoints: 4, minSpan: 0.0007 },
  { id: 13, key: 'water', offset: 0.00004, minPoints: 4, minSpan: 0.0002 },
];

const PAGE = 2000;

// Coordinates are quantised onto a grid across the bounding box. Over a ~4.5 km
// span that is about 7 cm per step, far finer than anything visible at campus
// zoom, and it turns every float into a small integer. Deltas within a ring are
// then mostly single digits, which is what gzip is good at.
//
// Values are not bounded to 0..GRID: the query asks for shapes that INTERSECT
// the box, so anything crossing the edge comes back whole. Measured range is
// -11080 to 61621. Clamping would tear shapes at the boundary, so the renderer
// clips instead.
const GRID = 65535;

// A stated ceiling, so the map cannot quietly grow into the thing this project
// criticises Roomix for. Roomix costs 3.3 MB to open.
const BUDGET_KB = 140;

function die(message) {
  console.error(`\nFATAL  ${message}`);
  process.exit(1);
}

const localDate = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

async function writeAtomic(path, text) {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, path);
}

// Every feature in the layer inside the box, following pagination rather than
// trusting one response. A truncated map has holes in it and nothing on screen
// would say so.
async function fetchLayer({ id, offset }, bbox) {
  const shapes = [];
  let cursor = 0;

  for (;;) {
    const url =
      `${SERVICE}/${id}/query?` +
      new URLSearchParams({
        where: '1=1',
        geometry: bbox.join(','),
        geometryType: 'esriGeometryEnvelope',
        spatialRel: 'esriSpatialRelIntersects',
        inSR: '4326',
        outFields: '',
        returnGeometry: 'true',
        outSR: '4326',
        maxAllowableOffset: String(offset),
        resultOffset: String(cursor),
        resultRecordCount: String(PAGE),
        f: 'json',
      });

    const page = await fetchJson(url);
    if (page?.error) die(`layer ${id}: ${JSON.stringify(page.error)}`);
    const features = page.features ?? [];
    for (const f of features) {
      for (const ring of f.geometry?.rings ?? f.geometry?.paths ?? []) shapes.push(ring);
    }
    cursor += features.length;
    await sleep(500);
    if (!page.exceededTransferLimit || features.length === 0) break;
  }

  return shapes;
}

// Quantise, drop what is too small to see, and delta encode.
export function encodeShape(ring, bbox, { minPoints, minSpan }) {
  if (ring.length < minPoints) return null;

  const [minLon, minLat, maxLon, maxLat] = bbox;
  let loX = Infinity;
  let hiX = -Infinity;
  let loY = Infinity;
  let hiY = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < loX) loX = lon;
    if (lon > hiX) hiX = lon;
    if (lat < loY) loY = lat;
    if (lat > hiY) hiY = lat;
  }
  // A shape whose whole bounding box is under a pixel at campus zoom is not
  // worth a byte, and slivers are most of what fills the transfer cap.
  if (Math.max(hiX - loX, hiY - loY) < minSpan) return null;

  const qx = (lon) => Math.round(((lon - minLon) / (maxLon - minLon)) * GRID);
  const qy = (lat) => Math.round(((lat - minLat) / (maxLat - minLat)) * GRID);

  const out = [];
  let px = 0;
  let py = 0;
  for (const [lon, lat] of ring) {
    const x = qx(lon);
    const y = qy(lat);
    // Consecutive duplicates survive simplification and cost two bytes each.
    if (out.length && x === px && y === py) continue;
    out.push(x - px, y - py);
    px = x;
    py = y;
  }
  return out.length >= minPoints * 2 ? out : null;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const buildingsPath = join(ROOT, 'data', 'buildings.json');
  if (!existsSync(buildingsPath)) die('data/buildings.json is missing. Run fetch-buildings.mjs first.');
  const buildings = JSON.parse(readFileSync(buildingsPath, 'utf8')).buildings;

  const near = Object.entries(buildings).filter(([, b]) => kmFromOval(b) <= MAP_RADIUS_KM);
  if (!near.length) die('no buildings inside the map radius.');
  const lons = near.map(([, b]) => b.lon);
  const lats = near.map(([, b]) => b.lat);
  const bbox = [
    Math.min(...lons) - PAD_DEG,
    Math.min(...lats) - PAD_DEG,
    Math.max(...lons) + PAD_DEG,
    Math.max(...lats) + PAD_DEG,
  ].map((v) => Number(v.toFixed(6)));

  console.log(`map covers ${near.length} buildings within ${MAP_RADIUS_KM} km of the Oval`);
  console.log(`bbox ${bbox.join(', ')}\n`);

  const layers = {};
  for (const layer of LAYERS) {
    const rings = await fetchLayer(layer, bbox);
    const encoded = rings.map((r) => encodeShape(r, bbox, layer)).filter(Boolean);
    layers[layer.key] = encoded;
    const points = encoded.reduce((a, s) => a + s.length / 2, 0);
    console.log(
      `  ${layer.key.padEnd(10)} ${String(rings.length).padStart(5)} shapes in, ` +
        `${String(encoded.length).padStart(5)} kept, ${String(points).padStart(6)} points`,
    );
  }

  if (!layers.building.length) die('no building footprints came back. The map would be empty.');

  const payload = {
    generated: localDate(),
    source: SERVICE,
    attribution: 'Ohio State University Facilities Information and Technology Services, GIS',
    note: 'Shapes are delta-encoded grid steps across bbox; values may fall outside 0..grid where a shape crosses the edge. Decode with js/campus.js.',
    bbox,
    grid: GRID,
    layers,
  };

  const json = `${JSON.stringify(payload)}\n`;
  const gz = gzipSync(json, { level: 9 }).length;
  console.log(`\n${(json.length / 1024).toFixed(0)} KB raw, ${(gz / 1024).toFixed(1)} KB gzipped`);
  console.log(`${requests()} requests.`);

  if (gz / 1024 > BUDGET_KB) {
    die(`${(gz / 1024).toFixed(1)} KB gzipped is over the ${BUDGET_KB} KB budget. Simplify harder.`);
  }

  if (dryRun) {
    console.log('DRY RUN, nothing written.');
    return;
  }
  await writeAtomic(OUT_PATH, json);
  console.log('wrote data/campus.json');
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('fetch-campus.mjs');
if (invokedDirectly) main().catch((err) => die(err.message));
