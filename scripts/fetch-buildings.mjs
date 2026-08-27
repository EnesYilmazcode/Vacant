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
  await writeFile(OUT_PATH, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`wrote data/buildings.json`);
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('fetch-buildings.mjs');
if (invokedDirectly) main().catch((err) => die(err.message));
