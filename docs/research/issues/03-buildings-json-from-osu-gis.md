---
title: Build data/buildings.json from Ohio State's own GIS building layer
labels: geo, data
milestone: Phase 0: Setup
estimate: M
order: 3
depends_on: repo-scaffold-pages-licence
---

The class API hands us `DL0357` in "Dreese Laboratories" and no coordinate, so nothing ranks by walking distance until a building layer exists. The README plans to fuzzy-match OpenStreetMap names. Do not: two matchers written independently topped out at 84.1% and 87.5%, and their worst failures are confident rather than uncertain. "Knowlton Airport Terminal" scores 0.742 against "Knowlton Hall", a 9,385 m error, and a separate fuzzy join put McCampbell Hall (`303`) on Campbell Hall (`018`). OSU publishes its own layer whose building number is character-for-character the class API's `meetings[].buildingCode`. It is a primary-key join.

### What to do

Two research passes each found a different OSU layer and each reported a 100% join, and nobody compared them. Query both once for the same codes and diff the coordinates:

- A: `gissvc.osu.edu/arcgis/rest/services/Data/FacilitiesStreets_RO/MapServer/11/query`, 1,347 features, 1,331 distinct `buildingNumber`, resolved 88 of 88 observed codes
- B: `services6.arcgis.com/PVrqnRx8k1Ldjgw0/arcgis/rest/services/MainCampusFacades/FeatureServer/0/query`, 436 features with polygon geometry, resolved 48 of 48 sampled codes

Then write `scripts/fetch-buildings.mjs`: one request to the winner, transform, write `data/buildings.json` keyed by `buildingCode` exactly as the class API spells it. Read `buildingNumber`, not `BLDG_NUM` (padded to `0279`), and cast `Latitude`/`Longitude`, which come back as strings.

```json
"279": { "name": "Dreese Laboratories", "short": "DL", "lat": 40.002221,
         "lon": -83.01599, "km_from_oval": 0.25, "address": "2015 Neil Ave" }
```

```
skip + count rows with no Latitude       (14 in layer A)
dedupe on buildingNumber, log collapsed  (246 and 1243 in layer A)
km_from_oval from (39.9995, -83.0130)
drop > 10 km, printing code, name, distance
emit sorted, plus _meta
```

`data/buildings.draft.json` already holds 628 records matching a live re-fetch to within 0.068 m. Use it as the fixture and expected output, not as the shipped file.

### Done when

- [ ] Both layers queried for the same code set; the choice, each layer's coverage, and the disagreement distances are in `docs/DECISIONS.md`
- [ ] `scripts/fetch-buildings.mjs` makes exactly one HTTP request and emits the six fields above per key, with no padding or trimming of the key
- [ ] Duplicate building numbers are collapsed explicitly and printed; layer A prints `246` and `1243`
- [ ] Rows with no coordinate are skipped and counted
- [ ] The 10 km cap is applied here and nowhere else; every drop prints code, name and distance, and the script warns if it drops anything other than `404`, `414`, `549`
- [ ] Nothing reads the GIS `Campus` or `InstType` field, with a comment saying why
- [ ] `_meta` carries source URL, join rule, pull date, distance cap and both attribution strings (OSU FITS, OpenStreetMap ODbL); a test fails if either string goes missing
- [ ] `gzip -9 data/buildings.json` is under 20,480 bytes
- [ ] The transform runs in a test over a committed fixture of the raw ArcGIS response with no network
- [ ] `data/buildings.json` is committed and no app code fetches an ArcGIS host at runtime

### Notes

The cap has to be 10 km, not the 3 km the first research pass recommended. 3 km deletes `837` Outpatient Care East at 4.98 km and `1019` Knowlton Executive Terminal at 9.79 km, both hosting real Autumn 2026 classes. There is a 116 km empty gap between Don Scott Field and Wooster, so 10 km is a stable line, not a tuned one. How far a student will walk is a UI setting, not a property of the dataset.

Neither attribute field filters this: `InstType = "Academic"` includes Refuse Vehicle Storage, and `Campus = "Columbus"` includes clinics 146 km out. Intersecting with harvested codes is the only filter that works, and it belongs downstream.

The published coordinate is a centroid, not a door. It falls outside its own footprint for Ohio Stadium (35 rings), so a point-in-polygon sanity gate fails on correct rows. The layer is public and CORS-open but not openly licensed; the OSU GIS Hub item says "For use by anyone interested in OSU data" with an asserted copyright and `gismaps@osu.edu` as the contact.
