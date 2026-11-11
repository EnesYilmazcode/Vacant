// Offline. The libraries' and the Union's hours, from fixtures in the shape the
// two live sources had on 2026-11-10, and the app's reading of the file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LIBRARIES,
  clockMinutes,
  datesIn,
  libcalDay,
  parseLibcal,
  parseUnionPage,
  span,
  unionDays,
} from '../lib/study-spaces.mjs';
import { buildStudySpaces } from '../fetch-study-spaces.mjs';
import { doorAt, rankStudySpaces } from '../../js/study.js';
import { resolveState } from '../../js/state.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

// ------------------------------------------------------------ clock reading

test('clock text reads in every spelling the two sources use', () => {
  assert.equal(clockMinutes('7:30am'), 450);
  assert.equal(clockMinutes('2am'), 120);
  assert.equal(clockMinutes('12:00 AM'), 0);
  assert.equal(clockMinutes('12pm'), 720);
  assert.equal(clockMinutes('11:59PM'), 1439);
  assert.equal(clockMinutes('8 a.m.'), 480);
  assert.equal(clockMinutes('11 p.m.'), 1380);
  assert.equal(clockMinutes('noon'), null);
  assert.equal(clockMinutes('13pm'), null);
});

test('a close at or before the open is the next morning', () => {
  assert.deepEqual(span('7:30am', '2am'), [450, 1560]);
  assert.deepEqual(span('7:30am', '12am'), [450, 1440]);
  assert.deepEqual(span('9am', '5pm'), [540, 1020]);
});

// ------------------------------------------------------------ LibCal days

const day = (date, times, rendered = '') => ({ date, times, rendered });

test('a structured LibCal day becomes minutes, and closed is an empty list', () => {
  assert.deepEqual(libcalDay(day('2026-12-14', { status: 'open', hours: [{ from: '7:30am', to: '2am' }] })), {
    hours: [[450, 1560]],
  });
  assert.deepEqual(libcalDay(day('2026-12-19', { status: 'closed' })), { hours: [] });
});

test('the 18th Avenue text days read as 24 hours, with the ID note and the last-night close', () => {
  const t = (text) => libcalDay(day('2026-12-14', { status: 'text', text }, text));
  assert.deepEqual(t("24 Hours (Current OSU ID req'd 12AM -7AM)"), { hours: [[0, 1440]], idAfterDark: true });
  assert.deepEqual(t('24 Hours, OSU ID required: 12:00 AM -7:00AM'), { hours: [[0, 1440]], idAfterDark: true });
  assert.deepEqual(t("24 Hours (Current OSU ID req'd 12AM -7AM)(Closed at 11:59PM)"), {
    hours: [[0, 1439]],
    idAfterDark: true,
  });
  assert.deepEqual(t("8am-5pm (CVM ID req'd 5PM to 8AM)"), { hours: [[480, 1020]], idAfterDark: false });
});

test('appointments, unset days and "see our website" are absent, never open', () => {
  assert.equal(libcalDay(day('2026-12-14', { status: 'ByApp' })), null);
  assert.equal(libcalDay(day('2026-12-14', { status: 'not-set' })), null);
  const text = 'See Health Sciences Library website for hours.';
  assert.equal(libcalDay(day('2026-12-14', { status: 'text', text }, text)), null);
});

const BUILDINGS = {
  '050': { name: 'Thompson Library', lat: 39.99925188, lon: -83.01488152 },
  '005': { name: 'Eighteenth Avenue Library', lat: 40.0016329, lon: -83.01333843 },
  '017': { name: 'Knowlton Hall', lat: 40.00359907, lon: -83.01678866 },
  '003': { name: 'Agricultural Administration', lat: 40.00542636, lon: -83.02722587 },
  '386': { name: 'Wexner Center for the Arts', lat: 40.00082115, lon: -83.00948504 },
  '060': { name: 'Orton Hall', lat: 39.99832824, lon: -83.01193358 },
  161: { name: 'Ohio Union', lat: 39.99765973, lon: -83.00864174 },
};

