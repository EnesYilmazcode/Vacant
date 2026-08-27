// Defect 4. launch.html offers three launch states and the verdict counted one.
// Five runs recorded the page's own way, as "cold everything, first launch
// after install", printed "Runs recorded: cold everything: 5 of 5" and then
// "VERDICT: No cold process runs recorded".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { verdict, median, STATES, COLD_STATES } from '../verdict.js';

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const run = (state, total, firstInContext = true) => ({ state, total, totalFirstParse: total + 10, firstInContext });

test('every state the page offers is a state this file knows', () => {
  const page = readFileSync(at('../launch.html'), 'utf8');
  const offered = [...page.matchAll(/<option value="([^"]+)">/g)].map((m) => m[1]);
  assert.deepEqual(offered, STATES, 'the #state select and STATES have drifted apart');
  for (const s of COLD_STATES) assert.ok(offered.includes(s));
  assert.ok(!COLD_STATES.includes('warm'));
});

test('five cold everything runs produce a verdict', () => {
  const v = verdict([200, 210, 190, 205, 195].map((t) => run('cold everything', t)));
  assert.equal(v.n, 5);
  assert.equal(v.median, 200);
  assert.match(v.line, /Under 300 ms/);
  assert.doesNotMatch(v.line, /No cold/);
});

test('the two cold states pool, and are printed apart', () => {
  const v = verdict([
    run('cold process', 400), run('cold process', 420),
    run('cold everything', 900), run('cold everything', 950),
    run('warm', 10),
  ]);
  assert.equal(v.n, 4, 'warm never counts');
  assert.equal(v.median, 420);
  const seen = Object.fromEntries(v.byState.map((b) => [b.state, b]));
  assert.equal(seen['cold process'].n, 2);
  assert.equal(seen['cold process'].median, 400);
  assert.equal(seen['cold everything'].n, 2);
  assert.equal(seen['cold everything'].median, 900);
});

test('warm runs alone still give no verdict, and say which states to record', () => {
  const v = verdict([run('warm', 30), run('warm', 35)]);
  assert.equal(v.median, null);
  assert.match(v.line, /No cold runs recorded/);
  assert.match(v.line, /cold process or cold everything/);
});

test('a warm JIT run only counts when nothing colder exists, and is flagged', () => {
  const mixed = verdict([run('cold everything', 800, false), run('cold everything', 200, true)]);
  assert.equal(mixed.n, 1);
  assert.equal(mixed.median, 200, 'the run with a warm JIT describes a launch nobody performs');
  assert.equal(mixed.warm, false);

  const all = verdict([run('cold everything', 800, false), run('cold everything', 820, false)]);
  assert.equal(all.n, 2);
  assert.equal(all.warm, true, 'nothing was first in its context, so the verdict is optimistic');
});

test('the three thresholds still split where #29 put them', () => {
  assert.match(verdict([run('cold everything', 299)]).line, /Under 300 ms/);
  assert.match(verdict([run('cold everything', 300)]).line, /Between 300 and 800/);
  assert.match(verdict([run('cold everything', 800)]).line, /Between 300 and 800/);
  assert.match(verdict([run('cold everything', 801)]).line, /Over 800 ms/);
});

test('median takes the lower middle on an even count, the way the page always did', () => {
  assert.equal(median([]), null);
  assert.equal(median([5]), 5);
  assert.equal(median([1, 2, 3, 4]), 2);
  assert.equal(median([3, 1, 2]), 2);
});
