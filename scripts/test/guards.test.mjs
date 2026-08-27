// Offline. Hand-built indexes, no network, no fixtures on disk except the two
// committed files the last two tests read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { countRefusal, fatal, forceable, refusalMessage, residueRefusal } from '../guards.mjs';
import {
  FLOORS,
  KNOWN_UNRESOLVED,
  floorsFor,
  guttedRooms,
  indexRefusals,
  lostRooms,
  measure,
  notReady,
  piiRefusal,
} from '../lib/index-guards.mjs';

const FORCE = true;
const NO_FORCE = false;

// A room with `n` blocks of `len` minutes on `day`.
const room = (day, n, len = 55, b = '279') => ({
  b,
  busy: Array.from({ length: n }, (_, i) => [day, 480 + i * 60, 480 + i * 60 + len, 0]),
});

// An index big enough to clear the Autumn floors, spread over Mon to Fri.
function healthy({ rooms = 400, perDay = 6 } = {}) {
  const out = {};
  for (let i = 0; i < rooms; i++) {
    const id = `RM${String(i).padStart(4, '0')}`;
    out[id] = { b: String(100 + (i % 60)), busy: [] };
    for (let day = 1; day <= 5; day++) {
      for (let k = 0; k < perDay; k++) out[id].busy.push([day, 480 + k * 60, 535 + k * 60, 0]);
    }
  }
  return out;
}

const base = (over = {}) => ({
  term: '1268',
  now: measure(healthy()),
  before: null,
  clockStrings: { parsed: 16948, failed: 0 },
  unresolvedCodes: [],
  noCoordRooms: 0,
  serialized: '{}',
  ...over,
});

const reasons = (list) => list.map((r) => r.reason).join('\n');

test('MAX_DROP is 0.05, not Finder 0.1, and the file says where it came from', () => {
  const src = readFileSync(new URL('../guards.mjs', import.meta.url), 'utf8');
  assert.match(src, /const MAX_DROP = 0\.05;/);
  assert.match(src, /EnesYilmazcode\/Finder scripts\/guards\.mjs \(MIT\)/);
  // Nothing Vacant-specific belongs in a verbatim copy. If a room or a term
  // creeps in here, the next port from Finder starts merging by hand.
  assert.ok(!/vacant|classroom|facilityId|busy block/i.test(src), 'guards.mjs mentions Vacant');
  // A 10% tolerance on a file that should not move at all is most of a partial
  // failure, so the change is load bearing.
  assert.equal(countRefusal('x', 95, 1, 100), null, '5% exactly is allowed');
  assert.ok(countRefusal('x', 94, 1, 100), '6% is a collapse');
});

test('the floors are keyed on the season digit and an unknown digit has none', () => {
  assert.deepEqual(Object.keys(FLOORS).sort(), ['2', '4', '8']);
  assert.equal(floorsFor('1268'), FLOORS[8]);
  assert.equal(floorsFor('1262'), FLOORS[2]);
  assert.equal(floorsFor('1264'), FLOORS[4]);
  assert.equal(floorsFor('1263'), null);
  // Summer is a seventh of Autumn by busy time, so one floor for both would be
  // either useless in Autumn or impossible in Summer.
  assert.ok(FLOORS[4].minutes < FLOORS[8].minutes / 5);
  const src = readFileSync(new URL('../lib/index-guards.mjs', import.meta.url), 'utf8');
  assert.match(src, /PROVISIONAL/);
});

test('the real Summer 1264 build clears its own floor', () => {
  // Measured: 142 rooms, 39 buildings, 668 blocks, 93,025 busy minutes.
  const floor = floorsFor('1264');
  assert.ok(142 >= floor.rooms && 39 >= floor.buildings);
  assert.ok(668 >= floor.blocks && 93025 >= floor.minutes);
});

test('busy blocks and busy minutes are what refuse, not room count', () => {
  // The whole point of the issue. A run that loses a fifth of its blocks keeps
  // nearly all its rooms, because only 18 of 290 rooms have a single block all
  // week, so a room-count guard sails past it.
  const before = measure(healthy({ rooms: 400, perDay: 6 }));
  const now = measure(healthy({ rooms: 400, perDay: 4 }));
  assert.equal(now.rooms, before.rooms, 'room count did not move at all');
  assert.equal(now.blocks / before.blocks, 4 / 6);

  const out = indexRefusals(base({ before, now }));
  const text = reasons(out);
  assert.match(text, /busy blocks: got 8000, down 33\.3%/);
  assert.match(text, /busy minutes/);
  assert.ok(!/^rooms:/m.test(text), 'rooms did not refuse, which is exactly the failure');
});

