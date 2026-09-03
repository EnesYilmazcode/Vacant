import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeSessions, freeGaps } from '../../js/engine.js';
import { CLUB_MAX_AGE_MS, clubDisclosure, normalizeMeetings, overlayForDate } from '../lib/club-occupancy.mjs';

// Synthetic contract examples. No real organization's booking is claimed.
const now = Date.parse('2026-09-03T16:00:00Z');
const index = () => ({
  sessions: [['2026-08-25', '2026-12-09']],
  courses: ['Example class'],
  rooms: { TEST101: { busy: [[4, 540, 600, 0, 0]] } },
});
const event = (overrides = {}) => ({
  sourceId: 'test-source', id: 'event-1', organizationId: 'test-club',
  organization: 'Synthetic test club', roomId: 'TEST101', date: '2026-09-03',
  startMinute: 610, endMinute: 660, status: 'confirmed',
  fetchedAt: '2026-09-03T15:00:00Z', sourceUrl: 'https://example.org/events/1',
  ...overrides,
});
const normalize = (records, clock = now) => normalizeMeetings(records, { rooms: index().rooms, now: clock });

test('a verified meeting removes free time without changing class data', () => {
  const original = index();
  const before = structuredClone(original);
  const out = overlayForDate(original, [event()], { date: '2026-09-03', now });
  assert.deepEqual(original, before);
  assert.deepEqual(out.index.rooms.TEST101.busy[0], before.rooms.TEST101.busy[0]);
  const mask = activeSessions(out.index.sessions, '2026-09-03');
  assert.deepEqual(freeGaps(out.index.rooms.TEST101.busy, 4, 540, 720, mask), [[600, 610], [660, 720]]);
});

test('one-time meetings do not repeat the following week', () => {
  const out = overlayForDate(index(), [event()], { date: '2026-09-03', now });
  const mask = activeSessions(out.index.sessions, '2026-09-10');
  assert.deepEqual(freeGaps(out.index.rooms.TEST101.busy, 4, 540, 720, mask), [[600, 720]]);
});

test('recurring meetings use separate dated occurrences and respect cancellations', () => {
  const records = [event({ seriesId: 'weekly' }), event({
    seriesId: 'weekly', date: '2026-09-10', status: 'cancelled',
  })];
  assert.equal(overlayForDate(index(), records, { date: '2026-09-03', now }).meetings.length, 1);
  assert.equal(overlayForDate(index(), records, { date: '2026-09-10', now }).meetings.length, 0);
  assert.equal(normalize([event({ recurrence: 'FREQ=WEEKLY' })]).rejected[0].reason, 'unexpanded-recurrence');
});

test('cancelled, tentative, and unknown-status events never block a room', () => {
  for (const status of ['cancelled', 'tentative', undefined]) {
    assert.equal(normalize([event({ status })]).meetings.length, 0);
  }
});

test('conflicting snapshots cannot resurrect a cancelled occurrence', () => {
  const records = [event(), event({ status: 'cancelled' })];
  for (const versions of [records, [...records].reverse()]) {
    const out = normalize(versions);
    assert.equal(out.meetings.length, 0);
    assert.equal(out.rejected[0].reason, 'conflicting-occurrence');
  }
});

test('duplicates across sources retain provenance without adding two meetings', () => {
  const out = normalize([event(), event(), event({ sourceId: 'second', id: 'other-id' })]);
  assert.equal(out.meetings.length, 1);
  assert.equal(out.meetings[0].sources.length, 2);
});

test('stale, future, missing and timezone-less fetch times are rejected', () => {
  for (const fetchedAt of ['2026-09-01T16:00:00Z', '2026-09-04T16:00:00Z', undefined, '2026-09-03T15:00:00']) {
    assert.equal(normalize([event({ fetchedAt })]).meetings.length, 0);
  }
  const records = [event()];
  assert.equal(normalize(records).meetings.length, 1);
  assert.equal(normalize(records, now + CLUB_MAX_AGE_MS).meetings.length, 0);
});

test('unknown rooms and ambiguous or invalid times cannot become busy claims', () => {
  for (const change of [
    { roomId: 'UNKNOWN' }, { roomId: '__proto__' }, { date: '2026-02-30' },
    { startMinute: -1 }, { endMinute: 1441 }, { endMinute: 610 },
    { startMinute: 610.5 }, { startMinute: '610' }, { endMinute: undefined },
    { sourceUrl: 'javascript:alert(1)' }, { organizationId: '' },
  ]) assert.equal(normalize([event(change)]).meetings.length, 0, JSON.stringify(change));
});

test('overlapping events and classes produce their union, with no invented gap', () => {
  const out = overlayForDate(index(), [event({ startMinute: 580 })], { date: '2026-09-03', now });
  assert.deepEqual(freeGaps(out.index.rooms.TEST101.busy, 4, 540, 720,
    activeSessions(out.index.sessions, '2026-09-03')), [[660, 720]]);
});

test('personal fields are not copied into output', () => {
  const out = normalize([event({ email: 'private@example.org', attendees: ['Private person'] })]);
  assert.ok(!JSON.stringify(out).includes('private@example.org'));
  assert.ok(!JSON.stringify(out).includes('Private person'));
});

test('empty and partial evidence always disclose unknown coverage and source freshness', () => {
  const empty = normalize([]);
  assert.equal(empty.coverage, 'unknown');
  assert.match(clubDisclosure(empty).message, /coverage is unknown/);
  const partial = clubDisclosure(normalize([event()]));
  assert.match(partial.message, /Other club bookings may be missing/);
  assert.equal(partial.sources[0].fetchedAt, '2026-09-03T15:00:00.000Z');
  assert.equal(partial.sources[0].sourceUrl, 'https://example.org/events/1');
});
