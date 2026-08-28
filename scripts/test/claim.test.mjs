// Offline. The room screen's one claim, checked without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { roomClaim } from '../../js/claim.js';
import { usableMinutes } from '../../js/engine.js';

const at = (h, m = 0) => h * 60 + m;

// The timeline the screen builds, in the shape the claim reads it. `rows` is
// what the eye sees, `blocks` is the classes, `open` and `close` are door times
// only when `known` is true.
function timeline({ known, blocks, open, close, now, metres }) {
  const rows = [];
  let cursor = open;
  for (const [s, e] of blocks) {
    if (s > cursor) rows.push({ kind: 'free', t: cursor, end: s, len: s - cursor, now: now >= cursor && now < s });
    rows.push({ kind: 'busy', t: s });
    cursor = Math.max(cursor, e);
  }
  if (cursor < close) rows.push({ kind: 'free', t: cursor, end: close, len: close - cursor, now: now >= cursor && now < close });
  return { known, rows, blocks, open, close, now, metres };
}

// Thompson Library 150B on Tuesday, the room in the defect. One class, 12:45 to
// 2:05, and no published hours for the building.
const thompson = (now) => timeline({
  known: false, blocks: [[at(12, 45), at(14, 5)]], open: at(12, 45), close: at(14, 5), now,
});

test('a building with no published hours is never given an opening time', () => {
  // The bug this file exists for: at 3am the screen headlined "Thompson Library
  // opens at 12:45pm", which is the start of the first class, printed two lines
  // above its own paragraph saying nobody publishes that door.
  const c = roomClaim(thompson(at(3)));
  assert.equal(c.kind, 'before-first-class');
  assert.equal(c.at, at(12, 45));
  assert.notEqual(c.kind, 'opens');
});

test('a building with no published hours is never called closed for the day', () => {
  const c = roomClaim(thompson(at(22)));
  assert.equal(c.kind, 'after-last-class');
  assert.equal(c.at, at(14, 5));
  assert.notEqual(c.kind, 'closed-for-day');
});

test('with no published hours, being free is a fact about classes', () => {
  // 10:00, two classes today, the second at 13:00. The room is free of classes,
  // which is not the same as the door being open, so the claim says the first.
  const tl = timeline({
    known: false, blocks: [[at(8), at(9)], [at(13), at(14)]], open: at(8), close: at(14), now: at(10),
  });
  const c = roomClaim(tl);
  assert.equal(c.kind, 'free');
  assert.equal(c.known, false);
  assert.equal(c.until, at(13));
});

test('published hours still get door sentences, because there the door is a fact', () => {
  const before = roomClaim(timeline({
    known: true, blocks: [[at(12), at(13)]], open: at(7), close: at(22), now: at(6),
  }));
  assert.equal(before.kind, 'opens');
  assert.equal(before.at, at(7));
  assert.equal(before.next, at(7), 'and it names the free window it can see');

  const after = roomClaim(timeline({
    known: true, blocks: [[at(12), at(13)]], open: at(7), close: at(22), now: at(23),
  }));
  assert.equal(after.kind, 'closed-for-day');

  const free = roomClaim(timeline({
    known: true, blocks: [[at(12), at(13)]], open: at(7), close: at(22), now: at(10),
  }));
  assert.equal(free.kind, 'free');
  assert.equal(free.known, true);
  assert.equal(free.until, at(12));
});

test('a class in the room is a claim either way, hours or no hours', () => {
  for (const known of [true, false]) {
    const c = roomClaim(timeline({
      known, blocks: [[at(12, 45), at(14, 5)], [at(15), at(16)]],
      open: known ? at(7) : at(12, 45), close: known ? at(22) : at(16), now: at(13), metres: 300,
    }));
    assert.equal(c.kind, 'in-class');
    assert.equal(c.until, at(14, 5));
    assert.equal(c.next, at(14, 5));
    // The 55 minute gap, minus packup, minus the walk. The raw 55 is what this
    // used to report, and printing it counted the walk as study time.
    assert.equal(c.yours, usableMinutes({ now: at(13), gapStart: at(14, 5), gapEnd: at(15), metres: 300 }));
    assert.ok(c.yours < 55);
  }
});

test('a claim with no distance behind it carries no duration at all', () => {
  // Not zero and not the whole gap. A shared link and the buildings screen both
  // reach this screen with no ranked row behind them, and a duration that
  // assumes you are already standing in the room is the same guess as a door
  // time nobody publishes.
  const c = roomClaim(timeline({
    known: true, blocks: [[at(12, 45), at(14, 5)]], open: at(7), close: at(22), now: at(13),
  }));
  assert.equal(c.kind, 'in-class');
  assert.equal(c.yours, null);
});

test('a room with nothing on its timeline claims nothing', () => {
  assert.equal(roomClaim({ known: false, rows: [], blocks: [], open: null, close: null, now: at(12) }).kind, 'no-class-today');
  assert.equal(roomClaim({ known: true, rows: [], blocks: [], open: at(7), close: at(22), now: at(12) }).kind, 'no-class-today');
});

test('every claim about a door is reachable only when the hours are published', () => {
  // The guard that outlives the wording. Whatever the clock, an unknown-hours
  // room can never produce a verdict that talks about the building.
  const doorKinds = new Set(['opens', 'closed-for-day']);
  for (let now = 0; now < 1440; now += 5) {
    const c = roomClaim(thompson(now));
    assert.ok(!doorKinds.has(c.kind), `at ${now} the claim was ${c.kind}`);
  }
});
