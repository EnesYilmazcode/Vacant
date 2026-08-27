// Offline. Fixtures only, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { buildIndex, smallIndex } from '../fetch-buildings.mjs';
import { padCode } from '../fetch-campus.mjs';
import { OVAL, haversineMetres, kmFromOval } from '../lib/geo.mjs';

const feat = (attributes) => ({ attributes });

// Coordinates come off the service as strings, which is the trap: Number()
// works, a bare arithmetic read does not, and the failure is a silent NaN.
const DREESE = feat({
  buildingNumber: '279',
  BLDG_NAME: 'Dreese Laboratories',
  SchedulingAbbreviation: 'DL',
  Latitude: '40.002295',
  Longitude: '-83.015831',
  Address: '2015 Neil Ave',
  Campus: 'Columbus',
  Status: 'Active',
  FloorCount: 8,
});

test('coordinates arrive as strings and must survive as finite numbers', () => {
  const { byCode } = buildIndex([DREESE]);
  const b = byCode.get('279');
  assert.equal(typeof b.lat, 'number');
  assert.ok(Number.isFinite(b.lat) && Number.isFinite(b.lon));
  assert.equal(b.lat, 40.002295);
  assert.equal(b.short, 'DL');
});

test('a duplicated buildingNumber is deduped explicitly and counted', () => {
  // 246 really does appear twice and 1243 three times in the live layer, both
  // with identical attributes.
  const dup = feat({ ...DREESE.attributes, buildingNumber: '246' });
  const { byCode, funnel, conflicts } = buildIndex([dup, dup, dup]);
  assert.equal(byCode.size, 1);
  assert.equal(funnel.duplicateRows, 2, 'the surplus rows are reported, not silently dropped');
  assert.equal(conflicts.length, 0, 'identical coordinates are not a conflict');
});

test('two rows sharing a code but disagreeing about position is a conflict', () => {
  const a = feat({ ...DREESE.attributes, buildingNumber: '999' });
  const b = feat({ ...DREESE.attributes, buildingNumber: '999', Latitude: '40.1' });
  const { conflicts } = buildIndex([a, b]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].code, '999');
});

test('rows with no buildingNumber or no coordinate are dropped and counted', () => {
  const noNum = feat({ buildingNumber: '', Latitude: '40', Longitude: '-83' });
  const blank = feat({ buildingNumber: null, Latitude: '40', Longitude: '-83' });
  // 1072 is the one real feature that has a code and no coordinate.
  const noCoord = feat({ buildingNumber: '1072', Latitude: null, Longitude: null });
  const empty = feat({ buildingNumber: '1073', Latitude: '', Longitude: '' });
  const { byCode, funnel } = buildIndex([DREESE, noNum, blank, noCoord, empty]);
  assert.equal(byCode.size, 1);
  assert.equal(funnel.noBuildingNumber, 2);
  assert.equal(funnel.noCoordinate, 2);
});

test('the cap keeps every building that hosts classes and drops the satellites', () => {
  // Real coordinates from the live layer. 837 and 1019 are the two furthest
  // buildings with actual scheduled classes, and a 3 km cap deletes both.
  const outpatient = feat({ buildingNumber: '837', Latitude: '39.97855583', Longitude: '-82.96310991' });
  const knowlton = feat({ buildingNumber: '1019', Latitude: '40.07523157', Longitude: '-83.0750966' });
  // Wooster Science Building and Stone Laboratory both host classes whose
  // sections claim campus "Columbus". The cap is what keeps them out.
  const wooster = feat({ buildingNumber: '8002', Latitude: '40.7798986', Longitude: '-81.9277940' });
  const stoneLab = feat({ buildingNumber: '118', Latitude: '41.65780852', Longitude: '-82.82223071' });

  const { byCode, funnel } = buildIndex([DREESE, outpatient, knowlton, wooster, stoneLab]);
  assert.ok(byCode.has('837'), 'Outpatient Care East at 4.85 km must survive');
  assert.ok(byCode.has('1019'), 'Knowlton Executive Terminal at 9.94 km must survive');
  assert.ok(!byCode.has('8002'), 'Wooster at 126 km is out');
  assert.ok(!byCode.has('118'), 'Stone Laboratory on Lake Erie at 185 km is out');
  assert.equal(funnel.beyondCap, 2);
});

test('the cap clears the furthest scheduled building by more than a rounding error', () => {
  // The whole reason the cap moved off 10 km: Knowlton sits at 9.94, which a
  // 10 km cap clears by 60 metres.
  const knowlton = { lat: 40.07523157, lon: -83.0750966 };
  const km = kmFromOval(knowlton);
  assert.ok(km > 9.9 && km < 10.0, `Knowlton measured at ${km.toFixed(2)} km`);
  const { byCode } = buildIndex([feat({ buildingNumber: '1019', Latitude: String(knowlton.lat), Longitude: String(knowlton.lon) })]);
  assert.ok(byCode.has('1019'));
});

