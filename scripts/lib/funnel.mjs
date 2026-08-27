// Decide whether one meetings[] row is a real room being occupied.
//
// Most rows are not. Across the two committed term archives, 41,534 meetings:
// 28,248 carry no facilityId at all, and the two pseudo-rooms ONLINE (4,574)
// and OFFCAMPUS (24) carry real weekday flags and real clock times, so they
// become busy blocks in a fake room unless something stops them.
//
// Pure. No node:fs, no node:https, no fetch. Import it from anywhere.

// ONLINE and OFFCAMPUS are not places. Both carry a facilityId of their own, so
// the blank check above does not catch them.
const PSEUDO = new Set(['ONLINE', 'OFFCAMPUS']);

// Exported because a bare `facilityId != null` is NOT "this is a real room".
// ONLINE and OFFCAMPUS carry a facilityId of their own, and on term 1268 they
// are 2,975 of the 11,454 meetings that pass a null check: 26%.
export const isPseudoRoom = (meeting) =>
  PSEUDO.has(meeting?.buildingCode) || PSEUDO.has(meeting?.facilityId);

export const hasRealRoom = (meeting) =>
  meeting?.facilityId != null && !isPseudoRoom(meeting);

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// section.location is DELIBERATELY not filtered on, and this was a real bug
// before it was a comment.
//
// It is the section's ADMINISTRATIVE location code, not the room's. Filtering
// `location !== 'CS-COLMBUS'` drops 29 meetings across the two archives, and 22
// of them are in ordinary main-campus classrooms inside 0.7 km of the Oval:
// Schoenbaum, Stillman, University Hall, Gerlach, Cunz, Orton, Smith Lab,
// Hayes, Weigel, Hitchcock, Timashev. Study-abroad and off-campus-program
// sections carry CS-INTRNTL or CS-COLOFF while still meeting in a normal room.
//
// Concrete harm: Hitchcock Hall 446 hosts a CS-INTRNTL section in Summer 2026
// and appears in no other meeting that term, so it never enters the index and
// the app reports it free while a class is sitting in it.
//
// Its only true positives were 7 Stone Laboratory rows, and Stone Lab is 185 km
// away so the distance cap in fetch-buildings.mjs already excludes it. The
// location filter's true-positive set is a strict subset of the cap's, and its
// false-drop set is 22. The room's building is the only thing worth asking
// about, which is what isKnownBuilding does.

// Deliberately NOT filtered on, and this is load bearing rather than an
// oversight:
//
//   instructionMode  "Distance Learning" has 0 real-room meetings, but "Hybrid
//                    Delivery" has 81 and "Distance Enhanced" 14, while 1,945
//                    "In Person" meetings have no room at all.
//   component        296 "Laboratory" meetings happen in ordinary 1B
//                    classrooms.
//
// Filtering on either drops real rooms and keeps fake ones.

// "9:05 am" -> 545. Four formats observed and no others: "#:## am", "##:## am",
// "#:## pm", "##:## pm".
export function toMinutes(clock) {
  if (typeof clock !== 'string') return null;
  const m = /^\s*(\d{1,2}):(\d{2})\s*([ap])m\s*$/i.exec(clock);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  const pm = m[3].toLowerCase() === 'p';
  // 12:xx am is the hour after midnight, 12:xx pm is the hour after noon.
  const base = hour === 12 ? 0 : hour * 60;
  return base + minute + (pm ? 720 : 0);
}

export function newCounter() {
  return {
    meetings: 0,
    blankFacilityId: 0,
    pseudoRoom: 0,
    unknownBuilding: 0,
    noWeekday: 0,
    // A subset of noWeekday, not another bucket: the stages still sum to
    // meetings. These are the rows that name a real room and a real clock
    // window and only lack the day, which is the difference between a row that
    // holds no occupancy and a room we know is used at a time we cannot place.
    noWeekdayTimed: 0,
    badTime: 0,
    usable: 0,
  };
}

const hasWeekday = (meeting) => DAYS.some((d) => meeting?.[d] === true);

// The same window test the badTime stage uses, so noWeekdayTimed counts exactly
// the rows isUnplaceable will pick up and nothing else.
function hasWindow(meeting) {
  const start = toMinutes(meeting?.startTime);
  const end = toMinutes(meeting?.endTime);
  return start != null && end != null && end > start;
}

// A booking we know is real and cannot place on a weekday.
//
// Nine of these exist across the three archives: four Dreese Lab 280 CSE lab
// slots in Summer 2026, each cross-listed twice, and one Denney 368 seminar in
// Spring 2026. Autumn 2026 has none. See isRealRoom's noWeekday stage for why
// the day is not recoverable and DECISIONS.md for what the index does with them.
export function isUnplaceable(meeting, { isKnownBuilding } = {}) {
  if (typeof meeting !== 'object' || meeting === null) return false;
  if (meeting.facilityId == null) return false;
  if (isPseudoRoom(meeting)) return false;
  if (isKnownBuilding && !isKnownBuilding(meeting.buildingCode)) return false;
  if (hasWeekday(meeting)) return false;
  return hasWindow(meeting);
}

