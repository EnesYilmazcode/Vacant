#!/usr/bin/env node
// Diff our room index against Roomix, the other Ohio State room finder, and
// settle every disagreement against the live class-search API.
//
//   mkdir rx
//   curl -sS -o rx/rx_matrix.json  https://api.roomix.app/indexed/1268/room_matrix.json
//   curl -sS -o rx/rx_courses.json https://api.roomix.app/indexed/1268/courses.json
//   node scripts/roomix-crosscheck.mjs rx                  offline, no network
//   node scripts/roomix-crosscheck.mjs rx --rooms          list the never-seen rooms
//   node scripts/roomix-crosscheck.mjs rx --adjudicate     ask content.osu.edu who is right
//
// The two Roomix files are 2.7 MB and are NOT committed. Everything printed here
// is derived from them plus the committed index, so a reader refetches and reruns.
//
// Agreement between the two proves nothing: Roomix reads the same
// content.osu.edu endpoint we do and inherits our blind spots exactly. A
// DISAGREEMENT is the only thing worth having, because it can be settled for
// free against the live API, which is what --adjudicate does.
// docs/research/ground-truth-walk.md holds the score from the run of 2026-09-02.
//
// The committed index is always compared. The raw harvest is optional: it is
// gitignored, so a fresh clone does not have it, and without it "our index never
// saw this room" softens to "the shipped index does not carry it", which is a
// different claim because 449 rooms are dropped on purpose by the safety filter.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://content.osu.edu/v2/classes/search';
const UA =
  'Vacant/0.1 (+https://github.com/EnesYilmazcode/Vacant; contact via repo issues) ' +
  'one-off room-index cross-check, <=600 requests';

// pattern_bin index 0 is Monday; ours is 0 = Sunday, the index
// data/buildings-hours.json uses. Backwards, every interval shifts a day and the
// diff still looks plausible, so it is a named table rather than arithmetic.
export const PATTERN_DAY = [1, 2, 3, 4, 5, 6, 0];
const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export const hhmmToMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(2));
export function clockToMin(c) {
  const x = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(String(c).trim());
  if (!x) return null;
  const h = Number(x[1]) % 12;
  return (/pm/i.test(x[3]) ? h + 12 : h) * 60 + Number(x[2]);
}

// Roomix's `building` is "<buildingCode>:<room>", which is our own row key with
// no fuzzy matching. ONE exception on term 1268: they write 339:37 where the API
// and we write 339:037. That is 1 key of 880, so the raw key stays the join and
// a leading-zero-stripped key is only a second chance at it.
export const roomKey = (code, room) => `${code}:${room}`;
export const loose = (key) => key.replace(/:0+(?=.)/, ':');

// Every (room, weekday, start, end) Roomix asserts, with the section behind it.
export function roomixIntervals(courses) {
  const tuples = new Map();
  const skipped = { noPattern: 0, noTime: 0 };
  for (const [title, course] of Object.entries(courses.courses ?? {})) {
    for (const [num, sec] of Object.entries(course.numbers ?? {})) {
      for (const [mn, m] of Object.entries(sec.meetings ?? {})) {
        if (!/^[01]{7}$/.test(m.pattern_bin ?? '')) {
          skipped.noPattern++;
          continue;
        }
        const t = /^(\d{4})-(\d{4})$/.exec(m.time ?? '');
        if (!t) {
          skipped.noTime++;
          continue;
        }
        const start = hhmmToMin(t[1]);
        const end = hhmmToMin(t[2]);
        const days = [];
        for (let i = 0; i < 7; i++) if (m.pattern_bin[i] === '1') days.push(PATTERN_DAY[i]);
        for (const day of days) {
          const key = `${m.building}|${day}|${start}|${end}`;
          if (!tuples.has(key)) tuples.set(key, []);
          tuples.get(key).push({
            side: 'roomix',
            title,
            classNumber: num.split(':')[0],
            mn,
            building: m.building,
            days: days.slice().sort((a, b) => a - b),
            start,
            end,
          });
        }
      }
    }
  }
  return { tuples, skipped };
}

