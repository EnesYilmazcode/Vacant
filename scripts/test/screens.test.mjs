// Offline. Fixtures plus the committed data, no network and no DOM.
//
// These cover the screens' decisions, not their markup: which state the app is
// in, what a row is allowed to say, and what the diagnostics block gives a
// maintainer. The one thing they exist for above all is the exam-week refusal,
// which cannot be reached by opening the app in August.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  MINUTES_IN_DAY,
  allWeekCodes,
  busyDayOf,
  clock,
  closedDayFor,
  diagnosticsBlock,
  inScheduledHours,
  inTermOn,
  indexFloorCheck,
  isoDate,
  nextOpening,
  openDoorCount,
  openingPhrase,
  rankBuildings,
  resolveState,
  roomsPerBuilding,
  scheduleDarkOn,
  scheduleShareOn,
  staleness,
  unscheduledGate,
  windowPhrase,
} from '../../js/state.js';
import { roomClaim } from '../../js/claim.js';
import { PACKUP, calendarOn, rank, refusalFor, usableMinutes } from '../../js/engine.js';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = (f) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));

const CURRENT = read('data/current.json');
const INDEX = read('data/rooms-1268.json');
const SLICE = read('data/buildings-1268.json').buildings;
const FULL = read('data/buildings.json').buildings;
const HOURS = read('data/buildings-hours.json');

// Local midnight, because every state decision is made against a wall clock the
// student is standing in, not against UTC.
const at = (iso, h = 12, m = 0) => {
  const [y, mo, d] = iso.split('-').map(Number);
  return new Date(y, mo - 1, d, h, m);
};

// The calendar the term index is meant to carry once the harvest emits it. The
// dates are the real Autumn 2026 ones from the issue.
const CAL = {
  ...INDEX,
  exams: { start: '2026-12-11', end: '2026-12-17' },
  closed: {
    '2026-09-07': { state: 'offices-closed', name: 'Labor Day' },
    '2026-10-15': { state: 'no-classes', name: 'Autumn break' },
    '2026-10-16': { state: 'no-classes', name: 'Autumn break' },
  },
  lowConfidence: [{ start: '2026-10-13', end: '2026-10-16', why: 'session 1 finals' }],
  sessions: INDEX.sessions.map((s) => (s[1] === '2026-12-11' ? ['2026-08-10', '2026-12-09'] : s)),
};
const CUR = { ...CURRENT, instruction: ['2026-08-10', '2026-12-09'] };

// ------------------------------------------------------------------ #19 state

test('exam week refuses, and names the day it can answer again', () => {
  const s = resolveState({ now: at('2026-12-15'), current: CUR, index: CAL });
  assert.equal(s.kind, 'EXAM_REFUSAL');
  assert.equal(s.ranked, false);
  assert.match(s.body, /Dec 18/);
});

test('the exam check runs before the between-terms check', () => {
  // Finals sits outside every session range, so the naive order sends Dec 11 to
  // 17 to "campus is empty", which reads as every room being free.
  const withNext = { ...CUR, next: { termName: 'Spring 2027', instruction: ['2027-01-11', '2027-04-24'] } };
  for (const day of ['2026-12-11', '2026-12-13', '2026-12-17']) {
    assert.equal(resolveState({ now: at(day), current: withNext, index: CAL }).kind, 'EXAM_REFUSAL');
  }
});

test('a closed campus is one message and no ranked rows', () => {
  const s = resolveState({ now: at('2026-09-07'), current: CUR, index: CAL });
  assert.equal(s.kind, 'CAMPUS_CLOSED');
  assert.equal(s.ranked, false);
  assert.match(s.heading, /Labor Day/);
});

test('a no-classes day still ranks, and says why campus is quiet', () => {
  const s = resolveState({ now: at('2026-10-15'), current: CUR, index: CAL });
  assert.equal(s.kind, 'RANKED');
  assert.equal(s.ranked, true);
  assert.match(s.note, /quiet/);
  // Oct 15 sits in both tables. One message, not two stacked banners.
  assert.doesNotMatch(s.note, /Session 1/);
});

test('the low-confidence window names both failure modes', () => {
  for (const day of ['2026-10-13', '2026-10-14']) {
    const s = resolveState({ now: at(day), current: CUR, index: CAL });
    assert.equal(s.ranked, true);
    assert.match(s.note, /finals/i);
    assert.match(s.note, /full term/i);
  }
});

test('between terms names the last class, the next start and the gap', () => {
  const withNext = { ...CUR, next: { termName: 'Spring 2027', instruction: ['2027-01-11', '2027-04-24'] } };
  const s = resolveState({ now: at('2026-12-20'), current: withNext, index: CAL });
  assert.equal(s.kind, 'BETWEEN_TERMS');
  assert.equal(s.ranked, false);
  assert.match(s.body, /Dec 9/);
  assert.match(s.body, /Jan 11/);
  assert.match(s.body, /22 days/);
  assert.ok(s.action, 'between terms offers the nearest buildings');
});

test('with no next term it is TERM_ENDED, and it prints when it last checked', () => {
  const s = resolveState({ now: at('2026-12-20'), current: CUR, index: CAL });
  assert.equal(s.kind, 'TERM_ENDED');
  assert.equal(s.ranked, false);
  assert.match(s.detail, new RegExp(CUR.generated));
  // Between-terms is not staleness and must not borrow its words.
  const between = resolveState({
    now: at('2026-12-20'),
    current: { ...CUR, next: { instruction: ['2027-01-11', '2027-04-24'] } },
    index: CAL,
  });
  const shared = s.body.split('. ').filter((line) => between.body.includes(line));
  assert.deepEqual(shared, []);
});

test('an index under its term-digit floor refuses and prints observed against expected', () => {
  const rooms = Object.fromEntries(Object.entries(INDEX.rooms).slice(0, 198));
  const s = resolveState({ now: at('2026-09-04'), current: CUR, index: { ...CAL, rooms } });
  assert.equal(s.kind, 'INDEX_REFUSED');
  assert.equal(s.ranked, false);
  assert.equal(s.detail, 'rooms 198 < 400');
});

test('the floor is per term digit, so a Summer index is not held to a full term', () => {
  // Measured on the shipped builds: 871 rooms for 1268, 884 for 1262, 206 for
  // the much smaller Summer 1264.
  const rooms = Object.fromEntries(Object.entries(INDEX.rooms).slice(0, 206));
  assert.equal(indexFloorCheck({ term: '1264', rooms }).ok, true);
  assert.equal(indexFloorCheck({ term: '1262', rooms }).ok, false);
});

