// Pure adapters for the Registrar's building tables and for room results grouped
// by building. Rendering and navigation stay in the application controller.

export function pickHoursTerm(hours, current, warn = console.warn) {
  const want = (current?.termName ?? '').toLowerCase().replace(/\s+/g, '-');
  const terms = Object.entries(hours?.terms ?? {});
  const exact = terms.find(([slug]) => slug.startsWith(want));
  if (exact) return exact;
  // Borrowing a different term's table invents door hours. Missing data is
  // represented as unknown instead.
  warn(`Vacant: no published hours for ${current?.termName}; all buildings will read unknown.`);
  return [null, null];
}

export function hoursFor(hoursTerm, code, day) {
  const record = hoursTerm?.buildings?.[code];
  if (!record) return undefined;
  return record.hours[day];
}

export function shortName(name) {
  const value = String(name ?? '');
  const cut = value.indexOf(' - ');
  return value.length > 24 && cut > 0 ? value.slice(cut + 3) : value;
}

export function availableBuildings(results, buildings) {
  const grouped = new Map();
  for (const room of results ?? []) {
    if (!room.hoursKnown || room.wait !== 0) continue;
    const rooms = grouped.get(room.building) ?? [];
    rooms.push(room);
    grouped.set(room.building, rooms);
  }
  return [...grouped.entries()]
    .map(([code, rooms]) => ({
      code,
      name: shortName(buildings?.[code]?.name ?? rooms[0]?.name ?? code),
      rooms,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
