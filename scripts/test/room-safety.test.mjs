// Offline. Hand-built rooms plus the two committed data files, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { KNOWN_HIDDEN, OFF_CAMPUS, TYPE_VISIBILITY, classify } from '../lib/room-safety.mjs';
import { applySafety, invert } from '../build-index.mjs';
import { parseFacilityIds, findTermLink } from '../fetch-ga-rooms.mjs';

const url = (p) => new URL(p, import.meta.url);
const read = (p) => JSON.parse(readFileSync(url(p), 'utf8'));

const room = (over = {}) => ({ facilityId: 'DL0357', facilityType: '1B', buildingCode: '279', ...over });

test('the five shown codes and the six secondary codes, and nothing else', () => {
  assert.deepEqual(
    Object.keys(TYPE_VISIBILITY).filter((k) => TYPE_VISIBILITY[k] === 'shown').sort(),
    ['1A', '1B', '1C', 'LCTR', 'SMNR'],
  );
  assert.deepEqual(
    Object.keys(TYPE_VISIBILITY).filter((k) => TYPE_VISIBILITY[k] === 'secondary').sort(),
    ['2J', '2P', '2Q', '5C', '5K', '6L'],
  );
});

test('an unrecognised facilityType is hidden, never shown', () => {
  // The code space is not closed and the failure mode of guessing is routing
  // someone into a cadaver lab.
  assert.equal(classify(room({ facilityType: 'ZZ' })), null);
  assert.equal(classify(room({ facilityType: null })), null);
  assert.equal(classify(room({ facilityType: undefined })), null);
  assert.equal(classify(room({ facilityType: '1b' })), null, 'the key is exact, not case folded');
});

test('a fabricated ZZ room is absent from a built index', () => {
  const meeting = (over) => ({
    m: {
      facilityId: 'ZZ0001',
      facilityType: 'ZZ',
      buildingCode: '279',
      room: '1',
      facilityCapacity: 30,
      startTime: '8:00 am',
      endTime: '8:55 am',
      startDate: '2026-08-25',
      endDate: '2026-12-09',
      monday: true,
      ...over,
    },
  });
  const safe = { ...meeting().m, facilityId: 'DL0357', facilityType: '1B' };
  const { rooms } = invert([meeting(), { m: safe }], { safety: {} });
  assert.deepEqual(Object.keys(rooms), ['DL0357']);
});

test('a wet lab, a gym and a dissection lab never reach the index', () => {
  // 2A is Jennings and Celeste bench labs, 2H is the RPAC gym floor, 2K holds
  // HM0260 where ANATOMY 4300 does dissection.
  for (const type of ['2A', '2H', '2K', '2M', '6F', 'PERF', '7A']) {
    assert.equal(classify(room({ facilityType: type })), null, type);
    assert.ok(KNOWN_HIDDEN.has(type), `${type} should be a known exclusion, not a surprise`);
  }
});

test('the three Wooster rooms are excluded by name', () => {
  assert.deepEqual([...OFF_CAMPUS].sort(), ['SY0203', 'WAB0130', 'WSB300']);
  for (const id of OFF_CAMPUS) {
    // All three are type 1B and report campus Columbus. Only the name catches
    // them.
    assert.equal(classify(room({ facilityId: id, facilityType: '1B' })), null, id);
  }
});

test('a room off the GA list ships ga:false and is never dropped', () => {
  // The parked decision in BACKLOG.md, implemented. 255 of the 581 kept rooms
  // are in this state, so hiding them would delete nearly half the inventory.
  const gaRooms = new Set(['DL0357']);
  const on = classify(room({ facilityId: 'DL0357' }), { gaRooms });
  const off = classify(room({ facilityId: 'SB0210' }), { gaRooms });
  assert.equal(on.ga, true);
  assert.equal(off.ga, false);
  assert.equal(off.vis, 'shown', 'still shown, just flagged');
});

test('ga is false rather than undefined when no list is supplied', () => {
  // A missing flag reads as "we did not check", and the app must not have to
  // tell that apart from "not general assignment".
  assert.equal(classify(room()).ga, false);
});

test('a restricted building drops a room the type filter would have kept', () => {
  const restricted = new Set(['049']);
  assert.equal(classify(room({ buildingCode: '049' }), { restricted }), null);
  assert.ok(classify(room({ buildingCode: '279' }), { restricted }));
});

test('unknown codes are collected with a count and an example, known ones are not', () => {
  const unknown = new Map();
  classify(room({ facilityId: 'AA0001', facilityType: 'ZZ' }), { unknown });
  classify(room({ facilityId: 'BB0002', facilityType: 'ZZ' }), { unknown });
  classify(room({ facilityType: '2A' }), { unknown });
  assert.deepEqual([...unknown.keys()], ['ZZ']);
  assert.deepEqual(unknown.get('ZZ'), { rooms: 2, example: 'AA0001' });
});

