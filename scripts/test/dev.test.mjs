// The dev clock, and the promises js/dev.js makes about it.
//
// The panel itself needs a browser and is checked by driving the real app in
// scripts/shoot.mjs's harness. What is checkable here is the seam: that the
// clock is a real switch rather than a mock, that it defaults to the real one,
// and that js/dev.js is genuinely absent from what a student downloads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { clockIsPinned, now, pinClock } from '../../js/state.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('the clock is the real one until something pins it', () => {
  pinClock(null);
  assert.equal(clockIsPinned(), false);
  const before = Date.now();
  const drift = Math.abs(now().getTime() - before);
  assert.ok(drift < 1000, `the unpinned clock is ${drift} ms off the real one`);
});

test('a pinned clock is the same instant every time it is read', () => {
  const at = Date.parse('2026-11-26T11:00:00-05:00');
  pinClock(at);
  assert.equal(clockIsPinned(), true);
  assert.equal(now().getTime(), at);
  assert.equal(now().getTime(), at, 'it does not tick');
  // A Date, not a number, because every caller in js/app.js reads getDay,
  // getHours or hands it to isoDate.
  assert.ok(now() instanceof Date);
  assert.equal(now().getUTCDay(), 4, 'Thanksgiving 2026 is a Thursday');
  pinClock(null);
  assert.equal(clockIsPinned(), false, 'null goes back to the real clock');
});

test('a nonsense pin is refused rather than producing an Invalid Date', () => {
  // `new Date(NaN)` is a Date whose every getter is NaN, and it would spread
  // silently through isoDate into a query for room availability on "NaN-NaN".
  for (const bad of [NaN, undefined, 'Tuesday', Infinity]) {
    pinClock(bad);
    assert.equal(clockIsPinned(), false, String(bad));
    assert.ok(Number.isFinite(now().getTime()), String(bad));
  }
});

test('nothing in js/app.js reads the wall clock behind the app clock', () => {
  // This is the whole reason dev mode can exist at all. Eleven `new Date()`
  // calls used to sit in js/app.js, so a simulated minute would have been a lie
  // on whichever screen still called the real one.
  const app = read('js/app.js');
  const stripped = app.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(
    /new Date\(\s*\)/.test(stripped),
    false,
    'js/app.js calls new Date() directly again; it must read clockNow() so dev mode can move it',
  );
});

test('the clock is imported under a name that cannot shadow a local', () => {
  // Six functions in js/app.js hold a `const now`. Importing the clock as `now`
  // makes every one of them a temporal dead zone error at the line that reads
  // it, and the app does not boot at all.
  const app = read('js/app.js');
  assert.match(app, /now as clockNow/);
  assert.equal(/^\s*now,\s*$/m.test(app.slice(0, app.indexOf("} from './state.js';"))), false);
});

