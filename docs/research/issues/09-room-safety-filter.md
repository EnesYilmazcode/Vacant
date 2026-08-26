---
title: Ship the room safety filter: facilityType allow list plus the Registrar general-assignment cross-check
labels: data, bug
milestone: Phase 1: Data pipeline
estimate: M
order: 9
depends_on: room-index-and-current-json, snapshot-expiring-terms
---

162 of the 633 rooms measured in term 1268 (25.6% of inventory, 33.2% of scheduled meeting time) are wet labs, dissection labs, gyms, dance studios, practice rooms and performance halls. `HM0260` in Hamilton Hall hosts ANATOMY 4300 "Human Anatomy with Dissection". Nothing keeps it out of the index today. Two sources answer this and they disagree about a large slice of the inventory, so ship both.

### What to do

Add `scripts/fetch-ga-rooms.mjs`, which pulls the Registrar's Autumn 2026 General Assignment Rooms page into `data/ga-rooms.json`. IDs parse out with `/Facility ID:\s*([A-Z0-9]+)/g` and join to `meetings[].facilityId` exactly, no fuzzy matching.

```json
{ "_meta": { "term": "1268", "pulled": "2026-08-26", "source": "registrar.osu.edu/...", "count": 327 },
  "rooms": ["DL0357", "EC0304", "HI0131"] }
```

The visibility table is one exported constant in the harvester, not the app, so an unsafe room is absent from the shipped file rather than ranked low.

```js
export const TYPE_VISIBILITY = {
  '1A':'shown','1B':'shown','1C':'shown','LCTR':'shown','SMNR':'shown',
  '2P':'secondary','2Q':'secondary','5K':'secondary',
  '6L':'secondary','2J':'secondary','5C':'secondary',
};
// Report campus Columbus AND location CS-COLMBUS, but sit 126 km away in Wooster.
const OFF_CAMPUS = new Set(['WSB300','WAB0130','SY0203']);

function classify(room) {
  if (OFF_CAMPUS.has(room.facilityId)) return null;
  const vis = TYPE_VISIBILITY[room.facilityType];
  if (!vis) { unknown.add(room); return null; }   // default hidden, never shown
  if (denyList.has(room.buildingCode)) return null;
  return { ...room, vis, ga: gaRooms.has(room.facilityId) };
}
```

`facilityType` is an opaque string key. Never regex it and never sort on it: five of the 27 codes are English mnemonics (`PERF`, `LCTR`, `SMNR`, `LAB`, `AUD`) sitting beside `<digit><letter>` codes.

### Done when

- [ ] `data/ga-rooms.json` holds 327 facility IDs plus `_meta.term` and `_meta.pulled`, and the build fails if the parsed count moves more than 10% against the last committed file
- [ ] `TYPE_VISIBILITY` is exported from one harvester module and the app imports no type codes
- [ ] `1A 1B 1C LCTR SMNR` ship as `vis: "shown"` (expect about 422 rooms, 71 buildings); `2P 2Q 5K 6L 2J 5C` ship as `vis: "secondary"` (expect about 49); every other code is absent
- [ ] A test asserts a fabricated room with `facilityType: "ZZ"` is absent from the built index
- [ ] The build prints one line per unrecognised code with a room count and an example `facilityId`
- [ ] A room passing the type filter but missing from `ga-rooms.json` ships `ga: false` and is never dropped; the build prints the count (expect about 77 non-GA `1B` rooms), and `docs/DECISIONS.md` records what the app does with the flag before `result-screen` renders it
- [ ] `WSB300`, `WAB0130` and `SY0203` are excluded by a named constant carrying the Wooster comment
- [ ] `data/restricted-buildings.json` ships separately with a `pulled` date the app surfaces, seeded with the 32 known rooms (Atwell 10, Drinko 7, Postle 3, Newton 3, Meiling 2, Riffe 2, Lincoln Tower 1, Wooster 3, Heffner 1)
- [ ] `facilityType`, `facilityCapacity` and `buildingCode` are diffed across the 1262, 1264 and 1268 snapshots for the shared `facilityId` set, and every room that changed type is listed in `docs/DECISIONS.md` with a call on whether the allow list needs a per-term refresh
- [ ] `docs/registrar-room-type-key-email.md` drafts the ask for the official room-type key

### Notes

The sources disagree and neither is complete. Only 258 of 486 sampled rooms (53%) are on the Registrar list, `1C` is 94% GA and `1B` is 73%, and every type outside the `1x` family is 0% GA. The 77 non-GA `1B` rooms are probably ordinary departmental classrooms, and 69 GA rooms never appeared in any sample. An unscheduled GA room is the best result this app can return, so GA absence is a flag, not a filter.

The zero-variance result the type filter rests on (0 of 633 rooms reported two types) was measured inside term 1268 alone. The cross-term diff is in this issue because `snapshot-expiring-terms` makes it cheap and Spring 2026 leaves the API on 2026-08-31.

The code space is not closed: 24 codes after 40 subjects, 3 more after 11 extra sweeps, probably 30 to 35 campus-wide. Hence unknown defaults to hidden. Nine of the 27 codes are decoded from one or two rooms and are labelled guesses in `facility-types.md`; do not restate them as facts.

Never drop a room for `facilityCapacity === 0`. The field has no null: 0 means unknown, 998 means online. 32 real rooms report 0, including seven Campbell Hall classrooms that would silently vanish.
