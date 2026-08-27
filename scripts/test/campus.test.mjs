// Offline. Fixtures plus the committed map, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

import { aspect, decodeShape, inBounds, toGrid, toLonLat } from '../../js/campus.js';

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

test('grid values outside 0..grid are allowed, not clamped', () => {
  // The query asks for shapes that INTERSECT the box, so anything crossing the
  // edge comes back whole. Clamping would tear shapes apart at the boundary.
  const west = toGrid([MAP.bbox[0] - 0.01, MAP.bbox[1]], MAP);
  assert.ok(west[0] < 0, `expected a negative x, got ${west[0]}`);
});

test('inBounds answers whether a room has anything to point at', () => {
  assert.equal(inBounds([-83.015, 40.0], MAP), true);
  assert.equal(inBounds([-81.93, 40.78], MAP), false, 'Wooster is not on the map');
});

test('the aspect ratio corrects for longitude being shorter than latitude', () => {
  // At 40 degrees north cos(40) is about 0.766, so drawing grid space square
  // would stretch campus east to west.
  const a = aspect(MAP);
  const expected =
    ((MAP.bbox[2] - MAP.bbox[0]) * Math.cos((40 * Math.PI) / 180)) / (MAP.bbox[3] - MAP.bbox[1]);
  assert.ok(Math.abs(a - expected) < 0.01, `${a} vs ${expected}`);
});

// --- the committed map, if it has been built ---

const PATH = new URL('../../data/campus.json', import.meta.url);
const readMap = () => (existsSync(PATH) ? JSON.parse(readFileSync(PATH, 'utf8')) : null);

test('the committed map has building footprints, which are the load-bearing layer', () => {
  const c = readMap();
  if (!c) return;
  assert.ok(c.layers.building.length > 300, `only ${c.layers.building.length} footprints`);
  assert.equal(c.bbox.length, 4);
  assert.ok(c.bbox[2] > c.bbox[0] && c.bbox[3] > c.bbox[1], 'bbox is not inside out');
});

test('every shape in the committed map decodes to at least two points', () => {
  const c = readMap();
  if (!c) return;
  for (const [name, rings] of Object.entries(c.layers)) {
    for (const r of rings) {
      assert.equal(r.length % 2, 0, `${name}: odd delta count`);
      assert.ok(r.length >= 4, `${name}: a shape with fewer than two points`);
      assert.ok(r.every(Number.isInteger), `${name}: a non-integer delta`);
    }
  }
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

  const centroids = c.layers.building.map((r) => {
    const pts = decodeShape(r);
    let x = 0;
    let y = 0;
    for (const p of pts) {
      x += p[0];
      y += p[1];
    }
    return [x / pts.length, y / pts.length];
  });

  // 250 m in grid steps, generous because a centroid is not a door.
  const tolerance = (250 / 4500) * c.grid;
  const missing = [];
  for (const code of codes) {
    const b = buildings[code];
    if (!b || !inBounds([b.lon, b.lat], c)) continue;
    const [gx, gy] = toGrid([b.lon, b.lat], c);
    if (!centroids.some((p) => Math.hypot(p[0] - gx, p[1] - gy) < tolerance)) {
      missing.push(`${code} ${b.name}`);
    }
  }
  assert.deepEqual(missing, [], 'on-map class buildings with no footprint within 250 m');
});

test('the committed map stays inside its stated budget', () => {
  if (!existsSync(PATH)) return;
  const gz = gzipSync(readFileSync(PATH), { level: 9 }).length / 1024;
  assert.ok(gz < 140, `${gz.toFixed(1)} KB gzipped is over the 140 KB budget`);
});