test('js/dev.js is never downloaded by a student who did not ask for it', () => {
  // It is loaded with import() from js/app.js and is deliberately not in the
  // service worker's shell list, so it costs the shipped app nothing.
  const html = read('index.html');
  assert.equal(html.includes('js/dev.js'), false, 'index.html loads dev.js as a script tag');
  // The list, not the file. sw.js explains next to SHELL_ASSETS why dev.js is
  // the one module left out of it, and naming it there tripped a raw substring
  // search over the whole file. Every comment in sw.js is a whole line, which
  // is the same seam scripts/test/sw.test.mjs cuts on.
  const sw = read('sw.js')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  // The WHOLE stripped file, not just the SHELL_ASSETS array. Narrowing to the
  // array was enough to stop the comment tripping it, and it quietly dropped two
  // real cases: dev.js added to WARM_ALWAYS, and a second addAll() in install
  // naming it. Both leave the module downloaded by a student who never asked for
  // it, which is the whole claim in this test's title, and both passed the
  // narrowed check. The comment strip alone fixes the false positive.
  assert.ok(/const SHELL_ASSETS = \[/.test(sw), 'no SHELL_ASSETS array in sw.js');
  assert.equal(sw.includes('dev.js'), false, 'sw.js downloads dev.js for a student who did not ask for it');
  assert.match(read('js/app.js'), /import\('\.\/dev\.js'\)/);
});

// ---- named scenes

// `?dev=1` opens the panel on the live minute, which at 10pm is a campus with
// every door shut: true, and nothing to look at. `?dev1` opens it standing
// somewhere, on a day, at a minute. The panel itself needs a browser; what is
// checkable here is the URL that arms it and the DATA the date is derived from.

test('a scene name is recognised in all three places it gets typed', () => {
  // The difference between ?dev=1 and ?dev1 is one character, and both get
  // typed. So does #dev1, because the app rewrites its own query string and the
  // hash is what survives a copied URL.
  const app = read('js/app.js');
  const body = app.slice(app.indexOf('function devScene('), app.indexOf('function openDev('));
  assert.match(body, /for \(const key of url\.keys\(\)\) if \(SCENE\.test\(key\)\) return key;/);
  assert.match(body, /url\.get\('dev'\)/);
  assert.match(body, /hash\.replace\(\/\^#\/, ''\)/);
  // And the plain panel is still the plain panel: ?dev=1 is not a scene, so it
  // must not match the pattern that names one.
  const SCENE = /^dev\d+$/;
  assert.equal(SCENE.test('1'), false, '?dev=1 would be read as a scene');
  assert.equal(SCENE.test('dev'), false);
  assert.ok(SCENE.test('dev1'));
  assert.ok(SCENE.test('dev12'));
});

test('a scene arms dev mode on its own, so one URL is the whole thing', () => {
  const app = read('js/app.js');
  const arm = app.slice(app.indexOf('function armDev('));
  assert.match(arm, /location\.hash === '#dev' \|\| scene/);
  assert.match(arm, /openDev\(scene\)/);
  assert.match(read('js/dev.js'), /export function start\(scene\)/);
});

test('a scene names its place by building code, and the code is a real one', () => {
  // A place the index does not have would leave the origin alone: a scene that
  // moved the clock and said nothing about it. js/dev.js falls back to the Oval
  // for that, and this checks the shipped scene never needs the fallback.
  const dev = read('js/dev.js');
  const scenes = dev.slice(dev.indexOf('const SCENES = {'), dev.indexOf('};', dev.indexOf('const SCENES = {')));
  const codes = [...scenes.matchAll(/place: '(\d+)'/g)].map((m) => m[1]);
  assert.ok(codes.length >= 1, 'no scene defines a place');

  const current = JSON.parse(read('data/current.json'));
  const buildings = JSON.parse(read(current.buildings)).buildings;
  const index = JSON.parse(read(current.rooms));
  for (const code of codes) {
    assert.ok(buildings[code], `building ${code} is not in ${current.buildings}`);
    const rooms = Object.values(index.rooms).filter((r) => r.b === code).length;
    // buildingOptions() only offers buildings that have rooms in the index, so
    // a scene pointing at a building with none would silently fall back.
    assert.ok(rooms > 0, `building ${code} has no rooms, so the panel never offers it`);
  }
  // The one Enes asked for.
  assert.equal(buildings['279'].name, 'Dreese Laboratories');
});

test('the term ships a day every scene can land on', () => {
  // The DATE is derived rather than written down: a literal 2026-09-17 in
  // js/dev.js would name a Thursday in a term that has ended the moment the next
  // one ships, with nothing to catch it. js/dev.js walks the teaching range for
  // the first weekday that is neither closed nor inside exams; this checks the
  // shipped calendar still answers that question, for every day a scene asks
  // for, and re-derives it the same way rather than trusting the file.
  const dev = read('js/dev.js');
  assert.match(dev, /if \(closed\[date\]\) continue;/);
  assert.match(dev, /date >= exams\.start && date <= exams\.end\) continue;/);

  const current = JSON.parse(read('data/current.json'));
  const index = JSON.parse(read(current.rooms));
  const [from, to] = index.teaching;
  const closed = index.closed ?? {};
  const exams = index.exams;
  const iso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const scenes = dev.slice(dev.indexOf('const SCENES = {'), dev.indexOf('};', dev.indexOf('const SCENES = {')));
  const days = [...scenes.matchAll(/day: (\d)/g)].map((m) => Number(m[1]));
  assert.ok(days.length >= 1, 'no scene names a day');

  for (const day of days) {
    let found = null;
    const end = new Date(`${to}T12:00`);
    for (const d = new Date(`${from}T12:00`); d <= end; d.setDate(d.getDate() + 1)) {
      if (d.getDay() !== day) continue;
      const date = iso(d);
      if (closed[date]) continue;
      if (exams?.start && date >= exams.start && date <= exams.end) continue;
      found = date;
      break;
    }
    assert.ok(found, `${current.termName} has no teaching day ${day} that is open`);
    assert.equal(new Date(`${found}T12:00`).getDay(), day);
    assert.ok(found >= from && found <= to, `${found} is outside the teaching range`);
  }
});

test('the dev seam is three exports and no more', () => {
  // A widening seam is how a debug tool ends up load bearing. If this grows,
  // the thing to ask is whether the app grew a state the screens cannot reach.
  const app = read('js/app.js');
  const named = [...app.matchAll(/^export (?:function |\{ )(\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(named.sort(), ['devApply', 'devReadout', 'state']);
});
