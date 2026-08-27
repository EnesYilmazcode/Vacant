// Offline. Fixtures only, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildIndex } from '../fetch-buildings.mjs';
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
