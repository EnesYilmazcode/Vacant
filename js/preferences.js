// Ohio State Registrar room characteristics. The numeric codes stay compact in
// the room index; this table supplies the vocabulary shown on the room screen.
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

export function roomFeatureLabels(room) {
  if (!Array.isArray(room?.features)) return [];
  const published = new Set(room.features.map(Number));
  return ROOM_FEATURES.filter((feature) => published.has(feature.code)).map((feature) => feature.label);
}