test('applySafety runs after group propagation, so a hidden parent still blocks its halves', () => {
  // MALC0100 is a facilityGroup parent typed 6F, which is hidden. Its halves are
  // typed 1B. Filtering before propagation would drop the parent's booking and
  // leave both halves reading free during a class held in the whole room.
  const at = (facilityId, facilityType, over = {}) => ({
    m: {
      facilityId,
      facilityType,
      buildingCode: '1321',
      room: facilityId,
      facilityCapacity: 120,
      startTime: '8:00 am',
      endTime: '8:55 am',
      startDate: '2026-08-25',
      endDate: '2026-12-09',
      monday: true,
      ...over,
    },
  });
  const records = [
    at('MALC0100', '6F', { facilityGroup: true }),
    at('MALC0100N', '1B', { startTime: '2:00 pm', endTime: '2:55 pm' }),
    at('MALC0100S', '1B', { startTime: '3:00 pm', endTime: '3:55 pm' }),
  ];
  const { rooms } = invert(records, { safety: {} });
  assert.deepEqual(Object.keys(rooms).sort(), ['MALC0100N', 'MALC0100S']);
  const covers = (id, minute) => rooms[id].busy.some((b) => b[1] <= minute && minute < b[2]);
  assert.equal(covers('MALC0100N', 490), true, 'the parent booking reached the north half');
  assert.equal(covers('MALC0100S', 490), true, 'and the south half');
});

test('applySafety reports what it dropped and why, once per room', () => {
  const rooms = {
    DL0357: { b: '279', type: '1B', busy: [] },
    HM0260: { b: '038', type: '2K', busy: [] },
    DI0244: { b: '049', type: '1B', busy: [] },
    WSB300: { b: '8002', type: '1B', busy: [] },
    AH0500: { b: '306', type: '2A', busy: [] },
  };
  const { kept, dropped } = applySafety(rooms, { restricted: new Set(['049', '306']) });
  assert.deepEqual(kept, { shown: 1, secondary: 0 });
  assert.deepEqual(dropped, { type: 2, restricted: 1, offCampus: 1 });
  assert.deepEqual(Object.keys(rooms), ['DL0357']);
  assert.equal(rooms.DL0357.vis, 'shown');
});

test('the committed GA list is a real Registrar pull with a term and a date', () => {
  const ga = read('../../data/ga-rooms.json');
  assert.equal(ga._meta.term, '1268');
  assert.match(ga._meta.pulled, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(ga._meta.source, /^https:\/\/registrar\.osu\.edu\//);
  assert.equal(ga.rooms.length, 327);
  assert.equal(ga._meta.count, ga.rooms.length);
  assert.equal(new Set(ga.rooms).size, ga.rooms.length, 'no duplicates');
  for (const id of ga.rooms) assert.match(id, /^[A-Z0-9]+$/, id);
});

test('the restricted building list ships a pulled date and real building codes', () => {
  const rb = read('../../data/restricted-buildings.json');
  assert.match(rb._meta.pulled, /^\d{4}-\d{2}-\d{2}$/);
  const buildings = read('../../data/buildings.json').buildings;
  for (const [code, entry] of Object.entries(rb.buildings)) {
    assert.ok(buildings[code], `${code} is not in buildings.json`);
    assert.equal(entry.name, buildings[code].name, code);
    assert.ok(entry.why.length > 10, `${code} has no reason`);
  }
});

test('the shipped index carries a visibility on every room and hides every other code', () => {
  const idx = read('../../data/rooms-1268.json');
  const seen = new Set();
  for (const [id, r] of Object.entries(idx.rooms)) {
    assert.ok(r.vis === 'shown' || r.vis === 'secondary', `${id} has vis ${r.vis}`);
    assert.equal(TYPE_VISIBILITY[r.type], r.vis, id);
    assert.equal(typeof r.ga, 'boolean', id);
    seen.add(r.type);
  }
  for (const type of seen) assert.ok(TYPE_VISIBILITY[type], `${type} should not be in the index`);
});

test('parseFacilityIds reads the Registrar markup and sorts, without fuzzy matching', () => {
  const html = `
    <p><a href="/x/dl0357/" title="DL0357" class="btn">Facility ID: DL0357</a></p>
    <p>Capacity: 46</p>
    <p><a href="/x/ea0160/" title="EA0160" class="btn">Facility ID:EA0160</a></p>
    <p><a class="btn">Facility ID: DL0357</a></p>`;
  assert.deepEqual(parseFacilityIds(html), ['DL0357', 'EA0160']);
  assert.deepEqual(parseFacilityIds('<p>no rooms here</p>'), []);
});

test('the term page is discovered from the index, never built as a slug', () => {
  const index = `
    <a href="/staff-resources/class-catalog-and-space/general-assignment-rooms/">GA rooms</a>
    <a href="/staff-resources/class-catalog-and-space/general-assignment-rooms/autumn-2026-general-assignment-rooms/">Autumn 2026</a>
    <a href="/staff-resources/class-catalog-and-space/general-assignment-rooms/spring-2027-general-assignment-rooms/">Spring 2027</a>`;
  const hit = findTermLink(index, 'Autumn 2026');
  assert.equal(hit.slug, 'autumn-2026-general-assignment-rooms');
  assert.match(hit.url, /^https:\/\/registrar\.osu\.edu\//);
  // A term the Registrar has not published yet fails loudly with the list it
  // did publish, rather than fetching a constructed URL and getting a 404 page.
  const miss = findTermLink(index, 'Summer 2029');
  assert.equal(miss.url, null);
  assert.deepEqual(miss.all, [
    'autumn-2026-general-assignment-rooms',
    'spring-2027-general-assignment-rooms',
  ]);
});
