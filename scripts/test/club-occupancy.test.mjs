import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activeSessions, freeGaps } from '../../js/engine.js';
import { clubDisclosure, normalizeMeetings, overlayForDate } from '../lib/club-occupancy.mjs';

const source = 'https://courses.erppub.osu.edu/room-matrix';
const index = () => ({
  term: '1268',
  sessions: [['2026-08-25', '2026-12-09']],
  courses: ['Example class'],
  rooms: { TEST101: { busy: [[4, 540, 600, 0, 0]] } },
});
const document = (records, overrides = {}) => ({
  _meta: {
    term: '1268', weekStart: '2026-08-31', weekEnd: '2026-09-06',
    generated: '2026-09-03', source, partial: false, ...overrides,
  },
  rooms: { TEST101: records },
});
const event = (overrides = {}) => ({
  kind: 'event', day: 4, start: 610, end: 660, type: 'MTG',
  eventId: '000657000', ...overrides,
});

test('the Room Matrix event removes free time without changing class data', () => {
  const original = index();
  const before = structuredClone(original);
  const out = overlayForDate(original, document([event()]), { date: '2026-09-03' });
  assert.deepEqual(original, before);
  assert.deepEqual(out.index.rooms.TEST101.busy[0], before.rooms.TEST101.busy[0]);
  const mask = activeSessions(out.index.sessions, '2026-09-03');
  assert.deepEqual(freeGaps(out.index.rooms.TEST101.busy, 4, 540, 720, mask), [[600, 610], [660, 720]]);
});

test('Room Matrix weekdays become dates within the snapshot week', () => {
  const records = [event({ day: 1 }), event({ day: 0, eventId: '000657001' })];
  assert.deepEqual(normalizeMeetings(document(records), { rooms: index().rooms, term: '1268' })
    .meetings.map((meeting) => meeting.date), ['2026-08-31', '2026-09-06']);
});

test('an occurrence does not repeat outside the source week', () => {
  const out = overlayForDate(index(), document([event()]), { date: '2026-09-10' });
  assert.equal(out.coverage, 'outside-snapshot');
  assert.equal(out.meetings.length, 0);
  assert.deepEqual(freeGaps(out.index.rooms.TEST101.busy, 4, 540, 720,
    activeSessions(out.index.sessions, '2026-09-10')), [[600, 720]]);
  assert.match(clubDisclosure(out).message, /No Room Matrix coverage/);
});

test('ROOM BLOCK records remain excluded until their meaning is decided', () => {
  const block = event({ kind: 'block', type: null, eventId: '33544' });
  const out = overlayForDate(index(), document([event(), block]), { date: '2026-09-03' });
  assert.equal(out.meetings.length, 1);
  assert.equal(out.blockCount, 1);
  assert.equal(out.rejected.find((item) => item.eventId === '33544').reason, 'undecided-room-block');
  assert.equal(clubDisclosure(out).blocksExcluded, 1);
});

test('unknown rooms and malformed events cannot become busy claims', () => {
  const rooms = {
    TEST101: [event({ start: -1 })],
    UNKNOWN: [event({ eventId: '000657002' })],
  };
  const normalized = normalizeMeetings({ ...document([]), rooms }, { rooms: index().rooms });
  assert.equal(normalized.meetings.length, 0);
  assert.deepEqual(normalized.rejected.map((item) => item.reason), ['invalid-event', 'unknown-room']);
});

test('future fields and personal text are not copied into output', () => {
  const normalized = normalizeMeetings(document([event({
    label: 'Private person', email: 'private@example.org', attendees: ['Someone'],
  })]), { rooms: index().rooms });
  assert.equal(normalized.meetings.length, 1);
  assert.ok(!JSON.stringify(normalized).includes('Private person'));
  assert.ok(!JSON.stringify(normalized).includes('private@example.org'));
  assert.ok(!JSON.stringify(normalized).includes('Someone'));
});

test('term and metadata mismatches fail closed', () => {
  assert.throws(() => normalizeMeetings(document([event()]), {
    rooms: index().rooms, term: '1272',
  }), /does not match/);
  assert.throws(() => normalizeMeetings(document([event()], { weekEnd: '2026-09-05' }), {
    rooms: index().rooms,
  }), /Invalid Room Matrix/);
  assert.throws(() => normalizeMeetings(document([event()], { source: 'https://user:pass@example.org' }), {
    rooms: index().rooms,
  }), /Invalid Room Matrix/);
});

test('overlapping events and classes produce their union, with no invented gap', () => {
  const out = overlayForDate(index(), document([event({ start: 580 })]), { date: '2026-09-03' });
  assert.deepEqual(freeGaps(out.index.rooms.TEST101.busy, 4, 540, 720,
    activeSessions(out.index.sessions, '2026-09-03')), [[660, 720]]);
});

test('the committed PR #114 snapshot is accepted without an adapter', () => {
  const roomEvents = JSON.parse(readFileSync(new URL('../../data/room-events-1268.json', import.meta.url)));
  const rooms = JSON.parse(readFileSync(new URL('../../data/rooms-1268.json', import.meta.url)));
  const normalized = normalizeMeetings(roomEvents, { rooms: rooms.rooms, term: rooms.term });
  assert.equal(normalized.meetings.length, roomEvents._meta.counts.events);
  assert.equal(normalized.blockCount, roomEvents._meta.counts.blockCells);
  assert.equal(normalized.coverage, 'complete-room-sweep');
  assert.equal(normalized.rejected.length, normalized.blockCount);
  assert.equal(normalized.meetings.every((meeting) => meeting.sourceUrl === roomEvents._meta.source), true);
});
