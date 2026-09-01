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
  rankBuildings,
  resolveState,
  roomsPerBuilding,
  scheduleDarkOn,
  scheduleShareOn,
  staleness,
  windowPhrase,
} from '../../js/state.js';
import { roomClaim } from '../../js/claim.js';
import {
  DISMISS_PX,
  FULL as FULL_SHEET,
  PEEK,
  REST,
  bandFor,
  floorFor,
  openAt,
  restFor,
  sheetAfterDrag,
} from '../../js/sheet.js';
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

// ---- the band each screen leaves

test('the strip the map composes for is the one that screen actually leaves', () => {
  // viewport() held a second copy of the resting height that said peek on every
  // screen, so the room screen framed the walk line for a 324px sheet and then
  // drew it under a 613px one: measured off the canvas at 393x852, 164 of the
  // 206px of target ink came out under the panel. These are the values, not the
  // spelling, so moving ROOM_SHEET moves this line.
  assert.equal(bandFor('room', 852), 239);
  assert.equal(bandFor('list', 852), 528);
  assert.equal(bandFor('near', 852), 528);
  assert.equal(bandFor('pick', 852), 187);
  assert.equal(bandFor('about', 852), 187);
  // The question screen has no sheet, so the whole canvas is the band.
  assert.equal(bandFor('ask', 852), 852);
  // A screen nobody wrote down rests where the ranked list does.
  assert.equal(bandFor('nowhere', 852), 528);
  // The install rail stands the sheet on top of it, so the map has that much
  // less. Left out, 112 of the room screen's 122px of walk line went back under
  // the panel with both bars up at 393x852.
  assert.equal(bandFor('room', 852, 147), 239 - 147);
  assert.equal(bandFor('list', 852, 80), 528 - 80);
  // A rail taller than the strip leaves nothing, and the camera still needs a
  // number it can divide by.
  assert.equal(bandFor('room', 852, 538), 1);
  assert.equal(restFor('room'), REST.room);
  assert.ok(REST.room > REST.list, `the room rests at ${REST.room}, the list at ${REST.list}`);
});

test('viewport() reads that one table rather than deciding a second time', () => {
  const src = readFileSync(join(ROOT, 'js', 'app.js'), 'utf8');
  const at = src.indexOf('function viewport()');
  const body = src.slice(at, src.indexOf('\n}', at));
  assert.match(body, /band: bandFor\(state\.screen, height, railHeight\(\)\)/);
  assert.equal(/state\.screen ===/.test(body), false, 'viewport() decides the resting height a second time');
});

test('a sheet dragged on one screen does not become another screen height', () => {
  const H = 852;
  // Leaving a room used to keep its 613px sheet while the map had already been
  // composed for the list's 528px band, so the walk line was drawn under the
  // panel and the Back tap rescaled it 1.69x with the camera untouched.
  assert.equal(openAt('list', { screen: 'room', h: 613 }, H), REST.list * H);
  assert.equal(openAt('near', { screen: 'room', h: 613 }, H), REST.near * H);
  // Staying on one screen keeps whatever height it was dragged to.
  assert.equal(openAt('list', { screen: 'list', h: 613 }, H), 613);
  // Nothing dragged yet, so the screen's own rest.
  assert.equal(openAt('list', { screen: 'list', h: 0 }, H), REST.list * H);
  assert.equal(openAt('room', null, H), REST.room * H);
});

test('a screen change re-composes the camera for the strip it leaves', () => {
  // The one half of this that a suite with no layout engine can hold: that the
  // call is there. What it is worth was measured by driving the app at 393x852,
  // where the list frame after Back is the frame the list had before the room
  // was opened, walk line at y 197..402.5 either side and none of it under the
  // panel.
  const src = readFileSync(join(ROOT, 'js', 'app.js'), 'utf8');
  const pane = src.slice(src.indexOf('function showPane('), src.indexOf('function reframe()'));
  assert.match(pane, /const arrived = state\.screen !== name;/);
  assert.match(pane, /if \(arrived\) reframe\(\);/);
});

// ---- what a drag on the sheet means

test('only the grip can pull the sheet far enough to throw the answer away', () => {
  const H = 852;
  const peek = PEEK * H;
  // Driven at 393x852, the 44px version dismissed on a 60px pull started on a
  // row: the sheet went 324 to 0 and took the list, the selection and the
  // scroll position with it. The pane's floor is peek however hard it is pulled.
  assert.equal(sheetAfterDrag(peek, 60, 'pane', H).dismiss, false);
  const hard = sheetAfterDrag(peek, 400, 'pane', H);
  assert.equal(hard.dismiss, false);
  assert.equal(hard.h, peek);
  // The grip owns the travel below peek, and the end of it is the trigger. 60px
  // is still short of it, which is the pull the row bug was measured on.
  assert.equal(sheetAfterDrag(peek, 60, 'grip', H).dismiss, false);
  assert.equal(sheetAfterDrag(peek, DISMISS_PX - 1, 'grip', H).dismiss, false);
  assert.equal(sheetAfterDrag(peek, DISMISS_PX, 'grip', H).dismiss, true);
  // The sheet stops dead at the floor, so a harder pull lands on it, not past.
  assert.equal(sheetAfterDrag(peek, 400, 'grip', H).h, floorFor('grip', H));
  // Upward, both stop at full.
  assert.equal(sheetAfterDrag(peek, -900, 'grip', H).h, FULL_SHEET * H);
});

test('the two floors are peek and the end of the grip travel', () => {
  const H = 852;
  assert.equal(floorFor('pane', H), PEEK * H);
  assert.equal(floorFor('grip', H), PEEK * H - DISMISS_PX);
});

test('the gesture asks js/sheet.js instead of deriving the rule again', () => {
  // Two copies of "how far is far enough" is how a threshold meant for the grip
  // came to fire on a drag that started on a row.
  const src = readFileSync(join(ROOT, 'js', 'app.js'), 'utf8');
  assert.match(src, /sheetAfterDrag\(drag\.h0, dy, drag\.from, window\.innerHeight\)/);
  assert.equal(src.includes('DISMISS_PX'), false, 'app.js names the dismiss distance a second time');
});
