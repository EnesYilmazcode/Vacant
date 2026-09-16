// Offline. The sidewalk graph, the encoder, and the search the browser runs.
//
// Three things can go quiet here. The ENCODER can lose a node: it writes edges
// once, from the lower-numbered end, and a decoder that forgets to add the
// reverse half produces a graph that is silently one-way, which does not throw
// and does not look wrong -- it just routes some walks the long way round. The
// SEARCH can disagree with the builder's: there are two Dijkstras in this
// repository, one over the builder's adjacency lists and one over the shipped
// CSR, and nothing but a test makes them stay the same function. And the
// COMMITTED FILE can go stale against what it says about itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { contract, encodeGraph, largestComponent, nodeGraph, reachable } from '../lib/walk-graph.mjs';
import { createRouter, decodeWalkGraph, snap, toPlane } from '../../js/route.js';
import { approachMetres } from '../../js/engine.js';
import { OVAL } from '../lib/geo.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

const FILE = read('data/walk-graph.json');
const BUILDINGS = read('data/buildings-1268.json').buildings;
const GRAPH = decodeWalkGraph(FILE);
const ROUTER = createRouter(GRAPH, BUILDINGS);

// A hand-built network, so the builder can be checked against a shape whose
// right answers are arithmetic rather than a snapshot. A 100 m run drawn in two
// pieces, meeting a junction that branches twice:
//
//     (0,0) --- (50,0) --- (100,0) --- (150,0)
//                             |
//                          (100,50)
//
// (50,0) is the degree-2 vertex contraction has to fold away, and it is drawn
// as the seam between two separate features, which is how a real centreline
// arrives.
const metresToLon = (m) => m / (111320 * Math.cos((OVAL.lat * Math.PI) / 180));
const metresToLat = (m) => m / 111320;
const at = (east, north) => [OVAL.lon + metresToLon(east), OVAL.lat + metresToLat(north)];
const line = (...points) => ({ geometry: { paths: [points] }, attributes: {} });

// The exact inverse of toPlane, so a node can be handed back to the router as
// the latitude and longitude it came from. The rough metresToLat/metresToLon
// above are fine for drawing a fixture and are NOT fine here: they evaluate the
// cosine at the origin rather than at the midpoint, which puts a node a metre
// or two from itself and makes a zero-cost snap look like a two-metre one.
const place = (x, y) => {
  const R = 6371008.8;
  const deg = (r) => (r * 180) / Math.PI;
  const lat = FILE.origin.lat + deg(y / R);
  const lon =
    FILE.origin.lon + deg(x / (R * Math.cos(((FILE.origin.lat + lat) * Math.PI) / 360)));
  return { lat, lon };
};

const TEE = [
  line(at(0, 0), at(50, 0)),
  line(at(50, 0), at(100, 0)),
  line(at(100, 0), at(150, 0)),
  line(at(100, 0), at(100, 50)),
];

// --- the builder

test('drawn vertices that share a point become one node', () => {
  const nodes = nodeGraph(TEE, OVAL);
  assert.equal(nodes.vertices, 8, 'four features of two points each');
  assert.equal(nodes.count, 5, 'the seams are shared');
  assert.equal(nodes.segments, 4);
});

test('contraction folds a degree-2 vertex into the weight of one edge', () => {
  const nodes = nodeGraph(TEE, OVAL);
  const graph = contract(nodes, largestComponent(nodes));
  assert.equal(graph.count, 4, 'the seam at (50,0) is gone, the junction stays');
  const total = graph.adj.reduce((sum, list) => sum + list.length, 0) / 2;
  assert.equal(total, 3);
  // The folded run still measures 100 m, not the 50 m of its first piece.
  const lengths = graph.adj.flat().map(([, m]) => Math.round(m)).sort((a, b) => a - b);
  assert.deepEqual(lengths, [50, 50, 50, 50, 100, 100]);
});

test('a path that meets nothing else is kept as its own component and dropped', () => {
  const island = [...TEE, line(at(900, 900), at(950, 900))];
  const nodes = nodeGraph(island, OVAL);
  const component = largestComponent(nodes);
  assert.equal(nodes.components, 2);
  assert.equal(component.length, 5, 'the tee, not the island');
});