test('a healthy rebuild of the same data refuses nothing', () => {
  const before = measure(healthy());
  assert.deepEqual(indexRefusals(base({ before })), []);
});

test('a first run under the floor is NOT READY, and with a committed file it is a collapse', () => {
  const tiny = measure({ A0001: room(1, 3) });
  const first = indexRefusals(base({ now: tiny, before: null }));
  assert.ok(first.length);
  assert.equal(notReady(first, false), true, 'nothing committed, so this term is just not ready');
  assert.equal(notReady(first, true), false, 'a committed file makes the same numbers a collapse');
  assert.match(reasons(first), /busy blocks: got 3, the floor is 5700/);
});

test('a floor refusal names the committed count so the loss is visible', () => {
  const out = indexRefusals(base({ now: measure({ A0001: room(1, 3) }), before: measure(healthy()) }));
  assert.match(reasons(out), /the floor is 5700, and 12000 is already committed/);
});

test('a room that had blocks and has none refuses, and FORCE_WRITE does not clear it', () => {
  const before = measure({ ...healthy(), DL0357: room(1, 8), CL0112: room(2, 4) });
  const now = measure(healthy());
  const out = indexRefusals(base({ before, now }));
  const lost = out.find((r) => /had busy blocks in the committed index/.test(r.reason));
  assert.ok(lost, 'no lostRooms refusal');
  assert.match(lost.reason, /CL0112 DL0357/);
  assert.equal(lost.forceable, false);
  assert.ok(refusalMessage([lost], FORCE), 'FORCE_WRITE=1 must not clear a lost room');
});

test('more than five gutted rooms refuse, and that one clears under FORCE_WRITE', () => {
  const beforeRooms = healthy();
  const nowRooms = healthy();
  for (let i = 0; i < 6; i++) nowRooms[`RM${String(i).padStart(4, '0')}`].busy.length = 5;
  const out = indexRefusals(base({ before: measure(beforeRooms), now: measure(nowRooms) }));
  const gutted = out.find((r) => /kept under half their committed blocks/.test(r.reason));
  assert.ok(gutted, 'no roomsGutted refusal');
  assert.match(gutted.reason, /RM0000 30->5/);
  assert.equal(gutted.forceable, true);
  assert.equal(refusalMessage([gutted], FORCE), null);
  assert.ok(refusalMessage([gutted], NO_FORCE));
});

test('five gutted rooms is churn and does not refuse', () => {
  const nowRooms = healthy();
  for (let i = 0; i < 5; i++) nowRooms[`RM${String(i).padStart(4, '0')}`].busy.length = 5;
  const out = indexRefusals(base({ before: measure(healthy()), now: measure(nowRooms) }));
  assert.ok(!out.some((r) => /kept under half/.test(r.reason)));
});

test('weekday balance is Monday to Friday only, and a near-zero Saturday does not divide it', () => {
  // Autumn 1268 measured 1,800 Saturday minutes against 166,895 on Tuesday. A
  // ratio over all seven days divides by that Saturday every single week.
  const rooms = healthy();
  rooms.WEEKEND = room(6, 1);
  const now = measure(rooms);
  assert.ok(now.weekdayBalance > 0.99, `${now.weekdayBalance} should ignore Saturday entirely`);
  assert.deepEqual(indexRefusals(base({ now })), []);
});

test('a weekday that lost its classes refuses, and clears under FORCE_WRITE', () => {
  const rooms = healthy();
  for (const id of Object.keys(rooms)) rooms[id].busy = rooms[id].busy.filter((b) => b[0] !== 3);
  const now = measure(rooms);
  assert.equal(now.weekdayBalance, 0);
  const out = indexRefusals(base({ now }));
  const balance = out.find((r) => /weekday balance/.test(r.reason));
  assert.ok(balance);
  assert.equal(balance.forceable, true);
  assert.match(balance.reason, /Monday to Friday busy minutes are/);
});

