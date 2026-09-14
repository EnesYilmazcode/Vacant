// Optional room requirements. The numeric codes are Ohio State Registrar room
// characteristics, kept as numbers in the room index so the weekly data build
// can add them without teaching the browser a second vocabulary.
//
// A room with no `features` array is UNKNOWN, not a room with no features. That
// distinction is load-bearing: when somebody asks for a whiteboard, sending
// them to a room whose details were never published is a false positive.
export const ROOM_FEATURES = Object.freeze([
  { id: 'movable-tablet', code: 30, label: 'Movable tablet-arm chairs', short: 'movable tablet-arm chairs' },
  { id: 'stationary-tablet', code: 31, label: 'Stationary tablet-arm chairs', short: 'stationary tablet-arm chairs' },
  { id: 'movable-tables', code: 32, label: 'Movable tables and chairs', short: 'movable tables and chairs' },
  { id: 'stationary-tables', code: 33, label: 'Stationary tables and chairs', short: 'stationary tables and chairs' },
  { id: 'tiered', code: 37, label: 'Sloped or tiered floor', short: 'a tiered floor' },
  { id: 'windows', code: 39, label: 'Windows', short: 'windows' },
  { id: 'chalkboards', code: 43, label: 'Chalkboards', short: 'chalkboards' },
  { id: 'whiteboards', code: 44, label: 'Whiteboards', short: 'whiteboards' },
]);

const BY_ID = new Map(ROOM_FEATURES.map((feature) => [feature.id, feature]));

export function normalizeRoomPreferences(value = {}) {
  const parsed = Number(value?.minSeats);
  // A number input accepts decimals and exponent notation. A minimum of 40.1
  // means the room needs 41 whole seats; parseInt() also read `1e2` as 1.
  const minSeats = Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.ceil(parsed), 999) : 0;
  const features = [...new Set(Array.isArray(value?.features) ? value.features : [])]
    .filter((id) => BY_ID.has(id));
  return { minSeats, features };
}

export function hasRoomPreferences(value) {
  const preferences = normalizeRoomPreferences(value);
  return preferences.minSeats > 0 || preferences.features.length > 0;
}

export function roomMatchesPreferences(room, value) {
  const preferences = normalizeRoomPreferences(value);
  if (preferences.minSeats > 0 && (!Number.isFinite(room?.cap) || room.cap === 0
    || room.cap === 998 || room.cap < preferences.minSeats)) {
    return false;
  }
  if (!preferences.features.length) return true;
  if (!Array.isArray(room?.features)) return false;

  const published = new Set(room.features.map(Number));
  return preferences.features.every((id) => published.has(BY_ID.get(id).code));
}

export function filterRoomsByPreferences(rooms, preferences) {
  return (rooms ?? []).filter((room) => roomMatchesPreferences(room, preferences));
}

export function roomFeatureCoverage(rooms) {
  const all = rooms ?? [];
  return {
    known: all.filter((room) => Array.isArray(room?.features)).length,
    total: all.length,
  };
}

export function describeRoomPreferences(value) {
  const preferences = normalizeRoomPreferences(value);
  const out = [];
  if (preferences.minSeats > 0) out.push(`${preferences.minSeats}+ seats`);
  for (const id of preferences.features) out.push(BY_ID.get(id).short);
  return out;
}

export function roomFeatureLabels(room) {
  if (!Array.isArray(room?.features)) return [];
  const published = new Set(room.features.map(Number));
  return ROOM_FEATURES.filter((feature) => published.has(feature.code)).map((feature) => feature.label);
}
