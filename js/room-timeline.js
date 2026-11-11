// Pure room-detail modeling. The controller supplies the selected date and the
// building's published hours; this module returns timeline rows and copy.
import { roomClaim } from './claim.js';
import { blocksOn, classesOn } from './day.js';
import { PACKUP } from './engine.js';
import { clock, dur } from './state.js';
import { HOLD_LABEL } from '../scripts/lib/club-occupancy.mjs';

export const SEAM_MIN = 20;

export function hourLabel(minutes) {
  const hour = Math.floor(minutes / 60) % 24;
  if (hour === 0) return '12 AM';
  if (hour === 12) return 'noon';
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

// The Registrar holds this room in these windows for bookings the Room Matrix
// never shows, so the screen can say "may be booked" instead of "in use".
export function holdsOn(room, date, schedule) {
  return classesOn(room, date, schedule.sessions, schedule.courses)
    .filter((item) => item.course === HOLD_LABEL)
    .map((item) => [item.from, item.to]);
}

export function timelineRows(room, buildingName, nowMin, date, schedule, hours) {
  const blocks = blocksOn(room, date, schedule.sessions);
  const holds = holdsOn(room, date, schedule);
  const known = Array.isArray(hours);
  if (hours === null) return { closed: true, rows: [], holds };

  const open = known ? hours[0] : blocks.length ? blocks[0][0] : null;
  const close = known ? hours[1] : blocks.length ? blocks[blocks.length - 1][1] : null;
  if (open == null) return { known, rows: [], nothing: true, holds };

  const inside = [];
  for (const [start, end] of blocks) {
    const clipped = [Math.max(start, open), Math.min(end, close)];
    if (clipped[1] > clipped[0]) inside.push(clipped);
  }

  const rows = [];
  if (known) rows.push({ kind: 'edge', t: open, text: `${buildingName} opens` });
  else rows.push({ kind: 'edge', text: `before ${clock(open)}, not known` });

  const gap = (from, to) => {
    const len = to - from;
    if (len <= 0) return;
    if (len < SEAM_MIN) {
      rows.push({ kind: 'seam' });
      return;
    }
    rows.push({ kind: 'free', t: from, end: to, len, now: nowMin != null && nowMin >= from && nowMin < to });
  };

  let cursor = open;
  for (const [start, end] of inside) {
    gap(cursor, start);
    rows.push({ kind: 'busy', t: start });
    cursor = Math.max(cursor, end);
  }
  gap(cursor, close);

  if (known) rows.push({ kind: 'edge', t: close, text: `${buildingName} closes` });
  else rows.push({ kind: 'edge', text: `after ${clock(close)}, not known` });
  return { known, rows, blocks: inside, open, close, holds };
}

export function claimFor(timeline, nowMin, metres) {
  const claim = roomClaim({ ...timeline, now: nowMin, metres });
  const holds = timeline.holds ?? [];
  const heldNow = holds.some(([from, to]) => nowMin >= from && nowMin < to);
  // A free window that ends because a hold starts, not a class.
  const heldAt = claim.kind === 'free' && claim.until != null
    ? holds.find(([from]) => from === claim.until + PACKUP)?.[0] ?? null
    : null;
  const heldNote = heldAt == null ? '' : `May be booked from ${clock(heldAt)}`;
  const withHeld = (sub) => [sub, heldNote].filter(Boolean).join(' · ');
  switch (claim.kind) {
    case 'opens':
      return {
        head: `Opens ${clock(claim.at)}`,
        sub: claim.next != null && claim.yours > 0
          ? `Free ${clock(claim.next)} · ${dur(claim.yours)}`
          : '',
      };
    case 'before-first-class':
      return { head: `First class ${clock(claim.at)}`, sub: '' };
    case 'closed-for-day':
      return { head: 'Closed for the day', sub: '' };
    case 'after-last-class':
      return { head: `Last class ended ${clock(claim.at)}`, sub: '' };
    case 'in-class':
      return {
        head: heldNow ? `May be booked till ${clock(claim.until)}` : `In use till ${clock(claim.until)}`,
        sub: claim.next == null
          ? 'Nothing free after it today'
          : claim.yours > 0
            ? `Next free ${clock(claim.next)}, for ${dur(claim.yours)}`
            : `Next free ${clock(claim.next)}`,
      };
    case 'no-class-today':
      return { head: 'No class today', sub: '' };
    case 'free':
      if (!claim.known) {
        return {
          head: claim.until == null
            ? 'No class in here for the rest of today'
            : `No class in here till ${clock(claim.until)}`,
          sub: withHeld('Door hours not published'),
        };
      }
      return {
        head: claim.until == null ? 'No class in here for the rest of today' : `Free till ${clock(claim.until)}`,
        sub: withHeld(claim.yours == null
          ? ''
          : claim.yours > 0
            ? `Yours for ${dur(claim.yours)} once you get there`
            : 'It closes before you could walk there'),
      };
    default:
      return { head: 'Nothing free now', sub: '' };
  }
}

const radians = (degrees) => (degrees * Math.PI) / 180;

export function bearingTo(from, to) {
  const deltaLon = radians(to.lon - from.lon);
  const y = Math.sin(deltaLon) * Math.cos(radians(to.lat));
  const x = Math.cos(radians(from.lat)) * Math.sin(radians(to.lat))
    - Math.sin(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.cos(deltaLon);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}