// The same tuples off our RAW harvest, before merging and group propagation, so
// a disagreement points at a class rather than at a merged block.
export function harvestIntervals(meetings) {
  const tuples = new Map();
  for (const rec of meetings) {
    const m = rec.m;
    if (!m?.facilityId || !m.buildingCode || !m.room) continue;
    const start = clockToMin(m.startTime);
    const end = clockToMin(m.endTime);
    if (start == null || end == null) continue;
    const days = [];
    for (let d = 0; d < 7; d++) if (m[DAY_KEYS[d]] === true) days.push(d);
    if (!days.length) continue;
    for (const day of days) {
      const key = `${roomKey(m.buildingCode, m.room)}|${day}|${start}|${end}`;
      if (!tuples.has(key)) tuples.set(key, []);
      tuples.get(key).push({
        side: 'ours',
        subject: rec.subject,
        catalogNumber: rec.catalogNumber,
        classNumber: rec.classNumber,
        mn: m.meetingNumber,
        facilityId: m.facilityId,
        building: roomKey(m.buildingCode, m.room),
        days,
        start,
        end,
      });
    }
  }
  return tuples;
}

export const indexTuples = (rooms) => {
  const out = new Set();
  for (const r of Object.values(rooms)) {
    for (const iv of r.busy) out.add(`${roomKey(r.b, r.n)}|${iv[0]}|${iv[1]}|${iv[2]}`);
  }
  return out;
};

// The minutes a side calls busy, per room and weekday. A tuple diff on its own
// overstates the disagreement: our builder merges overlapping bookings inside a
// session, so Roomix's 0900-1145 sitting inside our merged 0900-1200 is a
// different tuple and the same answer. Only a minute the other side leaves free
// changes what a student is told.
export function minutesByRoomDay(keys) {
  const out = new Map();
  for (const key of keys) {
    const [room, day, start, end] = key.split('|');
    const k = `${room}|${day}`;
    if (!out.has(k)) out.set(k, new Set());
    const set = out.get(k);
    for (let m = Number(start); m < Number(end); m++) set.add(m);
  }
  return out;
}

export function uncoveredMinutes(key, other) {
  const [room, day, start, end] = key.split('|');
  const set = other.get(`${room}|${day}`) ?? new Set();
  let n = 0;
  for (let m = Number(start); m < Number(end); m++) if (!set.has(m)) n++;
  return n;
}

// A facilityId for a room we never harvested, so the never-seen list reads
// against the ids the rest of the repo uses. The room's leading letters join the
// building abbreviation and its digit run pads to four: 148 plus "N056" is
// SON0056. MEASURED on term 1268: this rebuilds 878 of the 880 facilityIds the
// harvest actually carries. The two it misses, AARL100 and WSB300, follow no
// pattern at all, which is why a derived id is printed as derived.
export function facilityIdFrom(abbrev, room) {
  const x = /^([A-Za-z]*)(\d*)(.*)$/.exec(room);
  if (!x) return abbrev + room;
  return abbrev + x[1] + (x[2] ? x[2].padStart(4, '0') : '') + x[3];
}

export function learnAbbrevs(meetings) {
  const out = new Map();
  for (const rec of meetings) {
    const m = rec.m;
    if (!m?.facilityId || !m.buildingCode || !m.room) continue;
    const x = /^([A-Za-z]*)(\d*)(.*)$/.exec(m.room);
    const tail = x[1] + (x[2] ? x[2].padStart(4, '0') : '') + x[3];
    if (m.facilityId.endsWith(tail)) {
      out.set(m.buildingCode, m.facilityId.slice(0, m.facilityId.length - tail.length));
    }
  }
  return out;
}

