// The days the class API is silent about, in both directions.
//
// A meeting's endDate is the last day of INSTRUCTION, so from December 10 to
// December 17 the busy list is empty for every room and Vacant would send
// someone into a 200-person final. And holidaySchedule is the literal string
// "OSUSIS" on all 4,931 sections sampled, so on November 11 the grid marks 788
// of 863 Wednesday busy rows occupied on a day nothing meets. Twelve wrong
// weekdays out of the 83 between the first class and the last final.
//
// Two sources, and neither is allowed to be the only one. The Registrar's
// five-year table is the publisher of record and is what ships. The vendored
// ICS is a third-party regeneration of the same calendar and is the check. They
// disagree, badly, and the build refuses rather than picking a winner.
//
// Pure. No node builtins, no fetch.

// offices-closed and no-classes are NOT shades of one thing.
//
// October 15 is Autumn Break: no classes and the doors open, which is the best
// day of the term for this app. September 7 is Labor Day: the same rooms behind
// locked doors. Nothing in the class API separates them, which is the whole
// reason this file exists.
export const OFFICES_CLOSED = 'offices-closed';
export const NO_CLASSES = 'no-classes';

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const SHORT_MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

export function addDays(date, n) {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

// The state a calendar row puts a day into, from the literal phrases the
// Registrar writes. A row that says neither is not classified: this returns
// null and the day does not ship. "Spring Break" alone is such a row.
export function stateOf(summary) {
  const s = String(summary ?? '').toLowerCase();
  if (s.includes('offices closed')) return OFFICES_CLOSED;
  if (s.includes('offices open')) return NO_CLASSES;
  return null;
}

// ---------------------------------------------------------------- ICS

// DTEND is EXCLUSIVE on a VALUE=DATE event, so 20261015..20261017 is October 15
// and 16, two days, not three.
export function parseIcs(text) {
  if (typeof text !== 'string' || !text.includes('BEGIN:VEVENT')) return [];
  // RFC 5545 folds long lines with a leading space. The vendored file has none
  // today, and unfolding costs one replace, so it is done rather than assumed.
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const out = [];
  for (const block of unfolded.split('BEGIN:VEVENT').slice(1)) {
    const field = (key) => {
      const m = new RegExp(`^${key}(?:;[^:\\r\\n]*)?:(.*)$`, 'm').exec(block);
      return m ? m[1].trim() : null;
    };
    const asDate = (v) => (v && /^\d{8}/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : null);
    const start = asDate(field('DTSTART'));
    if (!start) continue;
    const end = asDate(field('DTEND'));
    // The generator escapes commas and semicolons per the spec.
    const summary = (field('SUMMARY') ?? '').replace(/\\([,;\\])/g, '$1');
    const days = [];
    if (end && end > start) for (let d = start; d < end; d = addDays(d, 1)) days.push(d);
    else days.push(start);
    out.push({ start, end, summary, days });
  }
  return out;
}

// ------------------------------------------------- Registrar HTML tables

const stripTags = (html) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8211;|&ndash;/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

export function parseTables(html) {
  const tables = [];
  for (const table of String(html ?? '').match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    const rows = [];
    for (const row of table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
      rows.push((row.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) ?? []).map(stripTags));
    }
    tables.push(rows);
  }
  return tables;
}

// "Monday, September 7, 2026" -> 2026-09-07. Also reads the range form the
// winter recess row uses, "Monday, December 28, 2026 - Thursday, December 31,
// 2026", and returns both ends expanded.
export function parseLongDates(cell) {
  const out = [];
  for (const m of String(cell ?? '').matchAll(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/g)) {
    const month = MONTHS[m[1].toLowerCase()];
    if (!month) continue;
    out.push(iso(Number(m[3]), month, Number(m[2])));
  }
  if (out.length !== 2) return out;
  // A two-date cell is a range in this table, never two separate days.
  const days = [];
  for (let d = out[0]; d <= out[1]; d = addDays(d, 1)) days.push(d);
  return days;
}

// The five-year view, read down one column. `column` is the header label, for
// example "AUTUMN 2026". Returns one entry per calendar row that resolves to at
// least one date.
export function parseFiveYear(html, column) {
  const want = String(column ?? '').toLowerCase().trim();
  const out = [];
  for (const rows of parseTables(html)) {
    if (!rows.length) continue;
    const header = rows[0].map((c) => c.toLowerCase().trim());
    const at = header.indexOf(want);
    if (at < 0) continue;
    for (const cells of rows.slice(1)) {
      if (cells.length <= at) continue;
      const days = parseLongDates(cells[at]);
      if (!days.length) continue;
      out.push({ summary: cells[0], days });
    }
  }
  return out;
}

