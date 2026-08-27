// Offline. Canned payloads in the exact shape the live endpoint returned on
// 2026-08-27. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { diffTerms, normalise } from '../check-terms.mjs';

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
  // Three terms are searchable at all times, every year. Seen 2026-08-27.
  assert.equal(file.terms.length, 3);
});
