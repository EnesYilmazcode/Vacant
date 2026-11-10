// Offline. No network, no writes: the step list and the refusals are data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  blockers,
  campusToday,
  flipTouches,
  hasHoursTable,
  hoursSlugFor,
  liveTermEnds,
  planSteps,
} from '../roll-term.mjs';

const script = fileURLToPath(new URL('../roll-term.mjs', import.meta.url));
const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const autumn = {
  term: '1268',
  termName: 'Autumn 2026',
  rooms: 'data/rooms-1268.json',
  instruction: ['2026-08-25', '2026-12-09'],
};
const autumnIndex = { exams: { start: '2026-12-11', end: '2026-12-17' } };
const terms = { terms: [{ strm: '1264' }, { strm: '1268' }, { strm: '1272' }] };
const hoursWithSpring = { terms: { 'autumn-2026-classroom-pool-building-schedule': {}, 'spring-2027-classroom-pool-building-schedule': {} } };
const hoursAutumnOnly = { terms: { 'autumn-2026-classroom-pool-building-schedule': {} } };
const staged = (rel) => rel === 'data/rooms-1272.json' || rel === 'data/buildings-1272.json';

const ctx = (over = {}) => ({
  term: '1272',
  mode: 'flip',
  today: '2026-12-18',
  current: autumn,
  currentIndex: autumnIndex,
  terms,
  hoursFile: hoursWithSpring,
  exists: staged,
  ...over,
});

test('prepare never writes current.json', () => {
  // The whole point of the first half: staging the next term must leave the
  // live one pointed at. build-index without --no-pointer flips the app.
  const steps = planSteps('1272', 'prepare').map((s) => s.cmd.join(' '));
  const build = steps.find((s) => s.includes('build-index.mjs'));
  assert.equal(build, 'node scripts/build-index.mjs 1272 --no-pointer');
  assert.ok(steps.includes('node scripts/fetch-buildings.mjs --term 1272'), 'subset must be built by term, not by pointer');
  assert.ok(!steps.some((s) => s.includes('fetch-ga-rooms') || s.includes('fetch-room-features')),
    'the single-term Registrar files are the live term\'s until the flip');
});

test('prepare builds the index before the subset that is keyed against it', () => {
  const steps = planSteps('1272', 'prepare').map((s) => s.cmd.join(' '));
  const at = (needle) => steps.findIndex((s) => s.includes(needle));
  assert.ok(at('fetch-rooms.mjs') < at('build-index.mjs'));
  assert.ok(at('build-index.mjs') < at('fetch-buildings.mjs'));
  assert.ok(at('fetch-buildings.mjs') < at('check-term-assets.mjs'));
});

test('flip runs the same gates rooms.yml runs before it pushes, after the pointer moves', () => {
  const steps = planSteps('1272', 'flip').map((s) => s.cmd.join(' '));
  const at = (needle) => steps.findIndex((s) => s === needle || s.includes(needle));
  assert.equal(steps[at('build-index.mjs')], 'node scripts/build-index.mjs 1272');
  for (const gate of ['check-term-assets.mjs', 'check-event-coverage.mjs', 'node --test']) {
    assert.ok(at(gate) > at('build-index.mjs'), `${gate} has to check the flipped tree`);
  }
  assert.ok(at('fetch-buildings.mjs') > at('build-index.mjs'), 'the hours rule can change which buildings ship');
  assert.ok(at('fetch-room-events.mjs') < at('check-event-coverage.mjs'));
});

test('only the two single-term Registrar pulls are allowed to fail', () => {
  const optional = planSteps('1272', 'flip').filter((s) => s.optional).map((s) => s.cmd[1]);
  assert.deepEqual(optional, ['scripts/fetch-ga-rooms.mjs', 'scripts/fetch-room-features.mjs']);
  assert.ok(planSteps('1272', 'prepare').every((s) => !s.optional));
});

