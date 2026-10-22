// The spike adapts the shared building-data module and must still answer the
// real table the same way a direct read does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pickHoursTerm, makeHoursFor } from '../hours.vendor.js';

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => readFileSync(at(p), 'utf8');
const json = (p) => JSON.parse(read(p));

test('the hours spike delegates to the shared building-data module', () => {
  const source = read('../hours.vendor.js');
  assert.match(source, /from '\.\.\/js\/buildings\.js'/);
  assert.doesNotMatch(source, /Object\.entries\(hours\?\.terms/);
});

test('the vendored hoursFor answers the shipped table exactly', () => {
  const hours = json('../../data/buildings-hours.json');
  const current = json('../../data/current.json');
  const term = pickHoursTerm(hours, current);
  assert.ok(term, `no published hours table for ${current.termName}`);

  const hoursFor = makeHoursFor(term);
  let pairs = 0;
  let closed = 0;
  for (const [code, rec] of Object.entries(term.buildings)) {
    for (let day = 0; day < 7; day++) {
      assert.deepEqual(hoursFor(code, day), rec.hours[day]);
      if (Array.isArray(rec.hours[day])) pairs++;
      else if (rec.hours[day] === null) closed++;
    }
  }
  assert.ok(pairs > 0 && closed > 0, 'the table should hold both open windows and published-closed days');

  // The distinction the whole app rests on: a building absent from the table is
  // undefined, never null and never an assumed window.
  assert.equal(hoursFor('__no_such_building__', 1), undefined);
});

test('a term with no table yields unknown hours rather than another term\'s doors', () => {
  const hours = json('../../data/buildings-hours.json');
  const term = pickHoursTerm(hours, { termName: 'Spring 2099' });
  assert.equal(term, null);
  assert.equal(makeHoursFor(term)('106', 1), undefined);
});