test('the real Autumn and Summer weekday balances both pass', () => {
  // Measured on the committed archives: 1268 is 0.59 and 1264 is 0.82.
  const index = JSON.parse(readFileSync(new URL('../../data/rooms-1268.json', import.meta.url), 'utf8'));
  const now = measure(index.rooms);
  assert.ok(now.weekdayBalance >= 0.55 && now.weekdayBalance <= 0.65, String(now.weekdayBalance));
  assert.ok(!indexRefusals(base({ now, before: now })).length);
});

test('one unreadable clock string in a run refuses, and it is fatal', () => {
  // Strict on purpose: 0 of 34,244 clock strings across the three archives fail
  // to parse. A non-zero rate means the "8:00 am" format moved.
  assert.equal(residueRefusal('meeting times', 16948, 0, 0.002), null);
  const out = indexRefusals(base({ clockStrings: { parsed: 16948, failed: 40 } }));
  const residue = out.find((r) => /meeting times/.test(r.reason));
  assert.ok(residue);
  assert.equal(residue.forceable, false);
  assert.ok(refusalMessage([residue], FORCE));
});

test('a known Wooster building code is quiet and an unknown one is fatal', () => {
  // Without the allow list this fires on every build and gets ignored, which is
  // worse than not having it.
  assert.deepEqual(indexRefusals(base({ unresolvedCodes: ['404', '414', '8002', '410', '549'] })), []);
  for (const code of KNOWN_UNRESOLVED.keys()) assert.match(KNOWN_UNRESOLVED.get(code), /Wooster|Lake Erie/);

  const out = indexRefusals(base({ unresolvedCodes: ['404', '999'] }));
  const unresolved = out.find((r) => /no entry in data\/buildings\.json/.test(r.reason));
  assert.ok(unresolved);
  assert.match(unresolved.reason, /999/);
  assert.ok(!/404/.test(unresolved.reason), 'a known off-campus code is not named');
  assert.equal(unresolved.forceable, false);
});

test('more than a tenth of rooms with no coordinate is fatal', () => {
  const now = measure(healthy());
  assert.deepEqual(indexRefusals(base({ now, noCoordRooms: 40 })), []);
  const out = indexRefusals(base({ now, noCoordRooms: 41 }));
  assert.match(reasons(out), /resolve to a building with no lat\/lon/);
  assert.equal(out.find((r) => /lat\/lon/.test(r.reason)).forceable, false);
});

test('an address anywhere in the serialized index is fatal and FORCE_WRITE cannot clear it', () => {
  // A leak here is a public, offline-cached record of which professor is in
  // which room at which minute, all term.
  assert.equal(piiRefusal('{"rooms":{}}'), null);
  for (const leak of [
    '{"i":"buckeye.1@osu.edu"}',
    '{"i":"Buckeye.Brutus+lab@med.osu.edu"}',
    '{"i":"a@b.co"}',
  ]) {
    const hit = piiRefusal(leak);
    assert.ok(hit, leak);
    assert.equal(hit.forceable, false);
    assert.ok(refusalMessage([hit], FORCE), 'FORCE_WRITE=1 must not clear the PII guard');
    assert.ok(!hit.reason.includes('osu.edu'), 'the refusal does not republish the address');
  }
  const out = indexRefusals(base({ serialized: '{"x":"a.b.1@osu.edu"}' }));
  assert.ok(out.some((r) => /an address reached the index/.test(r.reason)));
});

test('the committed index holds no address', () => {
  const raw = readFileSync(new URL('../../data/rooms-1268.json', import.meta.url), 'utf8');
  assert.equal(piiRefusal(raw), null);
});

test('lostRooms and guttedRooms read the committed file, not the harvest', () => {
  const before = measure({ A: room(1, 4), B: room(1, 4), C: room(1, 1) });
  const now = measure({ A: room(1, 4), B: room(1, 1) });
  assert.deepEqual(lostRooms(now, before), ['C']);
  assert.deepEqual(guttedRooms(now, before), ['B 4->1']);
  // A room that vanished entirely is lost, not gutted. Counting it twice makes
  // one problem look like two.
  assert.ok(!guttedRooms(now, before).some((s) => s.startsWith('C')));
});

test('refusalMessage suggests FORCE_WRITE only when it would actually work', () => {
  assert.match(refusalMessage([forceable('a')], NO_FORCE), /Set FORCE_WRITE=1/);
  assert.ok(!/Set FORCE_WRITE=1/.test(refusalMessage([forceable('a'), fatal('b')], NO_FORCE)));
  assert.equal(refusalMessage([], NO_FORCE), null);
});
