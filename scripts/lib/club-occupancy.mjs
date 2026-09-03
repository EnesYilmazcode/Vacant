// Issue #110 prototype. No network and no production caller yet: see
// docs/research/club-occupancy.md for the missing source and rollout gates.
// Adapters must supply dated occurrences in America/New_York, with room IDs
// verified against the class index. This deliberately does not guess an RRULE,
// a building alias, a cancellation, or an end time from prose.

export const CLUB_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const validDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
  && Number.isFinite(Date.parse(`${s}T00:00:00Z`))
  && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const text = (s) => typeof s === 'string' && s.trim().length > 0;
const timestamp = (s) => typeof s === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(s)
  ? Date.parse(s) : NaN;
const https = (s) => {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && !u.username && !u.password;
  } catch { return false; }
};

// Every record describes one occurrence, including cancelled occurrences.
// Recurrence must already be expanded by the source into actual dated events;
// an adapter must reconcile exclusions and updates before passing them here.
export function normalizeMeetings(records, { rooms, now, maxAgeMs = CLUB_MAX_AGE_MS }) {
  if (!Array.isArray(records) || !rooms || !Number.isFinite(now)
    || !(maxAgeMs > 0) || !Number.isFinite(maxAgeMs)) {
    throw new TypeError('Expected records, a room index, and a finite clock/age limit');
  }
  const rejected = [];
  const groups = new Map();
  const reject = (r, reason) => rejected.push({
    sourceId: typeof r?.sourceId === 'string' ? r.sourceId : null,
    id: typeof r?.id === 'string' ? r.id : null,
    reason,
  });
  for (const r of records) {
    if (!r || !text(r.sourceId) || !text(r.id) || !validDate(r.date)) {
      reject(r, 'missing-identity-or-date');
      continue;
    }
    const key = JSON.stringify([r.sourceId, r.id, r.date]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const meetings = [];
  const dedup = new Map();
  for (const versions of groups.values()) {
    // Conflicting versions are uncertainty, not a licence to choose the one
    // that happens to arrive last. A fresh adapter should emit one snapshot.
    const r = versions[0];
    const fields = ['organizationId', 'organization', 'roomId', 'startMinute',
      'endMinute', 'status', 'sourceUrl', 'seriesId', 'recurrence'];
    if (versions.some((other) => fields.some((f) => other[f] !== r[f]))) {
      reject(r, 'conflicting-occurrence');
      continue;
    }
    if (r.status !== 'confirmed') {
      reject(r, r.status === 'cancelled' ? 'cancelled' : 'unconfirmed');
      continue;
    }
    // Take the oldest fetch of otherwise identical duplicates. Repacking a
    // stale record next to a fresh timestamp must not renew the stale copy.
    const fetched = versions.map((v) => timestamp(v.fetchedAt));
    if (fetched.some((t) => !Number.isFinite(t) || t > now || now - t > maxAgeMs)) {
      reject(r, 'stale-or-invalid-fetched-at');
      continue;
    }
    if (!https(r.sourceUrl) || !text(r.organizationId) || !text(r.organization)) {
      reject(r, 'missing-provenance');
      continue;
    }
    if (r.recurrence != null) {
      reject(r, 'unexpanded-recurrence');
      continue;
    }
    if (!Object.hasOwn(rooms, r.roomId)) {
      reject(r, 'unknown-room');
      continue;
    }
    if (!Number.isInteger(r.startMinute) || !Number.isInteger(r.endMinute)
      || r.startMinute < 0 || r.endMinute > 1440 || r.endMinute <= r.startMinute) {
      reject(r, 'invalid-time');
      continue;
    }
    const provenance = {
      sourceId: r.sourceId, id: r.id, sourceUrl: r.sourceUrl,
      fetchedAt: new Date(Math.min(...fetched)).toISOString(),
    };
    const key = JSON.stringify([r.organizationId, r.roomId, r.date, r.startMinute, r.endMinute]);
    if (dedup.has(key)) {
      dedup.get(key).sources.push(provenance);
      continue;
    }
    // An allowlist, not a spread of the original record. Contact/attendee fields
    // have no place in occupancy output or diagnostics.
    const meeting = {
      organizationId: r.organizationId, organization: r.organization,
      roomId: r.roomId, date: r.date, startMinute: r.startMinute,
      endMinute: r.endMinute, status: 'confirmed',
      seriesId: text(r.seriesId) ? r.seriesId : null,
      sources: [provenance],
    };
    dedup.set(key, meeting);
    meetings.push(meeting);
  }
  meetings.sort((a, b) => a.date.localeCompare(b.date)
    || a.roomId.localeCompare(b.roomId) || a.startMinute - b.startMinute);
  return { meetings, rejected, coverage: 'unknown' };
}

// Return an ephemeral index for a particular date. Original class tuples and
// course/session tables are preserved; a one-date session prevents an event
// from becoming a weekly class if this index is queried on a different date.
// Normalize afresh for every query so an old in-memory snapshot can expire.
export function overlayForDate(index, records, { date, now, maxAgeMs } = {}) {
  if (!validDate(date)) throw new TypeError('Expected a valid ISO date');
  const normalized = normalizeMeetings(records, { rooms: index.rooms, now, maxAgeMs });
  const meetings = normalized.meetings.filter((m) => m.date === date);
  const sessions = (index.sessions ?? []).map((s) => [...s]);
  const rooms = { ...index.rooms };
  if (meetings.length) {
    const slot = sessions.length;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    sessions.push([date, date]);
    const copied = new Set();
    for (const m of meetings) {
      if (!copied.has(m.roomId)) {
        const original = rooms[m.roomId];
        rooms[m.roomId] = { ...original, busy: (original.busy ?? []).map((b) => [...b]) };
        copied.add(m.roomId);
      }
      rooms[m.roomId].busy.push([weekday, m.startMinute, m.endMinute, slot]);
    }
  }
  return { index: { ...index, rooms, sessions }, ...normalized, meetings };
}

// Presentation data for a future UI: escaped/textContent rendering is the
// caller's responsibility. Partial positive evidence never proves completeness.
export function clubDisclosure({ meetings, rejected }) {
  return {
    message: meetings.length
      ? `${meetings.length} verified meeting occurrence(s) included. Other club bookings may be missing.`
      : 'No verified club meetings included. Club coverage is unknown.',
    excluded: rejected.length,
    sources: meetings.flatMap((m) => m.sources),
  };
}
