#!/usr/bin/env node
// Reproduce the public-origin sample in walking-routes-115.md against Ohio
// State's own campus pedestrian network. Nothing is written to disk.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { distanceMetres, rank, shape, walkMinutes } from '../../js/engine.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROUTE_URL = 'https://gissvc.osu.edu/arcgis/rest/services/Apps/Campusmap_Routing/NAServer/Route/solve';
const ORIGIN_IDS = ['161', '050', '246', '082', '302', '136'];
const SAMPLE_PER_ORIGIN = 6;
const VACANT_WALK_METRES_PER_MINUTE = 78;
const EARTH_METRES = 6371008.8;

const rooms = JSON.parse(readFileSync(join(ROOT, 'data', 'rooms-1268.json'), 'utf8')).rooms;
const buildings = JSON.parse(readFileSync(join(ROOT, 'data', 'buildings-1268.json'), 'utf8')).buildings;
const roomBuildingIds = [...new Set(Object.values(rooms).map((room) => room.b))];

function candidates(originId) {
  const origin = buildings[originId];
  return roomBuildingIds
    .filter((id) => id !== originId)
    .map((id) => {
      const destination = buildings[id];
      const metres = distanceMetres(origin, destination);
      return {
        originId,
        origin: origin.name,
        destinationId: id,
        destination: destination.name,
        originPoint: origin,
        destinationPoint: destination,
        straightMetres: Math.round(metres),
        vacantMinutes: walkMinutes(metres),
      };
    })
    .sort((a, b) => a.straightMetres - b.straightMetres || a.destinationId.localeCompare(b.destinationId))
    .slice(0, SAMPLE_PER_ORIGIN);
}

