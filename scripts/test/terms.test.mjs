// Offline. Canned payloads in the exact shape the live endpoint returned on
// 2026-08-27. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { departure, diffTerms, fieldDrift, normalise } from '../check-terms.mjs';

// Trimmed from a real GET of searchableTermsV2, fields and order untouched.
const LIVE = {
  data: {
    _id: 'sis:searchableTerms',
    _rev: '91-fb0c3b766c87073fa30e0886f95e344a',
    data: [
      { strm: '1262', descr: 'Spring 2026', descrlong: '2026 Spr', classSearch: 'Y', startDate: '2025-09-08', endDate: '2026-08-31' },
      { strm: '1268', descr: 'Autumn 2026', descrlong: '2026 Autmn', classSearch: 'Y', startDate: '2026-02-09', endDate: '2027-01-31' },
      { strm: '1264', descr: 'Summer 2026', descrlong: '2026 Sum', classSearch: 'Y', startDate: '2026-01-26', endDate: '2027-01-01' },
    ],
    updated: '2026-02-09T09:56:13.199Z',
  },
};

test('the endpoint answers unsorted, and the baseline is sorted by strm', () => {
  assert.deepEqual(normalise(LIVE).map((t) => t.strm), ['1262', '1264', '1268']);
});

test('startDate is renamed on the way in, because it is not an academic date', () => {
  // Autumn 2026 "starts" 2026-02-09 by this field and its first class is
  // 2026-08-25. Carrying the original name into a committed file is how that
  // gets mistaken for a calendar.
  const autumn = normalise(LIVE).find((t) => t.strm === '1268');
  assert.deepEqual(autumn, {
    strm: '1268',
    descr: 'Autumn 2026',
    searchableFrom: '2026-02-09',
    searchableUntil: '2027-01-31',
  });
  assert.equal('startDate' in autumn, false);
});

test('a payload that is not the expected shape normalises to null, not to empty', () => {
  // Empty and unrecognisable have to stay different. Empty means every term
  // left, unrecognisable means the endpoint changed, and only one of those is
  // a reason to keep the baseline.
  assert.equal(normalise({}), null);
  assert.equal(normalise({ data: {} }), null);
  assert.equal(normalise({ data: { data: 'nope' } }), null);
  assert.deepEqual(normalise({ data: { data: [] } }), []);
});

test('a row with no strm is dropped rather than committed as a null key', () => {
  const payload = { data: { data: [{ descr: 'Mystery' }, { strm: '1272', descr: 'Spring 2027' }] } };
  assert.deepEqual(normalise(payload).map((t) => t.strm), ['1272']);
});

test('an unchanged list diffs to nothing', () => {
  const terms = normalise(LIVE);
  assert.deepEqual(diffTerms(terms, terms), { appeared: [], left: [] });
});

test('Spring 2027 appearing is reported by name', () => {
  // Expected on or about 2026-09-07, from the +364 day pattern on Spring 2026.
  const before = normalise(LIVE);
  const after = [...before, { strm: '1272', descr: 'Spring 2027', searchableFrom: null, searchableUntil: null }];
  assert.deepEqual(diffTerms(before, after), { appeared: ['1272 (Spring 2027)'], left: [] });
});

test('Spring 2026 leaving is reported by name', () => {
  // Due 2026-08-31. After that the API returns zero sections for 1262 forever.
  const before = normalise(LIVE);
  const after = before.filter((t) => t.strm !== '1262');
  assert.deepEqual(diffTerms(before, after), { appeared: [], left: ['1262 (Spring 2026)'] });
});

test('a rollover reports both halves in one go', () => {
  const before = normalise(LIVE);
  const after = [
    ...before.filter((t) => t.strm !== '1262'),
    { strm: '1272', descr: 'Spring 2027', searchableFrom: null, searchableUntil: null },
  ];
  assert.deepEqual(diffTerms(before, after), { appeared: ['1272 (Spring 2027)'], left: ['1262 (Spring 2026)'] });
});

test('a term with no descr still names its code', () => {
  const after = [{ strm: '1274', descr: null }];
  assert.deepEqual(diffTerms([], after), { appeared: ['1274'], left: [] });
});