test('haversine agrees with a known campus distance', () => {
  // Dreese to the Oval, the pair the research measured.
  const m = haversineMetres(OVAL, { lat: 40.002295, lon: -83.015831 });
  assert.ok(m > 300 && m < 400, `expected roughly 350 m, got ${Math.round(m)}`);
  assert.equal(Math.round(kmFromOval({ lat: 40.002295, lon: -83.015831 }) * 1000), Math.round(m));
});

test('haversine is symmetric and zero on itself', () => {
  const a = { lat: 39.9995, lon: -83.013 };
  const b = { lat: 40.002295, lon: -83.015831 };
  assert.equal(haversineMetres(a, a), 0);
  assert.ok(Math.abs(haversineMetres(a, b) - haversineMetres(b, a)) < 1e-9);
});

test('one degree of latitude is about 111 km, which pins the radius', () => {
  const m = haversineMetres({ lat: 40, lon: -83 }, { lat: 41, lon: -83 });
  assert.ok(Math.abs(m - 111195) < 200, `got ${Math.round(m)}`);
});

test('the funnel adds up to the feature count', () => {
  const rows = [DREESE, feat({ buildingNumber: '', Latitude: '40', Longitude: '-83' })];
  const { funnel } = buildIndex(rows);
  const accounted =
    funnel.noBuildingNumber + funnel.noCoordinate + funnel.duplicateRows + funnel.beyondCap + funnel.kept;
  assert.equal(accounted, funnel.features, 'every feature is accounted for in exactly one bucket');
});

// --- regressions found by code review, 2026-08-26 ---

test('a position conflict outside the cap is still detected', () => {
  // With the cap checked before the dedupe, the first row is dropped before it
  // is stored, so the second finds nothing to compare against and the conflict
  // is invisible.
  const a = feat({ buildingNumber: '9001', Latitude: '40.7789', Longitude: '-81.9310' });
  const b = feat({ buildingNumber: '9001', Latitude: '41.6578', Longitude: '-82.8222' });
  const { funnel } = buildIndex([a, b]);
  assert.equal(funnel.beyondCap, 1, 'one building, not two');
  assert.equal(funnel.duplicateRows, 1, 'the second row is a duplicate, not a second building');
});

test('a duplicated far-away building is counted once against the cap', () => {
  const row = feat({ buildingNumber: '8002', Latitude: '40.7798986', Longitude: '-81.9277940' });
  const { funnel } = buildIndex([row, row, row]);
  assert.equal(funnel.beyondCap, 1);
  assert.equal(funnel.duplicateRows, 2);
  const accounted =
    funnel.noBuildingNumber + funnel.noCoordinate + funnel.duplicateRows + funnel.beyondCap + funnel.kept;
  assert.equal(accounted, funnel.features);
});

test('an empty BLDG_NAME falls back to FormalName instead of shipping ""', () => {
  const row = feat({
    buildingNumber: '500',
    BLDG_NAME: '',
    FormalName: 'Real Name',
    Latitude: '40.0',
    Longitude: '-83.01',
  });
  assert.equal(buildIndex([row]).byCode.get('500').name, 'Real Name');
});

// --- the launch subset, issue #54 ---

const FULL = {
  '003': { name: 'Arps Hall', short: 'AH', lat: 40.0, lon: -83.01, km_from_oval: 0.2, address: 'x', city: 'Columbus', campus: 'Columbus', floors: 5, status: 'Active' },
  '279': { name: 'Dreese Laboratories', short: 'DL', lat: 40.002295, lon: -83.015831, km_from_oval: 0.5, address: 'y', city: 'Columbus', campus: 'Columbus', floors: 8, status: 'Active' },
  '900': { name: 'Never Hosts A Class', short: 'NH', lat: 40.1, lon: -83.1, km_from_oval: 9, address: 'z', city: 'Columbus', campus: 'Columbus', floors: 1, status: 'Active' },
};

test('the launch subset keeps only the three fields the app reads', () => {
  const { small } = smallIndex(FULL, new Set(['003']));
  assert.deepEqual(Object.keys(small['003']), ['name', 'lat', 'lon']);
  assert.equal(small['003'].name, 'Arps Hall');
});

test('the launch subset keeps only codes the room index points at', () => {
  // Sorted, because a plain key order puts '279' before '003': JS orders
  // integer-like keys numerically and everything else by insertion.
  const { small } = smallIndex(FULL, new Set(['003', '279']));
  assert.deepEqual(Object.keys(small).sort(), ['003', '279']);
});

