---
title: SPIKE: does a genuinely never-scheduled room exist in our own data?
labels: spike, data
milestone: Backlog
estimate: S
order: 30
depends_on: snapshot-expiring-terms, bucket-harvester, room-safety-filter
---

The multi-term union is the only backlog item justified entirely by a competitor's file. Roomix's `room_matrix.json` for term 1268 has 190 of its 1,067 rooms carrying an empty `courses` array, and the reading that those are the best study rooms on campus comes from Antscoper's README, a different project at a different school. The other reading is that they are cross-term residue inside Roomix's own index, in which case unioning our snapshots manufactures the same artifact and we cite it back to ourselves as evidence. Settle it before tripling harvest cost and splitting every guard floor by term.

### What to do

Run the funnel from `Filter meetings to real Columbus rooms with a counted funnel, and strip instructors at the parse boundary` over `data/raw/1262/`, `data/raw/1264/` and the 1268 harvest, then diff room identity.

```
for term of ['1262','1264','1268']:
  seen[term] = Set(m.facilityId for every meeting surviving the funnel)

carried = union(seen['1262'], seen['1264']) minus seen['1268']
for id of carried:
  print id, lastSeenTerm, buildingCode, facilityType from lastSeenTerm,
        TYPE_VISIBILITY[type], ga: gaRooms.has(id)
```

On `data/ga-rooms.json` with a `shown` type is a strong positive. A `shown` type off the GA list is weak. Anything else is noise.

Do the cheaper half in the same sitting. `data/ga-rooms.json` is 327 Registrar rooms and does not depend on the class schedule at all, and 69 of them never appeared in any research sample. Count how many of the 327 are absent from all three terms. If that set is large, never-scheduled rooms are already reachable from one term plus the Registrar list and the union buys nothing.

Then walk to three strong positives and look. If the decision is build, carried rooms get their own tier and never enter the ranked list:

```
  4 rooms with real schedule data
  Dreese 357     4 min   free till 1:55p    46 seats
  Enarson 218    7 min   no class rest of today

  not scheduled this term (3)
  Enarson 304    6 min   no record in 1268, unverified
```

### Done when

- [ ] A script prints every carried-forward room with `facilityId`, `lastSeenTerm`, `buildingCode`, `facilityType`, `TYPE_VISIBILITY` bucket and GA flag
- [ ] Carried count and strong-positive count written down beside 190 of 1,067 (17.8%)
- [ ] Count of the 327 GA rooms absent from all three terms written down
- [ ] Three strong positives visited, each recorded with date, time, whether the door number matches, whether it was unlocked, whether it is a classroom, whether anyone was in it
- [ ] `docs/DECISIONS.md` records BUILD or DROP as one word
- [ ] If BUILD: spec says a carried room never renders as a rankable free room, sits below every room with real busy data, never wins a tie-break, and has `facilityType` re-fetched each term rather than inherited
- [ ] `searchableTermsV2` fetched on the day, its term codes and `endDate` values pasted into the decision
- [ ] If DROP: the union line is deleted from the backlog, not left open

### Notes

Antscoper's rule, keep any room with activity in the last two years, does not port. The API deletes a term once it leaves `searchableTermsV2`: `term=1258` returns `totalItems: 0` today. Three terms are searchable at once on eleven-month windows, so the lookback ceiling is whatever `Snapshot terms 1262 and 1264 before Spring 2026 leaves the API on August 31` captured, and widening it later means snapshotting before a term expires, not after.

A room can be missing from 1268 because it was renovated, repurposed or demolished. Nothing in the data separates that from a quiet classroom, which is why the three visits are the point of the spike. One dead room in the sample is a DROP.

This cannot ship on an inference because a room with an empty busy list reads as free at every minute of every day forever and wins every ranking tie-break, so it sits at the top of the list permanently.
