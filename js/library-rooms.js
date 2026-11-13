import { walkMetres, walkMinutes } from './engine.js';

const API = 'https://content.osu.edu/v2/library/roomreservation/api/v1/locationsearch';
const LOCATIONS = [
  { id: 16286, code: '050' },
  { id: 16287, code: '005' },
  { id: 16298, code: '003' },
];
const MINUTE = 60_000;
const campusDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
export const libraryDate = (now) => campusDate.format(now);
export const libraryTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit',
});

export async function fetchLibraryRooms(now) {
  const date = libraryDate(now);
  const signal = AbortSignal.timeout(8000);
  const locations = await Promise.allSettled(LOCATIONS.map(async (library) => {
    const response = await fetch(`${API}/${library.id}/${date}T05:00:00.000Z`, {
      signal, cache: 'no-store', credentials: 'omit',
    });
    if (!response.ok) throw new Error(`Library availability returned ${response.status}`);
    const payload = await response.json();
    const rooms = payload.data?.locationAvailableRooms;
    if (payload.status !== 'success' || !Array.isArray(rooms) ||
        rooms.some((room) => !Array.isArray(room?.timeslots))) {
      throw new Error('Invalid library availability response');
    }
    return { ...library, rooms };
  }));
  return {
    date,
    libraries: locations.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []),
    missing: LOCATIONS.filter((_, index) => locations[index].status === 'rejected'),
  };
}

export function rankLibraryRooms({ availability, now, duration, origin, field, buildings }) {
  if (availability?.date !== libraryDate(now)) return [];
  const results = [];
  for (const library of availability.libraries) {
    const building = buildings?.[library.code];
    if (!building) continue;
    const metres = walkMetres(origin, building, library.code, field);
    if (!Number.isFinite(metres)) continue;
    const walk = walkMinutes(metres);
    const arrival = now.getTime() + walk * MINUTE;
    for (const { timeslots } of library.rooms) {
      const slots = timeslots
        .filter((slot) => slot?.roomHide === false && slot.open === true && typeof slot.roomName === 'string')
        .map((slot) => ({
          slot, start: Date.parse(slot.startTimestamp), end: Date.parse(slot.endTimestamp),
        }))
        .filter(({ start, end }) => Number.isFinite(start) && end > start)
        .sort((a, b) => a.start - b.start);
      const close = slots.reduce((end, slot) => Math.max(end, slot.end), 0);
      let window = null;
      for (const { slot, start, end } of slots) {
        if (start < arrival || slot.taken !== false) {
          window = null;
          continue;
        }
        if (window?.end === start) window.end = end;
        else window = { start, end };
        const requestedEnd = duration === 'day' ? close : window.start + Number(duration) * MINUTE;
        const startsSoon = duration !== 'day' || window.start - arrival <= 30 * MINUTE;
        const length = requestedEnd - window.start;
        const maxLength = (Number(slot.maximumDuration) || 4) * 60 * MINUTE;
        if (startsSoon && window.end >= requestedEnd && length >= 30 * MINUTE && length <= maxLength) {
          results.push({
            library: slot.location ?? building.name, name: slot.roomName, capacity: slot.maximumCapacity,
            walk, metres, start: window.start, end: requestedEnd,
          });
          break;
        }
      }
    }
  }
  return results.sort((a, b) => a.start - b.start || a.metres - b.metres || a.name.localeCompare(b.name));
}
