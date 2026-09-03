// Offline. The cross-check's parsers, on fixtures and on the shipped index.
//
// The two Roomix files are 2.7 MB and are not committed, so the fixtures here
// are hand-written copies of the shapes their documentation states. Every one
// of these tests pins a mistake that was actually made while writing the diff
// and that a plausible-looking number came out of.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  PATTERN_DAY,
  clockToMin,
  facilityIdFrom,
  findSection,
  harvestIntervals,
  hhmmToMin,
  indexTuples,
  learnAbbrevs,
  loose,
  minutesByRoomDay,
  roomixIntervals,
  uncoveredMinutes,
} from '../roomix-crosscheck.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rooms = JSON.parse(readFileSync(join(ROOT, 'data', 'rooms-1268.json'), 'utf8'));

const meeting = (over = {}) => ({
  start_date: '2026-08-25',
  end_date: '2026-12-09',
  building: '279:113',
  pattern_bin: '0101000',
  time: '0800-0855',
  ...over,
});
const course = (m) => ({ courses: { 'CSE 1223': { numbers: { '12345:0010': { meetings: { 1: m } } } } } });

test('pattern_bin index 0 is Monday and index 6 is Sunday', () => {
  // Off by a day and the diff still looks plausible, which is why the table is
  // asserted rather than trusted.
  assert.deepEqual(PATTERN_DAY, [1, 2, 3, 4, 5, 6, 0]);
  const tue = roomixIntervals(course(meeting({ pattern_bin: '0100000' }))).tuples;
  assert.deepEqual([...tue.keys()], ['279:113|2|480|535']);
  const sun = roomixIntervals(course(meeting({ pattern_bin: '0000001' }))).tuples;
  assert.deepEqual([...sun.keys()], ['279:113|0|480|535']);
});

test('a meeting with no day bits or no time is counted, never guessed at', () => {
  // Term 1268 has five of these and they carry no room-hour claim at all. A
  // parser that expanded them to all seven days would block a real room.
  const none = roomixIntervals(course(meeting({ pattern_bin: null, time: null })));
  assert.equal(none.tuples.size, 0);
  assert.equal(none.skipped.noPattern, 1);
  const timeless = roomixIntervals(course(meeting({ time: null })));
  assert.equal(timeless.skipped.noTime, 1);
});

test('both clock formats reach the same minute', () => {
  assert.equal(hhmmToMin('0800'), 480);
  assert.equal(hhmmToMin('1420'), 860);
  assert.equal(clockToMin('8:00 am'), 480);
  assert.equal(clockToMin('12:05 pm'), 725);
  assert.equal(clockToMin('12:05 am'), 5);
  assert.equal(clockToMin('nonsense'), null);
});

test('our side reads weekday flags, and skips a meeting with no room', () => {
  const rec = (m) => ({ subject: 'CSE', catalogNumber: '1223', classNumber: '1', m });
  const one = harvestIntervals([
    rec({ facilityId: 'DL0113', buildingCode: '279', room: '113', meetingNumber: 1, startTime: '8:00 am', endTime: '8:55 am', tuesday: true, thursday: true }),
  ]);
  assert.deepEqual([...one.keys()].sort(), ['279:113|2|480|535', '279:113|4|480|535']);
  assert.equal(harvestIntervals([rec({ startTime: '8:00 am', endTime: '8:55 am', monday: true })]).size, 0);
});

test('a block swallowed by a merged one is not a disagreement', () => {
  // Our builder merges overlapping bookings inside a session, so a tuple diff
  // alone counts merges as errors. Only an uncovered minute changes an answer.
  const ours = minutesByRoomDay(['279:113|1|540|720']);
  assert.equal(uncoveredMinutes('279:113|1|540|705', ours), 0);
  assert.equal(uncoveredMinutes('279:113|1|540|780', ours), 60);
  assert.equal(uncoveredMinutes('279:113|2|540|600', ours), 60, 'another weekday shares no minutes');
});

test('every shipped room id is the facilityId its parts rebuild', () => {
  // The never-seen list names rooms by a facilityId we derive, so the rule has
  // to be checked against 425 ids we did not derive.
  const abbrev = new Map();
  for (const [id, r] of Object.entries(rooms.rooms)) {
    const x = /^([A-Za-z]*)(\d*)(.*)$/.exec(r.n);
    const tail = x[1] + (x[2] ? x[2].padStart(4, '0') : '') + x[3];
    if (id.endsWith(tail)) abbrev.set(r.b, id.slice(0, id.length - tail.length));
  }
  const bad = [];
  for (const [id, r] of Object.entries(rooms.rooms)) {
    if (facilityIdFrom(abbrev.get(r.b) ?? '?', r.n) !== id) bad.push(id);
  }
  assert.deepEqual(bad, [], `facilityId rule missed ${bad.length} shipped rooms`);
  assert.equal(facilityIdFrom('SO', 'N056'), 'SON0056');
  assert.equal(facilityIdFrom('FWH', '110B'), 'FWH0110B');
  assert.equal(facilityIdFrom('EC', '248'), 'EC0248');
});

test('learnAbbrevs reads the abbreviation back out of a facilityId', () => {
  const learned = learnAbbrevs([
    { m: { facilityId: 'SON0056', buildingCode: '148', room: 'N056' } },
    { m: { facilityId: 'EC0248', buildingCode: '072', room: '248' } },
    { m: { facilityId: 'AARL100', buildingCode: '199', room: '100' } },
  ]);
  assert.equal(learned.get('148'), 'SO');
  assert.equal(learned.get('072'), 'EC');
  assert.equal(learned.has('199'), false, 'an id that follows no rule teaches nothing');
});

test('the one room key the two sides spell differently still joins', () => {
  // 339:037 here, 339:37 at Roomix. One key of 880, so it is a second chance at
  // the join and not the join itself.
  assert.equal(loose('339:037'), '339:37');
  assert.equal(loose('279:113'), '279:113');
  assert.equal(loose('148:N056'), '148:N056');
});

test('a section is found in whichever entry the search split it into', () => {
  // The live API returns one course as several entries, each with a subset of
  // its sections. Reading only the first reported ten live sections as deleted.
  const data = {
    courses: [
      { course: { subject: 'KOREAN', catalogNumber: '5256' }, sections: [{ classNumber: '36616' }] },
      { course: { subject: 'KOREAN', catalogNumber: '5256' }, sections: [{ classNumber: '36617' }] },
    ],
  };
  assert.equal(findSection(data, '36617').sec.classNumber, '36617');
  assert.equal(findSection(data, '99999'), null);
});

test('the shipped index reads back as tuples the diff can compare', () => {
  const tuples = indexTuples(rooms.rooms);
  const blocks = Object.values(rooms.rooms).reduce((n, r) => n + r.busy.length, 0);
  assert.ok(tuples.size > 8000, `only ${tuples.size} tuples off ${blocks} blocks`);
  assert.ok(tuples.size <= blocks, 'tuples are deduped blocks, so never more of them');
  for (const key of tuples) {
    const [room, day, start, end] = key.split('|');
    assert.match(room, /^[^|]+:[^|]+$/);
    assert.ok(Number(day) >= 0 && Number(day) <= 6);
    assert.ok(Number(end) > Number(start));
  }
});
