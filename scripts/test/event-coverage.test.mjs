import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEventCoverage } from '../check-event-coverage.mjs';

const now = new Date('2026-09-13T07:25:00Z');
const current = { term: '1268' };
const index = { term: '1268', rooms: { AA0108: {}, BE0120: {} } };
const events = {
  _meta: {
    term: '1268', week: '09/14/2026', weekStart: '2026-09-14',
    weekEnd: '2026-09-20', partial: false,
    counts: { roomsParsed: 2, noGrid: 0, invalidValue: 0 },
  },
  rooms: { AA0108: [], BE0120: [] },
};

test('Sunday publish requires the coming Monday through Sunday', () => {
  assert.deepEqual(checkEventCoverage({ current, index, events, now }),
    { start: '2026-09-14', end: '2026-09-20', through: '2026-09-20', rooms: 2 });
  assert.throws(() => checkEventCoverage({ current, index, events: {
    ...events,
    _meta: { ...events._meta, week: '09/07/2026', weekStart: '2026-09-07', weekEnd: '2026-09-13' },
  }, now }), /expected 2026-09-14 through 2026-09-20/);
});

test('a partial or incomplete sweep cannot publish', () => {
  assert.throws(() => checkEventCoverage({ current, index, events: {
    ...events, _meta: { ...events._meta, partial: true },
  }, now }), /partial/);
  assert.throws(() => checkEventCoverage({ current, index, events: {
    ...events, rooms: { AA0108: [] },
  }, now }), /swept 1 of 2/);
  assert.throws(() => checkEventCoverage({ current, index, events: {
    ...events, _meta: { ...events._meta, counts: { ...events._meta.counts, noGrid: 1 } },
  }, now }), /complete valid sweep/);
});

const ahead = (overrides = {}, rooms = { AA0108: [], BE0120: [] }) => ({
  _meta: {
    term: '1268', week: '09/21/2026', weekStart: '2026-09-21', weekEnd: '2026-09-27', partial: false,
    counts: { roomsParsed: 2, noGrid: 0, invalidValue: 0 }, ...overrides,
  },
  rooms,
});

test('the week after is checked when it is there, and carries coverage through it', () => {
  assert.equal(checkEventCoverage({ current, index, events: { ...events, ahead: [ahead()] }, now }).through, '2026-09-27');
});

test('a week ahead that skips a week, is partial or misses rooms cannot publish', () => {
  const check = (week) => () => checkEventCoverage({ current, index, events: { ...events, ahead: [week] }, now });
  assert.throws(check(ahead({ week: '09/28/2026', weekStart: '2026-09-28', weekEnd: '2026-10-04' })),
    /expected 2026-09-21 through 2026-09-27/);
  assert.throws(check(ahead({ partial: true })), /partial/);
  assert.throws(check(ahead({}, { AA0108: [] })), /not a complete valid sweep/);
});