// Search returns ONE course as SEVERAL entries, each holding a subset of its
// sections: KOREAN 5256 comes back twice, section 36616 in one entry and 36617
// in the other. Taking the first entry reported ten live sections as deleted, so
// every entry on the page is scanned.
export function findSection(data, classNumber) {
  for (const entry of data.courses ?? []) {
    for (const sec of entry.sections ?? []) {
      if (String(sec.classNumber) === String(classNumber)) return { entry, sec };
    }
  }
  return null;
}

export function liveMeeting(sec, mn) {
  const m = (sec.meetings ?? []).find((x) => String(x.meetingNumber) === String(mn));
  if (!m) return null;
  const days = [];
  for (let d = 0; d < 7; d++) if (m[DAY_KEYS[d]] === true) days.push(d);
  return {
    room: m.buildingCode && m.room ? roomKey(m.buildingCode, m.room) : (m.facilityId ?? null),
    days,
    start: clockToMin(m.startTime),
    end: clockToMin(m.endTime),
  };
}

// ------------------------------------------------------------------------ report

// Everything below runs only when the file is run, so a test can import the
// parsers above without a report and a network call falling out of the import.
async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };
  const dir = args.find((a) => !a.startsWith('--') && a !== flag('--harvest')) ?? 'rx';
  const current = JSON.parse(readFileSync(join(ROOT, 'data', 'current.json'), 'utf8'));
  const TERM = current.term;
  const harvestPath = flag('--harvest') ?? join(ROOT, 'data', `harvest-${TERM}.json.gz`);

  const matrix = JSON.parse(readFileSync(join(dir, 'rx_matrix.json'), 'utf8'));
  const rxCourses = JSON.parse(readFileSync(join(dir, 'rx_courses.json'), 'utf8'));
  const shipped = JSON.parse(readFileSync(join(ROOT, 'data', `rooms-${TERM}.json`), 'utf8'));
  const harvest = existsSync(harvestPath)
    ? JSON.parse(gunzipSync(readFileSync(harvestPath)).toString('utf8'))
    : null;

  const rx = roomixIntervals(rxCourses);
  const shipTuples = indexTuples(shipped.rooms);
  const shipRooms = new Set(Object.values(shipped.rooms).map((r) => roomKey(r.b, r.n)));

  console.log(`term ${TERM}, index generated ${current.generated}`);
  console.log(
    `roomix  ${Object.keys(rxCourses.courses).length} course titles, ${rx.tuples.size} day intervals, ` +
      `${rx.skipped.noPattern} meeting(s) with no day bits, ${rx.skipped.noTime} with no time`,
  );
  console.log(`shipped ${shipRooms.size} rooms, ${shipTuples.size} day intervals`);
  if (!harvest) {
    console.log(`no harvest at ${harvestPath}; pass --harvest <file> for the never-saw numbers`);
  }

  // ---- rooms
  const matrixRooms = new Map();
  for (const [code, b] of Object.entries(matrix.buildings ?? {})) {
    for (const [room, r] of Object.entries(b.rooms ?? {})) {
      matrixRooms.set(roomKey(code, room), { code, room, ...r, building: b.info?.description ?? '' });
    }
  }
  const seen = harvest
    ? new Set(
      harvest.meetings
        .filter((rec) => rec.m?.buildingCode && rec.m?.room)
        .map((rec) => roomKey(rec.m.buildingCode, rec.m.room)),
    )
    : shipRooms;
  const seenLoose = new Set([...seen].map(loose));
  const abbrevs = harvest ? learnAbbrevs(harvest.meetings) : new Map();
  const codeAbbrev = new Map();
  for (const [abbrev, code] of Object.entries(matrix.codes ?? {})) {
    if (!codeAbbrev.has(code)) codeAbbrev.set(code, abbrev);
  }
  const neverSaw = [...matrixRooms.values()]
    .filter((r) => {
      const k = roomKey(r.code, r.room);
      return !seen.has(k) && !seenLoose.has(loose(k));
    })
    .map((r) => ({
      ...r,
      facilityId: facilityIdFrom(abbrevs.get(r.code) ?? codeAbbrev.get(r.code) ?? `?${r.code}`, r.room),
      derived: !abbrevs.has(r.code),
    }))
    .sort((a, b) => a.facilityId.localeCompare(b.facilityId));

  const label = harvest ? 'our index never saw' : 'the shipped index does not carry';
  console.log(`\nrooms in room_matrix.json ${label}: ${neverSaw.length} of ${matrixRooms.size}`);
  const byType = {};
  for (const r of neverSaw) byType[r.type || '(none)'] = (byType[r.type || '(none)'] ?? 0) + 1;
  console.log('  by facilityType', JSON.stringify(byType));
  console.log(`  with no class at all this term: ${neverSaw.filter((r) => !(r.courses ?? []).length).length}`);
  const oursNotInMatrix = [...seen].filter((k) => !matrixRooms.has(k) && !matrixRooms.has(loose(k)));
  console.log(`rooms we saw that room_matrix.json does not carry: ${oursNotInMatrix.length}  ${oursNotInMatrix.join(' ')}`);
  if (args.includes('--rooms')) {
    for (const r of neverSaw) {
      console.log(
        `  ${r.facilityId}${r.derived ? ' (derived)' : ''}  ${r.code}:${r.room}  ${r.type || '-'}  ` +
          `${r.capacity ?? '?'} seats  ${(r.courses ?? []).length} classes  ${r.building}`,
      );
    }
  }

  // ---- intervals
  function diff(name, ours, roomsInScope) {
    const rxKeys = [...rx.tuples.keys()].filter((k) => roomsInScope.has(k.split('|')[0]));
    const ourKeys = [...ours].filter((k) => roomsInScope.has(k.split('|')[0]));
    const rxSet = new Set(rxKeys);
    const ourSet = new Set(ourKeys);
    const rxOnly = rxKeys.filter((k) => !ourSet.has(k));
    const ourOnly = ourKeys.filter((k) => !rxSet.has(k));
    const rxMin = minutesByRoomDay(rxKeys);
    const ourMin = minutesByRoomDay(ourKeys);
    const rxReal = rxOnly.filter((k) => uncoveredMinutes(k, ourMin) > 0);
    const ourReal = ourOnly.filter((k) => uncoveredMinutes(k, rxMin) > 0);
    console.log(`\n${name}: ${roomsInScope.size} rooms in scope, ${rxKeys.length} roomix / ${ourKeys.length} ours`);
    console.log(`  roomix has and we do not  ${String(rxOnly.length).padStart(4)}   answer-changing ${rxReal.length}`);
    console.log(`  we have and roomix does not ${String(ourOnly.length).padStart(3)}   answer-changing ${ourReal.length}`);
    return { rxOnly, ourOnly, rxReal, ourReal };
  }

  // Every room either side carries, which is the diff the issue asks for.
  const allRooms = new Set([...matrixRooms.keys(), ...seen]);
  const shippedScope = new Set([...shipRooms].filter((k) => matrixRooms.has(k) || matrixRooms.has(loose(k))));
  let harvestDiff = null;
  if (harvest) {
    const ourRawTuples = harvestIntervals(harvest.meetings);
    harvestDiff = diff('harvest against roomix, every room', new Set(ourRawTuples.keys()), allRooms);
    harvestDiff.raw = ourRawTuples;
  }
  const shippedDiff = diff('shipped index against roomix, rooms that ship', shipTuples, shippedScope);

  if (!args.includes('--adjudicate')) {
    console.log('\nRe-run with --adjudicate to settle the disagreements against content.osu.edu.');
    process.exit(0);
  }
  if (!harvest) {
    console.error('--adjudicate needs the harvest, which carries the class number behind an interval.');
    process.exit(1);
  }

  // ---- adjudication
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cacheDir = join(ROOT, 'scratch', 'live-cache');
  const net = { requests: 0, cached: 0 };

  async function livePage(q, p) {
    const url = `${API}?${new URLSearchParams({ q, campus: 'col', term: TERM, p: String(p) })}`;
    if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
    const file = join(cacheDir, `${createHash('sha1').update(url).digest('hex')}.json`);
    if (existsSync(file)) {
      net.cached++;
      return JSON.parse(readFileSync(file, 'utf8'));
    }
    net.requests++;
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    if (!res.ok) throw new Error(`${res.status} on ${url}`);
    const data = (await res.json()).data;
    writeFileSync(file, JSON.stringify(data));
    await sleep(350);
    return data;
  }

  async function lookup(subject, catalog, classNumber, maxPages = 12) {
    const q = `${subject} ${catalog}`;
    let pages = 1;
    let sawCourse = false;
    for (let p = 1; p <= Math.min(pages, maxPages); p++) {
      const data = await livePage(q, p);
      pages = data.totalPages ?? 1;
      sawCourse = sawCourse
        || (data.courses ?? []).some((c) => c.course?.subject === subject && c.course?.catalogNumber === catalog);
      const found = findSection(data, classNumber);
      if (found) return { state: 'found', ...found };
    }
    if (pages > maxPages) return { state: 'unsure' };
    return { state: sawCourse ? 'section-gone' : 'course-gone' };
  }

  // Only the intervals that change an answer, taken back to the section behind
  // them. One request answers a whole course and is cached under scratch/, so a
  // rerun costs nothing.
  const targets = new Map();
  for (const k of harvestDiff.rxReal) {
    for (const t of rx.tuples.get(k)) targets.set(`rx${t.classNumber}|${t.mn}`, t);
  }
  for (const k of harvestDiff.ourReal) {
    for (const t of harvestDiff.raw.get(k) ?? []) targets.set(`our${t.classNumber}|${t.mn}`, t);
  }
  console.log(`\nadjudicating ${targets.size} bookings behind those intervals`);

  const verdicts = [];
  for (const t of targets.values()) {
    const subject = t.side === 'roomix' ? t.title.slice(0, t.title.lastIndexOf(' ')) : t.subject;
    const catalog = t.side === 'roomix' ? t.title.slice(t.title.lastIndexOf(' ') + 1) : t.catalogNumber;
    const hit = await lookup(subject, catalog, t.classNumber);
    if (hit.state !== 'found') {
      verdicts.push({ ...t, verdict: hit.state });
      continue;
    }
    const live = liveMeeting(hit.sec, t.mn);
    if (!live) {
      verdicts.push({ ...t, verdict: 'meeting-gone' });
      continue;
    }
    const same = live.room === t.building
      && live.start === t.start
      && live.end === t.end
      && JSON.stringify(live.days) === JSON.stringify(t.days.slice().sort((a, b) => a - b));
    verdicts.push({ ...t, verdict: same ? 'confirmed' : 'stale', live });
  }

  if (!existsSync(join(ROOT, 'scratch'))) mkdirSync(join(ROOT, 'scratch'), { recursive: true });
  writeFileSync(join(ROOT, 'scratch', 'roomix-verdicts.json'), JSON.stringify(verdicts, null, 1));
  console.log(`${net.requests} live requests, ${net.cached} served from scratch/live-cache`);
  for (const side of ['roomix', 'ours']) {
    const rows = verdicts.filter((v) => v.side === side);
    const unsure = rows.filter((v) => v.verdict === 'unsure').length;
    const right = rows.filter((v) => v.verdict === 'confirmed').length;
    const tally = {};
    for (const v of rows) tally[v.verdict] = (tally[v.verdict] ?? 0) + 1;
    console.log(
      `  ${side}: ${right} of ${rows.length - unsure} settled claims still true today ${JSON.stringify(tally)}`,
    );
  }
  console.log('scratch/roomix-verdicts.json holds every one of them.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
