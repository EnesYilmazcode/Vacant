#!/usr/bin/env node
// Build data/buildings.json from Ohio State's own GIS building layer.
//
// The class API names rooms like DL0357 and carries meetings[].buildingCode
// "279", but no coordinates. OSU's Facilities GIS server publishes a Building
// layer whose buildingNumber field is character-for-character the same value.
// It is a key join on exact string equality, not a fuzzy name match, and all 88
// building codes observed across two independently drawn schedule samples
// resolve on the first try.
//
// Usage:  node scripts/fetch-buildings.mjs
//         node scripts/fetch-buildings.mjs --dry-run
//
// One HTTP request pulls the whole layer.

import { gzipSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchJson, requests } from './lib/fetch.mjs';
import { kmFromOval } from './lib/geo.mjs';

const SERVICE =
  'https://gissvc.osu.edu/arcgis/rest/services/Data/FacilitiesStreets_RO/MapServer/11/query';
const OUT_FIELDS = [
  'buildingNumber',
  'BLDG_NAME',
  'SchedulingAbbreviation',
  'FormalName',
  'Address',
  'City',
  'Campus',
  'Status',
  'InstType',
  'FloorCount',
  'Latitude',
  'Longitude',
].join(',');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PATH = join(ROOT, 'data', 'buildings.json');

// Two files, not one. The full index is 612 buildings with ten fields each and
// 22,964 bytes gzipped, 18.5% of everything the app downloads, and the app
// reads three of those fields on 96 of those buildings: js/engine.js takes
// lat, lon and name, and nothing anywhere reads address, city, campus, status,
// floors, short or km_from_oval.
//
// So the launch file carries the codes the term's room index actually
// references, with name, lat and lon, and measures 2,359 bytes gzipped. The
// full file keeps its name and every field, and the building picker loads it
// when that screen opens instead of before the first answer.
const SMALL_FIELDS = ['name', 'lat', 'lon'];

// Plus `d`, the building's doors, when data/entrances.json has any: whole
// metres east and north of `lat`/`lon`, flattened, nearest first.
//
// Offsets and not coordinates, because the point of this file is that it is
// small. A door as a lat/lon pair is two 17-character numbers; as a pair of
// metre offsets it is two numbers under three digits, every one of them inside
// the 72 m the furthest real door sits from its building's own point. MEASURED
// on the Autumn 2026 subset, same 46 buildings either way: 217 doors cost 743
// bytes gzipped as offsets, 1,482 to 2,225, and 4,699 as coordinate pairs.
//
// The file still SHRANK, 2,563 bytes to 2,225, because the committed one was
// built on 2026-08-27 against a 96-building index and had been carrying 50
// buildings the room index stopped referencing. That is the stale floor above
// doing its damage, not a discount on the doors.
//
// Whole metres is a 0.7 m worst-case rounding error, which at WALK_MPM is half
// a second, against doors the GIS layer places to about 10 cm. The engine's
// own comment is that a metre is a second; a metre here is not worth a byte.
const doorOffsets = (building, doors) => (doors ?? []).flatMap((door) => {
  const midLat = rad((building.lat + door.lat) / 2);
  return [
    Math.round(rad(door.lon - building.lon) * Math.cos(midLat) * EARTH_METRES),
    Math.round(rad(door.lat - building.lat) * EARTH_METRES),
  ];
});

// The same equirectangular plane js/engine.js measures in, so that adding an
// offset to an origin-to-building vector is the same answer as measuring
// origin to door directly. scripts/test/entrances.test.mjs holds the two
// against each other over every shipped door.
const EARTH_METRES = 6371008.8;
const rad = (deg) => (deg * Math.PI) / 180;

// The small file is derived from a term, so it is named for one the way
// data/rooms-1268.json is. data/current.json says which term is live.
const smallPath = (term) => join(ROOT, 'data', `buildings-${term}.json`);