test('the committed baseline parses and matches what normalise produces', () => {
  const file = JSON.parse(readFileSync(new URL('../../data/terms.json', import.meta.url), 'utf8'));
  assert.equal(file.source, 'https://content.osu.edu/v2/classes/searchableTermsV2');
  assert.ok(Array.isArray(file.terms) && file.terms.length > 0, 'the baseline must not be empty');
  for (const t of file.terms) {
    assert.deepEqual(Object.keys(t), ['strm', 'descr', 'searchableFrom', 'searchableUntil']);
  }
  // Not a fixed count. Three on 2026-08-27, two on 2026-09-01 once Spring 2026
  // reached its searchableUntil and before Spring 2027 opened. The count dips
  // through a rollover, so the membership check at the bottom is the one with
  // teeth.
});

// ---- ops-terms

// Verbatim from a GET on 2026-09-01, the run that re-baselined data/terms.json.
// Spring 2026 is gone; it published searchableUntil 2026-08-31. Nothing else
// moved, and _rev went 91 to 92 for that single edit.
const LIVE_2026_09_01 = {
  data: {
    _id: 'sis:searchableTerms',
    _rev: '92-6b17acb70881338b3b99f6ad729e5872',
    data: [
      { strm: '1264', descr: 'Summer 2026', descrlong: '2026 Sum', classSearch: 'Y', startDate: '2026-01-26', endDate: '2027-01-01' },
      { strm: '1268', descr: 'Autumn 2026', descrlong: '2026 Autmn', classSearch: 'Y', startDate: '2026-02-09', endDate: '2027-01-31' },
    ],
    updated: '2026-09-01T14:57:12.743Z',
  },
};

test('the wire still names the two date fields startDate and endDate', () => {
  // Not searchableFrom and searchableUntil. Those are this repo's renames and
  // appear nowhere in a response, which is what makes reading the raw body for
  // them look like the fields have gone. Six keys, same order, on both bodies.
  for (const row of [...LIVE.data.data, ...LIVE_2026_09_01.data.data]) {
    assert.deepEqual(Object.keys(row), ['strm', 'descr', 'descrlong', 'classSearch', 'startDate', 'endDate']);
  }
  assert.deepEqual(fieldDrift(LIVE), []);
  assert.deepEqual(fieldDrift(LIVE_2026_09_01), []);
});

test('a renamed date field is caught, and named by the keys the row really has', () => {
  // The silent failure this exists for. normalise reads both by name, so a
  // rename does not throw: it is two nulls in the committed baseline, and the
  // strm diff the watcher runs never looks at them.
  const renamed = {
    data: {
      data: LIVE_2026_09_01.data.data.map(({ startDate, endDate, ...rest }) => ({
        ...rest,
        searchableFrom: startDate,
        searchableUntil: endDate,
      })),
    },
  };
  assert.deepEqual(normalise(renamed).map((t) => t.searchableFrom), [null, null]);
  assert.deepEqual(fieldDrift(renamed), [
    '1264 carries strm, descr, descrlong, classSearch, searchableFrom, searchableUntil',
    '1268 carries strm, descr, descrlong, classSearch, searchableFrom, searchableUntil',
  ]);
});

test('a date that is present but null is drift, and no rows at all is not', () => {
  assert.deepEqual(fieldDrift({ data: { data: [{ strm: '1272', startDate: null, endDate: '2027-09-01' }] } }), [
    '1272 carries strm, startDate, endDate',
  ]);
  assert.deepEqual(fieldDrift({}), []);
  assert.deepEqual(fieldDrift({ data: { data: [] } }), []);
});

test('a departure on the published date reads differently from an early one', () => {
  const spring = { strm: '1262', searchableUntil: '2026-08-31' };
  assert.match(departure(spring, '2026-09-01'), /ordinary expiry/);
  assert.match(departure(spring, '2026-08-31'), /ordinary expiry/);
  assert.match(departure(spring, '2026-08-30'), /left early/);
  assert.match(departure({ strm: '1272' }, '2026-09-01'), /nothing predicted this/);
});

test('the term the app serves is still in the committed searchable list', () => {
  // The state that ends the app quietly: current.json points at a term that has
  // left searchableTermsV2, so the index it names returns zero sections forever
  // and can never be rebuilt.
  const terms = JSON.parse(readFileSync(new URL('../../data/terms.json', import.meta.url), 'utf8')).terms;
  const current = JSON.parse(readFileSync(new URL('../../data/current.json', import.meta.url), 'utf8'));
  assert.ok(
    terms.some((t) => t.strm === current.term),
    `current.json serves ${current.term}, and the searchable list is ${terms.map((t) => t.strm).join(', ')}`,
  );
});
