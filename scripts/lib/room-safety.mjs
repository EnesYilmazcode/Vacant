// Which rooms a student may be sent to, decided once at build time.
//
// 250 of the 871 rooms in the Autumn 2026 index are wet labs, dissection labs,
// gyms, dance studios, practice rooms, a climbing wall, a stadium meeting room
// and an instructional kitchen. HM0260 in Hamilton Hall hosts ANATOMY 4300
// "Human Anatomy with Dissection". They are 27.3% of the term's busy minutes,
// which is why nothing downstream can be trusted to rank them low: they have to
// be absent from the shipped file.
//
// Two sources answer this and they disagree about a large slice of the
// inventory, so both are used and neither is allowed to be the whole answer.
// The room's own facilityType is the filter. The Registrar's general-assignment
// list is a flag.
//
// Pure. No node builtins, no fetch. The tables live here rather than in the app
// so an unsafe room is missing from data/rooms-<term>.json rather than ranked
// low in a file anyone can read.

// facilityType is an OPAQUE STRING KEY. Never regex it and never sort on it:
// five of the 28 observed codes are English mnemonics (PERF, LCTR, SMNR, LAB,
// AUD) sitting beside <digit><letter> codes, so /^(\d)([A-Z])$/ is wrong on
// real data and any ordering built on it is meaningless.
//
// Anything not listed here is HIDDEN. The code space is not closed: 24 codes
// after 40 subjects, 27 after 11 more sweeps, 28 in the full 1268 harvest (6E
// turned up in Hagerty 335 and is decoded from that one room, which is to say
// not decoded). The failure mode of guessing wrong is routing someone into a
// cadaver lab.
export const TYPE_VISIBILITY = {
  '1A': 'shown',
  '1B': 'shown',
  '1C': 'shown',
  LCTR: 'shown',
  SMNR: 'shown',
  // Real rooms with chairs and tables, but card-access, lab-monitor controlled
  // or socially awkward. 5K contains an actual dental clinic (PH3089A) and a
  // law clinic (DI0455), which is why it is not in the list above.
  '2P': 'secondary',
  '2Q': 'secondary',
  '5K': 'secondary',
  '6L': 'secondary',
  '2J': 'secondary',
  '5C': 'secondary',
};

// What the app is allowed to call a room, decoded once here so nothing
// downstream keeps a second copy of the code table. It kept one, and five of
// these ten codes were missing from it, so 95 rooms rendered with no type word
// at all: a conference room and a lecture hall looked like the same thing.
//
// Everything below `SMNR` comes from Roomix's compiled bundle, which carries
// the Registrar's own decode table for 23 of the 28 codes seen in the harvest.
// docs/research/peer-check-ui.md has the two greps that recovered it. LCTR and
// SMNR are not in that table and do not need to be; they are the API's own
// English mnemonics.
//
// 5C is in TYPE_VISIBILITY and NOT in here. Roomix's table does not carry it,
// nothing else decodes it, and its two rooms ship with no word rather than a
// guess. Adding one would be inventing a fact about a room we have never seen.
export const TYPE_WORDS = {
  '1A': 'seminar room',
  '1B': 'classroom',
  '1C': 'lecture hall',
  LCTR: 'lecture hall',
  SMNR: 'seminar room',
  '2J': 'TV and radio facility',
  '2P': 'computer lab',
  '2Q': 'computer lab',
  '5K': 'conference room',
  '6L': 'meeting room',
};

// Report campus Columbus AND location CS-COLMBUS, but sit 126 km away in
// Wooster. Nothing in the payload flags them.
//
// Redundant today and kept anyway: all three resolve to buildings 8002, 549 and
// 410, none of which is in data/buildings.json, so the funnel's building join
// already drops them. That join is a side effect of a geocoding pass. This is
// the statement of intent, and it costs three strings.
export const OFF_CAMPUS = new Set(['WSB300', 'WAB0130', 'SY0203']);

// Decide one room. Returns null to drop it, or the room with `vis` and `ga`.
//
// `unknown` is an optional Map the caller passes in to collect codes this table
// does not know, so the build can print them and the list can grow on purpose
// rather than by accident.
export function classify(room, { gaRooms, restricted, unknown } = {}) {
  const id = room?.facilityId;
  if (id == null) return null;
  if (OFF_CAMPUS.has(id)) return null;

  const vis = TYPE_VISIBILITY[room.facilityType];
  if (!vis) {
    const code = room.facilityType ?? null;
    if (unknown && !KNOWN_HIDDEN.has(code)) {
      const key = code ?? 'null';
      if (!unknown.has(key)) unknown.set(key, { rooms: 0, example: id });
      unknown.get(key).rooms++;
    }
    return null;
  }

  if (restricted && restricted.has(room.buildingCode)) return null;

  // GA absence is a flag, not a filter. Only 326 of the 621 rooms that pass the
  // type filter are on the Registrar's list, and an unscheduled general
  // assignment room is the best answer this app can return, so the ranking gets
  // to know which is which. See DECISIONS.md.
  return { ...room, vis, ga: Boolean(gaRooms && gaRooms.has(id)) };
}

// Codes that were looked at and deliberately excluded, so the build's "codes I
// do not recognise" line stays a signal rather than a wall of known text.
// Anything outside both tables is genuinely new.
export const KNOWN_HIDDEN = new Set([
  '2A', // teaching laboratory, mostly wet
  '2D', // one room, Atwell 435, HIMS field experience
  '2H', // gymnasium and physical activity space
  '2K', // special-equipment teaching lab, includes the Hamilton anatomy labs
  '2M', // studio-format instruction: dance, studio physics, costuming
  '3A', // clinical skills or imaging lab
  '5A', // music studio
  '5G', // individual practice room, one of them has capacity 1
  '5J', // one room, Denney 368, creative writing
  '5L', // two rooms, Fisher 700 and Campbell 100
  '6C', // large assembly, including a stadium meeting room
  '6E', // one room, Hagerty 335, first seen in the full 1268 harvest
  '6F', // catch-all: a climbing wall, a gym floor, an animal arena, ONLINE
  '7A', // instructional kitchen, and the API names it that
  'AUD', // auditorium
  'LAB', // laboratory
  'PERF', // performance space
  null, // no room at all; the funnel drops these long before here
]);
