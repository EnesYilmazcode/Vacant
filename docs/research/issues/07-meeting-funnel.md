---
title: Filter meetings to real Columbus rooms with a counted funnel, and strip instructors at the parse boundary
labels: data, good first issue
milestone: Phase 1: Data pipeline
estimate: S
order: 7
depends_on: repo-scaffold-pages-licence
---

Most rows in `meetings[]` are not a room being occupied. About half carry no `facilityId` at all, and two pseudo-rooms (`ONLINE` and `OFFCAMPUS`) carry real weekday flags and clock times, so they will happily become busy blocks in a fake 998-seat room unless something stops them. Separately, every meeting ships `instructors[]` with a real `name.n@osu.edu` address, and one page of one subject held 64 distinct instructors and 208 email occurrences. Ported naively, `rooms-<term>.json` becomes a public, offline-cached index of which professor is in which room at which minute all term.

### What to do

Add `scripts/lib/funnel.mjs` with a pure `isRealRoom(meeting, section)` and a counter object. Delete `instructors` the moment a meeting object is first read, in the harvester's parse loop, not at serialization.

```js
// stages run in this order, each with its own counter
if (m.facilityId == null)                    return drop('blankFacilityId')
if (PSEUDO.has(m.buildingCode))              return drop('pseudoRoom')  // ONLINE, OFFCAMPUS
if (section.location !== 'CS-COLMBUS')       return drop('offCampus')
if (!DAYS.some(d => m[d] === true))          return drop('noWeekday')
const [s, e] = [toMinutes(m.startTime), toMinutes(m.endTime)]
if (s == null || e == null || e <= s)        return drop('badTime')
return true
```

`facilityId` is `null`, never `""` (0 empty strings in 8,284 meetings), and `facilityType`, `buildingCode`, `facilityDescription` and `facilityGroup` all go null on exactly the same rows, so testing `facilityId` alone is enough. `room == null` catches both pseudo-rooms too and is a cheap second check.

Do not filter on `instructionMode` or `component`. Leave a comment saying why: `Distance Learning` has 0 real-room meetings but `Hybrid Delivery` has 81 and `Distance Enhanced` 14, while 1,945 `In Person` meetings have no room; and 296 `component: "Laboratory"` meetings happen in ordinary `1B` classrooms.

Print every counter plus the surviving ratio at the end of a run, so an upstream shape change is a moved number rather than a quietly half-empty grid:

```
meetings 8284 | blankFacilityId 4063 | pseudoRoom 852 | offCampus 0
noWeekday 0 | badTime 0 | usable 3369 (40.7%)
```

### Done when

- [ ] `isRealRoom(meeting, section)` is exported from `scripts/lib/funnel.mjs` and the file imports no `node:fs`, no `node:https` and calls no `fetch`
- [ ] The five stages run in the order above, each incrementing its own named counter
- [ ] A run prints all five counts and the surviving ratio as a percentage
- [ ] The harvester's parse loop does `delete m.instructors` (or never copies it) at the point each meeting is first read, and a unit test asserts the field is absent on the returned object
- [ ] A test greps the serialized index for `/ONLINE|OFFCAMPUS/` and asserts 0 matches
- [ ] A test greps the serialized index for `/[A-Za-z0-9._+-]+@osu\.edu/` and asserts 0 matches
- [ ] Neither `instructionMode` nor `component` appears in `funnel.mjs`, and a comment records the counts that rule them out
- [ ] `node --test` passes with the network unreachable, covering: an `ONLINE` row with a real day and time (dropped), an `OFFCAMPUS` row (dropped), a `CS-MARION` section (dropped), a `Hybrid Delivery` meeting in a real room (kept), an `Independent Study` meeting with a real room (kept)

### Notes

`facility-types-sample.json` is room-level, one row per `facilityId`, so it gives real shapes for the room attributes but carries no `startTime`, no day flags and no section `location`. The five fixtures above have to be hand-built meeting objects using the shapes recorded in `facility-types.md`. Copy the `ONLINE` object verbatim from that note.

The weekday and time checks dropped nothing: every one of 1,813 meetings with a real `facilityId` also had a day flag and a parseable time. Keep them anyway and keep counting them. A nonzero count there is the signal that the upstream shape moved.

The `location` filter does not do the job people expect. `WSB300`, `WAB0130` and `SY0203` are Wooster rooms 60 miles away that report `campus: "Columbus"` **and** `location: "CS-COLMBUS"`, so they survive this funnel. Excluding them belongs to `Build data/buildings.json from Ohio State's own GIS building layer`, not here.
