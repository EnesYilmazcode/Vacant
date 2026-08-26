---
title: Scrape the Registrar classroom pool building schedule into data/buildings-hours.json
labels: geo, data
milestone: Phase 2: Geo
estimate: M
order: 14
depends_on: buildings-json-from-osu-gis
---

The blueprint listed building access hours as a dataset that might not exist publicly. It does. The Registrar publishes an open and close time for every weekday, for all 47 classroom pool buildings, every semester, as HTML. Measured against it, a flat 7am-10pm assumption overstates open minutes by 27% Mon-Fri and by 837% Sat-Sun, because only 5 of 47 buildings open Saturday and 11 open Sunday. Without this table Vacant names free rooms behind locked doors, which is the exact failure the project exists to fix.

### What to do

Build the abbreviation to `buildingCode` join table first, as its own committed file. The Registrar keys buildings by a 2-3 letter abbreviation; the class API and the GIS layer key on the numeric `buildingCode`. 42 rows are already derived from observed API data in `building-access.md` section 6; five (AE, AS, BK, KH, TFM) were resolved by name against GIS and must be hand-checked against a real meeting object before they ship. `FL` is `1018` and `TFM` is `1025`, so do not assume three digits.

`scripts/fetch-building-hours.mjs` then reads the classroom pool index page, follows the term links, caches each fetched page in-repo, parses, and emits:

```json
{
  "generated": "2026-08-26",
  "term": "1268",
  "source": "https://registrar.osu.edu/.../autumn-2026-classroom-pool-building-schedule/",
  "buildings": {
    "279": { "abbr": "DL", "hoursSource": "registrar",
             "hours": [null, [420,1170], [420,1260], [420,1170], [420,1260], [420,1170], null] },
    "1064": { "abbr": null, "hoursSource": "unknown", "hours": null }
  }
}
```

`hours` is indexed 0=Sunday through 6=Saturday, each entry `[openMinute, closeMinute]` or `null` for closed. A `12am` close is 1440, not 0.

The parser splits on `div.panel.panel-default`, takes `panel-title > a` for `Name (CODE) | street address`, strips tags from `panel-body`, and regexes `(Monday|...|Sunday)\s*:\s*(.*)` out of it. The page has zero `<table>` elements, so a table parser finds nothing.

### Done when

- [ ] A committed 47-row map of registrar abbreviation to `buildingCode`, each row carrying how it was derived, with AE, AS, BK, KH and TFM confirmed against a real meeting object
- [ ] The join is on `buildingCode` only. A test asserts SOE and SON both resolve to 148 and PEA resolves to 245, which a `facilityId` prefix join gets wrong
- [ ] `scripts/fetch-building-hours.mjs` discovers term pages by following links from the pool index, never by constructing a slug
- [ ] Every successfully fetched term page is committed under `data/cache/registrar/`. A failed fetch falls back to the cached copy, prints a warning and exits 0
- [ ] An unparseable day cell exits non-zero and prints the building abbreviation plus the raw cell text. Run against the current Autumn 2026 page it fails on the 4 Caldwell Lab cells
- [ ] A documented override file can supply a cell by hand; the record's `hoursSource` becomes `override` and the file records why
- [ ] Tests cover `Closed` with a capital C, `2pm to 6pm`, `7am-5:00pm`, `8am-12am` mapping to close 1440, and `closed` mapping to `null`
- [ ] Buildings with no published hours appear in the file with `hoursSource: "unknown"` and `hours: null`. No record anywhere carries assumed hours
- [ ] A test asserts the emitted JSON contains no phone number, no `name.n` pattern and no staff name. The comment block is never written to output
- [ ] The build warns when a building's published close precedes its last scheduled class end that weekday, with Hopkins Hall on a documented allowlist
- [ ] Fewer than 40 parsed buildings fails the build, and a drop against the last committed file fails unless forced. No hardcoded 47
- [ ] The emitted file carries a `generated` date and the app surfaces it

### Notes

The 47 pool buildings are not the campus. Only 47 of the roughly 116 buildings holding classrooms are centrally scheduled, so around 60% of the rooms Vacant surfaces have no published hours at all. Coverage measured on a 12-subject sample is 88.8% of rooms and 85.4% of in-person meetings, and the uncovered set is Timashev Music, Celeste Chem, Weigel, Sherman Studio Art, McCampbell and Ohio Stadium. The unknown path is the majority path by building count and it must never be filled in with a plausible guess.

Do not derive hours from the class schedule as a fallback. Hopkins Hall publishes a 6:30pm close and runs classes to 8:45pm, and its own comment explains why: art students have swipe card access outside building hours. A late class proves badge access, not an open door. Cunz Hall makes the same point at finer grain, locking floor 2 and above at 6pm while floor 1 stays open, so building-level hours will be wrong in the optimistic direction for some rooms.

The four malformed Caldwell Lab cells are live right now (`8am-` with no close Tue/Wed/Thu, `8am-10` with no am/pm Monday). Summer 2026 shows Caldwell as 7am-5pm so 10pm is the likely intent, but the fix belongs with the Room and Class Scheduling Office, not in the parser. This is why the manual override exists: one Registrar typo should not block a term rebuild.

The slug is not constructible. `winter-break-classroom-pool-building-schedule-2025-2026` breaks the season-year pattern, and it is unknown whether an old term's page survives once the next is posted, which is what the in-repo cache is for.

Enarson (EC), Hitchcock (HI) and Independence (IH) are 7am-11pm all seven days, and Sullivant (SU) is the fourth all-week building. Those four are the honest empty-state answer and are worth carrying forward to `Build the unscheduled-hours screen that ranks buildings, not rooms`.
