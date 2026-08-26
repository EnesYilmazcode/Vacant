---
title: Walk to twenty rooms the app calls free and record what was actually true
labels: bug, help wanted
milestone: Phase 3: App
estimate: M
order: 26
depends_on: result-screen, geolocation-watchdog
---

Every gate in this backlog compares the pipeline to itself: the guards diff this week's harvest against last week's, and the tests check the engine against fixtures the engine shaped. An index that is wrong in the same direction every week passes all of it green, and we know two ways it can be. 384 timed in-person meetings carry no room at all, which is 10.2% of scheduled class time, and non-class bookings are invisible. The only way to get a real error rate is to go stand in the rooms.

### What to do

Twenty visits, one row each in `docs/research/ground-truth-walk.md`:

```
room     ts                app_usable  app_walk  tier        outer   inner   occupied  by
DL0357   2026-09-15T14:12  2h06        4 min     bounded     open    open    no        -
CL0177   2026-09-20T10:40  rest of day 6 min     open-ended  locked  -       -         -
```

For at least eight, run a stopwatch from tapping the row to touching the room's own door. Predicted is `ceil(metres * DETOUR / WALK_MPM)` with `WALK_MPM 78` and `DETOUR 1.30` in `js/engine.js`, both commented as fudge factors. Solve back for effective metres per minute.

The second oracle runs the same sitting, no walking:

```bash
curl -sS -o rx_matrix.json  https://api.roomix.app/indexed/1268/room_matrix.json   #   293,114 B
curl -sS -o rx_courses.json https://api.roomix.app/indexed/1268/courses.json       # 2,405,358 B
```

Each `courses[<title>].numbers[<classNumber:section>].meetings[<n>]` is:

```json
{"start_date":"2026-08-25","end_date":"2026-12-09",
 "building":"279:113","pattern_bin":"0101000","time":"0800-0855"}
```

`building` is `buildingCode:room`, so it joins to our rows with no matching. `pattern_bin` index 0 is Monday. Measured: 8,413 meetings expand to 13,975 day-level intervals over 877 rooms, and `room_matrix.json` holds 1,067 rooms in 116 buildings, 190 with no class at all this term. Diff both directions.

### Done when

- [ ] `docs/research/ground-truth-walk.md` holds 20 visit rows across 6 or more buildings
- [ ] 4 or more rows are Saturday, Sunday, or after 19:00; 3 or more are type 1B rooms absent from the Registrar general-assignment list; 2 or more are in buildings with no row in `data/buildings-hours.json`
- [ ] Every row carries all 9 fields above, with `occupied` and `by` filled in wherever the room door opened
- [ ] 8 or more rows carry a stopwatch door-to-door time next to the predicted `walkMinutes`, and the note states the fitted metres per minute
- [ ] The note states one error rate as a fraction of 20, split into locked building / locked room / occupied by something unscheduled / room does not exist / correct, and the five buckets sum to 20
- [ ] The note lists every `(buildingCode, room, weekday, start, end)` interval Roomix has that we do not and every one we have that it does not, with a count on each side
- [ ] Every room in `room_matrix.json` our index never saw is listed by facilityId, with a count
- [ ] `WALK_MPM` and `DETOUR` are changed, or reaffirmed with the measured number written into the comment
- [ ] The caveat wording and the confidence tiers on `result-screen` are changed or reaffirmed in the same commit, citing the error rate

### Notes

Roomix is not ground truth. It reads the same `content.osu.edu` API and inherits our blind spots exactly, so agreement proves the harvest and not the answer. Its `courses.json` is already cleaned, with all 8,413 meetings carrying a numeric building code and only 5 missing a day bit or a time, so a disagreement is more likely ours than theirs.

Weekend rows mostly test `building-hours-scrape`, not the index. 41 of 47 pool buildings are closed Saturday, so a locked outer door there means the hours table was right. Log which of the two was under test.

The building coordinate is a polygon centroid, a systematic underestimate of up to 38 seconds for a normal building and 1 min 45 s for Ohio Stadium, so expect measured above predicted and separate that bias out before touching `WALK_MPM`.

Spend two visits on rooms with no class all term. 69 general-assignment rooms never appeared in any research sample and 190 of Roomix's 1,067 rooms are class-free this term. That is the highest-value result the app can return and the least verified.
