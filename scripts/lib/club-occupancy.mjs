// Overlay the Registrar Room Matrix output from fetch-room-events.mjs on the
// class index. The input is the parsed data/room-events-<term>.json document,
// not an organization calendar, EMS export, or caller-normalized feed.
//
// Only `kind: "event"` is occupancy. ROOM BLOCK is retained by the scraper but
// its meaning to a student is deliberately undecided in docs/DECISIONS.md, so
// this module reports and excludes it.

const DAY_MS = 24 * 60 * 60 * 1000;
const EVENT_TYPES = new Set(['MTG', 'TOUR', 'INFO', 'WRKS', 'SMNR', 'RCPT', 'INTV', 'FAIR']);

const validDate = (value) => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

const validSource = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
};

function dateForDay(weekStart, day) {
  // Room Matrix uses 0=Sunday..6=Saturday, while weekStart is Monday.
  const offset = (day + 6) % 7;
  return new Date(Date.parse(`${weekStart}T00:00:00Z`) + offset * DAY_MS)
    .toISOString().slice(0, 10);
}

function rejection(roomId, record, reason) {
  return {
    roomId,
    eventId: typeof record?.eventId === 'string' ? record.eventId : null,
    reason,
  };
}

// Convert the shipped, room-keyed weekly snapshot into dated occurrences.
// Invalid or intentionally unused records are visible in `rejected`; none can
// silently become a busy claim. The output is an allowlist, so future source
// fields (including free text) cannot leak through this boundary.
export function normalizeMeetings(roomEvents, { rooms, term } = {}) {
  if (!roomEvents || typeof roomEvents !== 'object' || Array.isArray(roomEvents)
    || !rooms || typeof rooms !== 'object' || Array.isArray(rooms)) {
    throw new TypeError('Expected a Room Matrix document and a room index');
  }
  const meta = roomEvents._meta;
  if (!meta || typeof meta !== 'object' || !validDate(meta.weekStart)
    || !validDate(meta.weekEnd) || meta.weekEnd !== dateForDay(meta.weekStart, 0)
    || !validDate(meta.generated) || !validSource(meta.source)
    || typeof meta.partial !== 'boolean'
    || !roomEvents.rooms || typeof roomEvents.rooms !== 'object'
    || Array.isArray(roomEvents.rooms)) {
    throw new TypeError('Invalid Room Matrix metadata or rooms table');
  }
  if (term != null && String(meta.term) !== String(term)) {
    throw new RangeError(`Room Matrix term ${meta.term} does not match class term ${term}`);
  }

  const meetings = [];
  const rejected = [];
  const seen = new Set();
  let blockCount = 0;

  for (const [roomId, records] of Object.entries(roomEvents.rooms)) {
    if (!Array.isArray(records)) {
      rejected.push(rejection(roomId, null, 'invalid-room-records'));
      continue;
    }
    for (const record of records) {
      if (!Object.hasOwn(rooms, roomId)) {
        rejected.push(rejection(roomId, record, 'unknown-room'));
        continue;
      }
      if (record?.kind === 'block') {
        blockCount += 1;
        rejected.push(rejection(roomId, record, 'undecided-room-block'));
        continue;
      }
      if (record?.kind !== 'event') {
        rejected.push(rejection(roomId, record, 'invalid-kind'));
        continue;
      }
      if (!Number.isInteger(record.day) || record.day < 0 || record.day > 6
        || !Number.isInteger(record.start) || !Number.isInteger(record.end)
        || record.start < 0 || record.end > 1440 || record.end <= record.start
        || typeof record.eventId !== 'string' || !/^\d{9}$/.test(record.eventId)
        || !EVENT_TYPES.has(record.type)) {
        rejected.push(rejection(roomId, record, 'invalid-event'));
        continue;
      }

      const date = dateForDay(meta.weekStart, record.day);
      const key = JSON.stringify([roomId, date, record.start, record.end, record.eventId]);
      if (seen.has(key)) continue;
      seen.add(key);
      meetings.push({
        roomId,
        date,
        startMinute: record.start,
        endMinute: record.end,
        type: record.type,
        eventId: record.eventId,
        sourceUrl: meta.source,
      });
    }
  }

  meetings.sort((a, b) => a.date.localeCompare(b.date)
    || a.roomId.localeCompare(b.roomId) || a.startMinute - b.startMinute
    || a.endMinute - b.endMinute || a.eventId.localeCompare(b.eventId));
  return {
    meetings,
    rejected,
    coverage: meta.partial ? 'partial-room-sweep' : 'complete-room-sweep',
    weekStart: meta.weekStart,
    weekEnd: meta.weekEnd,
    generated: meta.generated ?? null,
    sourceUrl: meta.source,
    blockCount,
  };
}

// Return an ephemeral class index for one date. Existing tuples are copied only
// for rooms receiving events, and a one-date session prevents a Room Matrix
// occurrence from becoming a weekly class. Always overlay the original index,
// never an index returned by an earlier call.
export function overlayForDate(index, roomEvents, { date, classesSuspended = false } = {}) {
  if (!index || typeof index !== 'object' || !validDate(date)) {
    throw new TypeError('Expected a class index and a valid ISO date');
  }
  const normalized = normalizeMeetings(roomEvents, { rooms: index.rooms, term: index.term });
  const meetings = normalized.meetings.filter((meeting) => meeting.date === date);
  const sessions = (index.sessions ?? []).map((session) => [...session]);
  const rooms = classesSuspended
    ? Object.fromEntries(Object.entries(index.rooms).map(([id, room]) => [id, { ...room, busy: [] }]))
    : { ...index.rooms };

  if (meetings.length) {
    const slot = sessions.length;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    sessions.push([date, date]);
    const copied = new Set();
    for (const meeting of meetings) {
      if (!copied.has(meeting.roomId)) {
        const original = rooms[meeting.roomId];
        rooms[meeting.roomId] = {
          ...original,
          busy: (original.busy ?? []).map((busy) => [...busy]),
        };
        copied.add(meeting.roomId);
      }
      rooms[meeting.roomId].busy.push([
        weekday, meeting.startMinute, meeting.endMinute, slot,
      ]);
    }
  }

  const coversDate = date >= normalized.weekStart && date <= normalized.weekEnd;
  return {
    index: { ...index, rooms, sessions },
    ...normalized,
    coverage: coversDate ? normalized.coverage : 'outside-snapshot',
    meetings,
  };
}

export function clubDisclosure({ meetings, rejected, coverage, weekStart, weekEnd, blockCount }) {
  const excluded = rejected.length;
  if (coverage === 'outside-snapshot') {
    return {
      message: `No Room Matrix coverage outside ${weekStart} through ${weekEnd}.`,
      excluded,
      blocksExcluded: blockCount,
    };
  }
  return {
    message: meetings.length
      ? `${meetings.length} registered non-class event occurrence(s) included.`
      : 'No registered non-class events found for this date.',
    excluded,
    blocksExcluded: blockCount,
    sourceCoverage: coverage,
  };
}