// A grid with every allow-listed library, each with `days` days of 9am-5pm
// unless a day is given explicitly.
function grid({ days = 28, drop = null, move = null } = {}) {
  const dates = Array.from({ length: days }, (_, i) =>
    new Date(Date.UTC(2026, 10, 15 + i)).toISOString().slice(0, 10));
  const locations = Object.entries(LIBRARIES)
    .filter(([lid]) => Number(lid) !== drop)
    .map(([lid, want]) => {
      const b = BUILDINGS[want.code];
      const weeks = [];
      for (let i = 0; i < dates.length; i += 7) {
        weeks.push(Object.fromEntries(dates.slice(i, i + 7).map((date, k) => [
          `d${k}`, day(date, { status: 'open', hours: [{ from: '9am', to: '5pm' }] }),
        ])));
      }
      return {
        lid: Number(lid),
        name: want.name,
        lat: String(Number(lid) === move ? b.lat + 0.01 : b.lat),
        long: String(b.lon),
        weeks,
      };
    });
  return { locations };
}

test('every allow-listed library is read, filed under its building', () => {
  const out = parseLibcal(grid(), BUILDINGS);
  assert.equal(out.length, Object.keys(LIBRARIES).length);
  const thompson = out.find((s) => s.id === 'lib-16286');
  assert.equal(thompson.b, '050');
  assert.deepEqual(thompson.days['2026-11-16'], [[540, 1020]]);
});

test('a library LibCal stops listing fails the build rather than vanishing quietly', () => {
  assert.throws(() => parseLibcal(grid({ drop: 16286 }), BUILDINGS), /Thompson/);
});

test('a library whose pin moved off its building fails the build', () => {
  assert.throws(() => parseLibcal(grid({ move: 16300 }), BUILDINGS), /Geology Library .* m from Orton Hall/);
});

// ------------------------------------------------------------ the Union page

test('date ranges read in every shape the Union page writes them', () => {
  assert.deepEqual(datesIn('December 17, 2026-January 9, 2027 (Winter Break)').ranges, [['2026-12-17', '2027-01-09']]);
  assert.deepEqual(datesIn('January 17-18, 2027 (MLK Jr Day)').ranges, [['2027-01-17', '2027-01-18']]);
  assert.deepEqual(datesIn('University Winter Recess (December 26, 2026 - January 3, 2027)').ranges, [
    ['2026-12-26', '2027-01-03'],
  ]);
  assert.deepEqual(datesIn("New Year's Day (January 1, 2027)").ranges, [['2027-01-01', '2027-01-01']]);
  const thanksgiving = datesIn('Thanksgiving (November 26-27, 2026, 8 p.m. close on November 25)');
  assert.deepEqual(thanksgiving.ranges, [['2026-11-26', '2026-11-27']]);
  assert.equal(thanksgiving.early, '2026-11-25');
});

// The live page's structure, cut down, with the en dash spelled three ways.
const UNION_HTML = `<main><h1>Hours</h1>
<h2>Regular Building Hours</h2><table><tr><th>Days</th><th>Hours</th></tr>
<tr><td>Monday&ndash;Friday</td><td>8 a.m.&ndash;11 p.m.</td></tr>
<tr><td>Saturday–Sunday</td><td>10 a.m.–11 p.m.</td></tr></table>
<h2>Academic Break and Summer Hours</h2><table><tr><th>Days</th><th>Hours</th></tr>
<tr><td>Monday�Friday</td><td>8 a.m.�8 p.m.</td></tr>
<tr><td>Saturday–Sunday</td><td>10 a.m.–8 p.m.</td></tr></table>
<p>2026–2027 Applicable Dates (Includes 8 p.m. close on the eve of holiday periods.)</p>
<p>December 17, 2026–January 9, 2027 (Winter Break)</p>
<p>The Ohio Union is closed on the following federal and university holidays</p>
<p>Thanksgiving (November 26–27, 2026, 8 p.m. close on November 25)</p>
<p>Christmas (December 24–25, 2026)</p>
<p>The Ohio Union closes early (8 p.m.) with limited service on the following federal holidays:</p>
</main>`;

test('the Union page reads into its two tables and its dated exceptions', () => {
  const rules = parseUnionPage(UNION_HTML);
  assert.deepEqual(rules.regular, { weekday: [480, 1380], weekend: [600, 1380] });
  assert.deepEqual(rules.brk, { weekday: [480, 1200], weekend: [600, 1200] });
  assert.deepEqual(rules.breaks, [['2026-12-17', '2027-01-09']]);
  assert.deepEqual(rules.closed, [['2026-11-26', '2026-11-27'], ['2026-12-24', '2026-12-25']]);
  assert.deepEqual(rules.early, ['2026-11-25']);
});

