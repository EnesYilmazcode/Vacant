// Offline. The walking constants and the bias sitting under them.
//
// js/engine.js prints three figures in the comment above DETOUR, and #26 asks
// for the pair to be changed or reaffirmed with a measured number written in.
// The number written in is measured here, off the shipped footprints, so the
// comment cannot go stale without a red test. That matters more than usual:
// the figure it replaces came from the issue body, was never reproduced, and
// is wrong in both of the two cases it names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { decodeShape, toLonLat } from '../../js/campus.js';
import { DETOUR, WALK_MPM, distanceMetres, walkMinutes } from '../../js/engine.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

const campus = read('data/campus.json');
const buildings = read('data/buildings.json').buildings;
const rooms = read('data/rooms-1268.json');

// How far the far corner of a building's own footprint is from the point the
// engine measures walks to. That distance is the part of the walk the engine
// cannot see: it stops at the point and the door is somewhere on the outline.
function farCorners() {
  const shipped = new Set(Object.values(rooms.rooms).map((r) => r.b));
  const out = new Map();
  campus.layers.building.forEach((rings, i) => {
    const code = campus.buildingCode[i];
    if (!code || !shipped.has(code)) return;
    const b = buildings[code];
    if (!b || !Number.isFinite(b.lat) || !Number.isFinite(b.lon)) return;
    let far = out.get(code) ?? 0;
    for (const ring of rings) {
      for (const pt of decodeShape(ring)) {
        const [lon, lat] = toLonLat(pt, campus);
        far = Math.max(far, distanceMetres({ lat: b.lat, lon: b.lon }, { lat, lon }));
      }
    }
    out.set(code, far);
  });
  return out;
}

test('one straight-line metre is one second of predicted walk', () => {
  // The identity the DETOUR comment leans on, and the reason a stopwatch alone
  // cannot separate the two constants: it fits the ratio and nothing else.
  assert.equal((DETOUR / WALK_MPM) * 60, 1);
  // And the rounding it survives, since walkMinutes ceils.
  assert.equal(walkMinutes(60), 1);
  assert.equal(walkMinutes(61), 2);
});

test('the centroid bias in the DETOUR comment is what the footprints say', () => {
  const far = [...farCorners().values()].sort((a, b) => a - b);
  assert.equal(far.length, 46, 'every shipped building should have a footprint');
  const q = (p) => far[Math.floor(far.length * p)];
  // Rounded to the metre, which is the unit the comment prints. A shipped
  // coordinate moving in the GIS pull is allowed to move these by a metre or
  // two, so the assertion is a band and not an equality.
  assert.ok(Math.abs(q(0.5) - 44) <= 2, `median far corner is ${q(0.5).toFixed(1)} m, comment says 44`);
  assert.ok(Math.abs(q(0.9) - 62) <= 2, `p90 far corner is ${q(0.9).toFixed(1)} m, comment says 62`);
  const max = far[far.length - 1];
  assert.ok(Math.abs(max - 85) <= 2, `worst far corner is ${max.toFixed(1)} m, comment says 85`);
  // The direction of the bias, which is the whole point of writing it down.
  assert.ok(q(0.5) > 0, 'the bias is an underestimate, never a credit');
});

test('the building #26 quotes the worst case for is not in the index', () => {
  // "1 min 45 s for Ohio Stadium" is a caveat about a building the safety
  // filter removes, so the walk cannot test it even if somebody wanted to.
  const stadium = Object.entries(buildings).find(([, b]) => b.name === 'Ohio Stadium');
  assert.ok(stadium, 'Ohio Stadium should still be in the building table');
  const codes = new Set(Object.values(rooms.rooms).map((r) => r.b));
  assert.equal(codes.has(stadium[0]), false, 'Ohio Stadium ships rooms again, so the comment needs redoing');
});