// The five stages run in this order, each with its own counter, so an upstream
// shape change shows up as a moved number rather than a quietly half-empty grid.
export function isRealRoom(meeting, section, counter, { isKnownBuilding } = {}) {
  if (counter) counter.meetings++;

  const drop = (stage) => {
    if (counter) counter[stage]++;
    return false;
  };

  // A null or non-object row must move a counter, not crash the build. The whole
  // point of this module is that upstream shape drift shows up as a moved number.
  if (typeof meeting !== 'object' || meeting === null) return drop('blankFacilityId');

  // Measured as null, never "" (0 empty strings in 41,534 meetings). facilityType,
  // buildingCode, facilityDescription and facilityGroup all go null on exactly
  // the same rows, so testing facilityId alone is enough.
  if (meeting.facilityId == null) return drop('blankFacilityId');

  // Both fields are checked. They agree on all 4,598 pseudo rows today, but the
  // failure is asymmetric: an ONLINE facilityId under a drifted buildingCode
  // would pass every remaining stage, because ONLINE already carries real
  // weekday flags and real clock times, and become a 998-seat room in the grid
  // with no counter moving to say so.
  if (PSEUDO.has(meeting.buildingCode) || PSEUDO.has(meeting.facilityId)) return drop('pseudoRoom');

  // The room has to be somewhere we can put on a map. Supplying the predicate is
  // how a caller excludes satellite campuses; without one this stage is skipped
  // and the caller is responsible for the join.
  if (isKnownBuilding && !isKnownBuilding(meeting.buildingCode)) return drop('unknownBuilding');

  // Drops 28 real-room meetings across the three archives. 19 carry no times
  // either, but 9 DO: four Dreese Lab 280 CSE lab slots in Summer 2026, each
  // cross-listed under a second course number, plus one Denney 368 seminar in
  // Spring 2026. Those 9 are real occupancy in a real room.
  //
  // The day is not recoverable, measured three ways over all 68,600 meetings in
  // the three archives:
  //
  //   standingMeetingPattern  non-null on 0 of the 47,490 no-weekday rows, and
  //                           it disagrees with the day flags on 135 of the
  //                           3,741 rows that carry both, so it is not a second
  //                           source even where it exists.
  //   section.meetingDays     the empty string on all 40,452 sections in 1262
  //                           and 1264, and absent from the 1268 harvest shape.
  //   a sibling meeting       the Denney row has one at the identical time and
  //                           dates carrying Friday, which looks recoverable and
  //                           is not: of 161 same-section same-time same-dates
  //                           multi-room groups in 1262, 60 put the two rooms on
  //                           DIFFERENT days. Engineering 1182.01 is HI0308 on
  //                           Monday and HI0224 on Thursday. Borrowing the
  //                           sibling's day would be right about 63% of the
  //                           time, which is a guess wearing a fact's clothes.
  //
  // So the funnel refuses to place them, and build-index refuses to call the
  // room free: isUnplaceable picks these rows back up and blocks the clock
  // window on every day of the session. A jump in noWeekdayTimed means the
  // upstream shape moved and the day may have become recoverable.
  if (!hasWeekday(meeting)) {
    if (counter && hasWindow(meeting)) counter.noWeekdayTimed++;
    return drop('noWeekday');
  }

  const start = toMinutes(meeting.startTime);
  const end = toMinutes(meeting.endTime);
  if (start == null || end == null || end <= start) return drop('badTime');

  if (counter) counter.usable++;
  return true;
}

export function formatFunnel(c) {
  const pct = c.meetings ? ((c.usable / c.meetings) * 100).toFixed(1) : '0.0';
  return (
    `meetings ${c.meetings} | blankFacilityId ${c.blankFacilityId} | ` +
    `pseudoRoom ${c.pseudoRoom} | unknownBuilding ${c.unknownBuilding} | ` +
    `noWeekday ${c.noWeekday} (${c.noWeekdayTimed} timed) | badTime ${c.badTime} | ` +
    `usable ${c.usable} (${pct}%)`
  );
}

// Delete instructors the moment a meeting is first read, at the parse boundary,
// never at serialisation. Every meeting ships instructors[] with a real
// name.n@osu.edu address; the two term archives carried 44,865 such records.
// Ported naively, the room index becomes a public, offline-cached record of
// which professor is in which room at which minute all term.
//
// Named for the MEETING it takes. snapshot-term.mjs exports a stripInstructors
// that takes a whole PAGE and returns a count, and the two are silent no-ops on
// each other's argument: passing a page to this one deletes nothing and returns
// truthy, which is how every address would flow into rooms-<term>.json.
export function stripMeetingInstructors(meeting) {
  if (typeof meeting === 'object' && meeting !== null && 'instructors' in meeting) {
    delete meeting.instructors;
  }
  return meeting;
}