test('staleness climbs at 14 and 35 days, and past the term it gates', () => {
  const gen = (days) => {
    const d = new Date(2026, 8, 4);
    d.setDate(d.getDate() - days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T07:00:00Z`;
  };
  const level = (days) =>
    staleness({ now: at('2026-09-04'), current: { ...CUR, generated: gen(days) } }).level;
  assert.equal(level(13), 'silent');
  assert.equal(level(14), 'line');
  assert.equal(level(34), 'line');
  assert.equal(level(35), 'banner');
  assert.equal(staleness({ now: at('2026-12-20'), current: CUR }).level, 'gated');
});

test('resolveState is pure: the same inputs twice give the same answer', () => {
  const args = { now: at('2026-12-15'), current: CUR, index: CAL };
  assert.deepEqual(resolveState(args), resolveState(args));
});

// ------------------------------------------------------------ #20 unscheduled

test('the scheduled window is measured off the index when the build omits it', () => {
  // Re-measured on the shipped index after the published-hours rule cut it to
  // 425 rooms and 8,329 blocks. The weekday shares are Sun 0.00%, Mon 16.70%,
  // Tue 23.59%, Wed 21.34%, Thu 23.70%, Fri 14.61%, Sat 0.07%, so nothing sits
  // near the 1% line either side of it. latestEnd has moved twice now, 1230 to
  // 1225 to 1215, each time because rooms left and took part of the evening
  // tail with them. It is a quantile over the shipped file, not a constant.
  const busyDay = busyDayOf({}, INDEX);
  assert.deepEqual(busyDay.weekdays, [false, true, true, true, true, true, false]);
  assert.equal(busyDay.earliestStart, 480);
  assert.equal(busyDay.latestEnd, 1215);
});

test('current.json wins over the measurement when it carries busyDay', () => {
  const given = { earliestStart: 500, latestEnd: 1000, weekdays: [false, true, true, true, true, true, false] };
  assert.deepEqual(busyDayOf({ busyDay: given }, INDEX), given);
});

test('the unscheduled trigger flips when latestEnd moves', () => {
  const thu = at('2026-09-03', 21, 40);
  const early = { ...CUR, busyDay: { earliestStart: 480, latestEnd: 1290, weekdays: [false, true, true, true, true, true, false] } };
  const late = { ...CUR, busyDay: { ...early.busyDay, latestEnd: 1380 } };
  assert.equal(inScheduledHours({ now: thu, current: early, index: CAL }), false);
  assert.equal(inScheduledHours({ now: thu, current: late, index: CAL }), true);
});

test('a weekend evening is never in scheduled hours', () => {
  assert.equal(inScheduledHours({ now: at('2026-09-05', 20, 0), current: CUR, index: CAL }), false);
  assert.equal(inScheduledHours({ now: at('2026-09-03', 14, 2), current: CUR, index: CAL }), true);
});

test('a shut campus is not scheduled hours, but a no-classes day still is', () => {
  // Autumn break really does leave the buildings open, so the ranked list is
  // still the right answer there and the quiet-campus line says why.
  assert.equal(inScheduledHours({ now: at('2026-09-07', 12, 0), current: CUR, index: CAL }), false);
  assert.equal(inScheduledHours({ now: at('2026-10-15', 12, 0), current: CUR, index: CAL }), true);
});

test('a day whose sessions have all ended is not a scheduled day', () => {
  // The measurement, on the shipped index, that the threshold sits on. Every
  // weekday between the first and last day of instruction is either a day the
  // sessions cover or a day they have all left, and there is nothing in the
  // middle.
  //
  // Re-measured after the published-hours rule cut the index to 425 rooms. The
  // gap is now total rather than merely wide: the seven-session term collapsed
  // to three, because the four odd windows belonged to rooms in buildings the
  // Registrar publishes no hours for, so a dark day is exactly 0.000000 and the
  // thinnest teaching day is 0.9549. The 0.5% line has nothing anywhere near
  // it in either direction.
  const share = (iso, h = 12) => scheduleShareOn({ now: at(iso, h), index: INDEX });
  for (const iso of ['2026-12-10', '2026-12-11', '2026-12-14', '2026-12-15', '2026-08-17']) {
    assert.ok(share(iso) <= 0.0012, `${iso} came out ${share(iso)}`);
    assert.equal(scheduleDarkOn({ now: at(iso), index: INDEX }), true, iso);
  }
  for (const iso of ['2026-09-03', '2026-10-15', '2026-11-11', '2026-12-09']) {
    assert.ok(share(iso) >= 0.9, `${iso} came out ${share(iso)}`);
    assert.equal(scheduleDarkOn({ now: at(iso), index: INDEX }), false, iso);
  }
  // The two days either side of the gap. Mon Aug 24 is the day before
  // instruction starts and now carries no block at all; it used to carry two
  // small sessions in rooms that no longer ship. Wed Oct 14 is the thinnest
  // teaching day, in the week between the two seven-week sessions.
  assert.equal(share('2026-08-24'), 0, `Aug 24 came out ${share('2026-08-24')}`);
  assert.equal(scheduleDarkOn({ now: at('2026-08-24'), index: INDEX }), true);
  assert.ok(share('2026-10-14') > 0.95 && share('2026-10-14') < 0.96, `Oct 14 came out ${share('2026-10-14')}`);
  assert.equal(scheduleDarkOn({ now: at('2026-10-14'), index: INDEX }), false);
});

test('finals week does not rank rooms even with no exam window in the data', () => {
  // The mechanism the exam refusal needs is a calendar the harvest emits, and
  // an index that has not got one yet must not fall through to "871 rooms free"
  // with a 727 seat lecture hall at the top. It cannot name the reason, but it
  // can see its own schedule has gone dark, and refusing on that is the whole
  // point: this used to rank and lean on inScheduledHours to route the answer
  // somewhere honest, which is two verdicts about one question.
  // The shipped index does carry one now, which is what the harvest was changed
  // to emit, so the fallback is tested against a copy with it taken back out.
  assert.ok(INDEX.exams, 'the shipped index is meant to carry an exam window');
  const NO_EXAMS = { ...INDEX };
  delete NO_EXAMS.exams;
  // What must hold on the shipped data is the REFUSAL. Which refusal it is
  // moved when the published-hours rule ran: the sessions that used to stretch
  // instruction to 2026-12-11 lived in rooms that no longer ship, so the term
  // now ends on the 9th and both dates below are out of term. TERM_ENDED is the
  // more specific answer and the app is right to give it.
  for (const iso of ['2026-12-10', '2026-12-11']) {
    const s = resolveState({ now: at(iso), current: CURRENT, index: NO_EXAMS });
    assert.equal(s.ranked, false, `${iso} still ranks`);
    assert.equal(s.kind, 'TERM_ENDED');
    assert.ok(s.action, `${iso} still offers the buildings screen`);
    assert.equal(inScheduledHours({ now: at(iso), current: CURRENT, index: NO_EXAMS }), false, `${iso} is scheduled`);
  }
  // The SCHEDULE_DARK fallback itself, which no date on the shipped calendar
  // can reach any more. It is the reason this test exists, so it is exercised
  // against an index whose term is wide and whose sessions have all ended,
  // rather than deleted along with the date that used to reach it.
  const WIDE = { ...NO_EXAMS, teaching: ['2026-08-25', '2027-01-31'] };
  const dark = resolveState({ now: at('2026-12-14'), current: { ...CURRENT, instruction: ['2026-08-25', '2027-01-31'] }, index: WIDE });
  assert.equal(dark.ranked, false);
  assert.equal(dark.kind, 'SCHEDULE_DARK');
  assert.ok(dark.action);
  // Midday on a real Thursday is untouched.
  assert.equal(resolveState({ now: at('2026-09-03', 12, 15), current: CURRENT, index: NO_EXAMS }).ranked, true);
  assert.equal(inScheduledHours({ now: at('2026-09-03', 12, 15), current: CURRENT, index: INDEX }), true);
});

test('resolveState refuses exactly when refusalFor does, and never on its own', () => {
  // The invariant the merge exists to hold. Two functions that each decide
  // whether the app may answer will drift, and the day they drift is the day
  // the question screen says nobody knows while the list behind it offers 450
  // rooms. Walked over every day of the shipped term, with the calendar the
  // harvest is meant to emit.
  const rooms = Object.values(CAL.rooms);
  let refusals = 0;
  for (let d = new Date(2026, 7, 1); d <= new Date(2026, 11, 31); d.setDate(d.getDate() + 1)) {
    const now = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0);
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const engine = refusalFor({
      now: 720,
      rooms,
      sessions: CAL.sessions,
      date: today,
      calendar: calendarOn(today, CAL, CUR),
      floor: indexFloorCheck(CAL),
      inTerm: inTermOn(today, CUR, CAL),
    });
    const screen = resolveState({ now, current: CUR, index: CAL });
    assert.equal(screen.ranked, engine === null, `${today}: engine ${engine?.refused ?? 'ok'}, screen ${screen.kind}`);
    if (engine) {
      refusals += 1;
      assert.ok(screen.heading, `${today} refused with no heading`);
      assert.ok(screen.body, `${today} refused with no reason`);
    }
  }
  assert.ok(refusals > 20, `only ${refusals} of 153 days refused, which is not the shipped term`);
});

test('the closed table reads in either shape the build might write it', () => {
  // The harvest emits a list of {date, state}; a hand-written fixture is easier
  // as a keyed object. Reading only the second one is how the campus-closed
  // refusal ends up wired to nothing, with no error anywhere: indexing a date
  // into an array gives undefined and the message never fires.
  const asList = { closed: [{ date: '2026-09-07', state: 'offices-closed', name: 'Labor Day' }] };
  const asMap = { closed: { '2026-09-07': { state: 'offices-closed', name: 'Labor Day' } } };
  for (const shape of [asList, asMap]) {
    assert.deepEqual(closedDayFor('2026-09-07', null, shape), { state: 'offices-closed', name: 'Labor Day' });
    assert.equal(closedDayFor('2026-09-08', null, shape), null);
    assert.equal(resolveState({ now: at('2026-09-07'), current: CUR, index: { ...CAL, ...shape } }).kind, 'CAMPUS_CLOSED');
  }
  // And the bare-string form the issue also allows.
  assert.deepEqual(closedDayFor('2026-10-15', null, { closed: [{ date: '2026-10-15', state: 'no-classes' }] }), {
    state: 'no-classes',
    name: null,
  });
});

test('no shipped building has unknown hours, and the grouping still holds', () => {
  const counts = roomsPerBuilding(INDEX);
  const term = HOURS.terms['autumn-2026-classroom-pool-building-schedule'];
  const hoursFor = (code, day) => term.buildings[code]?.hours[day];
  const groups = rankBuildings({
    origin: { lat: 39.99944, lon: -83.01502 },
    buildings: SLICE,
    counts,
    hoursFor,
    day: 4,
    nowMin: 14 * 60,
  });
  assert.ok(groups.open.length > 0);
  // The published-hours rule made this zero and has to keep it there. A
  // building the Registrar documents no doors for does not reach the index, so
  // the buildings screen has no unknown group to render and none of the prose
  // that used to explain one. If this ever goes above zero the index and the
  // hours table have drifted apart and the screen is hiding buildings.
  assert.equal(groups.unknown.length, 0, 'a shipped building has no published hours');
  for (const row of groups.open) assert.ok(Number.isFinite(row.closesAt));
  // Every building the screen lists carries a classroom count and a walk. The
  // count is no longer rendered, and rankBuildings still has to produce it: it
  // is in the spoken name of every row.
  for (const row of [...groups.open, ...groups.closed]) {
    assert.ok(row.rooms >= 1);
    assert.ok(Number.isFinite(row.walk));
  }
  assert.equal(
    groups.open.length + groups.unknown.length + groups.closed.length,
    Object.keys(counts).filter((c) => SLICE[c]).length,
  );
});

test('with no hours table at all every building reads unknown, never open', () => {
  const counts = roomsPerBuilding(INDEX);
  const groups = rankBuildings({
    origin: { lat: 39.99944, lon: -83.01502 },
    buildings: SLICE,
    counts,
    hoursFor: () => undefined,
    day: 6,
    nowMin: 21 * 60,
  });
  assert.equal(groups.open.length, 0);
  assert.equal(groups.closed.length, 0);
  assert.equal(groups.unknown.length, Object.keys(counts).filter((c) => SLICE[c]).length);
});

test('a building published as closed today is not a building with no hours', () => {
  // 43 of the 47 buildings in the Registrar pool publish at least one day as
  // closed, so on a Saturday this is the majority of the closed group. Calling
  // a published fact unknown throws away the one thing this screen carries.
  const term = HOURS.terms['autumn-2026-classroom-pool-building-schedule'];
  const hoursFor = (code, day) => term.buildings[code]?.hours[day];
  assert.equal(hoursFor('087', 6), null, 'Townshend publishes Saturday closed');
  const groups = rankBuildings({
    origin: { lat: 39.99944, lon: -83.01502 },
    buildings: SLICE,
    counts: roomsPerBuilding(INDEX),
    hoursFor,
    day: 6,
    nowMin: 20 * 60,
  });
  const townshend = groups.closed.find((b) => b.code === '087');
  assert.equal(townshend.when, 'closed-today');
  assert.ok(groups.closed.some((b) => b.when === 'closed-today'));
  for (const row of groups.unknown) assert.equal(row.when, 'unknown');
  for (const row of groups.open) assert.equal(row.when, 'open');
});

test('a closed building says which side of its window the clock is on', () => {
  // The one shared line used to read "open till 6:00pm" at 9:40pm, three hours
  // forty after the door locked.
  const hoursFor = () => [420, 1080];
  const grouped = (nowMin) =>
    rankBuildings({
      origin: { lat: 39.99944, lon: -83.01502 },
      buildings: { 900: { name: 'Nowhere Hall', lat: 39.9995, lon: -83.013 } },
      counts: { 900: 4 },
      hoursFor,
      day: 4,
      nowMin,
    });
  assert.equal(grouped(6 * 60).closed[0].when, 'before');
  assert.equal(grouped(12 * 60).open[0].when, 'open');
  assert.equal(grouped(21 * 60 + 40).closed[0].when, 'after');
});

test('the all-week list comes out of the hours table, not out of the source', () => {
  const term = HOURS.terms['autumn-2026-classroom-pool-building-schedule'];
  const codes = allWeekCodes(term);
  assert.ok(codes.length >= 4);
  for (const code of codes) {
    assert.ok(term.buildings[code].hours.every((d) => Array.isArray(d)));
  }
});

// Comments are stripped first. A comment naming Sullivant is a record of the
// measurement that produced a rule; a name in the code is a hardcoded building
// that survives a term rollover it should not have survived.
const codeOnly = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('no building name is typed into the app source', () => {
  const dir = join(ROOT, 'js');
  const names = ['Enarson', 'Hitchcock', 'Independence', 'Sullivant', '18th Avenue'];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const text = codeOnly(readFileSync(join(dir, file), 'utf8'));
    for (const name of names) {
      assert.equal(text.includes(name), false, `${file} names ${name}`);
    }
  }
});

test('the app source assumes nothing about an unpublished door', () => {
  // The whole word, not just "usually open". A hedge anywhere in this app is
  // one edit away from being a hedge about a door.
  const dir = join(ROOT, 'js');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    assert.doesNotMatch(readFileSync(join(dir, file), 'utf8'), /usually/i, `${file} hedges`);
  }
  assert.doesNotMatch(readFileSync(join(ROOT, 'index.html'), 'utf8'), /usually/i, 'index.html hedges');
});

// The two large-text rules, checked in the source because this suite has no
// layout engine. What they are worth is measured in a browser: at 393px with
// the root at 53px the buildings screen went from 53 of 53 rows clipped and
// #near scrolling sideways at 454 against 393, to 0 clipped and no sideways
// scroll, and the question screen's 30 minute button went from top -644 with
// no way to reach it to top 493.

test('every container-query rule sits below the plain rule it has to beat', () => {
  // A container query adds no specificity of its own, so a plain rule further
  // down the sheet wins on source order. This is the bug that shipped: .b-row
  // was given the container name, and the only rule inside the query was for
  // .row, which happens to be declared above it.
  const css = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const blocks = [...css.matchAll(/@container[^{]*\{([\s\S]*?)\n {2}\}/g)];
  assert.ok(blocks.length >= 1, 'no container query in the sheet');
  const seen = new Set();
  for (const block of blocks) {
    for (const rule of block[1].matchAll(/^ {4}(\.[\w-]+)/gm)) {
      const selector = rule[1];
      seen.add(selector);
      const plain = new RegExp(`^ {2}\\${selector}[\\s,{]`, 'gm');
      for (const hit of css.matchAll(plain)) {
        assert.ok(
          hit.index < block.index,
          `${selector} is declared at ${hit.index}, below the container query at ${block.index}`,
        );
      }
    }
  }
  for (const want of ['.row', '.b-row', '.pick-row']) {
    assert.ok(seen.has(want), `${want} has no large-text rule`);
  }
});

test('the question screen does not centre content it cannot scroll to', () => {
  // justify-content: center on a scroll container puts overflow above the
  // scroll origin, where scrollTop, scrollIntoView and Tab all cannot reach it.
  // safe falls back to flex-start the moment the content stops fitting.
  const css = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const ask = css.slice(css.indexOf('  #ask {'), css.indexOf('  #ask h1 {'));
  assert.match(ask, /justify-content: safe center;/);
  assert.match(ask, /overflow-y: auto;/);
  // The plain value has to stay above it for engines that drop the keyword.
  assert.ok(ask.indexOf('justify-content: center') < ask.indexOf('justify-content: safe center'));
});

// ---------------------------------------------------------------- #18 the row

test('a room with no later class says so, and never invents an end time', () => {
  const row = {
    wait: 0,
    hoursKnown: true,
    nextClassAt: 1290,
    usableUntil: 1280,
    availableAt: 800,
    usable: 480,
  };
  assert.equal(windowPhrase(row, 1290).text, 'no class rest of today');
  assert.equal(windowPhrase(row, 1290).tier, 'medium');
  // The lock time is still in the accessible name, because it is the one fact
  // the phrase drops.
  assert.match(windowPhrase(row, 1290).say, /locks at 9:30 pm/);
});

test('a class-bounded room prints a clock time and no duration', () => {
  const row = { wait: 0, hoursKnown: true, nextClassAt: 835, usableUntil: 825, availableAt: 700, usable: 125 };
  const p = windowPhrase(row, 1290);
  assert.equal(p.tier, 'strong');
  assert.equal(p.text, 'free till 1:45pm');
  assert.doesNotMatch(p.text, /\dh\d\d/);
});

test('the 9h44 case: an unpublished door never gets a window', () => {
  // The room really is free from 14:16 to midnight as far as the schedule
  // knows, and the naive read of that is "9h44 free", which is a claim about a
  // door nobody publishes. rank() returns usable null here on purpose.
  const rooms = [{ id: 'XX0001', b: '900', cap: 40, busy: [[4, 600, 700]] }];
  const buildings = { 900: { name: 'Nowhere Hall', lat: 39.9995, lon: -83.013 } };
  const [row] = rank(rooms, {
    origin: { lat: 39.9995, lon: -83.013 },
    now: 856,
    day: 4,
    needed: 30,
    buildings,
    hoursFor: () => undefined,
  });
  assert.equal(row.hoursKnown, false);
  assert.equal(row.usable, null);
  assert.equal(row.usableUntil, null);
  const p = windowPhrase(row, null);
  assert.equal(p.text, 'hours not published');
  assert.doesNotMatch(p.text, /\dh\d\d/);
});

test('clock wraps, so the string a row prints is not the thing to assert on', () => {
  // The guard below used to parse the rendered text and check the minute came
  // out under 1440. Measured across clock(0..2999) with that same parse, the
  // highest value it can ever produce is 1439, from clock(1439) = 11:59pm.
  // clock(1440) renders 12:00am and clock(1500) renders 1:00am, so every
  // possible input passed and the assertion asserted nothing.
  let highest = -1;
  for (let m = 0; m < 3000; m += 1) {
    const hit = /(\d+):(\d\d)(am|pm)/.exec(clock(m));
    if (!hit) continue;
    const minute = ((Number(hit[1]) % 12) + (hit[3] === 'pm' ? 12 : 0)) * 60 + Number(hit[2]);
    highest = Math.max(highest, minute);
  }
  assert.equal(highest, 1439);
  assert.equal(clock(1440), '12:00am');
  assert.equal(clock(1500), '1:00am');
});

test('a window past the end of the day is refused, not wrapped into the morning', () => {
  // The negative control the old guard did not have. This row would have
  // printed "free till 1:00am" and passed.
  const past = {
    wait: 0, hoursKnown: true, availableAt: 700,
    usableUntil: MINUTES_IN_DAY + 50, nextClassAt: MINUTES_IN_DAY + 60, usable: 60,
  };
  const p = windowPhrase(past, MINUTES_IN_DAY + 60);
  assert.equal(p.tier, 'unknown');
  assert.doesNotMatch(p.text, /\d+:\d\d(am|pm)/);
  assert.doesNotMatch(p.say, /\d+:\d\d (am|pm)/);

  // The same row one minute inside the day still answers.
  const ok = {
    wait: 0, hoursKnown: true, availableAt: 700,
    usableUntil: MINUTES_IN_DAY - 10, nextClassAt: MINUTES_IN_DAY, usable: 60,
  };
  assert.equal(windowPhrase(ok, MINUTES_IN_DAY).tier, 'medium');
});

test('a strong row names the class time it is talking about, not a made up one', () => {
  // usableUntil is PACKUP before the class, so the old accessible name said
  // "free until 3:20 pm when a class starts" for a room whose class is at 3:30,
  // while the room screen for the same room said 3:30. Nothing starts at 3:20.
  const row = { wait: 0, hoursKnown: true, availableAt: 700, nextClassAt: 930, usableUntil: 930 - PACKUP, usable: 200 };
  const p = windowPhrase(row, 1140);
  assert.equal(p.tier, 'strong');
  assert.equal(p.text, 'free till 3:20pm');
  assert.match(p.say, /3:20 pm/);
  assert.match(p.say, /3:30 pm/);
  assert.doesNotMatch(p.say, /3:20 pm when a class starts/);
});

test('no row phrase ever names a time past the end of the day', () => {
  const counts = roomsPerBuilding(INDEX);
  const term = HOURS.terms['autumn-2026-classroom-pool-building-schedule'];
  const hoursFor = (code, day) => term.buildings[code]?.hours[day];
  const rows = rank(
    Object.entries(INDEX.rooms).map(([id, r]) => ({ id, ...r })),
    {
      origin: { lat: 39.99944, lon: -83.01502 },
      now: 735,
      day: 4,
      needed: 60,
      buildings: SLICE,
      hoursFor,
      sessions: INDEX.sessions,
      date: '2026-09-03',
    },
  );
  assert.ok(rows.length > 100, `expected a busy Thursday, got ${rows.length} rows`);
  assert.ok(Object.keys(counts).length > 0);
  for (const row of rows) {
    // The numbers, not the rendered string. Any of these past MINUTES_IN_DAY is what
    // clock() would quietly wrap, and it is the only thing that can go wrong.
    for (const [what, minute] of [
      ['availableAt', row.availableAt],
      ['usableUntil', row.usableUntil],
      ['nextClassAt', row.nextClassAt],
    ]) {
      if (minute == null) continue;
      assert.ok(minute >= 0 && minute <= MINUTES_IN_DAY, `${row.id} ${what} is ${minute}`);
    }
    const hours = hoursFor(row.building, 4);
    // 'window unknown' is the refusal the guard above produces. A real Thursday
    // must not reach it, or the guard is hiding a wrong window rather than
    // catching one.
    assert.notEqual(windowPhrase(row, Array.isArray(hours) ? hours[1] : null).text, 'window unknown', row.id);
  }
});

// The room screen at 12:15 on a Thursday, in a building open 7:00 to 19:30
// with one class from 15:30 to 17:00. This is the shape timelineRows() hands
// roomClaim(), written out rather than built, so the arithmetic under test is
// the only thing that can move.
//
// The Registrar publishes this building, so `known` is true and the verdict is
// allowed to talk about the door. js/claim.js returns the verdict and js/app.js
// writes the sentence, so what is asserted here is the number.
const TIMELINE = {
  known: true,
  open: 420,
  close: 1170,
  blocks: [[930, 1020]],
  rows: [
    { kind: 'edge', t: 420, text: 'Nowhere Hall opens' },
    { kind: 'free', t: 420, end: 930, len: 510, now: true },
    { kind: 'busy', t: 930 },
    { kind: 'free', t: 1020, end: 1170, len: 150, now: false },
    { kind: 'edge', t: 1170, text: 'Nowhere Hall closes' },
  ],
};

test('the room screen subtracts the walk, the way the engine says to', () => {
  // `gapEnd - PACKUP - now` is the expression engine.js documents as the bug it
  // exists to fix. It shipped here anyway and overstated every claim by exactly
  // the walk: measured headlessly on a Thursday at 12:15, all 23 rooms in the
  // top 40 that carried a claim were 5 minutes long.
  const nowMin = 735;
  const metres = 147;
  const engine = usableMinutes({ now: nowMin, gapStart: 420, gapEnd: 930, metres });
  const naive = 930 - PACKUP - nowMin;
  assert.equal(naive - engine, 3, 'the walk is 3 minutes, so the old formula was 3 minutes long');

  const claim = roomClaim({ ...TIMELINE, now: nowMin, metres });
  assert.equal(claim.kind, 'free');
  assert.equal(claim.until, 920, 'the class is at 3:30pm, so you are out at 3:20pm');
  assert.equal(claim.yours, engine);
  assert.notEqual(claim.yours, naive);
});

test('the room screen prints no duration when it does not know the walk', () => {
  // A shared link and the buildings screen both land here with no ranked row
  // behind them. A duration that assumes you are already at the door is the
  // same lie in a different place, so the verdict carries null and the screen
  // has nothing to print.
  const claim = roomClaim({ ...TIMELINE, now: 735, metres: null });
  assert.equal(claim.kind, 'free');
  assert.equal(claim.until, 920);
  assert.equal(claim.yours, null);
});

test('a walk that outlasts the window says so instead of printing zero', () => {
  const claim = roomClaim({ ...TIMELINE, now: 925, metres: 4000 });
  assert.ok(claim.yours <= 0, `a 4 km walk cannot leave ${claim.yours} minutes`);
  // And the screen has a sentence for it rather than a zero.
  const src = readFileSync(join(ROOT, 'js/app.js'), 'utf8');
  assert.match(src, /It closes before you could walk there/);
});

test('the before-open and in-class claims go through the same formula', () => {
  const early = roomClaim({ ...TIMELINE, now: 300, metres: 147 });
  assert.equal(early.kind, 'opens');
  assert.equal(early.at, 420, 'the door, not the first class');
  assert.equal(early.yours, usableMinutes({ now: 300, gapStart: 420, gapEnd: 930, metres: 147 }));

  const during = roomClaim({ ...TIMELINE, now: 950, metres: 147 });
  assert.equal(during.kind, 'in-class');
  assert.equal(during.until, 1020, 'in use till 5:00pm');
  assert.equal(during.next, 1020);
  assert.equal(during.yours, usableMinutes({ now: 950, gapStart: 1020, gapEnd: 1170, metres: 147 }));
});

test('the room deep link is gated on scheduled hours, not only on rankable', () => {
  // There is no DOM in this suite, so this reads the branch. What it guards:
  // boot() opened the ranked list behind a ?room= link at 3am on a Saturday,
  // leaving 40 rows one back press from a link, on a screen the front door
  // refuses to show at all.
  const src = readFileSync(join(ROOT, 'js/app.js'), 'utf8');
  const branch = src.slice(src.indexOf('const wanted = new URLSearchParams'));
  assert.ok(branch.length > 0, 'the deep link branch moved');
  const head = branch.slice(0, 700);
  assert.match(head, /if \(state\.scheduled\)/);
  assert.match(head, /showNear\(\)/);
});

// ------------------------------------------------------------ #17 the picker

test('the picker list is the intersection of the harvest and buildings.json', () => {
  const counts = roomsPerBuilding(INDEX);
  const codes = Object.keys(counts).filter((c) => SLICE[c]);
  // The floor is the Registrar's hours table, not the schedule: a building
  // with no published doors no longer ships, so the picker can never list more
  // than the 46 buildings that table names.
  assert.ok(codes.length >= 30 && codes.length <= 60, `picker would list ${codes.length} buildings`);
  for (const code of codes) {
    assert.ok(SLICE[code], `${code} missing from the term slice`);
    assert.ok(FULL[code], `${code} missing from buildings.json`);
    assert.ok(counts[code] >= 1);
  }
});

test('every picked building resolves to a coordinate', () => {
  const counts = roomsPerBuilding(INDEX);
  for (const code of Object.keys(counts)) {
    const b = SLICE[code];
    if (!b) continue;
    assert.ok(Number.isFinite(b.lat) && Number.isFinite(b.lon), `${code} has no coordinate`);
  }
});

test('a picked origin ranks rooms from more than one building', () => {
  // Roomix seeds from a building and then expands outward until it breaks at
  // 200 m, so picking narrows the answer. A picked building here is only where
  // you are standing.
  const term = HOURS.terms['autumn-2026-classroom-pool-building-schedule'];
  const home = SLICE['279'];
  const rows = rank(
    Object.entries(INDEX.rooms).map(([id, r]) => ({ id, ...r })),
    {
      origin: { lat: home.lat, lon: home.lon, accuracy: 50, source: 'picked' },
      now: 735,
      day: 4,
      needed: 30,
      buildings: SLICE,
      hoursFor: (code, day) => term.buildings[code]?.hours[day],
      sessions: INDEX.sessions,
      date: '2026-09-03',
    },
  );
  const distinct = new Set(rows.slice(0, 20).map((r) => r.building));
  assert.ok(distinct.size >= 3, `top 20 came from ${distinct.size} buildings`);
});

// -------------------------------------------------------- #24 diagnostics

const DIAG = {
  build: 'a3f9c21',
  controlling: true,
  term: '1268',
  termName: 'Autumn 2026',
  generated: '2026-08-30T07:41:12Z',
  ageDays: 5,
  stateKind: 'RANKED',
  rooms: 871,
  buildings: 96,
  sessions: 10,
  originSource: 'gps',
  accuracy: 32,
  originAgeS: 14,
  lat: 40.0022951,
  lon: -83.0158317,
  hoursSource: 'registrar',
  hoursGenerated: '2026-08-26',
  clock: '2026-09-04 14:02',
  zone: 'America/New_York',
  caches: ['vacant-shell-a3f9c21', 'vacant-data-1268'],
  room: {
    id: 'DL0357',
    type: '1B',
    cap: 46,
    building: '279',
    metres: 412,
    walk: 7,
    gapStart: 835,
    gapEnd: 970,
    session: 0,
    usable: 123,
    nowMin: 842,
  },
  dayName: 'Thu',
  busy: [[480, 535], [550, 605], [780, 835], [970, 1025]],
};

test('the block prints what a maintainer needs to reproduce a wrong answer', () => {
  const block = diagnosticsBlock(DIAG);
  for (const want of ['a3f9c21', '1268', 'Autumn 2026', '5 days old', '871 rooms', '96 buildings', '10 sessions',
    'gps', '+/-32 m', 'age 14 s', 'America/New_York', 'vacant-data-1268', 'DL0357', 'type 1B', 'cap 46',
    'bldg 279', '412 m -> 7 min', 'sess 0', 'usable 2h03', 'leaveBy']) {
    assert.ok(block.includes(want), `block is missing ${want}`);
  }
  assert.match(block, /busy Thu\s+8:00am-8:55am/);
});

test('leaveBy is the last minute you could have set off and still got that usable', () => {
  // usable = gapEnd - PACKUP - max(now + walk, gapStart). Leave any later than
  // this and the arrival, not the gap, sets the start, so the figure on the
  // same line shrinks minute for minute. Once the gap has already opened, that
  // deadline is simply the minute the row was tapped.
  const started = diagnosticsBlock(DIAG);
  assert.match(started, /usable 2h03, leaveBy 2:02pm/);

  // Same room, tapped at 12:30 for a gap that does not open until 13:55: the
  // deadline is the gap start less the seven minute walk.
  const waiting = diagnosticsBlock({ ...DIAG, room: { ...DIAG.room, nowMin: 750 } });
  assert.match(waiting, /leaveBy 1:48pm/);

  // A pick stored before this line existed carries no clock, and the line stops
  // rather than inventing one.
  const { nowMin, ...older } = DIAG.room;
  assert.equal(nowMin, 842);
  const old = diagnosticsBlock({ ...DIAG, room: older });
  assert.ok(old.includes('usable 2h03'));
  assert.ok(!old.includes('leaveBy'));
});

test('no coordinate leaves the device unless it is ticked, and then only to 4 places', () => {
  const withheld = diagnosticsBlock(DIAG);
  assert.ok(withheld.includes('[location withheld]'));
  assert.doesNotMatch(withheld, /[0-9]{2}\.[0-9]/);

  const shared = diagnosticsBlock({ ...DIAG, includeLocation: true });
  assert.ok(shared.includes('40.0023, -83.0158'), shared);
  for (const hit of shared.match(/-?\d+\.\d+/g) ?? []) {
    const places = hit.split('.')[1].length;
    assert.ok(places <= 4, `${hit} carries ${places} decimal places`);
  }
});

test('a room carrying 57 weekly intervals still fits under the cap whole', () => {
  const busy = Array.from({ length: 57 }, (_, i) => [480 + i * 10, 485 + i * 10]);
  const block = diagnosticsBlock({ ...DIAG, busy });
  assert.ok(block.length <= 4000, `block is ${block.length} characters`);
  assert.doesNotMatch(block, /\.\.\. \d+ more/);
  assert.equal((block.match(/-/g) ?? []).length >= 57, true);
});

test('past the cap the busy list is what loses entries, and it says how many', () => {
  // An issue URL carrying a 4000 character block is already at the edge of what
  // survives a redirect, so the unbounded line is the one that gives way.
  const busy = Array.from({ length: 400 }, (_, i) => [480 + (i % 90) * 10, 485 + (i % 90) * 10]);
  const block = diagnosticsBlock({ ...DIAG, busy });
  assert.ok(block.length <= 4000, `block is ${block.length} characters`);
  assert.match(block, /\.\.\. \d+ more/);
  assert.ok(block.startsWith('build'), 'the head survives the cap');
  assert.ok(block.includes('DL0357'), 'the room line survives the cap');
});

// ---- the night gate

// Nothing in this file pinned a word of the night screen before these. The
// buildings screen said "Everything is closed right now." and the question
// screen said nothing at all, so the copy could rot without a test noticing.

const TERM = HOURS.terms['autumn-2026-classroom-pool-building-schedule'];
const DOORS = (code, day) => TERM.buildings[code]?.hours[day];
const COUNTS = roomsPerBuilding(INDEX);
const BUSY = busyDayOf(CURRENT, INDEX);
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HERE = { lat: 39.99944, lon: -83.01502 }; // the Thompson Library steps
const opening = (day, nowMin) =>
  nextOpening({ buildings: SLICE, counts: COUNTS, hoursFor: DOORS, day, nowMin });

// A date walked forward by whole days, at a wall-clock minute.
const on = (d, plus, min = 0) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + plus, Math.floor(min / 60), min % 60);

// firstDoor in js/app.js, minus the short name. The calendar lives at the call
// site because data/buildings-hours.json is weekly and knows no holidays.
const firstDoor = (now) => {
  const first = opening(now.getDay(), now.getHours() * 60 + now.getMinutes());
  if (!first) return null;
  const day = on(now, (first.day - now.getDay() + 7) % 7);
  return closedDayFor(isoDate(day), CURRENT, INDEX)?.state === 'offices-closed' ? null : first;
};

// The gate as paintGate builds it, against the shipped index and hours table.
const gateAt = (now) => {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return unscheduledGate({
    now,
    current: CURRENT,
    index: INDEX,
    busyDay: BUSY,
    opening: firstDoor(now),
    openNow: openDoorCount({ counts: COUNTS, hoursFor: DOORS, day: now.getDay(), nowMin }),
  });
};

// Whether the app answers at all is a fact about the DATE: refusalFor reads the
// minute only to check it is a wall clock, and inScheduledHours is that same day
// filter plus one comparison against the day's own window. So each date is asked
// once and the answer reused across its minutes, which is what makes a 118 day
// walk affordable at all.
const dayCache = new Map();
const dayFacts = (d) => {
  const iso = isoDate(d);
  if (!dayCache.has(iso)) {
    dayCache.set(iso, {
      ranked: resolveState({ now: on(d, 0, 12 * 60), current: CURRENT, index: INDEX }).ranked,
      covers: inScheduledHours({ now: on(d, 0, BUSY.earliestStart), current: CURRENT, index: INDEX }),
    });
  }
  return dayCache.get(iso);
};
const isGateMinute = (d, m) => {
  const day = dayFacts(d);
  return day.ranked && !(day.covers && m >= BUSY.earliestStart && m < BUSY.latestEnd);
};

// For every gate minute in the range: read the sentence the way a person would,
// turn that into a date, and ask resolveState and inScheduledHours whether the
// app will really rank on it. Neither of those reads busyDay.weekdays on its
// own, which is the whole point; the old sweep asserted against the same mask
// that wrote the sentence.
function walkGate(from, to, step) {
  const wrong = [];
  const silent = [];
  let visited = 0;
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    for (let m = 0; m < MINUTES_IN_DAY; m += step) {
      if (!isGateMinute(d, m)) continue;
      const now = on(d, 0, m);
      visited += 1;
      const body = gateAt(now).body;
      const cut = body.indexOf('Vacant ranks rooms again');
      if (cut < 0) {
        silent.push(isoDate(now));
        continue;
      }
      // The clause's own day word wins; "today" means today; and with neither,
      // the last day named before it carries over, because two adjacent
      // sentences are read as one thought.
      const clause = body.slice(cut);
      const before = DAYS.filter((x) => body.slice(0, cut).includes(x));
      const own = DAYS.find((x) => clause.includes(x));
      const name = own ?? (/ today at /.test(clause) ? null : (before[before.length - 1] ?? null));
      let target = null;
      for (let ahead = 0; ahead < 7 && !target; ahead++) {
        if (ahead === 0 && m >= BUSY.earliestStart) continue;
        const c = on(now, ahead, BUSY.earliestStart);
        if (name === null ? ahead === 0 : DAYS[c.getDay()] === name) target = c;
      }
      const day = target && dayFacts(target);
      if (!day?.ranked || !day.covers) wrong.push(`${isoDate(now)} ${clock(m)}: ${body}`);
    }
  }
  return { visited, wrong, silent };
}

test('the first door after 11:40pm on a Monday is not one that opened this morning', () => {
  // PAES at 5:00am is the earliest opening the Autumn table holds on any
  // weekday, and it is 5h20 the wrong side of the minute being asked about.
  const first = opening(1, 23 * 60 + 40);
  assert.equal(first.day, 2, 'Tuesday');
  assert.equal(first.opensAt, 300);
  assert.match(first.name, /PAES/);
  assert.equal(first.ties, 1);
  assert.equal(openingPhrase(first, 1), `On Tuesday ${first.name} opens at 5:00am`);
});

test('three doors share 7:00am on a Saturday, and the sentence says so', () => {
  const first = opening(6, 180);
  assert.equal(first.day, 6, 'later the same morning, not Monday');
  assert.equal(first.opensAt, 420);
  assert.equal(first.name, 'Hitchcock Hall');
  assert.equal(first.ties, 3);
  const also = Object.keys(COUNTS).filter((c) => DOORS(c, 6)?.[0] === 420);
  assert.deepEqual(also.sort(), ['072', '274', '338']);
  assert.equal(openingPhrase(first, 6), 'Hitchcock Hall and 2 more open at 7:00am');
});

test('a Sunday afternoon door is named on the day it opens', () => {
  const first = opening(0, 900);
  assert.equal(first.opensAt, 960);
  assert.equal(first.name, 'Pomerene Hall');
  assert.equal(first.ties, 1);
  assert.equal(openingPhrase(first, 0), 'Pomerene Hall opens at 4:00pm');
});

test('no hours table means no door, not a guessed one', () => {
  assert.equal(nextOpening({ buildings: SLICE, counts: COUNTS, hoursFor: () => undefined, day: 1, nowMin: 0 }), null);
  assert.equal(nextOpening({ buildings: SLICE, counts: {}, hoursFor: DOORS, day: 1, nowMin: 0 }), null);
  assert.equal(nextOpening({ buildings: SLICE, counts: COUNTS, day: 1, nowMin: 0 }), null);
  assert.equal(openingPhrase(null, 1), null);
});

test('every minute of the week, the first door is still ahead of you', () => {
  // The whole point of the function. A door that opened this morning is not a
  // door you can walk to now, and printing one is the bug the row phrases in
  // js/app.js already record fixing once.
  let checked = 0;
  for (let day = 0; day < 7; day++) {
    for (let m = 0; m < MINUTES_IN_DAY; m++) {
      const first = opening(day, m);
      assert.ok(first, `no door found at day ${day} minute ${m}`);
      if (first.day === day) assert.ok(first.opensAt > m, `day ${day} minute ${m} named ${first.opensAt}`);
      checked += 1;
    }
  }
  assert.equal(checked, 7 * MINUTES_IN_DAY);
});

test('the doors published on each weekday are what the walk crosses a day for', () => {
  // The measurement the nextOpening header rests on. Saturday is the thin day
  // and Sunday is not far behind it, which is why the walk steps days at all.
  const published = [0, 1, 2, 3, 4, 5, 6].map(
    (d) => Object.keys(COUNTS).filter((c) => Number.isFinite(DOORS(c, d)?.[0])).length,
  );
  assert.deepEqual(published, [11, 46, 46, 46, 46, 46, 5]);
  // From a Saturday night the answer is three doors at 7:00am on the Sunday.
  // Monday is unreachable from any Saturday minute, and Monday's own earliest
  // door is PAES on its own, so "46 of them opening Monday" was wrong twice.
  assert.deepEqual(opening(6, 1420), { code: '274', name: 'Hitchcock Hall', day: 0, opensAt: 420, ties: 3 });
  assert.equal(opening(1, 0).ties, 1);
  assert.match(opening(1, 0).name, /PAES/);
  // And the walk never needs more than one day boundary anywhere in the week.
  for (let day = 0; day < 7; day++) {
    for (let m = 0; m < MINUTES_IN_DAY; m++) {
      assert.ok((opening(day, m).day - day + 7) % 7 <= 1, `day ${day} minute ${m} walked past tomorrow`);
    }
  }
});

test('openDoorCount agrees with the group the buildings screen renders', () => {
  // The gate has no origin and must not need one to know whether campus is shut.
  // rankBuildings answers the same question for a reader standing somewhere, so
  // the two are held together across a week.
  for (let day = 0; day < 7; day++) {
    for (let m = 0; m < MINUTES_IN_DAY; m += 5) {
      const groups = rankBuildings({ origin: HERE, buildings: SLICE, counts: COUNTS, hoursFor: DOORS, day, nowMin: m });
      assert.equal(
        openDoorCount({ counts: COUNTS, hoursFor: DOORS, day, nowMin: m }),
        groups.open.length,
        `day ${day} minute ${m}`,
      );
    }
  }
  assert.equal(openDoorCount({ counts: COUNTS, hoursFor: undefined, day: 1, nowMin: 0 }), 0);
});

test('the day the gate promises rooms back is a day the app will actually rank on', () => {
  // The assertion busyDay.weekdays cannot make. It is a weekly Mon-Fri mask
  // built out of block counts with no calendar in it, so reading it alone named
  // Labor Day, Veterans Day, Thanksgiving and the day after the term ended:
  // 3,780 of the 94,665 gate minutes of Autumn 2026 at one minute resolution,
  // 3.99%. Quarter hours here, because unscheduledGate walks the calendar itself
  // and every minute of all 118 days costs 65 seconds; the week that carried
  // 3,105 of those wrong minutes is walked minute by minute below.
  const walked = walkGate(new Date(2026, 7, 25), new Date(2026, 11, 20), 15);
  assert.equal(walked.visited, 6311);
  assert.deepEqual(walked.wrong, []);
  // The clause is dropped, not guessed, when there is no day left to name: the
  // term's last class meets on 2026-12-09 and the index holds nothing after it.
  assert.deepEqual([...new Set(walked.silent)], ['2026-12-09']);
});

test('every minute of the Labor Day weekend, the gate names a day it can rank on', () => {
  // Where 3,105 of the old sentence's 3,780 wrong minutes were, all of them
  // pointing at the Monday: Friday from 20:15, then the Saturday and Sunday
  // whole. Walked one minute at a time.
  const walked = walkGate(new Date(2026, 8, 4), new Date(2026, 8, 6), 1);
  assert.equal(walked.visited, 3585);
  assert.deepEqual(walked.wrong, []);
  assert.deepEqual(walked.silent, []);
  // All three skip the Monday.
  for (const day of [4, 5, 6]) {
    assert.match(gateAt(new Date(2026, 8, day, 23, 0)).body, /rooms again on Tuesday at 8:00am\.$/, `Sep ${day}`);
  }
  assert.equal(
    resolveState({ now: new Date(2026, 8, 7, 8, 0), current: CURRENT, index: INDEX }).heading,
    'Labor Day, campus is closed',
  );
});

test('the gate names no door while a door is open', () => {
  // The buildings screen guards this sentence on groups.open.length and the gate
  // did not, so it named the first door on 3,885 of the 6,405 gate minutes of a
  // week with campus open behind it, including 7:30am on a Tuesday with all 46
  // unlocked, under a button leading straight to a list of them.
  const week = new Date(2026, 8, 13); // Sunday 2026-09-13, an ordinary week
  let gateMinutes = 0;
  let openMinutes = 0;
  let named = 0;
  for (let d = 0; d < 7; d++) {
    for (let m = 0; m < MINUTES_IN_DAY; m++) {
      const now = on(week, d, m);
      if (!isGateMinute(now, m)) continue;
      gateMinutes += 1;
      const body = gateAt(now).body;
      const open = rankBuildings({
        origin: HERE, buildings: SLICE, counts: COUNTS, hoursFor: DOORS, day: now.getDay(), nowMin: m,
      }).open.length;
      if (open === 0) {
        if (/opens? at /.test(body)) named += 1;
        continue;
      }
      openMinutes += 1;
      assert.doesNotMatch(body, /opens? at /, `${DAYS[now.getDay()]} ${clock(m)} with ${open} open: ${body}`);
    }
  }
  assert.equal(gateMinutes, 6405);
  assert.equal(openMinutes, 3885);
  assert.equal(named, 2520, 'the door clause still fires on the minutes campus really is shut');
});

test('a registrar no-classes day is not read as an ordinary teaching day', () => {
  // Three weekdays the mask says yes to and the registrar publishes as closed to
  // classes. resolveState flags them and names them on the ranked screen, while
  // the gate said the opposite on both sides of the day: "Classes have not
  // started yet" in the morning, "Classes are done for the day" at night. 705
  // gate minutes on each of the three, 2,115 a term.
  for (const [iso, name] of [
    ['2026-10-15', 'Autumn Break'],
    ['2026-10-16', 'Autumn Break'],
    ['2026-11-25', 'Thanksgiving Break begins'],
  ]) {
    const [y, mo, d] = iso.split('-').map(Number);
    assert.equal(closedDayFor(iso, CURRENT, INDEX).state, 'no-classes');
    const noon = resolveState({ now: new Date(y, mo - 1, d, 12, 0), current: CURRENT, index: INDEX });
    assert.equal(noon.classesSuspended, true, iso);
    assert.ok(noon.note.startsWith(`${name}. No classes are meeting today,`), noon.note);
    for (const h of [3, 23]) {
      const body = gateAt(new Date(y, mo - 1, d, h, 0)).body;
      assert.ok(body.startsWith(`${name}. No classes are meeting today.`), `${iso} ${h}:00 said ${body}`);
    }
  }
  // A weekday with nothing on the calendar keeps the ordinary reading.
  assert.match(gateAt(new Date(2026, 8, 15, 3, 0)).body, /^Classes have not started yet\./);
  assert.match(gateAt(new Date(2026, 8, 15, 23, 0)).body, /^Classes are done for the day\./);
});

test('the gate says what the clock is doing without repeating its own button', () => {
  const button = 'Show nearest buildings';
  for (const [now, want] of [
    [new Date(2026, 8, 14, 23, 40), /^Classes are done for the day\./],
    [new Date(2026, 8, 15, 2, 0), /^Classes have not started yet\./],
    [new Date(2026, 8, 12, 3, 0), /^No classes are scheduled today\./],
  ]) {
    const said = gateAt(now);
    assert.match(said.body, want);
    assert.equal(said.heading, `${DAYS[now.getDay()]}, ${clock(now.getHours() * 60 + now.getMinutes())}`);
    assert.equal(said.body.split('\n').length, 1, 'one line');
    assert.notEqual(said.heading, button);
    assert.ok(!said.heading.includes(button) && !button.includes(said.heading), said.heading);
    // docs/DECISIONS.md 2026-08-29 took the per-building room count off this
    // screen. This line is not a way back in.
    assert.doesNotMatch(said.body, /classroom|\d+ rooms?\b/);
  }
});

test('a Saturday night names Monday for rooms and Saturday morning for the door', () => {
  const said = gateAt(new Date(2026, 8, 12, 3, 0));
  assert.equal(said.heading, 'Saturday, 3:00am');
  assert.equal(
    said.body,
    'No classes are scheduled today. Hitchcock Hall and 2 more open at 7:00am. ' +
      'Vacant ranks rooms again on Monday at 8:00am.',
  );
  // 11:40pm on a Monday, the minute the whole screen was written for. The
  // Journalism Building publishes hours to midnight on weeknights, so one door
  // is open and the sentence does not offer tomorrow's.
  const night = gateAt(new Date(2026, 8, 14, 23, 40));
  assert.equal(night.heading, 'Monday, 11:40pm');
  assert.equal(night.body, 'Classes are done for the day. Vacant ranks rooms again on Tuesday at 8:00am.');
  assert.equal(openDoorCount({ counts: COUNTS, hoursFor: DOORS, day: 1, nowMin: 1420 }), 1);
});

test('the ranked clause says today when the door clause has named tomorrow', () => {
  // Two adjacent sentences are read as one thought, so a bare "at 8:00am"
  // sitting behind "On Wednesday" reads as Wednesday when it means 30 minutes
  // away. The shipped table never reaches this any more, because a door is
  // always open in the window that produced it, so it is driven from a door
  // handed in rather than looked up.
  const now = new Date(2026, 8, 15, 7, 30);
  const tomorrow = { code: '245', name: 'PAES', day: 3, opensAt: 300, ties: 1 };
  const said = unscheduledGate({ now, current: CURRENT, index: INDEX, busyDay: BUSY, opening: tomorrow, openNow: 0 });
  assert.equal(
    said.body,
    'Classes have not started yet. On Wednesday PAES opens at 5:00am. Vacant ranks rooms again today at 8:00am.',
  );
  // The same door today, and the two join into one sentence with one day word.
  const later = unscheduledGate({
    now,
    current: CURRENT,
    index: INDEX,
    busyDay: BUSY,
    opening: { ...tomorrow, day: 2, opensAt: 450 },
    openNow: 0,
  });
  assert.equal(later.body, 'Classes have not started yet. PAES opens at 7:30am and Vacant ranks rooms again at 8:00am.');
  // And with a door open there is no door clause and no day word to carry.
  const open = unscheduledGate({ now, current: CURRENT, index: INDEX, busyDay: BUSY, opening: tomorrow, openNow: 46 });
  assert.equal(open.body, 'Classes have not started yet. Vacant ranks rooms again at 8:00am.');
});

test('the closed group breaks a distance tie on which door opens first', () => {
  // A sort key that never moves a row is decoration, so it is measured, and the
  // figure is pinned here rather than left in a comment to rot. Over a 12x12
  // grid on the campus box at every quarter hour of every day: 2,984 of 96,768
  // closed lists come out in a different order, 3.08%, and no row moves more
  // than one place. The commonest case is Hayes Hall over Derby Hall, 240 of
  // them, both a 42 minute walk and both 2,492 m out, Hayes opening 6:00am and
  // Derby 7:00am.
  const lats = Object.values(SLICE).map((b) => b.lat);
  const lons = Object.values(SLICE).map((b) => b.lon);
  const box = { s: Math.min(...lats), n: Math.max(...lats), w: Math.min(...lons), e: Math.max(...lons) };
  const byWalk = (a, b) => a.walk - b.walk || a.metres - b.metres;
  const order = Object.fromEntries(Object.keys(COUNTS).map((code, i) => [code, i]));
  let lists = 0;
  let moved = 0;
  let furthest = 0;
  for (let i = 0; i < 12; i++) {
    for (let j = 0; j < 12; j++) {
      const origin = { lat: box.s + ((box.n - box.s) * i) / 11, lon: box.w + ((box.e - box.w) * j) / 11 };
      for (let day = 0; day < 7; day++) {
        for (let m = 0; m < MINUTES_IN_DAY; m += 15) {
          const { closed } = rankBuildings({ origin, buildings: SLICE, counts: COUNTS, hoursFor: DOORS, day, nowMin: m });
          lists += 1;
          // Only rows that tie on the walk can have moved, so the comparison is
          // run by run: inside each tie the walk alone would leave them in the
          // index's own order, and the sorted list says where they went.
          let move = 0;
          for (let i0 = 0; i0 < closed.length; ) {
            let j0 = i0;
            while (j0 + 1 < closed.length && byWalk(closed[j0], closed[j0 + 1]) === 0) j0 += 1;
            if (j0 > i0) {
              const run = closed.slice(i0, j0 + 1);
              const walkOnly = [...run].sort((a, b) => order[a.code] - order[b.code]);
              for (let k = 0; k < run.length; k++) move = Math.max(move, Math.abs(walkOnly.indexOf(run[k]) - k));
            }
            i0 = j0 + 1;
          }
          if (move > 0) moved += 1;
          furthest = Math.max(furthest, move);
          for (let k = 0; k + 1 < closed.length; k++) {
            const [a, b] = [closed[k], closed[k + 1]];
            assert.ok(byWalk(a, b) <= 0, 'the walk still leads');
            if (byWalk(a, b) !== 0) continue;
            // The key is the NEXT door. An `after` row's opensAt is the minute
            // it opened this morning and then locked, so keying on that put a
            // building shut for the rest of the day above one still to open:
            // four of those, all Sullivant Hall over Hagerty Hall on a Sunday
            // evening.
            assert.ok(
              a.when === 'before' || b.when !== 'before',
              `${a.code} (${a.when}) sorts above ${b.code} (${b.when}) at the same distance`,
            );
            if (a.when === 'before' && b.when === 'before') {
              assert.ok(a.opensAt <= b.opensAt, `${a.code} opens ${a.opensAt} above ${b.code} opens ${b.opensAt}`);
            }
          }
        }
      }
    }
  }
  assert.equal(lists, 96768);
  assert.equal(moved, 2984);
  assert.equal(furthest, 1);
});

// ---- the screens that say it

// Everything above is a pure function in js/state.js, and the bug in this
// branch's own title lives in js/app.js. These read the two files as text, the
// way dev.test.mjs and the container-query test already do, so putting any one
// of the screen changes back turns something here red.

test('paintGate says the night out loud instead of borrowing the buildings screen', () => {
  const app = readFileSync(join(ROOT, 'js/app.js'), 'utf8');
  const from = app.indexOf('function paintGate(');
  const gate = app.slice(from, app.indexOf('\n// ---', from));
  assert.ok(gate.length > 200, 'paintGate not found');
  assert.match(gate, /unscheduledGate\(\{/);
  assert.doesNotMatch(gate, /UNSCHEDULED\.(head|body)/, 'the buildings screen pair is back on the question screen');
  // Orange is a refusal, not a clock.
  assert.match(gate, /classList\.remove\('refusal'\)/);
  assert.match(gate, /classList\.add\('refusal'\)/);
  assert.ok(
    gate.indexOf("classList.remove('refusal')") < gate.indexOf('if (!s || s.ranked)'),
    'the class has to be cleared before the branch, or a gate hidden by a ranked minute keeps it',
  );
});

test('the gate card is only orange when it refuses', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const rules = html.slice(html.indexOf('\n  #gate {'), html.indexOf('#gate p {'));
  assert.match(rules, /border: 1px solid var\(--line\)/, '#gate wears --warn on every state again');
  assert.doesNotMatch(rules.slice(0, rules.indexOf('#gate.refusal')), /var\(--warn\)/);
  assert.match(rules, /#gate\.refusal \{ border-color: var\(--warn\); \}/);
  assert.match(rules, /#gate\.refusal h2 \{ color: var\(--warn\); \}/);
  // The two colours in docs/DECISIONS.md were read off the running app: Labor
  // Day at 2:00pm comes out rgb(255, 176, 46) and Monday at 11:40pm
  // rgb(29, 35, 44). These are the tokens they resolve from.
  assert.match(html, /--warn:\s*#ffb02e/i);
  assert.match(html, /--line:\s*#1d232c/i);
});

test('the question screen is repainted when the app comes back to the foreground', () => {
  // The gate heading is a live minute now. Left off this list, a card booted at
  // 11:40pm on a Monday still read "Monday, 11:40pm" at 10:00am on the Tuesday,
  // on a minute the app is willing to rank.
  const app = readFileSync(join(ROOT, 'js/app.js'), 'utf8');
  const hook = app.slice(app.indexOf("addEventListener('visibilitychange'"));
  assert.match(hook.slice(0, 500), /state\.screen === 'ask'/);
});

test('the buildings screen names the door it is already holding the hours for', () => {
  const app = readFileSync(join(ROOT, 'js/app.js'), 'utf8');
  const near = app.slice(app.indexOf('function paintNear('), app.indexOf("$('near').innerHTML"));
  assert.match(near, /openingPhrase\(/);
  assert.match(near, /Everything is closed\. \$\{door\}\./);
  assert.match(near, /Everything is closed right now\./);
  // The nearest of the tied doors, not the first one the index reaches.
  assert.match(near, /groups\.closed\.find\(/);
  // And no door named at all on a day the university is shut.
  const first = app.slice(app.indexOf('function firstDoor('), app.indexOf('function paintNear('));
  assert.match(first, /closedDayFor\([\s\S]*?'offices-closed'/);
});

test('a focused heading does not wear the ring that means you can press it', () => {
  const app = readFileSync(join(ROOT, 'js/app.js'), 'utf8');
  assert.match(app, /el\.focus\(\{ preventScroll: true, focusVisible: false \}\)/);
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  // Scoped to h2, so the roving-tabindex chips, which are buttons carrying the
  // same attribute, keep their ring.
  assert.match(html, /h2\[tabindex="-1"\]:focus-visible \{ outline: none; \}/);
});
