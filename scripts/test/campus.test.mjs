// Offline. Fixtures plus the committed map, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

import { aspect, decodeFeature, decodeShape, inBounds, toGrid, toLonLat } from '../../js/campus.js';

const MAP = { bbox: [-83.04, 39.98, -82.99, 40.02], grid: 65535 };

test('delta decoding rebuilds the original points', () => {
  // First pair absolute, the rest steps from the last.
  assert.deepEqual(decodeShape([10, 20, 5, -5, -3, 2]), [
    [10, 20],
    [15, 15],
    [12, 17],
  ]);
  assert.deepEqual(decodeShape([]), []);
});

test('a feature decodes all of its rings, so a courtyard survives', () => {
  // 19 buildings on the shipped map have more than one ring. Flattening them
  // loses the hole, because ArcGIS marks it only by winding order and that is
  // gone once the ring is delta-encoded.
  const feature = [[0, 0, 10, 0, 0, 10, -10, 0], [3, 3, 4, 0, 0, 4, -4, 0]];
  const rings = decodeFeature(feature);
  assert.equal(rings.length, 2, 'outer ring and hole');
  assert.deepEqual(rings[0][0], [0, 0]);
  assert.deepEqual(rings[1][0], [3, 3]);
});

test('a coordinate survives the round trip', () => {
  const dreese = [-83.015831, 40.002295];
  const back = toLonLat(toGrid(dreese, MAP), MAP);
  assert.ok(Math.abs(back[0] - dreese[0]) < 1e-6, `lon off by ${Math.abs(back[0] - dreese[0])}`);
  assert.ok(Math.abs(back[1] - dreese[1]) < 1e-6, `lat off by ${Math.abs(back[1] - dreese[1])}`);
});

test('the bbox corners land on the grid corners', () => {
  assert.deepEqual(toGrid([MAP.bbox[0], MAP.bbox[1]], MAP), [0, 0]);
  assert.deepEqual(toGrid([MAP.bbox[2], MAP.bbox[3]], MAP), [MAP.grid, MAP.grid]);
});

test('grid values outside 0..grid are allowed in BOTH directions', () => {
  // The query asks for shapes that INTERSECT the box, so anything crossing the
  // edge comes back whole. The shipped map runs -19205 to 102550 against a grid
  // of 65535, so a Uint16Array would wrap the high end and teleport it.
  assert.ok(toGrid([MAP.bbox[0] - 0.01, MAP.bbox[1]], MAP)[0] < 0, 'low side');
  assert.ok(toGrid([MAP.bbox[2] + 0.01, MAP.bbox[3]], MAP)[0] > MAP.grid, 'high side');
});

test('inBounds answers whether a room has anything to point at', () => {
  assert.equal(inBounds([-83.015, 40.0], MAP), true);
  assert.equal(inBounds([-81.93, 40.78], MAP), false, 'Wooster is not on the map');
});

test('the aspect ratio is pinned to a literal, not re-derived', () => {
  // Re-computing the implementation's own formula would pass for an inverted
  // ratio or a dropped cosine. This fixture is 0.05 deg wide by 0.04 deg tall
  // at 40 degrees north.
  assert.ok(Math.abs(aspect(MAP) - 0.9576) < 0.0005, `got ${aspect(MAP).toFixed(4)}`);
  // Grid space is NOT square, so this is not cos(latitude).
  assert.ok(Math.abs(aspect(MAP) - Math.cos((40 * Math.PI) / 180)) > 0.15);
  // A taller box than it is wide gives a ratio under one.
  const tall = { bbox: [-83.01, 39.98, -83.0, 40.02], grid: 65535 };
  assert.ok(aspect(tall) < 0.3, `got ${aspect(tall).toFixed(4)}`);
});

// --- the committed map, if it has been built ---

const PATH = new URL('../../data/campus.json', import.meta.url);
const readMap = () => (existsSync(PATH) ? JSON.parse(readFileSync(PATH, 'utf8')) : null);