test('a room code with no building record is reported, not silently dropped', () => {
  // A room in the grid whose building is missing has nothing to put on the map,
  // and dropping it quietly is how that reaches a phone.
  const { small, missing } = smallIndex(FULL, new Set(['003', '404']));
  assert.deepEqual(missing, ['404']);
  assert.equal(small['404'], undefined);
});

test('the committed launch subset covers every building the room index names', () => {
  const cur = new URL('../../data/current.json', import.meta.url);
  if (!existsSync(cur)) return;
  const term = JSON.parse(readFileSync(cur, 'utf8')).term;
  const smallPath = new URL(`../../data/buildings-${term}.json`, import.meta.url);
  const roomsPath = new URL(`../../data/rooms-${term}.json`, import.meta.url);
  const fullPath = new URL('../../data/buildings.json', import.meta.url);
  if (!existsSync(smallPath) || !existsSync(roomsPath) || !existsSync(fullPath)) return;

  const small = JSON.parse(readFileSync(smallPath, 'utf8')).buildings;
  const full = JSON.parse(readFileSync(fullPath, 'utf8')).buildings;
  const rooms = JSON.parse(readFileSync(roomsPath, 'utf8')).rooms;
  const codes = [...new Set(Object.values(rooms).map((r) => r.b))];

  const absent = codes.filter((c) => !small[c]);
  assert.deepEqual(absent, [], 'room codes with no record in the launch subset');
  assert.ok(codes.length > 50, 'the check would be vacuous with too few codes');

  for (const [code, b] of Object.entries(small)) {
    assert.deepEqual(Object.keys(b), ['name', 'lat', 'lon'], `${code} carries more than it needs`);
    assert.equal(b.lat, full[code].lat, `${code} disagrees with the full index`);
    assert.equal(b.lon, full[code].lon, `${code} disagrees with the full index`);
  }
});

// --- building codes on the map, issue #50 ---

test('a short building code is padded to the three digits room.b uses', () => {
  // data/footprints.draft.json ships the unpadded form, and joining on it
  // resolves 50 of 86 codes while looking like it worked.
  assert.equal(padCode('3'), '003');
  assert.equal(padCode('60'), '060');
  assert.equal(padCode('003'), '003');
  assert.equal(padCode('1243'), '1243');
  assert.equal(padCode(''), '');
  assert.equal(padCode(null), '');
});

test('the committed map keys its footprints by building code', () => {
  const mapPath = new URL('../../data/campus.json', import.meta.url);
  const cur = new URL('../../data/current.json', import.meta.url);
  if (!existsSync(mapPath) || !existsSync(cur)) return;
  const c = JSON.parse(readFileSync(mapPath, 'utf8'));
  const term = JSON.parse(readFileSync(cur, 'utf8')).term;
  const roomsPath = new URL(`../../data/rooms-${term}.json`, import.meta.url);
  if (!existsSync(roomsPath)) return;

  assert.ok(Array.isArray(c.buildingCode), 'campus.json carries no buildingCode');
  assert.equal(
    c.buildingCode.length,
    c.layers.building.length,
    'buildingCode is not aligned with layers.building, so every code after a gap is wrong',
  );

  // A keyed code has to be a building we can name, in the padded form room.b
  // uses. It does NOT have to appear in the room index: since the safety filter
  // landed, 15 of the 86 keyed buildings host classes only in rooms the index
  // refuses to ship. The Adventure Recreation Center's classes are all in a
  // climbing wall, Ohio Stadium's are in a meeting room. Those buildings are
  // still on the map as context, which is what the map is for.
  const buildings = JSON.parse(readFileSync(new URL('../../data/buildings.json', import.meta.url), 'utf8')).buildings;
  const keyed = c.buildingCode.filter(Boolean);
  for (const code of keyed) {
    assert.ok(buildings[code], `${code} is keyed but is not in buildings.json`);
    assert.match(code, /^\d{3,}$/, `${code} is not in the padded form room.b uses`);
  }
  // The direction that matters for the app: a room in the index that is on the
  // map has a footprint to point at.
  const rooms = JSON.parse(readFileSync(roomsPath, 'utf8')).rooms;
  const onMap = new Set(keyed);
  for (const [id, r] of Object.entries(rooms)) {
    const km = buildings[r.b]?.km_from_oval;
    if (km == null || km > 2) continue;
    assert.ok(onMap.has(r.b), `${id} is in building ${r.b}, inside the map, with no footprint`);
  }
  assert.ok(keyed.length >= 80, `only ${keyed.length} class-hosting buildings resolve to a polygon`);
});