test('a failed flip can put back every shared file it may have rewritten', () => {
  const touched = flipTouches('1272');
  for (const p of ['data/current.json', 'data/ga-rooms.json', 'data/room-features.json', 'data/buildings.json']) {
    assert.ok(touched.includes(p), `${p} is rewritten by a flip step and must be restorable`);
  }
});

test('a clean flip after finals has nothing to refuse', () => {
  assert.deepEqual(blockers(ctx()), []);
});

test('the flip waits for the live term to end, in campus time', () => {
  for (const today of ['2026-11-10', '2026-12-09', '2026-12-17']) {
    const why = blockers(ctx({ today }));
    assert.equal(why.length, 1, today);
    assert.match(why[0], /runs until 2026-12-17/);
  }
  assert.deepEqual(blockers(ctx({ today: '2026-11-10', early: true })), []);
  // 03:00 UTC on the 18th is still the 17th in Columbus.
  assert.equal(campusToday(new Date('2026-12-18T03:00:00Z')), '2026-12-17');
});

test('the live term ends with its finals, or its teaching when there are none', () => {
  assert.equal(liveTermEnds(autumnIndex, autumn), '2026-12-17');
  assert.equal(liveTermEnds({}, autumn), '2026-12-09');
  assert.equal(liveTermEnds(null, null), null);
});

test('the flip refuses a term with no published door hours', () => {
  const why = blockers(ctx({ hoursFile: hoursAutumnOnly }));
  assert.equal(why.length, 1);
  assert.match(why[0], /spring-2027/);
});

test('the flip refuses a term that was never prepared, naming each file', () => {
  const why = blockers(ctx({ exists: () => false }));
  assert.ok(why.some((w) => w.includes('data/rooms-1272.json')));
  assert.ok(why.some((w) => w.includes('data/buildings-1272.json')));
});

test('either half refuses the term already live, an unsearchable term and a bad code', () => {
  for (const mode of ['prepare', 'flip']) {
    assert.ok(blockers(ctx({ mode, term: '1268' })).some((w) => /already names 1268/.test(w)));
    assert.ok(blockers(ctx({ mode, term: '1274' })).some((w) => /not in data\/terms.json/.test(w)));
    assert.deepEqual(blockers(ctx({ mode, term: '../x' })), ['the term has to be a four digit code, like 1272']);
  }
  assert.deepEqual(blockers(ctx({ mode: 'prepare', today: '2026-11-10', exists: () => false, hoursFile: {} })), [],
    'prepare is safe any day: it does not need hours, staged files or the end of the term');
});

test('the hours slug matches the rule build-index.mjs and js/app.js use', () => {
  assert.equal(hoursSlugFor('1272'), 'spring-2027');
  assert.equal(hoursSlugFor('1268'), 'autumn-2026');
  const src = read('scripts/build-index.mjs');
  assert.ok(src.includes(".toLowerCase().replace(/\\s+/g, '-')"), 'build-index changed its slug rule');
  assert.ok(hasHoursTable('1268', JSON.parse(read('data/buildings-hours.json'))), 'the live term has its table');
});

test('fetch scripts the weekly job runs no longer default to the Autumn index', () => {
  // After the flip, rooms.yml runs fetch-room-events.mjs with no flags. When
  // that defaulted to rooms-1268.json it swept the old term every Sunday and
  // check-event-coverage refused every publish from then on.
  assert.ok(!read('scripts/fetch-room-events.mjs').includes("'rooms-1268.json'"));
  assert.ok(!read('scripts/fetch-room-features.mjs').includes("'rooms-1268.json'"));
  assert.ok(!/arg\('--term', '1268'\)/.test(read('scripts/fetch-room-features.mjs')));
});

test('with no mode the CLI only prints the plan', () => {
  const res = spawnSync(process.execPath, [script, '1272'], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /--prepare/);
  assert.match(res.stdout, /--flip/);
  assert.equal(spawnSync(process.execPath, [script, 'nope'], { encoding: 'utf8' }).status, 2);
  assert.equal(spawnSync(process.execPath, [script, '1272', '--prepare', '--flip'], { encoding: 'utf8' }).status, 2);
});
