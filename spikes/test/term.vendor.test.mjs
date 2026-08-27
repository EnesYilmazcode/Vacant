// Defect 1. The spike pages ranked rooms on days the app refuses to rank any.
// Frozen to 2026-12-23, twelve days after Autumn 2026 ended, the app said
// "Autumn 2026 ended on Dec 11" and walk.html offered 871 free rooms.
// term.vendor.js is the app's gate with the DOM taken out, so it needs the same
// two guards the hours copy has: the app source must still say what it said,
// and the copy must still answer the shipped current.json the same way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { termGate, refusalNote, fmtDay, isoDate } from '../term.vendor.js';

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => readFileSync(at(p), 'utf8');
const json = (p) => JSON.parse(read(p));

const AUTUMN = { termName: 'Autumn 2026', instruction: ['2026-08-10', '2026-12-11'] };

test('js/app.js still gates the way term.vendor.js copied', () => {
  const app = read('../../js/app.js');
  for (const needle of [
    'const [from, to] = current.instruction ?? [];',
    'if (!from || !to || (today >= from && today <= to)) return;',
    '`${term} ended on ${fmtDay(to)}`',
    'Vacant will not rank rooms against a term that is over.',
    // The gate only matters because boot() stops before this line.
    'state.ready = true;',
  ]) {
    assert.ok(
      app.includes(needle),
      `js/app.js no longer contains ${JSON.stringify(needle)}. spikes/term.vendor.js copied the term gate from it, and the spike pages rank rooms whenever it says they may.`,
    );
  }
});

test('the term is over: the gate shuts, in the app\'s words', () => {
  const g = termGate(AUTUMN, '2026-12-23');
  assert.equal(g.open, false);
  assert.equal(g.early, false);
  assert.equal(g.headline, 'Autumn 2026 ended on Dec 11');
  assert.equal(g.detail, 'Ohio State has not published a newer schedule yet. Vacant will not rank rooms against a term that is over.');
  // The instrument has to name the dates, because the person reading it was
  // about to walk somewhere.
  assert.match(refusalNote(g), /Aug 10 to Dec 11/);
  assert.match(refusalNote(g), /will not pick/);
});

test('before the term starts the gate shuts the other way', () => {
  const g = termGate(AUTUMN, '2026-08-01');
  assert.equal(g.open, false);
  assert.equal(g.early, true);
  assert.equal(g.headline, 'Autumn 2026 has not started yet');
  assert.match(g.detail, /Classes run Aug 10 to Dec 11/);
  assert.match(refusalNote(g), /before it starts/);
});

test('both edges of the window are inside it', () => {
  for (const day of ['2026-08-10', '2026-09-03', '2026-12-11']) {
    assert.equal(termGate(AUTUMN, day).open, true, `${day} should be inside the term`);
  }
  for (const day of ['2026-08-09', '2026-12-12']) {
    assert.equal(termGate(AUTUMN, day).open, false, `${day} should be outside the term`);
  }
});

test('no published window is not a closed window', () => {
  // js/app.js returns early and answers in this case, so the instrument does
  // too. Inventing a refusal the product would not make is its own wrong answer.
  assert.equal(termGate({ termName: 'Autumn 2026' }, '2026-12-23').open, true);
  assert.equal(termGate(null, '2026-12-23').open, true);
});

test('the shipped current.json is gated on the dates it actually carries', () => {
  const current = json('../../data/current.json');
  const [from, to] = current.instruction;
  assert.ok(from && to, 'data/current.json carries no instruction window');
  assert.equal(termGate(current, from).open, true);
  assert.equal(termGate(current, to).open, true);
  const after = termGate(current, '2099-01-01');
  assert.equal(after.open, false);
  assert.equal(after.headline, `${current.termName} ended on ${fmtDay(to)}`);
});

test('isoDate is local, so a late-evening run is not tomorrow', () => {
  assert.equal(isoDate(new Date(2026, 11, 23, 23, 30)), '2026-12-23');
  assert.equal(isoDate(new Date(2026, 0, 1, 0, 5)), '2026-01-01');
});

test('both ranking pages read the gate rather than ranking past it', () => {
  const walk = read('../walk.html');
  assert.ok(walk.includes("import { termGate, refusalNote, fmtDay } from './term.vendor.js';"));
  assert.ok(
    walk.includes('if (!gate.open) { refuse(); return; }'),
    'walk.html no longer refuses to pick when the term gate is shut. Out of term it will offer rooms the app calls nothing.',
  );
  assert.ok(
    walk.includes("if (!gate.open) throw new Error('the term gate is shut"),
    'pickTwenty no longer guards the gate itself, so any other caller can pick out of term.',
  );

  const launch = read('../launch.html');
  assert.ok(launch.includes("import { termGate, fmtDay, isoDate } from './term.vendor.js';"));
  assert.ok(
    launch.includes("(r.gate.open ? r.answered : 'none, the app refuses today')"),
    'launch.html is printing a room count again on days the app answers nothing.',
  );
});