test('a ring with no junction on it survives contraction', () => {
  // Four segments closing on themselves. Every node has degree 2, so without
  // the ring pin in contract() there is no node to start the walk from and the
  // whole loop disappears without an error.
  const ring = [
    line(at(0, 0), at(60, 0)),
    line(at(60, 0), at(60, 60)),
    line(at(60, 60), at(0, 60)),
    line(at(0, 60), at(0, 0)),
  ];
  const nodes = nodeGraph(ring, OVAL);
  const graph = contract(nodes, largestComponent(nodes));
  assert.ok(graph.count >= 1, 'the ring is still in the graph');
});

// --- the encoder and the decoder

test('the shipped file decodes to the node and edge count it claims', () => {
  assert.equal(GRAPH.count, FILE.nodes);
  assert.equal(GRAPH.edges, FILE.edges);
  assert.equal(FILE.funnel.kept, FILE.nodes);
});

test('every edge is readable from both of its ends', () => {
  // The file stores each edge once. A decoder that only filled the forward half
  // would still answer most questions, just some of them the long way round.
  let checked = 0;
  for (let node = 0; node < GRAPH.count; node++) {
    for (let k = GRAPH.first[node]; k < GRAPH.first[node + 1]; k++) {
      const other = GRAPH.target[k];
      let back = false;
      for (let j = GRAPH.first[other]; j < GRAPH.first[other + 1]; j++) {
        if (GRAPH.target[j] === node) {
          assert.ok(Math.abs(GRAPH.metres[j] - GRAPH.metres[k]) < 1e-9, 'same weight both ways');
          back = true;
        }
      }
      assert.ok(back, `edge ${node}->${other} has no reverse`);
      checked++;
    }
  }
  assert.equal(checked, GRAPH.edges * 2);
});

test('no edge is shorter than the straight line between its own ends', () => {
  // The weight is stored as an excess over the chord, so a sign error here
  // would produce pavement that beats the crow.
  for (let node = 0; node < GRAPH.count; node++) {
    for (let k = GRAPH.first[node]; k < GRAPH.first[node + 1]; k++) {
      const other = GRAPH.target[k];
      const chord = Math.hypot(GRAPH.xs[other] - GRAPH.xs[node], GRAPH.ys[other] - GRAPH.ys[node]);
      assert.ok(GRAPH.metres[k] >= chord - 1e-6, `${GRAPH.metres[k]} < ${chord}`);
    }
  }
});

test('encoding is deterministic', () => {
  const nodes = nodeGraph(TEE, OVAL);
  const graph = contract(nodes, largestComponent(nodes));
  assert.equal(encodeGraph(graph).base64, encodeGraph(graph).base64);
});

// --- the two searches agree

test('the browser search and the builder search return the same distances', () => {
  // Rebuild the builder-side adjacency from the DECODED graph, so the only
  // thing under test is the search itself.
  const rebuilt = {
    count: GRAPH.count,
    xs: [...GRAPH.xs],
    ys: [...GRAPH.ys],
    adj: Array.from({ length: GRAPH.count }, (_, i) => {
      const out = [];
      for (let k = GRAPH.first[i]; k < GRAPH.first[i + 1]; k++) out.push([GRAPH.target[k], GRAPH.metres[k]]);
      return out;
    }),
  };

  // Where each building's doors sit on the graph, worked out here rather than
  // taken from the router, so the two sides share nothing but the graph.
  const landings = new Map();
  for (const [code, building] of Object.entries(BUILDINGS)) {
    const base = toPlane(FILE.origin, building.lat, building.lon);
    const doors = building.d ?? [];
    const points = doors.length
      ? Array.from({ length: doors.length / 2 }, (_, i) => ({
          x: base.x + doors[i * 2],
          y: base.y + doors[i * 2 + 1],
        }))
      : [base];
    const hits = points.map((p) => snap(GRAPH, p.x, p.y)).filter(Boolean);
    if (hits.length) landings.set(code, hits);
  }

  const CEILING = 936; // MAX_WALK 12 x WALK_MPM 78
  let compared = 0;
  for (const start of [0, 1000, 2500, 4000, GRAPH.count - 1]) {
    const mine = reachable(rebuilt, [[start, 0]], CEILING);
    const here = place(GRAPH.xs[start], GRAPH.ys[start]);
    const theirs = ROUTER.from(here.lat, here.lon, CEILING);
    assert.ok(theirs, 'a node is on the graph by definition');
    assert.ok(theirs.offGraphMetres < 1e-6, 'and it starts on it at no cost');

    for (const [code, hits] of landings) {
      let expected = Infinity;
      for (const { node, metres } of hits) expected = Math.min(expected, mine[node] + metres);
      const actual = theirs.metresTo(code);

      // Past the ceiling both sides must say "no", not a number one of them
      // happened to settle before it stopped.
      if (!Number.isFinite(expected) || expected > CEILING) {
        assert.ok(actual == null || actual > CEILING, `${code}: ${actual} past the ceiling`);
        continue;
      }
      assert.ok(actual != null, `${code}: the browser search found nothing`);
      assert.ok(Math.abs(actual - expected) < 1e-6, `${code}: ${actual} vs ${expected}`);
      compared++;
    }
  }
  // Most of the 50 buildings sit past the ceiling from a node picked at random
  // out of the file's ordering, so this is a floor on coverage rather than a
  // count worth pinning.
  assert.ok(compared > 50, `only ${compared} routed distances compared`);
});

