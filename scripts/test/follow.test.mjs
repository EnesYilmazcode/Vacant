// The location watch, and the four things it is not allowed to do.
//
// Offline, no DOM, no phone. The decisions are pure and live in js/state.js for
// that reason; the wiring that consults them is read out of js/app.js as text,
// the way every other app.js behaviour in this suite is, because that file
// reaches for `document` at import time and cannot be imported here.
//
// Why this file is as long as it is. Issue #87 is a change to what the app does
// while nobody is holding a phone in front of it, and the one measurement that
// would settle it — battery over a fifteen minute walk — has not been taken.
// These tests are the only evidence there is, so each gate gets one that fails
// if the gate is deleted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WALK_MPM } from '../../js/engine.js';
import { FOLLOW_M, FOLLOW_MS, createWatch, followAction, followFix } from '../../js/state.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = readFileSync(join(ROOT, 'js', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const STATE = readFileSync(join(ROOT, 'js', 'state.js'), 'utf8').replace(/\r\n/g, '\n');

// A phone on the list screen with nothing under a thumb. Every gate test below
// starts from this and turns exactly one thing on, so a test that goes green
// for the wrong reason has nowhere to hide.
const idle = { screen: 'list', selected: null, dragging: false, picked: false, scrolled: false };

// ------------------------------------------------------------- the thresholds

test('the move threshold is 40 m, under the accuracy line the app itself draws', () => {
  assert.equal(FOLLOW_M, 40);
  // COARSE_M is where js/app.js stops trusting a fix enough to print a plain
  // number and starts printing "~4 min". A follow threshold above it would be
  // re-ranking on readings the app has already called too loose to quote.
  const coarse = Number(APP.match(/const COARSE_M = (\d+);/)?.[1]);
  assert.equal(coarse, 75);
  assert.ok(FOLLOW_M < coarse, `FOLLOW_M ${FOLLOW_M} is above the coarse-fix line ${coarse}`);

  // And it is under a walk minute, which is what the threshold is spending. At
  // the engine's 78 m per minute, 40 m is 0.51 of one, so no figure on screen
  // can be a whole minute stale inside the threshold.
  assert.ok(FOLLOW_M / WALK_MPM < 1, `${FOLLOW_M} m is a whole walk minute at ${WALK_MPM} m/min`);
  assert.equal(Number((FOLLOW_M / WALK_MPM).toFixed(2)), 0.51);
});

test('the time floor is longer than a fix and shorter than the distance takes to cover', () => {
  // A watch on a phone delivers about one position a second. The floor exists
  // so a stationary phone whose readings wander cannot re-rank on every one of
  // them, and it must stay well under the 31 seconds a walking student needs to
  // cover FOLLOW_M, or it would be the binding gate instead of the distance.
  const secondsToCover = (FOLLOW_M / WALK_MPM) * 60;
  assert.ok(FOLLOW_MS >= 1000, 'the floor is shorter than the gap between fixes');
  assert.ok(FOLLOW_MS / 1000 < secondsToCover, 'the clock, not the distance, decides when to re-rank');
});

// ----------------------------------------------------------------- followFix

test('a fix that has not moved far enough does nothing', () => {
  assert.equal(followFix({ movedM: FOLLOW_M - 1, sinceMs: 60000 }), false);
  assert.equal(followFix({ movedM: 0, sinceMs: 60000 }), false);
  assert.equal(followFix({ movedM: FOLLOW_M, sinceMs: 60000 }), true);
  assert.equal(followFix({ movedM: 400, sinceMs: 60000 }), true);
});

test('a fix that arrives too soon does nothing however far it moved', () => {
  assert.equal(followFix({ movedM: 5000, sinceMs: FOLLOW_MS - 1 }), false);
  assert.equal(followFix({ movedM: 5000, sinceMs: FOLLOW_MS }), true);
});