async function campusRoute(row) {
  const stops = {
    features: [row.originPoint, row.destinationPoint].map((point, index) => ({
      geometry: {
        x: point.lon,
        y: point.lat,
        spatialReference: { wkid: 4326 },
      },
      attributes: { Name: index ? row.destination : row.origin },
    })),
  };
  const body = new URLSearchParams({
    f: 'json',
    stops: JSON.stringify(stops),
    returnRoutes: 'true',
    returnDirections: 'false',
    returnStops: 'false',
    outSR: '4326',
    impedanceAttributeName: 'Length',
    accumulateAttributeNames: 'Time_Cost',
  });
  const response = await fetch(ROUTE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) throw new Error(`route service returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message ?? JSON.stringify(payload.error));
  const attributes = payload.routes?.features?.[0]?.attributes;
  if (!attributes) throw new Error(`no route from ${row.origin} to ${row.destination}`);
  return {
    campusFeet: Math.round(attributes.Total_Length),
    campusMinutes: attributes.Total_Time_Cost,
  };
}

const rows = ORIGIN_IDS.flatMap(candidates);
for (const row of rows) Object.assign(row, await campusRoute(row));

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(fraction * sorted.length) - 1];
}

function inversionCount(group, baselineKey, valueKey) {
  let count = 0;
  for (let left = 0; left < group.length; left += 1) {
    for (let right = left + 1; right < group.length; right += 1) {
      const vacantOrder = Math.sign(group[left][baselineKey] - group[right][baselineKey]);
      const comparisonOrder = Math.sign(group[left][valueKey] - group[right][valueKey]);
      if (vacantOrder !== 0 && comparisonOrder !== 0 && vacantOrder !== comparisonOrder) count += 1;
    }
  }
  return count;
}

console.log([
  'origin',
  'destination',
  'straight_m',
  'vacant_min',
  'osu_route_ft',
  'osu_route_min',
  'osu_minus_vacant_min',
].join('\t'));
for (const row of rows) {
  console.log([
    row.origin,
    row.destination,
    row.straightMetres,
    row.vacantMinutes,
    row.campusFeet,
    row.campusMinutes.toFixed(2),
    (row.campusMinutes - row.vacantMinutes).toFixed(2),
  ].join('\t'));
}

const differences = rows.map((row) => row.campusMinutes - row.vacantMinutes);
const routeAtVacantPace = rows.map((row) => row.campusFeet * 0.3048 / VACANT_WALK_METRES_PER_MINUTE);
const rawVacantMinutes = rows.map((row) => row.straightMetres * 1.3 / VACANT_WALK_METRES_PER_MINUTE);
const geometryDifferences = routeAtVacantPace.map((minutes, index) => minutes - rawVacantMinutes[index]);
const circuities = rows.map((row) => row.campusFeet * 0.3048 / row.straightMetres);
const groups = ORIGIN_IDS.map((originId) => rows.filter((row) => row.originId === originId));

console.error('\nsummary');
console.error(`pairs\t${rows.length}`);
console.error(`mean_osu_minus_vacant_min\t${mean(differences).toFixed(2)}`);
console.error(`median_osu_minus_vacant_min\t${percentile(differences, 0.5).toFixed(2)}`);
console.error(`p90_osu_minus_vacant_min\t${percentile(differences, 0.9).toFixed(2)}`);
console.error(`median_route_circuity\t${percentile(circuities, 0.5).toFixed(2)}`);
console.error(`p90_route_circuity\t${percentile(circuities, 0.9).toFixed(2)}`);
console.error(`mean_geometry_only_delta_min\t${mean(geometryDifferences).toFixed(2)}`);
console.error(`straight_distance_order_inversions\t${groups.reduce((sum, group) => sum + inversionCount(group, 'straightMetres', 'campusMinutes'), 0)}`);
console.error(`rounded_vacant_jointly_strict_inversions\t${groups.reduce((sum, group) => sum + inversionCount(group, 'vacantMinutes', 'campusMinutes'), 0)}`);

// The 36-pair default above isolates the distance model. This slower optional
// pass asks the product question: if the current schedule is held fixed and
// only the walk changes, how often does the room card change? It routes every
// room-bearing building before applying the app's normal 12-minute bound, so a
// straight-line prefilter cannot hide the inversion being measured.
if (process.argv.includes('--ranking')) {
  const index = JSON.parse(readFileSync(join(ROOT, 'data', 'rooms-1268.json'), 'utf8'));
  const allRooms = Object.entries(index.rooms).map(([id, room]) => ({ id, ...room }));
  const hours = JSON.parse(readFileSync(join(ROOT, 'data', 'buildings-hours.json'), 'utf8'));
  const current = JSON.parse(readFileSync(join(ROOT, 'data', 'current.json'), 'utf8'));
  const slug = current.termName.toLowerCase().replace(/\s+/g, '-');
  const termHours = Object.entries(hours.terms).find(([name]) => name.startsWith(slug))?.[1];
  if (!termHours) throw new Error(`no building-hours table for ${current.termName}`);
  const hoursFor = (code, day) => termHours.buildings[code]?.hours[day];

  // rank() deliberately owns distance calculation. Put each destination due
  // east of the origin at a synthetic distance that rounds to the routed walk
  // minute; every other room/building/schedule fact stays real.
  function buildingsForWalks(origin, routeRows, walkOf) {
    const copy = structuredClone(buildings);
    for (const route of routeRows) {
      const minutes = walkOf(route);
      const metres = minutes === 0 ? 0 : minutes * 60 - 0.01;
      const lonDelta = metres / (EARTH_METRES * Math.cos(origin.lat * Math.PI / 180)) * 180 / Math.PI;
      copy[route.destinationId] = {
        ...copy[route.destinationId],
        lat: origin.lat,
        lon: origin.lon + lonDelta,
      };
    }
    return copy;
  }

  function answer(origin, answerBuildings, { date, day, now, needed }) {
    return shape(rank(allRooms, {
      origin,
      buildings: answerBuildings,
      hoursFor,
      sessions: index.sessions,
      date,
      day,
      now,
      needed,
    })).rows;
  }

  function firstBuildings(rows, count = 3) {
    const seen = new Set();
    for (const row of rows) {
      seen.add(row.building);
      if (seen.size === count) break;
    }
    return [...seen];
  }

  const weekdays = [
    ['2026-09-14', 1],
    ['2026-09-15', 2],
    ['2026-09-16', 3],
    ['2026-09-17', 4],
    ['2026-09-18', 5],
  ];
  const minutes = [550, 730, 910, 1090]; // 09:10, 12:10, 15:10, 18:10
  const needs = [30, 60];
  const comparisons = [];
  const skipped = [];

  for (const originId of ORIGIN_IDS) {
    const origin = buildings[originId];
    const routeRows = [];
    for (const destinationId of roomBuildingIds) {
      const row = {
        originId,
        origin: origin.name,
        destinationId,
        destination: buildings[destinationId].name,
        originPoint: origin,
        destinationPoint: buildings[destinationId],
      };
      Object.assign(row, destinationId === originId
        ? { campusFeet: 0, campusMinutes: 0 }
        : await campusRoute(row));
      routeRows.push(row);
    }
    const geometryBuildings = buildingsForWalks(
      origin,
      routeRows,
      (route) => Math.ceil(route.campusFeet * 0.3048 / VACANT_WALK_METRES_PER_MINUTE),
    );
    const osuTimeBuildings = buildingsForWalks(
      origin,
      routeRows,
      (route) => Math.ceil(route.campusMinutes),
    );

    for (const [date, day] of weekdays) {
      for (const now of minutes) {
        for (const needed of needs) {
          const opts = { date, day, now, needed };
          const vacant = answer(origin, buildings, opts);
          const geometry = answer(origin, geometryBuildings, opts);
          const osuTime = answer(origin, osuTimeBuildings, opts);
          if (!vacant.length || !geometry.length || !osuTime.length) {
            skipped.push({ origin: origin.name, ...opts,
              rows: [vacant.length, geometry.length, osuTime.length] });
            continue;
          }
          const baselineRoomInGeometry = geometry.find((row) => row.id === vacant[0].id);
          const baselineRoomInOsuTime = osuTime.find((row) => row.id === vacant[0].id);
          comparisons.push({
            origin: origin.name,
            vacant,
            geometry,
            osuTime,
            baselineGeometryUsableDelta: baselineRoomInGeometry?.usable - vacant[0].usable,
            baselineOsuUsableDelta: baselineRoomInOsuTime?.usable - vacant[0].usable,
          });
        }
      }
    }
  }

  const count = (predicate) => comparisons.filter(predicate).length;
  const changedFirst = (provider) => count((row) => row.vacant[0].building !== row[provider][0].building);
  const changedTopThree = (provider) => count((row) =>
    firstBuildings(row.vacant).join(',') !== firstBuildings(row[provider]).join(','));
  const finite = (key) => comparisons.map((row) => row[key]).filter(Number.isFinite);

  console.error('\nranking summary');
  console.error(`attempted_scenarios\t${comparisons.length + skipped.length}`);
  console.error(`scenarios\t${comparisons.length}`);
  console.error(`skipped\t${JSON.stringify(skipped)}`);
  console.error(`geometry_top_building_changed\t${changedFirst('geometry')}`);
  console.error(`osu_time_top_building_changed\t${changedFirst('osuTime')}`);
  console.error(`geometry_top_three_order_changed\t${changedTopThree('geometry')}`);
  console.error(`osu_time_top_three_order_changed\t${changedTopThree('osuTime')}`);
  const geometryUsable = finite('baselineGeometryUsableDelta');
  const osuTimeUsable = finite('baselineOsuUsableDelta');
  console.error(`geometry_baseline_room_usable_samples\t${geometryUsable.length}`);
  console.error(`geometry_baseline_room_mean_usable_delta_min\t${mean(geometryUsable).toFixed(2)}`);
  console.error(`osu_time_baseline_room_usable_samples\t${osuTimeUsable.length}`);
  console.error(`osu_time_baseline_room_mean_usable_delta_min\t${mean(osuTimeUsable).toFixed(2)}`);
}