test('a Union page missing either table fails instead of half-reading', () => {
  assert.throws(() => parseUnionPage(UNION_HTML.replace('Regular Building Hours', 'Our Hours')), /Regular/);
  assert.throws(() => parseUnionPage(UNION_HTML.replace('Academic Break and Summer Hours', 'Other')), /Break/);
});

test('the Union rules become dated hours: closed, break, weekend and the early close', () => {
  const days = unionDays(parseUnionPage(UNION_HTML), '2026-11-24', '2026-12-25');
  assert.deepEqual(days['2026-11-24'], [[480, 1380]]); // Tuesday
  assert.deepEqual(days['2026-11-25'], [[480, 1200]]); // the eve of Thanksgiving
  assert.deepEqual(days['2026-11-26'], []);
  assert.deepEqual(days['2026-11-28'], [[600, 1380]]); // Saturday
  assert.deepEqual(days['2026-12-15'], [[480, 1380]]); // finals week is term hours
  assert.deepEqual(days['2026-12-17'], [[480, 1200]]); // winter break starts
  assert.deepEqual(days['2026-12-24'], []);
});

test('the whole file builds from the two responses', () => {
  const file = buildStudySpaces({
    grid: grid(),
    unionHtml: UNION_HTML,
    buildings: BUILDINGS,
    entrances: {},
    generated: '2026-11-15',
  });
  assert.equal(file.from, '2026-11-15');
  assert.equal(file.to, '2026-12-12');
  assert.equal(file.spaces.at(-1).id, 'union');
  assert.equal(Object.keys(file.spaces.at(-1).days).length, 28);
  assert.deepEqual(Object.keys(file.buildings).sort(), Object.keys(BUILDINGS).sort());
});

test('a truncated LibCal feed fails the build', () => {
  assert.throws(
    () => buildStudySpaces({ grid: grid({ days: 7 }), unionHtml: UNION_HTML, buildings: BUILDINGS, entrances: {} }),
    /7 days for Thompson/,
  );
});

// ------------------------------------------------------------ the app's reading

const at = (iso, hh, mm = 0) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, hh, mm);
};

const THOMPSON = {
  id: 'lib-16286', name: 'Thompson Library', b: '050',
  days: {
    '2026-12-14': [[450, 1560]],
    '2026-12-15': [[450, 1560]],
    '2026-12-19': [],
    '2026-12-20': [[660, 1080]],
  },
};
const EIGHTEENTH = {
  id: 'lib-16287', name: '18th Avenue Library', b: '005', note: 'OSU ID needed after midnight',
  days: {
    '2026-12-14': [[0, 1440]],
    '2026-12-15': [[0, 1440]],
    '2026-12-16': [[0, 1440]],
    '2026-12-17': [[0, 1440]],
    '2026-12-18': [[0, 1439]],
  },
};

test('a door open past midnight is open at 1am the next day, until 2am', () => {
  assert.deepEqual(doorAt(THOMPSON, at('2026-12-14', 22)), { when: 'open', closesAt: 1560 });
  assert.deepEqual(doorAt(THOMPSON, at('2026-12-15', 1)), { when: 'open', closesAt: 120 });
  assert.deepEqual(doorAt(THOMPSON, at('2026-12-15', 3)), { when: 'before', opensAt: 450 });
});

test('the day after the last published one is known only through the spill', () => {
  assert.deepEqual(doorAt(THOMPSON, at('2026-12-16', 1)), { when: 'open', closesAt: 120 });
  assert.deepEqual(doorAt(THOMPSON, at('2026-12-16', 3)), { when: 'unknown' });
});

test('closed, after hours and unpublished are three different answers', () => {
  assert.deepEqual(doorAt(THOMPSON, at('2026-12-19', 12)), { when: 'closed-today' });
  assert.deepEqual(doorAt(THOMPSON, at('2026-12-20', 19)), { when: 'after' });
  assert.deepEqual(doorAt(THOMPSON, at('2026-12-25', 12)), { when: 'unknown' });
});

test('24 hours a day, one day at a time, chains into one closing time', () => {
  // Monday 3pm: open through Friday's 11:59pm close, four days and change out.
  assert.deepEqual(doorAt(EIGHTEENTH, at('2026-12-14', 15)), { when: 'open', closesAt: 4 * 1440 + 1439 });
  assert.deepEqual(doorAt(EIGHTEENTH, at('2026-12-18', 15)), { when: 'open', closesAt: 1439 });
});

