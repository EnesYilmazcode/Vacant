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

// How far from the Oval a room can sit and still be a room somebody walks to.
//
// The type filter and the restricted list both describe the ROOM. Neither of
// them describes where it is, so the airport got through. Measured against the
// Autumn 2026 index: the furthest building the boundary keeps is Waterman at
// 2,599 m, and the nearest one it drops is Outpatient Care East at 4,995 m. The
// threshold sits in a 2.4 km gap with nothing in it, so it is not tuned to a
// building and moving it 20% either way changes nothing.
//
// It drops three rooms: an outpatient clinic 5 km east, and two hangars at Don
// Scott airfield 9.9 km northwest. The engine's own MAX_WALK is 12 minutes,
// about 720 m, so the ranking could never have offered any of them. They were
// inflating the room count and sitting on the buildings screen.
export const MAX_CAMPUS_M = 3000;

// The fewest class meetings a week a room has to host before it counts as a
// classroom rather than as a room that once appeared in the schedule.
//
// Every room in the index got there by being named in at least one booking, so
// "has a class" was never a filter, only a floor of one. That floor lets in a
// department's own conference room: TO0038 in Townshend Hall is a 40 seat 5K
// with exactly one booking a week, and the ranking put it in the top ten 60
// times out of 504 measured queries and made it the single best answer 9 times.
// Nobody walks into that room to study.
//
// This applies ONLY to rooms the Registrar does not list as general assignment.
// A GA room is already certified as central pool space that any department can
// book and anyone can walk into, so its booking count is not evidence about it:
// 321 of the 326 GA rooms host 10 or more meetings a week, and the 5 that do
// not are still GA rooms.
//
// Measured on Autumn 2026, over 504 queries from 4 origins x 7 days x 6 times
// x 3 durations: at 3 it drops 65 of 581 rooms (11.2%), leaves every one of the
// 504 queries with an answer, and moves the best answer further away in 4 of
// them, by one minute. Two would drop 36 and leave the two-a-week departmental
// conference rooms in. Four would drop 98 and start eating real classrooms.
export const MIN_WEEKLY_MEETINGS = 3;

// Report campus Columbus AND location CS-COLMBUS, but sit 126 km away in
// Wooster. Nothing in the payload flags them.
//
// Redundant today and kept anyway: all three resolve to buildings 8002, 549 and
// 410, none of which is in data/buildings.json, so the funnel's building join
// already drops them. That join is a side effect of a geocoding pass. This is
// the statement of intent, and it costs three strings.
export const OFF_CAMPUS = new Set(['WSB300', 'WAB0130', 'SY0203']);

// Why a room was dropped, for the build's own tally. Exported so the counter
// and the printed line cannot drift apart.
export const DROP = {
  offCampus: 'offCampus',
  type: 'type',
  restricted: 'restricted',
  farFromCampus: 'farFromCampus',
  thin: 'thin',
  noHours: 'noHours',
};

// Decide one room. Returns null to drop it, or the room with `vis` and `ga`.
//
// `unknown` is an optional Map the caller passes in to collect codes this table
// does not know, so the build can print them and the list can grow on purpose
// rather than by accident.
//
// `why` is an optional object the caller passes in to read back which rule
// dropped the room, because four of the five reasons are now indistinguishable
// from a null return.
export function classify(room, { gaRooms, restricted, unknown, why, hoursKnown } = {}) {
  const drop = (reason) => {
    if (why) why.reason = reason;
    return null;
  };
  if (why) why.reason = null;
  const id = room?.facilityId;
  if (id == null) return null;
  if (OFF_CAMPUS.has(id)) return drop(DROP.offCampus);

  const vis = TYPE_VISIBILITY[room.facilityType];
  if (!vis) {
    const code = room.facilityType ?? null;
    if (unknown && !KNOWN_HIDDEN.has(code)) {
      const key = code ?? 'null';
      if (!unknown.has(key)) unknown.set(key, { rooms: 0, example: id });
      unknown.get(key).rooms++;
    }
    return drop(DROP.type);
  }

  if (restricted && restricted.has(room.buildingCode)) return drop(DROP.restricted);

  // Distance is checked before the meeting count so a hangar at the airfield is
  // reported as the airfield and not as a quiet room.
  if (Number.isFinite(room.metresFromOval) && room.metresFromOval > MAX_CAMPUS_M) {
    return drop(DROP.farFromCampus);
  }

  // A door nobody publishes hours for is a door this app cannot say anything
  // useful about.
  //
  // It used to ship those rooms and rank them in their own tier, with a label
  // saying the hours were unknown. That was honest and it was still the wrong
  // product: the answer "here is a room, and we cannot tell you whether you can
  // get into the building" is not an answer, and it cost four separate blocks of
  // explanatory text across three screens to say it.
  //
  // Measured on Autumn 2026: 22 of the 68 buildings and 90 of the 515 rooms had
  // no published hours, and over 5,040 ranked rows from four origins across a
  // week, ZERO of them ever reached a top ten. They were paying for themselves
  // in prose and returning nothing.
  if (hoursKnown === false) return drop(DROP.noHours);

  const ga = Boolean(gaRooms && gaRooms.has(id));
  // No GA list means "not general assignment" is not a fact about the room, it
  // is a missing input, and every room would fail the rule at once. The build
  // already refuses to run without data/ga-rooms.json, so the only callers that
  // land here are tests and tools working from hand-built rooms. Skipping the
  // rule is the same fail-open the ga flag itself takes.
  if (
    gaRooms &&
    !ga &&
    Number.isFinite(room.weeklyMeetings) &&
    room.weeklyMeetings < MIN_WEEKLY_MEETINGS
  ) {
    return drop(DROP.thin);
  }

  // GA absence is no longer only a flag. It is the filter above for a room with
  // thin evidence, and below MIN_WEEKLY_MEETINGS it is the whole difference
  // between a lecture hall the Registrar publishes and a department's own
  // conference room. It still ships on every kept room, because a non-GA room
  // with a full teaching week is a perfectly good answer that the ranking
  // should prefer second. See DECISIONS.md.
  return { ...room, vis, ga };
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
