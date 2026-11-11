// Places students go to study that are not classrooms: the Columbus libraries
// and the Ohio Union. Pure, so the parsers can be tested against fixtures; the
// fetching lives in scripts/fetch-study-spaces.mjs.
//
// These are not rooms and nothing here claims a seat. What is published is when
// the door is open, by date, and that is all the app is given to say.
//
// Every day is one of three things, and the file keeps them apart:
//   [[open, close], ...]  minutes from local midnight; close may pass 1440
//                         when the published day ends after midnight (2am)
//   []                    published as closed all day
//   absent                nothing usable was published for that date

// The libraries Vacant names, by LibCal location id, and the building each one
// is in. An allow list for the same reason the room filter is one: a new LibCal
// location could be a test entry (there is one, lid 21414 "Test Library"), a
// service desk or a regional campus, and the failure mode of guessing is
// sending someone to a door that is not theirs.
//
// Left out on purpose:
//   16575 Research Commons     a service on the 18th Avenue floor plan, by
//                              appointment on most days; the building is listed
//   16303 Veterinary Medicine  CVM ID badge after 5pm and all weekend
//   16302 University Archives  by appointment only
//   16793, 16795, 16293        Health Sciences, Law and Billy Ireland publish
//                              "see our website" instead of hours
export const LIBRARIES = {
  16286: { code: '050', name: 'Thompson Library' },
  16287: { code: '005', name: '18th Avenue Library' },
  16288: { code: '017', name: 'Architecture Library' },
  16298: { code: '003', name: 'FAES Library' },
  16299: { code: '386', name: 'Fine Arts Library' },
  16300: { code: '060', name: 'Geology Library' },
  16301: { code: '005', name: 'Music & Dance Library' },
};

export const UNION = { code: '161', name: 'Ohio Union' };

// How far LibCal's own pin may sit from the building we file a library under.
// Measured on the 2026-11-10 grid: the furthest of the seven is Fine Arts at
// 29 m from the Wexner Center's point. A library that moves buildings moves
// hundreds of metres, so this fails the build rather than walking people to
// the old address.
export const MAX_PIN_METRES = 150;

// '7:30am', '2am', '12:00 AM', '11:59PM' -> minutes. Null when it is not a time.
export function clockMinutes(text) {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?\s*$/i.exec(text ?? '');
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h < 1 || h > 12 || min > 59) return null;
  return ((h % 12) + (m[3].toLowerCase() === 'p' ? 12 : 0)) * 60 + min;
}

// One opening as minutes. A close at or before the open is the next morning:
// Thompson's "7:30am - 2am" is [450, 1560], and "noon - midnight" is [720, 1440].
export function span(fromText, toText) {
  const from = clockMinutes(fromText);
  const to = clockMinutes(toText);
  if (from == null || to == null) return null;
  return [from, to <= from ? to + 1440 : to];
}

// One LibCal day. `times.status` is the structured answer and is preferred;
// "text" days are free text, and only the two shapes the 18th Avenue Library
// and its neighbours actually publish are read. Anything else is absent, not
// guessed. Returns { hours, idAfterDark } or null.
export function libcalDay(day) {
  const t = day?.times;
  if (!t) return null;
  if (t.status === 'closed') return { hours: [] };
  if (t.status === 'open' && Array.isArray(t.hours)) {
    const hours = t.hours.map((h) => span(h.from, h.to));
    return hours.length && hours.every(Boolean) ? { hours } : null;
  }
  if (t.status === 'text' || t.status === '24hours') {
    const text = String(t.text ?? day.rendered ?? '');
    const idAfterDark = /OSU ID/i.test(text);
    if (t.status === '24hours' || /^\s*24 hours/i.test(text)) {
      // "24 Hours (...)(Closed at 11:59PM)" is the last day before a closure.
      const closedAt = /closed at\s*([\d:]+\s*[ap]\.?m\.?)/i.exec(text);
      const close = closedAt ? clockMinutes(closedAt[1]) : 1440;
      return close == null ? null : { hours: [[0, close]], idAfterDark };
    }
    const range = /^\s*([\d:]+\s*[ap]\.?m\.?)\s*[-–]\s*([\d:]+\s*[ap]\.?m\.?)/i.exec(text);
    const one = range && span(range[1], range[2]);
    return one ? { hours: [one], idAfterDark } : null;
  }
  // 'not-set', 'ByApp' and anything new.
  return null;
}