test('the first fix of a session passes both gates', () => {
  // js/app.js has no previous position to measure against and hands in Infinity
  // for both, which is the only way a walk can start being followed at all.
  assert.equal(followFix({ movedM: Infinity, sinceMs: Infinity }), true);
});

test('a malformed fix fails closed rather than reading as movement', () => {
  // `movedM < minM` would have let every one of these through as "moved far
  // enough", which is a re-rank on a position that does not exist.
  assert.equal(followFix({ movedM: NaN, sinceMs: 60000 }), false);
  assert.equal(followFix({ movedM: undefined, sinceMs: 60000 }), false);
  assert.equal(followFix({ movedM: 5000, sinceMs: NaN }), false);
  assert.equal(followFix({}), false);
});

// --------------------------------------------------------------- the gates
//
// One test per line of the issue's list. Delete the branch each names from
// followAction and its test is the one that goes red.

test('an idle, untouched list re-ranks', () => {
  assert.equal(followAction(idle), 'rank');
  assert.equal(followAction({ ...idle, screen: 'near' }), 'rank');
  // The question screen ranks too: nothing is on screen to lose, and the list
  // behind it is what the next tap opens.
  assert.equal(followAction({ ...idle, screen: 'ask' }), 'rank');
});

test('the room screen never re-ranks', () => {
  // "The user has chosen. Update the map dot and the walk minutes in place;
  // leave the ranking alone." The dot needs nothing from this function, and
  // 'room' is what redraws the minutes without touching the order.
  assert.equal(followAction({ ...idle, screen: 'room' }), 'room');
  // Opening a room always selects its row, so a room screen tested for
  // selection before screen would answer 'hold' and the walk on the screen the
  // student is reading would never move. The order of the tests is the rule.
  assert.equal(followAction({ ...idle, screen: 'room', selected: { id: 'X' } }), 'room');
  assert.notEqual(followAction({ ...idle, screen: 'room' }), 'rank');
});

test('a selected row holds the order', () => {
  assert.equal(followAction({ ...idle, selected: { id: 'RM0001' } }), 'hold');
  // Zero and the empty string are not selections, but they are falsy, and a
  // `selected` test written as a truth test would re-rank under a row id of 0.
  assert.equal(followAction({ ...idle, selected: 0 }), 'hold');
  assert.equal(followAction({ ...idle, selected: '' }), 'hold');
});

test('a finger on the sheet holds the order, wherever it is', () => {
  // This is the sentence refresh() is written around: a list that re-sorts
  // under a thumb loses the row somebody was reaching for.
  assert.equal(followAction({ ...idle, dragging: true }), 'hold');
  assert.equal(followAction({ ...idle, screen: 'near', dragging: true }), 'hold');
  // Including on the room screen, where the repaint it would otherwise get
  // rewrites the markup under the finger that is dragging the sheet.
  assert.equal(followAction({ ...idle, screen: 'room', dragging: true }), 'hold');
});

test('a scrolled list is a touched list', () => {
  // "Re-rank freely when the list is idle and untouched." Rows under the fold
  // are rows somebody scrolled to see, and answer() paints from the top, so a
  // re-rank here takes both the order and their place in it.
  assert.equal(followAction({ ...idle, scrolled: true }), 'hold');
  assert.equal(followAction({ ...idle, screen: 'near', scrolled: true }), 'hold');
});

test('a picked origin stops the watch instead of being overwritten', () => {
  // A deliberate choice is not a sensor reading. This is the first test in the
  // function, so it holds on every screen and under every other condition.
  assert.equal(followAction({ ...idle, picked: true }), 'stop');
  assert.equal(followAction({ ...idle, screen: 'room', picked: true }), 'stop');
  assert.equal(followAction({ ...idle, dragging: true, picked: true }), 'stop');
  for (const screen of ['ask', 'list', 'near', 'room', 'pick', 'about']) {
    assert.equal(followAction({ ...idle, screen, picked: true }), 'stop');
  }
});

