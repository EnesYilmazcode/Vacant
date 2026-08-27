// Offline. Fixtures only, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import {
  DAY_INDEX,
  buildSessions,
  expandMeeting,
  halvesOf,
  mergeIntervals,
  propagateGroups,
} from '../lib/rooms.mjs';

const iv = (day, start, end, session = 0) => [day, start, end, session];

test('the day index matches buildings-hours.json, Sunday first', () => {
  // If these two disagree, a room's busy blocks are checked against a different
  // day's opening hours, which is silent and wrong in both directions.
  assert.deepEqual(DAY_INDEX, {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  });
});

test('two identical cross-listed intervals collapse to one', () => {
  // 232 of 1,813 usable blocks are this, 12.8%.
  const { intervals, dropped } = mergeIntervals([iv(2, 860, 940), iv(2, 860, 940)]);
  assert.deepEqual(intervals, [iv(2, 860, 940)]);
  assert.equal(dropped, 1);
});

test('the CSE 2112 ten-copy case collapses, including the short tenth', () => {
  // Section 0031 lists the same 2:20-3:40 pm Tuesday meeting ten times, and the
  // tenth ends twenty minutes early at 3:20. The short one is contained by the
  // others, so it must not shorten the block.
  const copies = Array.from({ length: 9 }, () => iv(2, 860, 940));
  copies.push(iv(2, 860, 920));
  const { intervals, dropped, merges } = mergeIntervals(copies);
  assert.deepEqual(intervals, [iv(2, 860, 940)], 'the room is busy until 3:40, not 3:20');
  // Sorted by (start, end) the short copy leads, so it is extended once and the
  // remaining eight are exact duplicates. Ten rows in, one block out.
  assert.equal(dropped + merges, 9);
  assert.equal(merges, 1, 'the short tenth is absorbed, and must not shorten the block');
});

test('overlapping intervals merge and abutting intervals merge', () => {
  assert.deepEqual(mergeIntervals([iv(1, 480, 540), iv(1, 520, 600)]).intervals, [iv(1, 480, 600)]);
  assert.deepEqual(mergeIntervals([iv(1, 480, 540), iv(1, 540, 600)]).intervals, [iv(1, 480, 600)]);
});

test('a 15 minute passing period stays two intervals', () => {
  // The merge must not swallow a real gap. 8:00-8:55 then 9:10-10:05 is two
  // bookings with fifteen minutes of genuinely free room between them.
  const { intervals } = mergeIntervals([iv(1, 480, 535), iv(1, 550, 605)]);
  assert.equal(intervals.length, 2);
  assert.deepEqual(intervals, [iv(1, 480, 535), iv(1, 550, 605)]);
});

test('the same clock time in different sessions never merges', () => {
  // Two sessions running the same slot are two different bookings, and
  // collapsing them deletes one.
  const { intervals } = mergeIntervals([iv(1, 480, 540, 0), iv(1, 480, 540, 1)]);
  assert.equal(intervals.length, 2);
  assert.deepEqual(intervals.map((x) => x[3]).sort(), [0, 1]);
});

test('different weekdays never merge', () => {
  const { intervals } = mergeIntervals([iv(1, 480, 540), iv(2, 480, 540)]);
  assert.equal(intervals.length, 2);
});

test('input order does not change the result', () => {
  const a = mergeIntervals([iv(1, 480, 540), iv(1, 600, 660), iv(1, 520, 610)]).intervals;
  const b = mergeIntervals([iv(1, 600, 660), iv(1, 520, 610), iv(1, 480, 540)]).intervals;
  assert.deepEqual(a, b);
  assert.deepEqual(a, [iv(1, 480, 660)]);
});