const rad = (deg) => (deg * Math.PI) / 180;
export function metresBetween(a, b) {
  const x = rad(b.lon - a.lon) * Math.cos(rad((a.lat + b.lat) / 2));
  const y = rad(b.lat - a.lat);
  return Math.hypot(x, y) * 6371000;
}

// The LibCal hours grid -> one record per library in LIBRARIES. Throws when an
// allow-listed library is missing or has moved, because shipping last week's
// list without it is quieter than it should be.
export function parseLibcal(grid, buildings) {
  const byLid = new Map((grid?.locations ?? []).map((l) => [Number(l.lid), l]));
  const out = [];
  for (const [lid, want] of Object.entries(LIBRARIES)) {
    const loc = byLid.get(Number(lid));
    if (!loc) throw new Error(`LibCal no longer lists ${want.name} (lid ${lid})`);
    const b = buildings[want.code];
    if (!b) throw new Error(`${want.name} is filed under building ${want.code}, which data/buildings.json does not have`);
    const pin = { lat: Number(loc.lat), lon: Number(loc.long) };
    if (Number.isFinite(pin.lat) && Number.isFinite(pin.lon)) {
      const off = metresBetween(pin, b);
      if (off > MAX_PIN_METRES) {
        throw new Error(`LibCal puts ${want.name} ${Math.round(off)} m from ${b.name}; it may have moved`);
      }
    }
    const days = {};
    let idAfterDark = false;
    for (const week of loc.weeks ?? []) {
      for (const day of Object.values(week)) {
        const parsed = libcalDay(day);
        if (!parsed || !/^\d{4}-\d{2}-\d{2}$/.test(day.date ?? '')) continue;
        days[day.date] = parsed.hours;
        if (parsed.idAfterDark) idAfterDark = true;
      }
    }
    out.push({
      id: `lib-${lid}`,
      kind: 'library',
      name: want.name,
      b: want.code,
      ...(idAfterDark ? { note: 'OSU ID needed after midnight' } : {}),
      days,
    });
  }
  return out;
}

// ------------------------------------------------------------- the Union

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];