test('the picker and the about pane hold, because the list is not what is on screen', () => {
  assert.equal(followAction({ ...idle, screen: 'pick' }), 'hold');
  assert.equal(followAction({ ...idle, screen: 'about' }), 'hold');
  // answer() reframes the map camera on the new origin and repaints a list
  // nobody can see. Neither is worth doing while somebody types a building name.
  assert.notEqual(followAction({ ...idle, screen: 'pick' }), 'rank');
});

// ------------------------------------------------------- the wiring, as text

test('the watch exists at all', () => {
  // `grep -rn "watchPosition" js/` returned nothing when #87 was filed, which is
  // the whole bug: one fix at boot, and every walk figure for the rest of the
  // session measured from a place the student had already left.
  // The calls moved into createWatch when the handle was extracted, so what
  // app.js has to show now is that it injects the real geolocation object.
  assert.match(APP, /createWatch\(\{/, 'nothing opens a watch any more');
  assert.match(APP, /geolocation: \(\) => navigator\.geolocation/, 'the watch is wired to something other than the phone');
  assert.match(STATE, /watchPosition\(onFix, onError, options\)/);
  assert.match(STATE, /clearWatch\(id\)/, 'clearWatch is not being handed the handle it opened');
});

test('the watch stays coarse and refuses a cached fix', () => {
  // The options are the config createWatch is built with now, not a literal
  // inside startWatch. Read them there; the behavioural test further down
  // proves they reach watchPosition.
  const start = APP.slice(APP.indexOf('const watch = createWatch({'), APP.indexOf('function startWatch()'));
  assert.ok(start.length > 0, 'the watch config moved');
  // High accuracy is what holds the GPS chip awake. Campus-scale ranking has
  // never needed 5 m, and this flag is the one that would show up on a battery
  // screen. It was false before the watch and it stays false.
  assert.match(start, /enableHighAccuracy: false/);
  assert.doesNotMatch(start, /enableHighAccuracy: true/);
  // maximumAge 0 on the watch, because a minute-old position is precisely the
  // staleness being removed: 78 m of walking at WALK_MPM, nearly two FOLLOW_M.
  assert.match(start, /maximumAge: 0/);
  // And 60 s kept on the boot fix, where a cached position buys a first answer
  // sooner and the student has not walked anywhere yet.
  const boot = APP.slice(APP.indexOf('function locate()'), APP.indexOf('const watch = createWatch({'));
  assert.match(boot, /enableHighAccuracy: false, timeout: FIX_TIMEOUT_MS, maximumAge: 60000/);
});

test('every gate is consulted before the fix is written, and only one branch re-ranks', () => {
  const fix = APP.slice(APP.indexOf('function onFix(p)'), APP.indexOf('function follow(origin)'));
  assert.ok(fix.length > 0, 'onFix moved');
  // The gate is asked with the four things it decides on, and it is asked
  // before useOrigin writes anything.
  assert.match(fix, /followAction\(\{/);
  assert.match(fix, /screen: state\.screen/);
  assert.match(fix, /selected: state\.selected/);
  assert.match(fix, /dragging: state\.dragging/);
  assert.match(fix, /picked: state\.origin\?\.source === 'picked'/);
  assert.match(fix, /scrolled: PANES\.some\(/);
  assert.ok(fix.indexOf('followAction') < fix.indexOf('useOrigin('), 'the fix is written before the gate is asked');

  // Exactly one call to the recompute path, and it is inside the 'rank' branch.
  assert.equal(fix.match(/refresh\(\)/g)?.length, 1);
  assert.match(fix, /if \(act === 'rank'\) refresh\(\);/);
  assert.match(fix, /else if \(act === 'room'\) repaintRoom\(\);/);
  assert.match(fix, /if \(act === 'stop'\) return stopWatch\(\);/);
  // Nothing else in here paints the list. 'hold' has to mean the order stands.
  assert.doesNotMatch(fix, /paintList\(\)|answer\(\)/);

  // The throttle is applied to the position, not to the timer, and both gates
  // go in: distance since the last position acted on, and time since it.
  assert.match(fix, /followFix\(\{\s*movedM: lastFix \? distanceMetres\(lastFix, here\) : Infinity,\s*sinceMs: lastFix \? at - lastFixAt : Infinity,/);
});

test('the off-campus circle runs on every accepted position, not only the first', () => {
  // #87 names this: a student who walks out of OFF_CAMPUS_KM with the app open
  // used to keep a ranking measured from the last point inside it, and never
  // saw the note. One function, called from both paths.
  assert.match(APP, /const offCampus = \(here\) =>/);
  const boot = APP.slice(APP.indexOf('function locate()'), APP.indexOf('function startWatch()'));
  assert.match(boot, /if \(offCampus\(here\)\) return finish\(oval, NO_WALK_OVAL\);/);
  const fix = APP.slice(APP.indexOf('function onFix(p)'), APP.indexOf('function follow(origin)'));
  assert.match(fix, /const far = offCampus\(here\);/);
  assert.match(fix, /far \? ovalOrigin\(\) :/);
  assert.match(fix, /far \? NO_WALK_OVAL : null/);
});

test('the circle it draws is the one the constant is documented against', () => {
  // The rule is lifted out of js/app.js and run, the way the origin bar's is:
  // the expression is pure, so it can be pulled out of the source and handed
  // its own constants.
  const km = APP.match(/const OFF_CAMPUS_KM = ([\d.]+);/);
  const oval = APP.match(/const OVAL = \{ lat: ([-\d.]+), lon: ([-\d.]+) \};/);
  const line = APP.match(/const offCampus = \(here\) => .*;/);
  assert.ok(km && oval && line, 'the off-campus circle moved');
  const test = new Function(
    `const OFF_CAMPUS_KM = ${km[1]}; const OVAL = { lat: ${oval[1]}, lon: ${oval[2]} }; ${line[0]} return offCampus;`,
  )();
  const OVAL = { lat: Number(oval[1]), lon: Number(oval[2]) };
  assert.equal(test(OVAL), false, 'the Oval itself is off campus');
  // A tenth of a degree of latitude is 11.1 km, which is Cleveland by the
  // standards of this circle. The 2.2 km constant is measured in js/app.js
  // against Animal Science at 1.410 km, so a point inside that stays inside.
  assert.equal(test({ lat: OVAL.lat + 0.1, lon: OVAL.lon }), true);
  assert.equal(test({ lat: OVAL.lat + 0.01, lon: OVAL.lon }), false, '1.11 km out is off campus');
});

test('the watch starts after the first fix and stops with the page', () => {
  // Started AFTER the boot fix rather than beside it: two position callbacks
  // racing to be the first origin is two answers to the question the app opens
  // with.
  const boot = APP.slice(APP.indexOf('async function boot()'));
  assert.match(boot, /useOrigin\(located\.origin, located\.note\);\n  follow\(located\.origin\);/);

  const hook = APP.slice(APP.indexOf("addEventListener('visibilitychange'"));
  const body = hook.slice(0, hook.indexOf('});'));
  // A background watch is a battery complaint, and nothing on a hidden page can
  // be re-ranked anyway.
  assert.match(body, /if \(document\.visibilityState !== 'visible'\) return stopWatch\(\);/);
  assert.match(body, /startWatch\(\);/);
  assert.ok(body.indexOf('stopWatch()') < body.indexOf('startWatch()'), 'the hidden branch stopped guarding');
});

test('a picked origin is never followed and never overwritten', () => {
  // Not merely ignored on arrival: the watch is never opened, so a student who
  // picked a building pays no battery for a position nothing will read. The
  // refusal is createWatch's now, and the behavioural test above runs it.
  assert.match(STATE, /if \(origin\.source === 'picked'\) return 'picked';/);
  // And a pick made MID-SESSION closes a watch that is already open, rather
  // than waiting for a position to arrive and be judged -- which, with
  // maximumAge 0 and no timeout, may be minutes away or never.
  const pick = APP.slice(APP.indexOf('function pickBuilding(code)'), APP.indexOf('function pickBuilding(code)') + 1400);
  assert.match(pick, /stopWatch\(\);\n  useOrigin\(origin, null\);/, 'a mid-session pick leaves the watch running');
  // pickedOrigin() still short-circuits before geolocation is asked at all,
  // which is the same rule one layer up.
  const locate = APP.slice(APP.indexOf('function locate()'), APP.indexOf('const watch = createWatch({'));
  assert.match(locate, /const picked = pickedOrigin\(\);\n  if \(picked\) return Promise\.resolve/);
});

test('a denied permission closes the watch rather than leaving it open', () => {
  const err = APP.slice(APP.indexOf('function onWatchError(err)'), APP.indexOf('function onFix(p)'));
  // Code 1 is terminal on iOS: there is no way back to the prompt from inside a
  // web page, so nothing will ever arrive on this callback again.
  assert.match(err, /if \(err\?\.code === 1\) stopWatch\(\);/);
  // Every other code is a fix that did not turn up, and the origin already on
  // screen is better than the Oval. Nothing is thrown away for a timeout.
  assert.doesNotMatch(err, /useOrigin|ovalOrigin/);
});

test('the finger flag goes down with the pointer and comes back up with it', () => {
  const sheet = APP.slice(APP.indexOf('function attachSheet()'), APP.indexOf('// ---------------------------------------------------------------- answering'));
  assert.ok(sheet.length > 0, 'attachSheet moved');
  // Down on pointerdown, not on the first 8px of travel: the row somebody is
  // reaching for is under their finger before they have moved it.
  assert.match(sheet, /const begin = \(e, mode\) => \{\n    swallow = false;\n(?:\s*\/\/.*\n)*\s*state\.dragging = true;/);
  // And cleared on every way a gesture can end, including the three that do not
  // reach the end of end(): a pane that takes the gesture back, a pointerup that
  // arrives with no drag on it, and a mouse released off the sheet, which is the
  // one case with no implicit pointer capture behind it. Left true, the list
  // freezes for the rest of the session.
  assert.equal(sheet.match(/state\.dragging = false;/g)?.length, 4);
  assert.match(sheet, /window\.addEventListener\('pointerup', release\);/);
  assert.match(sheet, /window\.addEventListener\('pointercancel', release\);/);
  assert.match(APP, /sheet\.addEventListener\('pointercancel', end\);/);
});

test('the room repaint moves the numbers and not the order', () => {
  const repaint = APP.slice(APP.indexOf('function repaintRoom()'), APP.indexOf('function showRoom(id'));
  assert.ok(repaint.length > 0, 'repaintRoom moved');
  // The one thing this function is forbidden to do.
  assert.doesNotMatch(repaint, /answer\(\)|refresh\(\)|paintList\(\)|state\.results =|\.sort\(/);
  // Both numbers on the screen are measured from the origin: the walk minutes,
  // and the "yours for" duration in the claim, which subtracts the walk from
  // the window. Rewriting one and not the other is two answers to one question.
  assert.match(repaint, /const metres = Math\.round\(distanceMetres\(state\.origin, b\)\);/);
  assert.match(repaint, /const walk = walkMinutes\(metres\);/);
  assert.match(repaint, /state\.selected\.metres = metres;/);
  assert.match(repaint, /state\.selected\.walk = walk;/);
  // Nothing is redrawn for a number that came back the same, because the
  // repaint costs the reader their place in the day grid.
  assert.match(repaint, /if \(walk === state\.selected\.walk\) return;/);
  // And what the reader had is put back: the scroll position and the focus.
  assert.match(repaint, /\$\('room'\)\.scrollTop = at;/);
  assert.match(repaint, /focus\(\{ preventScroll: true \}\)/);
  // The handlers go back on through the same function showRoom uses, so a
  // repaint cannot leave the day arrows dead.
  assert.match(repaint, /wireRoom\(id\);/);
  const show = APP.slice(APP.indexOf('function showRoom(id'), APP.indexOf('function toAsk()'));
  assert.match(show, /wireRoom\(id\);/);
});

test('the privacy page describes the watch, not the single fix it used to take', () => {
  // The page said "The app asks for it once and does not keep watching", which
  // this change makes false. A privacy page that is wrong about the sensor is
  // worse than no page, and it is the one document a suspicious student reads.
  const privacy = readFileSync(join(ROOT, 'privacy.html'), 'utf8');
  assert.doesNotMatch(privacy, /does not keep watching/);
  assert.doesNotMatch(privacy, /asks for it once/);
  // Wrapped at 80 columns like the rest of the file, so every match here is
  // whitespace-tolerant rather than pinned to where the line happens to break.
  assert.match(privacy, /followed while the app is on\s+screen/);
  // Both promises the code actually keeps: the watch stops with the page, and a
  // picked building is never followed.
  assert.match(privacy, /stops the moment you switch away or lock\s+the\s+phone/);
  assert.match(privacy, /never starts at all if you picked a building by\s+hand/);
});

test('refresh is still never on a timer', () => {
  // The watch is not a timer and must not become one. Nothing in js/app.js may
  // schedule a recompute: a list that re-sorts on a clock re-sorts under a
  // thumb, which is the comment refresh() carries and the reason every gate
  // above exists.
  const code = APP.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /setInterval\(/);
  assert.doesNotMatch(code, /setTimeout\([^)]*refresh/);
  assert.match(APP, /\/\/ Recompute\. Never on a timer/);
});

// ---------------------------------------------------------------- the handle
//
// Everything above this line reads js/app.js as text, which is the best the
// suite could do while the handle lived there. Reviewed with 26 mutations, five
// survived: clearWatch(0), the missing double-start guard, the un-nulled handle,
// and both halves of the throttle. Every one is a battery or staleness bug that
// a green regex suite would have shipped. createWatch takes the geolocation
// object and the visibility predicate, so these run it for real.

function fakeGeo() {
  const calls = { watch: [], clear: [] };
  let next = 0;
  return {
    calls,
    watchPosition(onFix, onErr, opts) { calls.watch.push({ onFix, onErr, opts }); return next++; },
    clearWatch(id) { calls.clear.push(id); },
  };
}
const shown = () => true;
const gps = { lat: 39.9995, lon: -83.013, source: 'gps' };

test('the handle it clears is the handle it opened', () => {
  // clearWatch(0) passes every source scan ever written and stops nothing. It is
  // the headline battery risk in #87 and it survived the first suite.
  const geo = fakeGeo();
  geo.watchPosition = () => 7;
  const w = createWatch({ geolocation: () => geo, visible: shown, onFix() {}, onError() {} });
  w.start(gps);
  assert.equal(w.id, 7);
  w.stop();
  assert.deepEqual(geo.calls.clear, [7], 'the watch was cleared by a handle it never held');
});

test('a second start cannot open a second watch', () => {
  const geo = fakeGeo();
  const w = createWatch({ geolocation: () => geo, visible: shown, onFix() {}, onError() {} });
  assert.equal(w.start(gps), 'open');
  assert.equal(w.start(gps), 'already-open');
  assert.equal(w.start(gps), 'already-open');
  assert.equal(geo.calls.watch.length, 1, 'two live watches is twice the battery and invisible in testing');
});

test('stopping drops the handle, so the watch can come back', () => {
  const geo = fakeGeo();
  const w = createWatch({ geolocation: () => geo, visible: shown, onFix() {}, onError() {} });
  w.start(gps);
  w.stop();
  assert.equal(w.open, false);
  assert.equal(w.start(gps), 'open', 'a handle left set refuses every restart for the session');
  assert.equal(geo.calls.watch.length, 2);
});

test('a throw inside clearWatch still drops the handle', () => {
  const geo = fakeGeo();
  geo.clearWatch = () => { throw new Error('locked down'); };
  const w = createWatch({ geolocation: () => geo, visible: shown, onFix() {}, onError() {} });
  w.start(gps);
  assert.equal(w.stop(), 'stopped');
  assert.equal(w.open, false, 'a failed stop must not strand the handle');
});

test('a hidden page never opens a watch', () => {
  // The reachable leak: switch away inside the 8 s boot-fix window and follow()
  // lands on a backgrounded page, after visibilitychange has already fired.
  const geo = fakeGeo();
  const w = createWatch({ geolocation: () => geo, visible: () => false, onFix() {}, onError() {} });
  assert.equal(w.start(gps), 'hidden');
  assert.equal(geo.calls.watch.length, 0, 'a sensor held open on a phone in a pocket');
});

test('a picked origin is refused, and no origin at all is refused', () => {
  const geo = fakeGeo();
  const w = createWatch({ geolocation: () => geo, visible: shown, onFix() {}, onError() {} });
  assert.equal(w.start({ ...gps, source: 'picked' }), 'picked');
  assert.equal(w.start(null), 'no-origin');
  assert.equal(geo.calls.watch.length, 0);
});

test('the watch stays coarse and refuses a cached fix, read off the options it is given', () => {
  const geo = fakeGeo();
  const w = createWatch({ geolocation: () => geo, visible: shown, onFix() {}, onError() {},
    options: { enableHighAccuracy: false, maximumAge: 0 } });
  w.start(gps);
  assert.equal(geo.calls.watch[0].opts.enableHighAccuracy, false, 'high accuracy is what drains the phone');
  assert.equal(geo.calls.watch[0].opts.maximumAge, 0);
});

test('an unsupported or throwing geolocation leaves no handle behind', () => {
  const bare = createWatch({ geolocation: () => ({}), visible: shown, onFix() {}, onError() {} });
  assert.equal(bare.start(gps), 'unsupported');
  assert.equal(bare.open, false);
  const thrower = createWatch({ geolocation: () => ({ watchPosition() { throw new Error('no'); } }),
    visible: shown, onFix() {}, onError() {} });
  assert.equal(thrower.start(gps), 'threw');
  assert.equal(thrower.open, false, 'a throw must not leave the app believing a watch is live');
  assert.equal(thrower.stop(), 'closed');
});

test('js/app.js owns no watch handle of its own any more', () => {
  // The extraction is the point: a handle back in app.js is a handle only a
  // regex can see.
  assert.doesNotMatch(APP, /let watchId/, 'the handle is back in a file the tests cannot run');
  assert.match(APP, /createWatch\(\{/, 'app.js stopped using the state machine');
  assert.match(APP, /visible: \(\) =>/, 'the visibility predicate is not injected, so it cannot be tested');
});

test('privacy.html describes the position handoff it actually makes', () => {
  const privacy = readFileSync(join(ROOT, 'privacy.html'), 'utf8');
  const install = readFileSync(join(ROOT, 'js', 'install.js'), 'utf8');
  // mapsHref puts the real gps lat,lon into saddr / origin on an outbound URL.
  // The page said the position was "never put in a URL", which was written
  // before the Directions button and was false the moment it shipped.
  assert.match(install, /const from = origin\?\.source === 'gps'/, 'mapsHref stopped sending the origin');
  assert.doesNotMatch(privacy, /never put in a URL/, 'the page is back to claiming something mapsHref disproves');
  assert.match(privacy, /Directions/, 'the page does not mention the one handoff it makes');
  // And the file count, which was four and has been twelve for a long time.
  const files = readdirSync(join(ROOT, 'js')).filter((f) => f.endsWith('.js')).length;
  assert.match(privacy, new RegExp(`${['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve'][files] ?? files} JavaScript files`),
    `privacy.html does not say there are ${files} JavaScript files`);
});