test('sessions come from observed date pairs, never from sessionCode', () => {
  // Nine LAW sections labelled 7W1 actually run 2026-08-24 to 2026-10-09, so
  // the label cannot be trusted to identify a window.
  const sessions = buildSessions([
    { m: { startDate: '2026-08-25', endDate: '2026-12-09' }, sessionCode: '1' },
    { m: { startDate: '2026-08-25', endDate: '2026-12-09' }, sessionCode: '7W1' },
    { m: { startDate: '2026-10-19', endDate: '2026-12-09' }, sessionCode: '7W1' },
  ]);
  assert.deepEqual(sessions, [
    ['2026-08-25', '2026-12-09'],
    ['2026-10-19', '2026-12-09'],
  ]);
});

test('sessions are ordered deterministically and skip incomplete pairs', () => {
  const s = buildSessions([
    { m: { startDate: '2026-10-19', endDate: '2026-12-09' } },
    { m: { startDate: '2026-08-25', endDate: '2026-12-09' } },
    { m: { startDate: null, endDate: '2026-12-09' } },
    { m: {} },
  ]);
  assert.deepEqual(s[0], ['2026-08-25', '2026-12-09']);
  assert.equal(s.length, 2);
});

test('a meeting expands onto exactly its true weekdays', () => {
  const m = { monday: true, wednesday: true, friday: true, tuesday: false, sunday: false };
  assert.deepEqual(expandMeeting(m, 480, 535, 0), [
    iv(1, 480, 535),
    iv(3, 480, 535),
    iv(5, 480, 535),
  ]);
  assert.deepEqual(expandMeeting({}, 480, 535, 0), []);
});

test('MALC0100 propagates onto both of its halves', () => {
  const rooms = {
    MALC0100: { group: true, busy: [iv(1, 480, 540)] },
    MALC0100N: { group: false, busy: [] },
    MALC0100S: { group: false, busy: [] },
  };
  const { down } = propagateGroups(rooms);
  assert.equal(down, 2);
  assert.deepEqual(rooms.MALC0100N.busy, [iv(1, 480, 540)]);
  assert.deepEqual(rooms.MALC0100S.busy, [iv(1, 480, 540)]);
});

test('a slash-named parent reaches halves a prefix test cannot see', () => {
  // The gap the issue's spec leaves. 'BO0410'.startsWith('BO0410/420') is
  // false, so on term 1268 a combined Bolz booking left BO0410 (7 blocks) and
  // BO0420 (4 blocks) both reading FREE.
  const rooms = {
    'BO0410/420': { group: true, busy: [iv(1, 480, 540)] },
    BO0410: { group: false, busy: [] },
    BO0420: { group: false, busy: [] },
  };
  const { down } = propagateGroups(rooms);
  assert.equal(down, 2);
  assert.deepEqual(rooms.BO0410.busy, [iv(1, 480, 540)]);
  assert.deepEqual(rooms.BO0420.busy, [iv(1, 480, 540)]);
});

test('the slash suffix replaces the last digits of the base number', () => {
  const ids = { BO0410: 1, BO0420: 1, FL2125: 1, FL2135: 1, MALC0100N: 1 };
  assert.deepEqual(halvesOf('BO0410/420', ids).sort(), ['BO0410', 'BO0420']);
  assert.deepEqual(halvesOf('FL2125/35', ids).sort(), ['FL2125', 'FL2135']);
  assert.deepEqual(halvesOf('BO0405/415', ids), [], 'halves that do not exist are not invented');
});

test('a half being booked makes the whole room unusable too', () => {
  // Decided deliberately: if half the room has a class in it, the whole room is
  // not available either, and sending someone to it is the same wrong answer in
  // the other direction.
  const rooms = {
    MALC0100: { group: true, busy: [] },
    MALC0100N: { group: false, busy: [iv(1, 480, 540)] },
    MALC0100S: { group: false, busy: [] },
  };
  const { up } = propagateGroups(rooms);
  assert.equal(up, 1);
  assert.deepEqual(rooms.MALC0100.busy, [iv(1, 480, 540)]);
  assert.deepEqual(rooms.MALC0100S.busy, [], 'a sibling is NOT made busy by its twin');
});

