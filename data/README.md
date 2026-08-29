# What is in this folder, where it came from, and who owns it

Every file here is derived from something Ohio State publishes. Nothing in it was
scraped from behind a login, and nothing in it describes a person.

`docs/DATA.md` is the longer page: it has the endpoint, the cadence, the request
count, the reproduction commands and the kill switch. This file answers the
narrower question of what each file is and what rights attach to it.

## The files the app fetches

| File | Source | Rights | Provenance |
| --- | --- | --- | --- |
| `rooms-1268.json` | Ohio State public class schedule, `https://content.osu.edu/v2/classes/search` | Facts. No rights asserted. Not MIT: that is a software licence and does not fit a dataset | Built 2026-08-29 by `scripts/build-index.mjs` from a walk-until-stable harvest of term 1268, refetched the same day so the course labels are subject CODES. 545 requests over 4 passes. 871 rooms and 96 buildings harvested, **425 rooms in 46 buildings shipped** after the type, restricted-building, distance, weekly-evidence and published-hours filters. Carries a `courses` table of 2,024 subject-and-catalog labels; no section, title or instructor. See `docs/DECISIONS.md`, 2026-08-29 |
| `buildings-1268.json` | Same GIS layer as `buildings.json`, sliced to the buildings that host a class this term. 96 harvested, 46 survive the room filters, which is every building the Registrar publishes hours for | (c) 2025 The Ohio State University, Facilities Information and Technology Services | Split out of `buildings.json` by `scripts/build-index.mjs`. 7.4 KB against the full table's 167 KB |
| `buildings-hours.json` | Registrar classroom pool building schedule, `https://registrar.osu.edu/staff-resources/class-catalog-and-space/classroom-pool-building-schedule/` | OSU page, scraped. Facts | Fetched 2026-08-26 by `scripts/fetch-building-hours.mjs`. Two term pages, 47 buildings each. 4 cells in Caldwell Lab are malformed upstream and come from `registrar-hours-overrides.json` |
| `campus.json` | `https://gissvc.osu.edu/arcgis/rest/services/Data/FacilitiesStreets_RO/MapServer`, layers 11, 12, 9 and 13 | (c) 2025 The Ohio State University, Facilities Information and Technology Services | Pulled 2026-08-27 by `scripts/fetch-campus.mjs`. `where=1=1` intersected with a bounding box anchored on class-hosting buildings within 2 km of the Oval. 1,543 features, 13,254 points, 39,054 bytes gzipped |
| `current.json` | Written by the build | n/a | Names the live term and the files that go with it, and carries the build date so the app can say how stale it is |

## The files the app does not fetch

| File | What it is | Why it is committed |
| --- | --- | --- |
| `buildings.json` | The full GIS building table, 612 buildings within 20 km of the Oval | The source `buildings-1268.json` is cut from. Rebuilding the term slice needs it |
| `buildings.draft.json` | A working table with an `osm_check_m` audit column on 73 rows | Provenance for the coordinate cross-check. See the ODbL note below |
| `footprints.draft.json` | An early footprint experiment, superseded by `campus.json` | Kept so nobody redoes it |
| `harvest-1268.manifest.json` | Per-pass counts for the harvest that built `rooms-1268.json` | The harvest blob itself is not committed, so this is the only record of how it converged |
| `registrar-hours-overrides.json` | 4 hand-corrected Caldwell Lab cells, each with a written reason | The upstream page is malformed and the override has to be auditable |
| `cache/registrar/` | The raw Registrar HTML the hours parser read | So a parser change can be tested without refetching |
| `raw/1262/`, `raw/1264/` | 210 gzipped search pages, 4.1 MB, the whole of Spring 2026 and Summer 2026 | **These cannot be refetched at any price.** A term absent from `searchableTermsV2` is deleted from the search index, not hidden. This is the only copy that will ever exist. Deleting it is not a cleanup |

## OpenStreetMap and ODbL: settled, and the answer is no credit is owed

Every coordinate that ships comes from Ohio State's own GIS server. OpenStreetMap
produced one number, `osm_check_m`, which is the distance in metres between the
OSU GIS point and the OSM point for 73 of the 631 buildings in the draft table.
It was an audit, not a source.

Checked on 2026-08-27:

```
grep -c osm_check_m data/buildings.json          0
grep -c osm_check_m data/buildings-1268.json     0
grep -c osm_check_m data/campus.json             0
grep -c osm_check_m data/buildings.draft.json   73
```

No shipped file carries it, and no shipped coordinate came from OSM. So there is
no Derivative Database, no ODbL obligation, no `LICENSE-ODbL.txt` and no
OpenStreetMap credit. The reasoning is written into `docs/DECISIONS.md` under
`2026-08-27  ODbL is not triggered`, because otherwise somebody re-derives it in
March off the research note, which was written when the plan was still Overpass.

`buildings.draft.json` keeps the column. 73 scalar distances are not a
substantial extraction of anything, and throwing away the audit to tidy a
licence question that does not exist would be the wrong trade.

## The credit that is owed

The FITS grant is real but it is not an open licence. The OSU GIS Hub item
carries this, verbatim:

> For use by anyone interested in OSU data. This data is hosted by Facilities
> Information and Technology Services (FITS) at The Ohio State University.
> Requests and Questions can be sent to gismaps@osu.edu

with `Copyright 2025. OSU GIS` on the site's own footer card and a Terms of
Service link that is `href="#"` and goes nowhere. So: an explicit grant of public
use, an asserted copyright, and a named contact.

Two things follow. The credit line is:

> Building locations (c) 2025 The Ohio State University, Facilities Information
> and Technology Services.

And `FacilitiesStreets_RO` is **not** one of the 13 items the OSU GIS account
publishes to ArcGIS Online. It lives on `gissvc.osu.edu` directly, so the Hub's
licence statement is the closest applicable statement rather than a statement
about this exact layer. That is why `docs/outreach/gismaps-email.md` exists and
why it should go out before the URL is shared widely.

Class and room facts get no credit line of that kind, because facts are not
copyrightable in the United States and a room-by-time occupancy table is about as
pure a set of facts as exists. They still get an attribution, because saying
where the data came from is how a reader decides whether to trust it.

## No instructor data, anywhere

The class API ships an `instructors[]` array on every meeting with a real
`name.n@osu.edu` address in it. Across the two archived terms that was **45,483
records**, and they are deleted at the parse boundary, before anything is written
to disk. `scripts/snapshot-term.mjs` then runs a fatal `@osu.edu` scan over each
serialised page and refuses to write if one survives.

Verified again on 2026-08-27 by decompressing all 210 committed pages and walking
every object in them:

```
files                       210
decompressed bytes   93,528,295
email addresses               0
"instructors" keys            0
lastName/firstName/emplid     0
```

The only key called `name` anywhere in the archive belongs to course attribute
codes: `CCP`, `CRSF`, `GE`, `HON`, `TAG` and thirteen others. No human name
survives.