// A term whose room index resolves fewer buildings than this did not load, and
// shipping the small file anyway would delete pins from the map.
//
// 90 until 2026-09-15, and by then it had been unreachable for some time: the
// figure was measured when term 1268 carried 871 rooms in 96 buildings, and the
// room safety filter has since cut the index to 425 rooms in 46. The floor sat
// ABOVE the real number, so `only 46 of 46 class-hosting codes resolved` was
// fatal and this script could not write data/buildings-<term>.json at all. The
// committed subset is older than the index it is keyed against for that reason.
//
// A floor that outruns its own dataset is worse than no floor, because it fails
// on a perfect run and the failure names the healthy number. 40 sits under the
// measured 46 with room for a term that schedules a few buildings fewer, and
// far above the zero a collapsed pull produces.
const MIN_CLASS_BUILDINGS = 40;

// The cap exists to keep satellite campuses out of a walking app. It is a
// CHOSEN bound, not a natural boundary, and the research calling 10 km "stable
// rather than tuned" is only true of buildings that host classes.
//
// Across the full 1331 building layer there is no gap at 10 km at all. The
// distribution runs straight through it (9.94, 9.95, 9.99, 10.01, 10.03, 10.17)
// and out to Extension offices in every Ohio county, then DC, Boston and LA. A
// 10 km cap splits Aerospace Research Center Storage 3 from Storage 1, two
// buildings in the same complex.
//
// Among SCHEDULED buildings the gap is real and enormous. Measured over every
// meeting in terms 1262 and 1264:
//
//     furthest scheduled Columbus-area building     9.94 km  Knowlton Exec Terminal
//     nearest scheduled satellite building        126.40 km  Wooster Science Building
//
// So 10 km is not wrong because it is arbitrary, it is wrong because it clears
// the furthest real classroom building by 60 metres. One class scheduled at the
// airport or the agricultural campus and a building silently disappears. 20 km
// sits inside the same 116 km gap with 10 km of headroom either way.
//
// This is the DATA filter. How far a student will actually walk is a separate
// user-facing setting on top, and never baked into the shipped dataset.
const MAX_KM = 20;

// A first run has to have a floor, and after that the committed file is the
// floor. Measured: 612 buildings inside 20 km.
const MIN_BUILDINGS = 550;

// Local calendar date as YYYY-MM-DD.
const localDate = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const gz = (text) => gzipSync(Buffer.from(text), { level: 9 }).length;

function die(message) {
  console.error(`\nFATAL  ${message}`);
  process.exit(1);
}

