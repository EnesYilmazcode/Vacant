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

// Which term's room index anchors the bounding box.
const TERM = '1268';

// A term returning fewer class-hosting buildings than this did not load
// properly, and a bbox derived from it would be wrong.
const MIN_ANCHOR_BUILDINGS = 60;

// Regression floors, matching fetch-buildings.mjs. Without them, one short page
// from the GIS server silently replaces a 461-footprint map with a handful of
// shapes and exits 0.
const MIN_BUILDING_SHAPES = 250;

// ArcGIS only guarantees stable resultOffset paging when an order is given.
// Without one a page can repeat or skip features, which is the silent-holes
// failure the pagination exists to prevent.
const ORDER_BY = 'OBJECTID';

// A hard ceiling. If a layer ever reports exceededTransferLimit while ignoring
// resultOffset, the loop would refetch page 1 forever, piling up duplicates
// until the global request cap throws. 4000 requests at 500 ms apiece is over
// half an hour of traffic aimed at a university GIS server.
const MAX_PAGES_PER_LAYER = 20;

// Per layer: how hard to simplify, and how small a shape has to be before it is
// not worth a byte. Buildings carry the most detail because they are the only
// layer that is load bearing; the rest exist so the shape of campus is legible.
// Tuned to what is visible, not to what is available. The shipped bbox is
// 2.68 x 2.22 km, so on a ~390 px phone ONE PIXEL IS ABOUT 6.9 METRES, which is
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
// Values are not bounded to 0..GRID IN EITHER DIRECTION: the query asks for
// shapes that INTERSECT the box, so anything crossing the edge comes back
// whole. Measured range on the shipped file is x -11080..61621 and
// y 3313..102550, so the maximum EXCEEDS the grid. A renderer that packs these
// into a Uint16Array wraps 102550 to 37014 and teleports the north edge into
// the middle of the map. Clamping would tear shapes at the boundary, so the
// renderer clips instead.
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
  const features = [];
  let cursor = 0;

  for (let page = 0; page < MAX_PAGES_PER_LAYER; page++) {
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
        orderByFields: ORDER_BY,
        resultOffset: String(cursor),
        resultRecordCount: String(PAGE),
        f: 'json',
      });

    const body = await fetchJson(url);
    if (body?.error) die(`layer ${id}: ${JSON.stringify(body.error)}`);
    const batch = body.features ?? [];
    for (const f of batch) {
      // Rings stay GROUPED per feature. ArcGIS marks a hole only by winding
      // order, and that is gone once a ring is delta-encoded, so flattening
      // them turns a building with a courtyard into a solid block. Grouped,
      // the renderer draws one path per feature and even-odd fill handles it.
      const rings = f.geometry?.rings ?? f.geometry?.paths ?? [];
      if (rings.length) features.push(rings);
    }
    cursor += batch.length;
    await sleep(500);
    if (!body.exceededTransferLimit || batch.length === 0) return features;
  }

  die(`layer ${id} still paging after ${MAX_PAGES_PER_LAYER} pages. Refusing to keep asking.`);
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
  const allowShrink = process.argv.includes('--allow-shrink');

  const buildingsPath = join(ROOT, 'data', 'buildings.json');
  if (!existsSync(buildingsPath)) die('data/buildings.json is missing. Run fetch-buildings.mjs first.');
  const buildings = JSON.parse(readFileSync(buildingsPath, 'utf8')).buildings;

  // The bbox is anchored on buildings that HOST CLASSES, not on every building
  // in the radius. Using all of them selected 320 rather than 86 and produced a
  // 3.96 x 4.59 km rectangle, roughly twice the linear extent of the region
  // that actually has classes, which in turn made the pixel budget below wrong
  // by about 2x. Buildings with no classes are still DRAWN, because they are
  // context; they just do not stretch the map to reach them.
  const roomsPath = join(ROOT, 'data', `rooms-${TERM}.json`);
  if (!existsSync(roomsPath)) die(`data/rooms-${TERM}.json is missing. Run build-index.mjs first.`);
  const classCodes = new Set(
    Object.values(JSON.parse(readFileSync(roomsPath, 'utf8')).rooms).map((r) => r.b),
  );

  const near = Object.entries(buildings).filter(
    ([code, b]) => classCodes.has(code) && kmFromOval(b) <= MAP_RADIUS_KM,
  );
  if (near.length < MIN_ANCHOR_BUILDINGS) {
    die(
      `only ${near.length} class-hosting buildings inside ${MAP_RADIUS_KM} km, ` +
        `under the ${MIN_ANCHOR_BUILDINGS} floor. The bbox would be wrong.`,
    );
  }
  const lons = near.map(([, b]) => b.lon);
  const lats = near.map(([, b]) => b.lat);
  const bbox = [
    Math.min(...lons) - PAD_DEG,
    Math.min(...lats) - PAD_DEG,
    Math.max(...lons) + PAD_DEG,
    Math.max(...lats) + PAD_DEG,
  ].map((v) => Number(v.toFixed(6)));

  console.log(`bbox anchored on ${near.length} class-hosting buildings within ${MAP_RADIUS_KM} km`);
  console.log(`bbox ${bbox.join(', ')}\n`);

  const layers = {};
  for (const layer of LAYERS) {
    const features = await fetchLayer(layer, bbox);
    const encoded = features
      .map((rings) => rings.map((r) => encodeShape(r, bbox, layer)).filter(Boolean))
      .filter((rings) => rings.length);
    layers[layer.key] = encoded;
    const points = encoded.reduce((a, f) => a + f.reduce((b, r) => b + r.length / 2, 0), 0);
    console.log(
      `  ${layer.key.padEnd(10)} ${String(features.length).padStart(5)} features in, ` +
        `${String(encoded.length).padStart(5)} kept, ${String(points).padStart(6)} points`,
    );
  }

  if (layers.building.length < MIN_BUILDING_SHAPES) {
    die(`only ${layers.building.length} building footprints, under the ${MIN_BUILDING_SHAPES} floor.`);
  }
  // Never replace a good map with a smaller one, matching fetch-buildings.mjs.
  if (existsSync(OUT_PATH)) {
    const before = JSON.parse(readFileSync(OUT_PATH, 'utf8')).layers?.building?.length ?? 0;
    if (layers.building.length < before && !allowShrink) {
      die(
        `${layers.building.length} footprints is fewer than the ${before} committed. Refusing.
` +
          `       If the bounding box was deliberately tightened, pass --allow-shrink.`,
      );
    }
  }

  const payload = {
    generated: localDate(),
    source: SERVICE,
    attribution: 'Ohio State University Facilities Information and Technology Services, GIS',
    note: 'layers[name] is an array of FEATURES, each an array of rings, each delta-encoded grid steps across bbox. Values may fall outside 0..grid in either direction. Decode with js/campus.js.',
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
