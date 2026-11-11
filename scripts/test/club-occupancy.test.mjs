import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activeSessions, freeGaps } from '../../js/engine.js';
import { HOLD_LABEL, normalizeMeetings, overlayForDate } from '../lib/club-occupancy.mjs';

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

test('all observed registered-event codes become occupancy', () => {
  const types = ['MTG', 'TOUR', 'INFO', 'WRKS', 'SMNR', 'RCPT', 'INTV', 'FAIR', 'DISC'];
  const records = types.map((type, i) => event({
    type,
    eventId: String(657000 + i).padStart(9, '0'),
  }));
  const normalized = normalizeMeetings(document(records), { rooms: index().rooms, term: '1268' });
  assert.deepEqual(normalized.meetings.map((meeting) => meeting.type).sort(), types.sort());
  assert.equal(normalized.rejected.length, 0);
});

test('an occurrence does not repeat outside the source week', () => {
  const out = overlayForDate(index(), document([event()]), { date: '2026-09-10' });
  assert.equal(out.coverage, 'outside-snapshot');
  assert.equal(out.meetings.length, 0);
  assert.deepEqual(freeGaps(out.index.rooms.TEST101.busy, 4, 540, 720,
    activeSessions(out.index.sessions, '2026-09-10')), [[600, 720]]);
});

test('a ROOM BLOCK is busy time, kept apart from events and labelled as a hold', () => {
  // Decided 2026-11-10: a group booked Lazenby Hall 001 at 7pm inside its
  // 5:30pm-11pm block, and the Room Matrix never showed that booking.
  const block = event({ kind: 'block', type: null, eventId: '35693', start: 1050, end: 1380 });
  const out = overlayForDate(index(), document([event(), block]), { date: '2026-09-03' });
  assert.equal(out.meetings.length, 1);
  assert.equal(out.holds.length, 1);
  assert.equal(out.blockCount, 1);
  assert.deepEqual(out.rejected, []);
  const busy = out.index.rooms.TEST101.busy;
  const hold = busy.find((b) => b[1] === 1050);
  assert.equal(out.index.courses[hold[4]], HOLD_LABEL, 'a hold must never borrow a class name');
  assert.deepEqual(out.index.courses.slice(0, 1), ['Example class'], 'class course indexes stay put');
  assert.deepEqual(freeGaps(busy, 4, 900, 1380, activeSessions(out.index.sessions, '2026-09-03')), [[900, 1050]]);
});

test('a hold on a no-class day still holds the room', () => {
  const block = event({ kind: 'block', type: null, eventId: '35693', start: 1050, end: 1380 });
  const out = overlayForDate(index(), document([block]), { date: '2026-09-03', classesSuspended: true });
  assert.deepEqual(freeGaps(out.index.rooms.TEST101.busy, 4, 480, 1380,
    activeSessions(out.index.sessions, '2026-09-03')), [[480, 1050]]);
});

test('a malformed block is rejected rather than guessed at', () => {
  const bad = event({ kind: 'block', type: null, eventId: 'x', start: 1050, end: 1380 });
  const out = normalizeMeetings(document([bad]), { rooms: index().rooms, term: '1268' });
  assert.equal(out.holds.length, 0);
  assert.deepEqual(out.rejected.map((r) => r.reason), ['invalid-block']);
});

test('the index without a hold is returned with its own course list', () => {
  const out = overlayForDate(index(), document([event()]), { date: '2026-09-03' });
  assert.deepEqual(out.index.courses, ['Example class']);
  assert.equal(out.holds.length, 0);
});

test('a no-class day suppresses classes but keeps registered events', () => {
  const out = overlayForDate(index(), document([event()]), {
    date: '2026-09-03', classesSuspended: true,
  });
  const mask = activeSessions(out.index.sessions, '2026-09-03');
  assert.deepEqual(freeGaps(out.index.rooms.TEST101.busy, 4, 540, 720, mask), [[540, 610], [660, 720]]);
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
  assert.equal(normalized.holds.length, normalized.blockCount, 'every committed block becomes a hold');
  assert.deepEqual(normalized.rejected, []);
  assert.equal(normalized.meetings.every((meeting) => meeting.sourceUrl === roomEvents._meta.source), true);
});

// Two weeks in one file: the coming week at the top level, as always, and the
// week after under `ahead`. A failed Sunday leaves this file in place, so the
// second week is what keeps a Monday from going class-only.
const twoWeeks = (thisWeek, nextWeek) => ({
  ...document(thisWeek),
  ahead: [{
    _meta: { term: '1268', weekStart: '2026-09-07', weekEnd: '2026-09-13', generated: '2026-09-03', source, partial: false },
    rooms: { TEST101: nextWeek },
  }],
});

test('a date in the week ahead reads the week ahead, with full coverage', () => {
  const file = twoWeeks([event()], [event({ start: 700, end: 760, eventId: '000657001' })]);
  const thisThursday = overlayForDate(index(), file, { date: '2026-09-03' });
  assert.equal(thisThursday.coverage, 'complete-room-sweep');
  assert.deepEqual(thisThursday.meetings.map((m) => m.startMinute), [610]);
  const nextThursday = overlayForDate(index(), file, { date: '2026-09-10' });
  assert.equal(nextThursday.coverage, 'complete-room-sweep');
  assert.deepEqual(nextThursday.meetings.map((m) => [m.date, m.startMinute]), [['2026-09-10', 700]]);
  assert.deepEqual(freeGaps(nextThursday.index.rooms.TEST101.busy, 4, 540, 780,
    activeSessions(nextThursday.index.sessions, '2026-09-10')), [[600, 700], [760, 780]]);
});

test('a date past every week in the file is still outside the snapshot', () => {
  const out = overlayForDate(index(), twoWeeks([event()], [event()]), { date: '2026-09-17' });
  assert.equal(out.coverage, 'outside-snapshot');
  assert.deepEqual(out.meetings, []);
});

test('a malformed week ahead is refused, not read', () => {
  const file = twoWeeks([], [event()]);
  delete file.ahead[0]._meta.source;
  assert.throws(() => overlayForDate(index(), file, { date: '2026-09-10' }), TypeError);
  // The week it does not touch still answers.
  assert.equal(overlayForDate(index(), file, { date: '2026-09-03' }).coverage, 'complete-room-sweep');
});

test('every week in the committed file is accepted without an adapter', () => {
  const roomEvents = JSON.parse(readFileSync(new URL('../../data/room-events-1268.json', import.meta.url)));
  const rooms = JSON.parse(readFileSync(new URL('../../data/rooms-1268.json', import.meta.url)));
  for (const week of roomEvents.ahead ?? []) {
    const normalized = normalizeMeetings(week, { rooms: rooms.rooms, term: rooms.term });
    assert.equal(normalized.meetings.length, week._meta.counts.events, week._meta.weekStart);
    // A block the grid draws twice is one hold: the week of 2026-11-16 has 346
    // block cells and 343 distinct holds. Every cell is still counted.
    assert.equal(normalized.blockCount, week._meta.counts.blockCells, week._meta.weekStart);
    assert.ok(normalized.holds.length > 0 && normalized.holds.length <= normalized.blockCount);
    assert.deepEqual(normalized.rejected, []);
  }
});