test('the KH0333 and HC0346 prefix trap is left alone', () => {
  // Both pairs are facilityGroup false and genuinely separate rooms. A bare
  // prefix scan would mark real free rooms busy.
  const rooms = {
    KH0333: { group: false, busy: [iv(1, 480, 540)] },
    KH0333C: { group: false, busy: [] },
    HC0346: { group: false, busy: [iv(1, 480, 540)] },
    HC0346D: { group: false, busy: [] },
  };
  const { down, up } = propagateGroups(rooms);
  assert.equal(down, 0);
  assert.equal(up, 0);
  assert.deepEqual(rooms.KH0333C.busy, []);
  assert.deepEqual(rooms.HC0346D.busy, []);
});

test('propagation is idempotent', () => {
  const build = () => ({
    MALC0100: { group: true, busy: [iv(1, 480, 540)] },
    MALC0100N: { group: false, busy: [iv(1, 600, 660)] },
  });
  const once = build();
  propagateGroups(once);
  const twice = build();
  propagateGroups(twice);
  propagateGroups(twice);
  assert.deepEqual(twice.MALC0100N.busy, once.MALC0100N.busy);
  assert.deepEqual(twice.MALC0100.busy, once.MALC0100.busy);
});

// --- the committed index, if it has been built ---

const INDEX = new URL('../../data/rooms-1268.json', import.meta.url);
const readIndex = () => (existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : null);

test('every busy tuple in the committed index is four integers in range', () => {
  const d = readIndex();
  if (!d) return;
  for (const [id, room] of Object.entries(d.rooms)) {
    for (const b of room.busy) {
      assert.equal(b.length, 4, id);
      assert.ok(b.every(Number.isInteger), `${id} ${JSON.stringify(b)}`);
      assert.ok(b[0] >= 0 && b[0] <= 6, `${id} weekday ${b[0]}`);
      assert.ok(b[1] < b[2], `${id} start must precede end`);
      assert.ok(b[2] <= 1440, `${id} end ${b[2]}`);
      assert.ok(b[3] >= 0 && b[3] < d.sessions.length, `${id} session ${b[3]}`);
    }
  }
});

test('the committed index leaves no unmerged overlap in any room', () => {
  const d = readIndex();
  if (!d) return;
  for (const [id, room] of Object.entries(d.rooms)) {
    const groups = {};
    for (const b of room.busy) (groups[`${b[0]}|${b[3]}`] ??= []).push(b);
    for (const g of Object.values(groups)) {
      g.sort((a, b) => a[1] - b[1]);
      for (let i = 1; i < g.length; i++) {
        assert.ok(g[i][1] > g[i - 1][2], `${id}: ${JSON.stringify(g[i - 1])} and ${JSON.stringify(g[i])}`);
      }
    }
  }
});

test('the committed index carries no geography, no clock string and no generated', () => {
  const d = readIndex();
  if (!d) return;
  const json = JSON.stringify(d);
  assert.equal(json.match(/"generated"/), null, 'generated lives only in current.json');
  assert.equal(json.match(/"lat"|"lon"/), null, 'geography lives in buildings.json');
  assert.equal(json.match(/\d{1,2}:\d{2}\s*[ap]m/i), null, 'times are integers, not strings');
  assert.equal(json.match(/@osu\.edu/i), null);
});

test('the committed index has sorted room keys, so a weekly diff is readable', () => {
  const d = readIndex();
  if (!d) return;
  const keys = Object.keys(d.rooms);
  assert.deepEqual(keys, [...keys].sort(), 'unsorted keys make every rebuild a full-file rewrite');
});

test('every room in the committed index resolves against buildings.json', () => {
  const d = readIndex();
  if (!d) return;
  const path = new URL('../../data/buildings.json', import.meta.url);
  if (!existsSync(path)) return;
  const buildings = JSON.parse(readFileSync(path, 'utf8')).buildings;
  for (const [id, room] of Object.entries(d.rooms)) {
    assert.ok(buildings[room.b], `${id} references building ${room.b}, which is not in buildings.json`);
  }
});
