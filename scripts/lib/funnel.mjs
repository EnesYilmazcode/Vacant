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

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// Measured across both archives: CS-COLMBUS 41,159, then CS-INTRNTL 159,
// CS-WOOSTER 148, CS-OFFCAMP 28, CS-COLOFF 15, CS-WASHDC 12, CS-STONELB 12,
// CS-COLFEEX 1. The filter catches most satellite rooms, but NOT all of them:
// WSB300, WAB0130 and SY0203 are Wooster rooms 60 miles away that report
// campus "Columbus" AND location "CS-COLMBUS". Excluding those is the distance
// cap's job in fetch-buildings.mjs, not this file's.
const COLUMBUS = 'CS-COLMBUS';

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
    offCampus: 0,
    noWeekday: 0,
    badTime: 0,
    usable: 0,
  };
}

// The five stages run in this order, each with its own counter, so an upstream
// shape change shows up as a moved number rather than a quietly half-empty grid.
export function isRealRoom(meeting, section, counter) {
  if (counter) counter.meetings++;

  const drop = (stage) => {
    if (counter) counter[stage]++;
    return false;
  };

  // Measured as null, never "" (0 empty strings in 41,534 meetings). facilityType,
  // buildingCode, facilityDescription and facilityGroup all go null on exactly
  // the same rows, so testing facilityId alone is enough.
  if (meeting.facilityId == null) return drop('blankFacilityId');
  if (PSEUDO.has(meeting.buildingCode)) return drop('pseudoRoom');
  if (section?.location !== COLUMBUS) return drop('offCampus');

  // Drops 23 real-room meetings across both archives, all with a null
  // standingMeetingPattern: Independent Study, Laboratory and Seminar rows that
  // name a room but no recurring weekly slot. A room with no weekday is not a
  // booking anyone can be shown. Keep counting it: a jump here means the
  // upstream shape moved.
  if (!DAYS.some((d) => meeting[d] === true)) return drop('noWeekday');

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
    `pseudoRoom ${c.pseudoRoom} | offCampus ${c.offCampus} | ` +
    `noWeekday ${c.noWeekday} | badTime ${c.badTime} | usable ${c.usable} (${pct}%)`
  );
}

// Delete instructors the moment a meeting is first read, at the parse boundary,
// never at serialisation. Every meeting ships instructors[] with a real
// name.n@osu.edu address; the two term archives carried 44,865 such records.
// Ported naively, the room index becomes a public, offline-cached record of
// which professor is in which room at which minute all term.
export function stripInstructors(meeting) {
  if (meeting && 'instructors' in meeting) delete meeting.instructors;
  return meeting;
}
