// Offline. The clock is passed in, so both sides of the 10 day boundary are
// exact rather than approximate. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_DAYS, ageInDays, freshness } from '../check-freshness.mjs';

const NOW = new Date('2026-08-27T12:00:00Z');
const daysBefore = (n) => new Date(NOW.getTime() - n * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const stamped = (n) => ({ term: '1268', termName: 'Autumn 2026', generated: daysBefore(n) });

test('the limit is ten days, not seven', () => {
  // Seven would fire on one skipped build plus GitHub's measured 31 to 62
  // minutes of cron slop. Ten needs two missed builds.
  assert.equal(MAX_DAYS, 10);
});

test('exactly ten days old passes', () => {
  const r = freshness(stamped(10), NOW);
  assert.equal(r.ok, true, r.reason);
  assert.equal(Number(r.days.toFixed(6)), 10);
});

test('a minute past ten days fails', () => {
  const r = freshness({ generated: daysBefore(10 + 1 / 1440) }, NOW);
  assert.equal(r.ok, false);
  assert.match(r.reason, /past the 10 day limit/);
});

test('a healthy weekly build is nowhere near the limit', () => {
  for (const age of [0, 1, 6.9, 7.5, 9.99]) {
    assert.equal(freshness(stamped(age), NOW).ok, true, `${age} days should pass`);
  }
});

test('an unreadable stamp is stale, not fresh', () => {
  // Unknown age must never resolve to fine. The whole project exists because a
  // room that reads free on data of unknown age is the worst kind of wrong.
  for (const generated of [undefined, null, '', 'soon', '2026-13-45', 42]) {
    const r = freshness({ generated }, NOW);
    assert.equal(r.ok, false, `${JSON.stringify(generated)} should be stale`);
    assert.match(r.reason, /no readable "generated" stamp/);
  }
});

test('current.json that is not an object is stale', () => {
  assert.equal(freshness(null, NOW).ok, false);
  assert.equal(freshness('{}', NOW).ok, false);
});

test('a stamp from the future fails, with an hour of clock slack', () => {
  assert.equal(freshness({ generated: daysBefore(-0.5 / 24) }, NOW).ok, true, 'half an hour ahead is skew');
  const r = freshness({ generated: daysBefore(-2) }, NOW);
  assert.equal(r.ok, false);
  assert.match(r.reason, /2\.0 days in the future/);
});

test('the message names the observed age, so the issue body is readable', () => {
  const r = freshness(stamped(23.4), NOW);
  assert.match(r.reason, /23\.4 days ago/);
});

test('ageInDays is plain arithmetic on the parsed instant', () => {
  assert.equal(ageInDays('2026-08-20T12:00:00Z', NOW), 7);
  assert.equal(ageInDays('nonsense', NOW), null);
  assert.equal(ageInDays(undefined, NOW), null);
});

test('the committed data/current.json still has a stamp this can read', async () => {
  // Not a freshness assertion. It would go red every time the repo sat for two
  // weeks, which is a fact about the calendar rather than about the code.
  const { readFileSync } = await import('node:fs');
  const current = JSON.parse(readFileSync(new URL('../../data/current.json', import.meta.url), 'utf8'));
  assert.notEqual(ageInDays(current.generated, NOW), null, 'generated must stay parseable');
});
