---
title: Invert sections into data/rooms-<term>.json, with intervals deduped, merged and propagated
labels: data, enhancement
milestone: Phase 1: Data pipeline
estimate: L
order: 8
depends_on: bucket-harvester, meeting-funnel
---

The harvester gives us course to sections to meetings. The app needs room to when it is busy. This issue is that inversion, written as one small per-term file the phone holds offline. The raw busy list lies in three directions at once: cross-listed sections repeat the identical interval (232 of 1,813 usable blocks, 12.8%), one section can list the same meeting ten times with the tenth ending twenty minutes early, and a divisible room's parent booking silently occupies its halves. Fix all three here, at build time, so the phone never has to.

### What to do

`scripts/fetch-rooms.mjs` writes two files. Room keys are the raw `facilityId`, building references the raw `buildingCode`. Neither is reconstructable from the other: 331 of 1,813 meetings disagree (`room: "N048"` becomes `SON0048`, and `buildingCode` 148 maps to both `SOE` and `SON`).

```json
{
  "term": "1268",
  "sessions": [["2026-08-25","2026-12-09"], ["2026-10-19","2026-12-09"]],
  "rooms": {
    "DL0357": { "b": "279", "n": "357", "cap": 46, "type": "1B",
                "busy": [[1,480,535,0], [1,545,600,0]] }
  }
}
```

`busy` is `[weekday 0-6, startMinute, endMinute, sessionIndex]`, all integers, times from a ported `toMinutes()`. `cap` is the raw `facilityCapacity` including 0; record in a schema comment that 0 means unknown and 998 means online. No lat, lon or building name goes in this file, they live in `data/buildings.json`.

Build `sessions` from deduped observed `(startDate, endDate)` pairs on the meetings. Never read `sessionCode`: nine LAW sections labelled `7W1` actually run 2026-08-24 to 2026-10-09, and Summer has eight codes (`1S`, `8W1`, `8W2`, `6W1`, `6W2`, `4WS`, `4W2`, `4W3`).

Merging is one pure exported function over one room's day-expanded intervals:

```
group intervals by (weekday, sessionIndex)
for each group:
  sort by (start, end)
  fold left: if next.start <= current.end
               current.end = max(current.end, next.end)   // duplicate, overlap or abutting
             else emit current, current = next
emit remaining
never merge across groups
```

Then propagate: for each room whose meetings carried `facilityGroup === true`, copy its merged intervals onto every room whose `facilityId` extends the parent's, and re-merge. Gate on `facilityGroup`, never on a bare prefix scan: `KH0333`/`KH0333C` and `HC0346`/`HC0346D` are both `facilityGroup: false` and genuinely separate rooms.

`data/current.json` is the pointer file, and it is the only place `generated` appears:

```json
{ "term": "1268", "termName": "Autumn 2026",
  "generated": "2026-08-30T07:41:12Z",
  "rooms": "data/rooms-1268.json",
  "instruction": ["2026-08-25", "2026-12-09"],
  "next": { "term": "1272", "termName": "Spring 2027", "firstClass": "2027-01-11" } }
```

`instruction` comes from min and max harvested meeting dates, not from `searchableTermsV2`, whose dates are eleven-month search visibility windows.

### Done when

- [ ] `data/rooms-<term>.json` is written by `writeAtomic` as `JSON.stringify(payload, null, 0)` plus a trailing newline, with room keys sorted
- [ ] Room keys are the raw `facilityId` string and `b` is the raw unpadded `buildingCode` string, so the join to `data/buildings.json` resolves
- [ ] `sessions` is built from deduped observed `(startDate, endDate)` pairs; `sessionCode` appears nowhere in `fetch-rooms.mjs`
- [ ] No `startTime` or `endTime` string reaches the output; `cap` is the raw integer including 0, with the 0-means-unknown / 998-means-online comment in the schema
- [ ] A pure exported function takes one room's raw intervals and returns them sorted and merged per `(weekday, sessionIndex)`: exact duplicates dropped, overlapping and abutting intervals merged, intervals in different sessions never merged
- [ ] Parent rooms with `facilityGroup === true` propagate every interval onto each child whose `facilityId` extends theirs, identified by `facilityGroup` and not by a prefix scan alone
- [ ] The run log prints duplicates dropped, merges performed, and intervals propagated to `facilityGroup` children
- [ ] No `lat`, `lon` or building name string is present anywhere in `rooms-<term>.json`
- [ ] `data/current.json` carries `term`, `termName`, `generated` as a full ISO-8601 UTC instant, `rooms`, `instruction`, and `next` when known
- [ ] Failing to determine a current term outside a known between-terms gap exits non-zero with a refusal, and never guesses a term
- [ ] Tests pass: round-trip; every busy tuple is 4 integers; weekday in 0-6; `startMinute < endMinute`; `sessionIndex` in range; the string `generated` never appears inside `rooms-<term>.json`; two identical cross-listed intervals collapse to one; the CSE 2112 section 0031 ten-copy case (`BE0120` and `BE0470`, 2:20-3:40 pm Tuesday, meeting #10 ending 3:20 pm) collapses correctly; two intervals at the same clock time in different sessions stay separate; a 15-minute passing period stays two intervals; `MALC0100` propagates to `MALC0100N` and `MALC0100S`
- [ ] Running the build twice on an unchanged term leaves `git status --porcelain -- data/rooms-*.json` empty, with only `data/current.json` staged

### Notes

`combinedSection` is not a partner pointer. Its only observed values are `null` (4,331), `'Closed'` (592) and `'S'` (8), so it cannot be used to pair cross-listed sections. Structural interval merging is the only dedupe that works, which is also why the ten-copy case falls out for free.

The research note recommends propagating child intervals back up to the parent as well, on the argument that a class in `MALC0100N` really does occupy half of `MALC0100`. That is not in the acceptance criteria above and only affects two rooms today, but decide it deliberately rather than by omission.

Sort the room keys for the diff, not for the bytes. Non-deterministic key order costs 4.6x more git history and, worse, turns every weekly diff into a full-file rewrite so nothing can tell you whether the data actually moved.

Size sanity check: 562 rooms and 5,438 intervals measured at 115,923 bytes raw and 15,270 gzipped, so full campus should land near 27 to 33 KB gzipped. If the output is much larger than that, the dedupe or the merge did not run.
