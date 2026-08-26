---
title: Walking skeleton: one catalog-number bucket to a ranked list of real rooms on a phone
labels: enhancement, data, ux
milestone: Phase 0: Setup
estimate: M
order: 4
depends_on: repo-scaffold-pages-licence, buildings-json-from-osu-gis
---

Building the data layer first means nothing renders until roughly nine issues in, which is nine issues of guessing. Cut one thin slice through every layer instead. The three things most likely to be quietly wrong are the usable-minutes formula, the `facilityId` to `buildingCode` join, and session-date masking, and all three fail visibly the first time a real ranked list appears on a screen.

### What to do

Four files. Everything is throwaway except the gap sweep and the distance function.

**1. `scripts/spike-harvest.mjs`.** Walk one bucket only, sequentially, 500 ms between calls, hard cap of 20 requests. Bucket `1xxx` is 14 pages of 200 for term 1268.

```
GET https://content.osu.edu/v2/classes/search
      ?q=&campus=col&term=1268&catalog-number=1xxx&sort=catalogNumber&p=<n>
```

Dump the raw pages to a scratch file so re-running the rest costs nothing.

**2. `scripts/spike-index.mjs`.** Invert sections into rooms. Drop a meeting only if `facilityId` is blank (41.5% of meetings) or `buildingCode` is `ONLINE` or `OFFCAMPUS`. No facilityType allow list, no two-pass union, no refusal guards, no dedupe. Day-expand with the `monday`..`sunday` booleans and parse `"8:00 am"` to minutes past midnight.

```json
{"DL0357": {"b": "279", "n": "357", "cap": 46,
            "busy": [[1, 480, 535], [3, 480, 535]]}}
```

`facilityId` is the room key. Take the building name from `b` joined against `data/buildings.json`, not from the meeting: `facilityDescription` holds the BUILDING name and `buildingDescription` holds the ROOM label, backwards from what the field names suggest.

**3. `js/engine.js`.** The part that survives. Copy the sweep and the equirectangular distance out of `docs/research/query-engine.md` section 13.

```js
arrival     = now + Math.ceil(metres * 1.30 / 78)   // DETOUR, WALK_MPM
usableStart = Math.max(arrival, gapStart)
usable      = (gapEnd - 10) - usableStart           // PACKUP = 10
```

Not `gapEnd - now - walkTime`. That counts corridor waiting as study time and overstates by the wait.

**4. `index.html`.** Hardcoded origin at the Oval (39.9995, -83.0130), no geolocation, top 20 by walk time ascending.

```
+--------------------------------------+
| VACANT  prototype, do not trust this |
| from the Oval, need 60 min           |
+--------------------------------------+
| Dreese Lab 357          4 min walk   |
| free till 1:55p             46 seats |
| Caldwell Lab 177        5 min walk   |
| free till 3:20p             60 seats |
+--------------------------------------+
```

### Done when

- [ ] `spike-harvest.mjs` makes at most 20 requests with a 500 ms pause between each, and prints the request count on exit
- [ ] The funnel prints four numbers: meetings read, dropped blank `facilityId`, dropped `ONLINE`/`OFFCAMPUS`, intervals emitted
- [ ] The room index has at least 200 distinct `facilityId` keys, and every key's `b` resolves in `data/buildings.json`
- [ ] A unit test asserts `usable` is 120 for gap 14:00-16:00, `now` 13:50, walk 6, `PACKUP` 0, and fails against the README formula's 124
- [ ] Equirectangular distance from the Oval to `279` (Dreese) is within 1 m of a haversine reference in the same test
- [ ] `index.html` renders 20 rows with room name, building name, walk minutes and a clock end time, ranked by walk ascending
- [ ] The words "prototype, do not trust this" are visible without scrolling
- [ ] The page is open on Enes's phone at the deployed `/Vacant/` URL
- [ ] `docs/DECISIONS.md` records the first real ranked list verbatim, plus anything that disagreed with expectation

### Notes

Read the bucket list off the response's `catalog-number` facet rather than hardcoding `1xxx`, so the same script works on a smaller term later.

Cross-axis completeness was only proven for bucket `3xxx` (400 of 400 sections matched a subject walk). `1xxx` is unverified, which is fine here and is not fine in `bucket-harvester`.

Zero weekend classes exist anywhere in the schedule, so running this on a Saturday returns every room as free with a huge window. That is the data telling the truth, not a bug in the sweep.

This depends on `buildings-json-from-osu-gis` landing `data/buildings.json`. `data/buildings.draft.json` is already in the repo and is close enough to unblock local work if that issue is still open.