test('the list is open first, nearest first, and leaves out what it cannot describe', () => {
  const buildings = { '050': BUILDINGS['050'], '005': BUILDINGS['005'], 161: BUILDINGS[161] };
  const union = { id: 'union', name: 'Ohio Union', b: '161', days: {} };
  // Standing on the Thompson steps at 10pm on the Monday of finals week.
  const origin = { lat: 39.9989, lon: -83.0149 };
  const { open, closed } = rankStudySpaces({
    spaces: [EIGHTEENTH, THOMPSON, union],
    buildings,
    origin,
    field: null,
    now: at('2026-12-14', 22),
  });
  assert.deepEqual(open.map((s) => s.name), ['Thompson Library', '18th Avenue Library']);
  assert.equal(open[1].note, 'OSU ID needed after midnight');
  assert.deepEqual(closed, []);
});

// ------------------------------------------------------------ finals week

test('the finals refusal offers the libraries, and the app may fall back', () => {
  const current = read('data/current.json');
  const index = read(current.rooms);
  const s = resolveState({ now: at('2026-12-14', 11), current, index });
  assert.equal(s.kind, 'EXAM_REFUSAL');
  assert.equal(s.action.study, true);
  assert.equal(s.action.to, 'near');
  assert.match(s.action.label, /libraries/i);
});

// ------------------------------------------------------------ the shipped file

test('the shipped file is the shape the app reads, with a door for every space', () => {
  const file = read('data/study-spaces.json');
  assert.ok(file.from <= file.to);
  assert.ok(file.spaces.length >= 6, `${file.spaces.length} spaces`);
  for (const s of file.spaces) {
    const b = file.buildings[s.b];
    assert.ok(b && Number.isFinite(b.lat) && Number.isFinite(b.lon), `${s.name} has no building point`);
    for (const [date, spans] of Object.entries(s.days)) {
      assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
      for (const [open, close] of spans) {
        assert.ok(open >= 0 && open < 1440 && close > open && close <= 2 * 1440, `${s.name} ${date}`);
      }
    }
  }
});

// ------------------------------------------------------------ outside finals
//
// The libraries are on the buildings screen whenever their hours loaded, and
// they are the way out of an empty answer. These read js/app.js the way
// screens.test.mjs does, because the rules live in its paint functions.

const app = readFileSync(join(ROOT, 'js', 'app.js'), 'utf8');
const between = (from, to) => app.slice(app.indexOf(from), app.indexOf(to, app.indexOf(from)));

test('the libraries are on the buildings screen outside finals week too', () => {
  const group = between('function studyGroup(', '\n}\n');
  assert.match(group, /if \(!hasStudy\(\)\) return ''/);
  assert.doesNotMatch(group, /EXAM_REFUSAL/);
  // Nothing published for today is no group at all, not "no library is open".
  assert.match(group, /if \(!state\.studyRows\.length\) return ''/);
});

test('they lead when the classrooms cannot answer, or when they were asked for', () => {
  const leads = between('const studyLeads', ';\n');
  assert.match(leads, /state\.studyAsked === true/);
  assert.match(leads, /EXAM_REFUSAL/);
  assert.match(leads, /classroomBuildingsOpen === 0/);
});

test('an empty answer names the libraries and offers the button', () => {
  const empty = between('function emptyAnswer(', '\nfunction wireFootActs');
  assert.equal((empty.match(/\bstudy,/g) ?? []).length, 4, 'every branch carries the libraries line');
  assert.match(app, /\$\('c-study'\)\.onclick = \(\) => openNear\(\{ study: true \}\)/);
  assert.match(app, /\$\('l-study'\)\.onclick = \(\) => openNear\(\{ study: true \}\)/);
});

test('a close past tomorrow morning reads as all night, not as a time tonight', () => {
  assert.match(app, /const allNight = \(closesAt\) => closesAt == null \|\| closesAt >= 1440 \+ 7 \* 60;/);
});

test('the empty list no longer names the removed room needs filter', () => {
  // `filtered` outlived the filter by seven weeks and threw on every empty answer.
  const list = between('function paintList(', '\n}\n');
  assert.doesNotMatch(list.replace(/^\s*\/\/.*$/gm, ''), /\bfiltered\b/);
});
