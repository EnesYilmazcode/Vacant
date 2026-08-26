---
title: Ship the trust surfaces: attribution, docs/DATA.md, /privacy, the kill switch and the README corrections
labels: documentation, ops
milestone: Phase 3: App
estimate: M
order: 25
depends_on: buildings-json-from-osu-gis, meeting-funnel, result-screen
---

Vacant ships two third-party datasets with real attribution obligations, has no non-affiliation line anywhere in the served page, has no privacy page, and the README still prints four claims the research disproved. Land all of it in one pass, plus the one page an OSU staffer would read if they ever found the repo, and the two commits that stop the harvester from a phone.

### What to do

`data/README.md` records source, licence and provenance per file:

| file | source | rights | provenance |
| --- | --- | --- | --- |
| `rooms-<term>.json` | OSU public class schedule, `content.osu.edu/v2` | facts, no rights asserted | harvest date, term, request count |
| `buildings.json` | OSU FITS `gissvc.osu.edu/.../FacilitiesStreets_RO/MapServer/11` | (c) 2025 OSU GIS, public use granted in writing | layer URL, the `where` query, pull date |
| `buildings-hours.json` | Registrar classroom pool building schedule | OSU page, scraped | term page URL, fetch date |

Settle ODbL before writing the credits. Every shipped coordinate comes from OSU GIS; OSM only produced the `osm_check_m` cross-check number in `buildings.draft.json`. If that field survives into the built `data/buildings.json`, ship `LICENSE-ODbL.txt` and credit OpenStreetMap. Otherwise drop the column, and write the reasoning into `DECISIONS.md` so nobody re-derives it in March.

Footer of the results screen, always rendered, not behind a menu:

```
  ────────────────────────────────────────
  Vacant is a student project. It is not
  affiliated with, authorized by, or
  endorsed by The Ohio State University.

  Room data from Ohio State's public class
  search. Building locations (c) 2025 The
  Ohio State University, Facilities
  Information and Technology Services.

  About · Privacy · Data
```

`docs/DATA.md` is the page that ends a conversation in one read: endpoint, weekly Sunday cadence, the measured request count printed by the harvester's own counter (currently two passes of 8 catalog-number buckets, 272 requests, roughly 11 MB gzipped a week at the measured 34 to 44 KB per page), the pacing, that `instructors[]` is dropped at the parse boundary and guarded, and a contact address for anyone who wants it throttled or stopped. It ends with the kill switch, written as two edits a phone browser can make: comment out the `schedule:` block in each file under `.github/workflows/` leaving `workflow_dispatch:` intact, and replace `index.html` with a static notice. Name the files and the lines.

### Done when

- [ ] `data/README.md` carries the table above with a real layer URL, a real query and a real pull date for `buildings.json`
- [ ] `grep -c osm_check_m data/buildings.json` is 0 and `DECISIONS.md` records why, OR `LICENSE-ODbL.txt` exists and the OpenStreetMap credit renders linked to `https://www.openstreetmap.org/copyright`
- [ ] The OSU FITS credit renders in the results footer and the About sheet
- [ ] `docs/outreach/gismaps-email.md` exists, and `DECISIONS.md` states the send date and that no answer is not permission. Sent before the URL is shared with anyone
- [ ] The short non-affiliation line appears in five places: the results footer, `<meta name="description">`, `og:description`, the manifest `description`, and the `/privacy` footer. A test greps all five
- [ ] `/privacy` states coordinates never leave the device, names GitHub Pages as the host that sees an IP, and says no accounts, no OSU credentials, no ads, no third-party scripts. It has a paragraph describing what changes if reports ship
- [ ] `docs/DATA.md` states endpoint, cadence, request count, bytes per week, that `instructors[]` is discarded, and a contact address
- [ ] `docs/DATA.md` carries the kill switch as two named file edits, each doable in GitHub's web editor
- [ ] README line 178: `generated` moves out of the room index example into `current.json`
- [ ] README lines 204-205: the formula becomes `usable = (gapEnd - PACKUP) - max(now + walk, gapStart)`, and 80 m/min becomes 78 m/min with an explicit 1.30 detour factor
- [ ] README line 207: "sort by distance, break ties by seats" becomes the scored surplus with `facilityType` ranked ahead of capacity
- [ ] README line 211: haversine becomes equirectangular, max error 0.1285 m over 298 campus buildings
- [ ] README line 328 replaces `TBD.` and states plainly that Vacant carries no ads, donations, sponsorships, affiliate links or paid tier, citing Responsible Use item 6 and GitHub Pages' no-business clause
- [ ] `grep -ri 'BA0C2F\|block o\|brutus' index.html css/ manifest.webmanifest` returns nothing

### Notes

The money rule is the hardest constraint in the project and the easiest to forget in a year. Responsible Use item 6 forbids using university resources "for personal commercial purposes or for personal financial or other gain", and its operative limit (I.D) is discretionary with no numeric safe harbor, so a paid tier turns "please throttle" into a named violation. GitHub Pages independently forbids running a business off Pages. Write it into the README, not just here.

The permission story is stronger than it looks and belongs in `docs/DATA.md` once: `content.osu.edu` serves no robots.txt at all (HTTP 404), `www.osu.edu` allows everything with no `Crawl-delay`, the class schedule is Public (S1) under OSU's own Institutional Data policy which applies to students, and `classes.osu.edu` hardcodes `https://content.osu.edu/v2` in its browser bundle behind `Access-Control-Allow-Origin: *`. Nothing was agreed to and nothing was breached.

Do not overclaim in the other direction either. The FITS grant is a Hub-site sentence with "Copyright 2025. OSU GIS" beside it and a Terms of Service link that is `href="#"`, and the layer we use is not one of the 13 registered ArcGIS Online items, which is why the email goes out. `/privacy` is a trust artifact, not a compliance one: Ohio has no enacted consumer privacy law, and the University Websites policy reaches neither `github.io` nor non-employee students. Write it for a skeptical sophomore.