// The page's text, one trimmed line per block, with every dash spelled '-'.
// The CMS serves the en dash in at least three encodings, one of them broken.
export function pageLines(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;|&mdash;|&#8211;|&#8212;|[–—]|�/g, '-')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&rsquo;|’/g, "'")
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// Every date range written in a line, as [startIso, endIso] pairs. Reads the
// shapes the page uses:
//   December 17, 2026-January 9, 2027      March 12-20, 2027
//   December 26, 2026 - January 3, 2027    New Year's Day (January 1, 2027)
//   November 26-27, 2026, 8 p.m. close on November 25
// The trailing "close on" date is returned separately as an early close.
export function datesIn(line) {
  const M = `(${MONTHS.join('|')})`;
  const monthOf = (name) => MONTHS.indexOf(name.toLowerCase());
  // The early close is cut off first so it is not read as a range of its own.
  const earlyMatch = new RegExp(String.raw`close on\s+${M}\s+(\d{1,2})`, 'i').exec(line);
  const body = earlyMatch ? line.slice(0, earlyMatch.index) : line;
  const re = new RegExp(
    String.raw`${M}\s+(\d{1,2})(?:,\s*(\d{4}))?(?:\s*-\s*(?:${M}\s+)?(\d{1,2})(?:,\s*(\d{4}))?)?`,
    'gi',
  );
  const ranges = [];
  for (const m of body.matchAll(re)) {
    const [, m0, d0, y0, m1, d1, y1] = m;
    const startMonth = monthOf(m0);
    const endMonth = m1 ? monthOf(m1) : startMonth;
    const endYear = Number(y1 ?? y0);
    if (!endYear) continue; // a date with no year anywhere in it is not read
    const startYear = y0 ? Number(y0) : endMonth < startMonth ? endYear - 1 : endYear;
    ranges.push([iso(startYear, startMonth, Number(d0)), iso(endYear, endMonth, Number(d1 ?? d0))]);
  }
  let early = null;
  if (earlyMatch && ranges.length) {
    const year = Number(ranges.at(-1)[0].slice(0, 4));
    early = iso(year, monthOf(earlyMatch[1]), Number(earlyMatch[2]));
  }
  return { ranges, early };
}

// "8 a.m.-11 p.m." -> [480, 1380]
function hoursCell(text) {
  const m = /([\d:]+\s*[ap]\.?\s*m\.?)\s*-\s*([\d:]+\s*[ap]\.?\s*m\.?)/i.exec(text ?? '');
  return m ? span(m[1], m[2]) : null;
}

// The two hours tables, read by the row headings under each title.
function hoursTable(lines, title) {
  const at = lines.findIndex((l) => l.toLowerCase().startsWith(title));
  if (at < 0) return null;
  const pick = (label) => {
    const i = lines.findIndex((l, k) => k > at && k < at + 12 && l.toLowerCase() === label);
    return i < 0 ? null : hoursCell(lines[i + 1]);
  };
  const weekday = pick('monday-friday');
  const weekend = pick('saturday-sunday');
  return weekday && weekend ? { weekday, weekend } : null;
}

// The Union page -> its rules. Throws when either table is gone, because the
// whole page is prose and a half-read version of it is worse than none.
export function parseUnionPage(html) {
  const lines = pageLines(html);
  const regular = hoursTable(lines, 'regular building hours');
  const brk = hoursTable(lines, 'academic break and summer hours');
  if (!regular) throw new Error('the Ohio Union page has no Regular Building Hours table');
  if (!brk) throw new Error('the Ohio Union page has no Academic Break and Summer Hours table');

  const section = (from, to) => {
    const a = lines.findIndex((l) => from.test(l));
    if (a < 0) return [];
    const b = lines.findIndex((l, k) => k > a && to.test(l));
    return lines.slice(a + 1, b < 0 ? a + 20 : b);
  };
  const breaks = [];
  const closed = [];
  const early = [];
  for (const line of section(/applicable dates/i, /closed on the following/i)) {
    const r = datesIn(line);
    breaks.push(...r.ranges);
    if (r.early) early.push(r.early);
  }
  for (const line of section(/closed on the following/i, /closes early/i)) {
    const r = datesIn(line);
    closed.push(...r.ranges);
    if (r.early) early.push(r.early);
  }
  if (!breaks.length) throw new Error('the Ohio Union page lists no break dates');
  if (!closed.length) throw new Error('the Ohio Union page lists no closed dates');
  return { regular, brk, breaks, closed, early };
}

// The rules -> dated hours for every day in [from, to], so the app reads the
// Union exactly the way it reads a library.
export function unionDays(rules, from, to) {
  const inside = (date, ranges) => ranges.some(([a, b]) => date >= a && date <= b);
  const days = {};
  for (let d = new Date(`${from}T12:00:00Z`); ; d = new Date(d.getTime() + 86400000)) {
    const date = d.toISOString().slice(0, 10);
    if (date > to) break;
    const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
    if (inside(date, rules.closed)) days[date] = [];
    else {
      const table = inside(date, rules.breaks) ? rules.brk : rules.regular;
      const [open, close] = weekend ? table.weekend : table.weekday;
      days[date] = [[open, rules.early.includes(date) ? Math.min(close, 20 * 60) : close]];
    }
  }
  return days;
}