// Latitude and Longitude come back as STRINGS ("39.995985"), so a plain numeric
// read yields NaN and every distance silently becomes NaN. Not documented in
// the research, and it is the sort of thing that produces an empty map rather
// than an error.
function coord(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function buildIndex(features) {
  const funnel = {
    features: features.length,
    noBuildingNumber: 0,
    noCoordinate: 0,
    duplicateRows: 0,
    beyondCap: 0,
    kept: 0,
  };

  const byCode = new Map();
  const conflicts = [];
  // Codes already counted against the cap, so a duplicated far-away row is not
  // counted as two separate buildings.
  const beyondCap = new Set();

  for (const feature of features) {
    const a = feature.attributes ?? feature;
    const code = String(a.buildingNumber ?? '').trim();
    if (!code) {
      funnel.noBuildingNumber++;
      continue;
    }

    const lat = coord(a.Latitude);
    const lon = coord(a.Longitude);
    if (lat === null || lon === null) {
      funnel.noCoordinate++;
      continue;
    }

    const km = kmFromOval({ lat, lon });

    // The cap is checked BEFORE the dedupe, not after. The other way round, the
    // first of two rows sharing a code is dropped by the cap before it is ever
    // stored, so the second row finds nothing to compare itself against, a
    // genuine position conflict outside the cap goes undetected, and beyondCap
    // counts the same building twice.
    if (km > MAX_KM) {
      if (!beyondCap.has(code)) {
        beyondCap.add(code);
        funnel.beyondCap++;
      } else {
        funnel.duplicateRows++;
      }
      continue;
    }

    // buildingNumber is NOT unique: 246 appears twice and 1243 three times, in
    // both cases with identical attributes. Deduping silently is exactly the
    // danger, because a later `features.length === index.size` assertion then
    // fails for a reason nobody can reproduce. Dedupe explicitly, and shout if
    // two rows sharing a code ever disagree about where they are.
    const existing = byCode.get(code);
    if (existing) {
      funnel.duplicateRows++;
      if (Math.abs(existing.lat - lat) > 1e-6 || Math.abs(existing.lon - lon) > 1e-6) {
        conflicts.push({ code, a: [existing.lat, existing.lon], b: [lat, lon] });
      }
      continue;
    }

    byCode.set(code, {
      // `??` keeps an empty string, so a row with a blank BLDG_NAME and a real
      // FormalName would ship as "". Every other string field here uses `||`.
      name: a.BLDG_NAME || a.FormalName || null,
      short: a.SchedulingAbbreviation || null,
      lat,
      lon,
      km_from_oval: Math.round(km * 100) / 100,
      address: a.Address || null,
      city: a.City || null,
      campus: a.Campus || null,
      floors: Number.isFinite(a.FloorCount) ? a.FloorCount : null,
      status: a.Status || null,
    });
    funnel.kept++;
  }

  return { byCode, funnel, conflicts };
}

// The launch subset: every code the term's room index points at, three fields
// each, plus its doors. A code with no record in the full index is reported
// rather than dropped, because it means a room in the grid has nothing to put
// on the map.
//
// A building with no doors gets no `d` at all rather than an empty array. The
// engine reads a missing `d` as "measure to the published point", which is what
// every building did before entrances existed, so the fallback is the old
// behaviour and not a special case.
export function smallIndex(buildings, roomCodes, entrances = {}) {
  const small = {};
  const missing = [];
  for (const code of [...roomCodes].sort()) {
    const b = buildings[code];
    if (!b) {
      missing.push(code);
      continue;
    }
    small[code] = Object.fromEntries(SMALL_FIELDS.map((f) => [f, b[f]]));
    const d = doorOffsets(b, entrances[code]);
    if (d.length) small[code].d = d;
  }
  return { small, missing };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const url =
    `${SERVICE}?` +
    new URLSearchParams({
      where: '1=1',
      outFields: OUT_FIELDS,
      returnGeometry: 'false',
      outSR: '4326',
      f: 'json',
    });

  const layer = await fetchJson(url);

  // The dead CampusMap_AGOL_RO service answers HTTP 200 with an error body, so
  // the status code is not the check. Read the body.
  if (layer?.error) die(`GIS service returned an error body: ${JSON.stringify(layer.error)}`);

  const features = layer?.features ?? [];
  if (!features.length) die('GIS query returned zero features.');

  // One request is meant to be the whole layer. If the service ever starts
  // paging, a silent truncation would delete buildings from the map.
  if (layer.exceededTransferLimit) {
    die(`exceededTransferLimit is set: the layer is now paged and this script only reads page 1.`);
  }

  const { byCode, funnel, conflicts } = buildIndex(features);

  if (conflicts.length) {
    die(
      `${conflicts.length} building code(s) have rows disagreeing about position: ` +
        conflicts.map((c) => `${c.code} ${c.a} vs ${c.b}`).join('; '),
    );
  }

  if (funnel.kept < MIN_BUILDINGS) {
    die(`only ${funnel.kept} buildings kept, under the ${MIN_BUILDINGS} floor.`);
  }

  if (existsSync(OUT_PATH)) {
    const previous = JSON.parse(readFileSync(OUT_PATH, 'utf8'));
    const before = Object.keys(previous.buildings ?? {}).length;
    if (funnel.kept < before) {
      die(`${funnel.kept} buildings is fewer than the ${before} already committed. Refusing.`);
    }
  }

  const buildings = Object.fromEntries([...byCode.entries()].sort(([a], [b]) => a.localeCompare(b)));

  console.log(`${funnel.features} features from the layer`);
  console.log(`  - ${funnel.noBuildingNumber} with no buildingNumber`);
  console.log(`  - ${funnel.noCoordinate} with no coordinate`);
  console.log(`  - ${funnel.duplicateRows} surplus rows on a duplicated code`);
  console.log(`  - ${funnel.beyondCap} beyond the ${MAX_KM} km cap`);
  console.log(`  = ${funnel.kept} buildings written`);
  console.log(`\n${requests()} request.`);

  if (dryRun) {
    console.log('DRY RUN, nothing written.');
    return;
  }

  const out = {
    // Local date, not UTC. toISOString stamped the file 2026-08-27 when it
    // was generated on the 26th Eastern, which is wrong on a provenance field.
    generated: localDate(),
    source: SERVICE,
    layer: 'Data/FacilitiesStreets_RO/MapServer/11 (Building)',
    attribution: 'Ohio State University Facilities Information and Technology Services, GIS',
    maxKmFromOval: MAX_KM,
    count: funnel.kept,
    funnel,
    buildings,
  };
  const full = `${JSON.stringify(out, null, 1)}\n`;
  await writeFile(OUT_PATH, full);
  console.log(`wrote data/buildings.json  ${gz(full)} bytes gzipped`);

  await writeSmall(buildings, out);
}

// The second artifact. Skipped rather than fatal when the room index is not
// built yet, because a first run has to write buildings.json before
// build-index.mjs can produce a room index to key the small file against.
async function writeSmall(buildings, meta) {
  const currentPath = join(ROOT, 'data', 'current.json');
  if (!existsSync(currentPath)) {
    console.warn('no data/current.json, skipping the launch subset. Run build-index.mjs, then re-run this.');
    return;
  }
  const term = JSON.parse(readFileSync(currentPath, 'utf8')).term;
  const roomsPath = join(ROOT, 'data', `rooms-${term}.json`);
  if (!existsSync(roomsPath)) {
    console.warn(`no data/rooms-${term}.json, skipping the launch subset.`);
    return;
  }

  const rooms = JSON.parse(readFileSync(roomsPath, 'utf8')).rooms;
  const roomCodes = new Set(Object.values(rooms).map((r) => r.b));

  // Optional on purpose. A checkout that has never run fetch-entrances.mjs
  // still builds a correct term subset, one that measures to the published
  // point the way every build did before the doors existed.
  const entrancesPath = join(ROOT, 'data', 'entrances.json');
  const entrances = existsSync(entrancesPath)
    ? JSON.parse(readFileSync(entrancesPath, 'utf8')).entrances ?? {}
    : {};
  if (!existsSync(entrancesPath)) {
    console.warn('  no data/entrances.json, so every walk measures to the building centroid. Run scripts/fetch-entrances.mjs.');
  }

  const { small, missing } = smallIndex(buildings, roomCodes, entrances);

  if (missing.length) {
    console.warn(
      `  ${missing.length} code(s) in the room index have no building record: ${missing.join(', ')}`,
    );
  }
  const kept = Object.keys(small).length;
  if (kept < MIN_CLASS_BUILDINGS) {
    die(
      `only ${kept} of ${roomCodes.size} class-hosting codes resolved, ` +
        `under the ${MIN_CLASS_BUILDINGS} floor.`,
    );
  }

  // Compact, like the room index it is keyed against. This one is on the
  // critical path, so it is read by a machine and never by a person.
  const text = `${JSON.stringify({
    generated: meta.generated,
    term,
    source: meta.source,
    attribution: meta.attribution,
    note: 'the buildings the term room index references, name/lat/lon plus d, the doors as whole-metre east/north offsets from lat/lon, nearest first. A building with no d has no surveyed door and is measured to lat/lon. data/buildings.json has every building and every field, data/entrances.json has every door and every field.',
    count: kept,
    buildings: small,
  })}\n`;
  await writeFile(smallPath(term), text);
  const withDoors = Object.values(small).filter((b) => b.d).length;
  const doors = Object.values(small).reduce((n, b) => n + (b.d?.length ?? 0) / 2, 0);
  console.log(`wrote data/buildings-${term}.json  ${kept} buildings, ${gz(text)} bytes gzipped`);
  console.log(`  ${doors} doors on ${withDoors} of them; the other ${kept - withDoors} measure to the published point`);
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('fetch-buildings.mjs');
if (invokedDirectly) main().catch((err) => die(err.message));