// --- snapping

test('a point on a node snaps to that node at no cost', () => {
  const hit = snap(GRAPH, GRAPH.xs[42], GRAPH.ys[42]);
  assert.equal(hit.node, 42);
  assert.ok(hit.metres < 1e-9);
});

test('a point far from any pavement does not snap, and the walk falls back', () => {
  // Ten kilometres east of the Oval. Not on campus, not in the envelope.
  const far = ROUTER.from(OVAL.lat, OVAL.lon + metresToLon(10000), 936);
  assert.equal(far, null, 'no field at all, rather than a route across ten km');
});

test('snapping finds the nearest node and not merely a near one', () => {
  // A point deliberately placed in the corner of its own bucket, where a search
  // that stops at the first occupied cell picks the wrong node.
  for (const node of [7, 700, 3000]) {
    const x = GRAPH.xs[node] + 3;
    const y = GRAPH.ys[node] + 3;
    const hit = snap(GRAPH, x, y);
    let best = Infinity;
    for (let i = 0; i < GRAPH.count; i++) {
      best = Math.min(best, Math.hypot(GRAPH.xs[i] - x, GRAPH.ys[i] - y));
    }
    assert.ok(Math.abs(hit.metres - best) < 1e-6, `${hit.metres} vs ${best}`);
  }
});

// --- what the app gets

test('every building the term indexes has somewhere to land', () => {
  assert.equal(ROUTER.covers, Object.keys(BUILDINGS).length);
});

test('a routed walk is never shorter than the straight line to the same door', () => {
  const origin = { lat: OVAL.lat, lon: OVAL.lon };
  const field = ROUTER.from(origin.lat, origin.lon, 4000);
  assert.ok(field);
  let compared = 0;
  for (const [code, building] of Object.entries(BUILDINGS)) {
    const routed = field.metresTo(code);
    if (routed == null) continue;
    const straight = approachMetres(origin, building);
    // The routed walk starts by stepping off-graph onto the nearest path, so
    // the floor is the straight line less that step, not the straight line.
    assert.ok(
      routed >= straight - field.offGraphMetres - 1,
      `${code}: routed ${routed.toFixed(0)} m beats straight ${straight.toFixed(0)} m`,
    );
    compared++;
  }
  assert.ok(compared > 40, `only ${compared} buildings compared`);
});

test('the committed graph stays small enough to ship', () => {
  // The whole app is 108 KB over the wire. This file is the single largest
  // thing #115 could have added, and the number is the reason the geometry
  // between two junctions is not in it.
  const gz = gzipSync(readFileSync(join(ROOT, 'data/walk-graph.json')), { level: 9 }).length;
  assert.ok(gz < 26 * 1024, `walk-graph.json is ${gz} B gzipped`);
});

test('the graph and the doors are measured in the same plane', () => {
  // js/engine.js adds door offsets onto an origin-to-building vector; this file
  // stores absolute metres from the Oval. If those two ever drift, every walk
  // is wrong by a little, everywhere.
  for (const [code, building] of Object.entries(BUILDINGS).slice(0, 12)) {
    const plane = toPlane(FILE.origin, building.lat, building.lon);
    const viaEngine = approachMetres({ lat: FILE.origin.lat, lon: FILE.origin.lon }, building);
    // approachMetres measures to the doors INSTEAD of the centroid once a
    // building has any, even where the centroid happens to be nearer. Mirror
    // that here or this test reimplements a different function.
    const doors = building.d ?? [];
    let best = Infinity;
    if (!doors.length) best = Math.hypot(plane.x, plane.y);
    for (let i = 0; i < doors.length; i += 2) {
      best = Math.min(best, Math.hypot(plane.x + doors[i], plane.y + doors[i + 1]));
    }
    assert.ok(Math.abs(best - viaEngine) < 0.01, `${code}: ${best} vs ${viaEngine}`);
  }
});