test('the committed map has building footprints, which are the load-bearing layer', () => {
  const c = readMap();
  if (!c) return;
  assert.ok(c.layers.building.length >= 250, `only ${c.layers.building.length} footprints`);
  assert.equal(c.bbox.length, 4);
  assert.ok(c.bbox[2] > c.bbox[0] && c.bbox[3] > c.bbox[1], 'bbox is not inside out');
});

test('the committed map is features of rings, not a flat list of rings', () => {
  const c = readMap();
  if (!c) return;
  for (const [name, features] of Object.entries(c.layers)) {
    for (const f of features) {
      assert.ok(Array.isArray(f) && Array.isArray(f[0]), `${name}: not a feature of rings`);
      for (const r of f) {
        assert.equal(r.length % 2, 0, `${name}: odd delta count`);
        assert.ok(r.length >= 4, `${name}: a ring with fewer than two points`);
        assert.ok(r.every(Number.isInteger), `${name}: a non-integer delta`);
      }
    }
  }
  const holed = c.layers.building.filter((f) => f.length > 1).length;
  assert.ok(holed > 0, 'no multi-ring buildings survived, so holes are being lost');
});

test('the committed bbox matches the region that actually has classes', () => {
  // The bbox is anchored on class-hosting buildings. Anchoring it on ALL
  // buildings in the radius gave a 3.96 x 4.59 km rectangle, roughly twice the
  // linear extent of the region with classes, and made the pixel budget the
  // simplification was tuned against wrong by about 2x.
  const c = readMap();
  if (!c) return;
  const km = [(c.bbox[2] - c.bbox[0]) * 85, (c.bbox[3] - c.bbox[1]) * 111];
  assert.ok(Math.max(...km) < 3.2, `map spans ${km.map((n) => n.toFixed(2)).join(' x ')} km`);
});

test('every building that hosts classes and sits on the map has a footprint nearby', () => {
  // A room cannot be pointed at if its building has no shape. Checked by
  // proximity, because the map layers carry no attributes to join on.
  const c = readMap();
  const bPath = new URL('../../data/buildings.json', import.meta.url);
  const rPath = new URL('../../data/rooms-1268.json', import.meta.url);
  if (!c || !existsSync(bPath) || !existsSync(rPath)) return;

  const buildings = JSON.parse(readFileSync(bPath, 'utf8')).buildings;
  const rooms = JSON.parse(readFileSync(rPath, 'utf8')).rooms;
  const codes = [...new Set(Object.values(rooms).map((r) => r.b))];

  // Outer ring centroid per feature.
  const centroids = c.layers.building.map((f) => {
    const pts = decodeShape(f[0]);
    let x = 0;
    let y = 0;
    for (const p of pts) {
      x += p[0];
      y += p[1];
    }
    return [x / pts.length, y / pts.length];
  });

  // 250 m, converted per axis. The grid is anisotropic: one x step and one y
  // step are different distances, so a single tolerance mixes units.
  const metresPerX = ((c.bbox[2] - c.bbox[0]) * 85000) / c.grid;
  const metresPerY = ((c.bbox[3] - c.bbox[1]) * 111000) / c.grid;
  const missing = [];
  for (const code of codes) {
    const b = buildings[code];
    if (!b || !inBounds([b.lon, b.lat], c)) continue;
    const [gx, gy] = toGrid([b.lon, b.lat], c);
    const near = centroids.some(
      (p) => Math.hypot((p[0] - gx) * metresPerX, (p[1] - gy) * metresPerY) < 250,
    );
    if (!near) missing.push(`${code} ${b.name}`);
  }
  assert.deepEqual(missing, [], 'on-map class buildings with no footprint within 250 m');
  // See buildings.test.mjs: the index tops out at the 46 buildings with
  // published hours.
  assert.ok(codes.length > 30, 'the check would be vacuous with too few codes');
});

test('the committed map stays inside its stated budget', () => {
  if (!existsSync(PATH)) return;
  const gz = gzipSync(readFileSync(PATH), { level: 9 }).length / 1024;
  assert.ok(gz < 140, `${gz.toFixed(1)} KB gzipped is over the 140 KB budget`);
});