// The finals page, for the window only.
//
// The class-time-to-exam-slot map on the same page is useless without the exam
// ROOM, which lives in a separate Final Assignment List the Registrar marks
// coming soon. So this reads the days and nothing else.
//
// Two spellings of the same day appear on the page and both are read, so a
// change to one is caught by the other: "Monday Dec 14" in the three lookup
// tables and "Monday 12/14" in the matrix header.
export function parseFinalsWindow(html, year) {
  const days = new Set();
  for (const rows of parseTables(html)) {
    for (const cells of rows) {
      for (const cell of cells) {
        const slash = /^(?:Mon|Tues|Tue|Wednes|Wed|Thurs|Thu|Fri)[a-z]*\s+(\d{1,2})\/(\d{1,2})$/i.exec(cell);
        if (slash) {
          days.add(iso(year, Number(slash[1]), Number(slash[2])));
          continue;
        }
        const named = /^(?:Mon|Tues|Tue|Wednes|Wed|Thurs|Thu|Fri)[a-z]*\s+([A-Za-z]{3,})\.?\s+(\d{1,2})$/i.exec(cell);
        if (named) {
          const month = SHORT_MONTHS[named[1].slice(0, 3).toLowerCase()];
          if (month) days.add(iso(year, month, Number(named[2])));
        }
      }
    }
  }
  const sorted = [...days].sort();
  return sorted.length ? { start: sorted[0], end: sorted[sorted.length - 1], days: sorted } : null;
}

// ---------------------------------------------------------------- shaping

// One entry per day inside the window that a calendar row put into a state.
export function closedDays(events, [from, to]) {
  const byDate = new Map();
  for (const event of events) {
    const state = stateOf(event.summary);
    if (!state) continue;
    for (const date of event.days) {
      if (date < from || date > to) continue;
      // offices-closed wins a collision. A day that is both is a locked door.
      if (byDate.get(date) === OFFICES_CLOSED) continue;
      byDate.set(date, state);
    }
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, state]) => ({ date, state }));
}

// Windows where the grid is misleading but the day is not closed. Autumn 2026's
// first-session finals are October 13 and 14: full-term classes meet normally,
// and the seven-week rooms hold exams that are in no busy list.
//
// The five-year table writes one row per exam day and the ICS writes one range,
// so contiguous days are merged and the two sources land on the same shape.
export function lowConfidence(events, [from, to]) {
  const days = new Set();
  for (const event of events) {
    if (!/final examinations for first-session/i.test(event.summary)) continue;
    for (const d of event.days) if (d >= from && d <= to) days.add(d);
  }
  const out = [];
  for (const day of [...days].sort()) {
    const last = out[out.length - 1];
    if (last && addDays(last.end, 1) === day) last.end = day;
    else out.push({ start: day, end: day, reason: 'session-1-finals' });
  }
  return out;
}

// The exam window as the calendar states it, first day to last.
//
// The five-year view writes one row per exam day and the ICS writes one range,
// so both reduce to the same pair. This is the cross-check on the finals page,
// which is the only source that also carries the time-of-day matrix.
// `after` is required for the ICS, which carries 2021 to 2030 in one file and
// would otherwise answer with a ten-year window. The five-year view is already
// one term per column.
export function examWindow(events, after) {
  const limit = after ? addDays(after, 60) : null;
  const days = [];
  for (const event of events) {
    if (!/^Final examinations for (semester|Summer Term)/i.test(String(event.summary ?? ''))) continue;
    for (const d of event.days) {
      if (after && (d <= after || d > limit)) continue;
      days.push(d);
    }
  }
  if (!days.length) return null;
  days.sort();
  return { start: days[0], end: days[days.length - 1] };
}

// The term's teaching window, from the Registrar's own rows. Never the min and
// max of harvested meeting dates: Anatomy 6511 runs 2026-08-10 to 2026-12-11 and
// Pharmacy 7110 to 2026-12-10, because the professional colleges keep their own
// calendars, and taking the max stretches Autumn 2026 straight through the exam
// window it is supposed to end before.
export function termWindow(events) {
  const begins = [];
  const ends = [];
  for (const event of events) {
    const s = String(event.summary ?? '');
    if (/classes begin$/i.test(s)) begins.push(...event.days);
    if (/^Last day of regularly scheduled/i.test(s)) ends.push(...event.days);
  }
  if (!begins.length || !ends.length) return null;
  return { first: begins.sort()[0], last: ends.sort()[ends.length - 1] };
}

// Every date the two sources put into a state inside the window, compared.
// Returns one line per disagreement, empty when they agree.
export function diffCalendars(a, b, window, labels = ['registrar', 'ics']) {
  const map = (events) => new Map(closedDays(events, window).map((c) => [c.date, c.state]));
  const left = map(a);
  const right = map(b);
  const lines = [];
  for (const date of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const l = left.get(date);
    const r = right.get(date);
    if (l === r) continue;
    lines.push(`${date}  ${labels[0]}=${l ?? 'nothing'}  ${labels[1]}=${r ?? 'nothing'}`);
  }
  return lines;
}
