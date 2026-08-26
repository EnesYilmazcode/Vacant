# Prior art: who already built "find me an empty classroom"

Research date: 2026-08-26. Everything here was probed live on that date. Every number has the
command that produced it. Nothing in this file is inference dressed as fact, and where I could
not determine something I say so.

---

## The one-sentence version

**The problem is not that nobody built this, it is that a dozen teams built it and every single
one of them stops at "no class is scheduled here", which on an Ohio State Saturday is wrong for
41 of the 47 classroom-pool buildings because they are locked.** The fix is that Ohio State
already publishes per-building open hours, holiday dates and keycard contacts on the registrar
site, and no competitor at OSU reads that page.

```
  WHAT EVERY COMPETITOR COMPUTES          WHAT A STUDENT ACTUALLY NEEDS
  +---------------------------+           +---------------------------+
  |  class schedule           |           |  class schedule           |
  |     |                     |           |     AND non-class events  |
  |     v                     |           |     AND building open hrs |
  |  "no class -> free"       |           |     AND holidays/exams    |
  +---------------------------+           |     AND door policy       |
             |                            +---------------------------+
             v                                       |
   Saturday: 1067 rooms "free"                       v
   Reality:  41/47 pool buildings locked   Saturday: ~6 buildings actually open
```

Roomix, the incumbent, computes the left box. So does everybody else. illiniSpots at UIUC is
the only project in the world that computes something close to the right box, and it needed a
Supabase cluster, a Tableau scrape and a cron fleet to do it.

---

## Part 1: Roomix, measured rather than assumed

### Correction first: the README is wrong about Roomix

The Vacant README says Roomix "is organized building by building" and "does not respect the
clock." Both halves are wrong, and if that framing survives into a launch post somebody will
call it out.

I pulled the app's compiled bundle and read it:

```bash
curl -sS -L -m 60 -o roomix-index.html https://roomix.app          # 3,634 bytes
curl -sS -L -m 60 -o roomix-main.dart.js https://roomix.app/main.dart.js   # 4,069,039 bytes
```

Roomix is a Flutter web app (`flutter_bootstrap.js`, `_flutter.buildConfig` names
`main.dart.js`, engine revision `f73bfc4522dd0bc87bbcdb4bb3088082755c5e87`). The HTML header
credits "Fatih Balsoy on 23 Nov 2023". It also ships as a native iOS app
(`<meta name="apple-itunes-app" content="app-id=6473177665">`) and an Android app
(`fatih.bal.soy.roomix` in `manifest.json`), so it is a three-platform product, not a web toy.

Extracting the app's own UI strings from the bundle turns up four search modes:

```
B.ca=new A.h0(0,"rooms")     B.cb=new A.h0(1,"nearby")
B.cc=new A.h0(2,"vacancy")   B.dw=new A.h0(3,"courses")
```

with analytics events `clicked_search_chip_nearby`, `clicked_search_chip_vacancy` and
`clicked_gps`, and the UI copy:

> "Search and select a facility below OR\ntap here to find the nearest facility."
> "Searching for the nearest facility..."

So **Roomix already has a nearest-facility button, a GPS chip and a vacancy search.** It has had
them for a while. The honest framing for Vacant is not "Roomix ignores location and time," it is
"Roomix bolts location and time onto a building browser, and the seams show." The seams are real
and they are measurable, see below.

### Roomix's architecture, from its own code

Roomix has a backend, at `https://api.roomix.app`, configurable in Developer Options via an
`api_url` setting that defaults to that host. The full endpoint list is hardcoded in the bundle
(function `A.a_e.prototype.ga5G`), and it is a **static JSON API**, the same architecture Vacant
is planning:

| Endpoint | Bytes, measured 2026-08-26 |
| --- | --- |
| `/api.json` | 86 |
| `/semesters.json` | 232 |
| `/buildings_custom.json` | 3,186 |
| `/buildings_index.json` | 4,653 |
| `/kd_tree.json` | 11,626 |
| `/graph.json` | 133,576 |
| `/buildings.json` | 176,716 |
| `/v2/graph_sorted_rounded.json` | 285,588 |
| `/indexed/1268/room_matrix.json` | 293,114 |
| `/indexed/1268/courses.json` | **2,405,358** |
| `/indexed/1268/course_search_index.json` | not measured |

Command: `curl -sS -m 45 -o out -w "%{http_code} %{size_download}" https://api.roomix.app/<path>`

**Roomix downloads roughly 3.3 MB on first launch.** Vacant's design target is one file around
150 to 200 KB. That is a 15x to 20x cold-start advantage and it is the most defensible technical
claim in the whole project. (For calibration: Roomix's `room_matrix.json` alone gzips to 70,970
bytes, so the README's "~100 KB gzipped" estimate for the Vacant index is sane.)

It is Firebase-backed for the account layer: the bundle references
`https://www.gstatic.com/firebasejs/`, `accounts.google.com/gsi/client`, a `FirestoreManager`
logger, and writes to `users/<uid>`. It has real accounts (create, verify email, reset password,
delete account), bookmarks, ten colour themes, a metric/imperial toggle, a 12/24 hour toggle,
calendar export (`https://www.google.com/calendar/render?cid=`) and a beta program.

### Roomix's freshness and history

```bash
curl -sS https://api.roomix.app/api.json
# {"date":"2026-08-25 01:07:47.428537","semester":{"title":"Autumn 2026","term":"1268"}}
curl -sS https://api.roomix.app/semesters.json
# 11 semesters, Summer 2023 (1234) through Autumn 2026 (1268)
```

Data was regenerated **the day before I looked**. This is a live, maintained, three-year-old
product with app-store distribution. It is not abandonware and it should not be described as
such. Its `last-modified` on `buildings.json` was `Tue, 25 Aug 2026 01:10:33 GMT`.

### Roomix's real scale, which corrects the Vacant README

```bash
python -X utf8 -c "import json; d=json.load(open('indexed_1268_room_matrix.json')); \
  B=d['buildings']; print(len(B), sum(len(b['rooms']) for b in B.values()))"
```

```
buildings 116     rooms 1067     alpha-name aliases 118 building codes
```

The README extrapolates "roughly 1,200 to 1,800 rooms in about 100 to 150 buildings." The true
number for Autumn 2026 is **1,067 rooms across 116 buildings**. Close enough that the plan is
sound, but use the real number in any writeup.

Two details worth stealing:

- **190 of the 1,067 rooms have an empty `courses` array**, that is 17.8% with no class at all
  this term. A single-term harvest cannot discover those rooms, because a room with zero
  meetings never appears in the term's class API. Roomix must be unioning room identities across
  terms. Antscoper at UCI does the same thing explicitly (see below). **A room with no classes
  all semester is the single best study room on campus and a naive one-term harvest will miss
  every one of them.** This is a free feature for Vacant: harvest 1268 plus 1262 plus 1258 and
  keep the union of room identities. Confidence: the count is verified, the union explanation is
  likely but not proven.
- `facilityType` distribution across those 1,067 rooms, which partly answers the README's open
  question about the code meanings:

  ```
  1B 506   2A 156   5K 74   1C 68   2K 40   2P 32   2M 27   1A 25   6L 24
  (null) 13   2Q 11   2D 11   2H 11   PERF 10   6F 9   LCTR 9   4A 8   5A 8
  ```

  Note that some values are already readable words (`PERF`, `LCTR`) mixed in with the numeric
  codes. `1B` is 47% of all rooms and is almost certainly the general classroom code.

### How Roomix's vacancy search actually works, and where it breaks

The vacancy routine is `A.Bm(a2,a3,a4,a5)`, logging `[LFVR] Looking for vacant rooms...`. Reading
it:

1. `if(a2.dy==null){s=1 break}`, **it returns nothing unless a seed building is already
   selected.** The GPS button does not search campus, it picks the nearest building and then
   searches from there.
2. It seeds a list with that building at distance 0, appends the precomputed neighbour list from
   `/v2/graph_sorted_rounded.json`, then `if(d.b>200)break`.
3. That graph is building-to-building distance in metres, sorted ascending. For Dreese (`279`)
   the first entries are `[["280",69.79],["077",70.84],["072",72.05],...]`.

**So Roomix's vacancy search only ever looks inside a 200 metre radius of one building.** Two
hundred metres is about a two and a half minute walk. Everything past that is invisible to it.
Verified from the bundle and from the graph file, not inferred.

4. The busy test is `A.brj(...)`: it walks the room's course keys, resolves each to a meeting,
   checks `startDate`/`endDate` containment, checks a day-of-week bit string
   (`if(l[a3.fy.gdz()-1]==="1")`), converts times to decimal hours and tests three overlap
   cases. **Roomix does handle partial-term sessions correctly**, because it checks the meeting
   date range. Credit where due.
5. Time input is a `Start` and an `End` time-of-day pair (`a2.go`, `a2.id`). There is no
   "how long do I need from now" concept and no duration chip.
6. Sorting: if the mode is `nearby` and coordinates are non-null it sorts by straight-line
   distance to the building, else the comparator is `$2(a,b){return -1}`, that is, no sort at
   all.
7. Distance is rendered by `A.byt(a)` as `ft`/`mi` or `m`/`km`. **There is no walk time anywhere
   in the bundle.** Grep counts: `walk` 0, `walking` 0.

### The Roomix gaps that matter, verified by grep on the bundle

```
building hours  0      Building Hours 0      open hours 0
holiday         0      Holiday        0      final exam 0
keycard         0      Keycard        0      BuckID     0
unofficial      0      guarantee      0      disclaimer 0
```

`https://api.roomix.app/hours.json` returns **404**, and the endpoint table I extracted from the
bundle is exhaustive, so there is no hours file under another name.

**Roomix has no building-hours awareness, no holiday awareness, no final-exam awareness, and no
locked-door disclaimer of any kind inside the app.** The only "unofficial" wording anywhere is
the HTML `<meta name="description">` tag, which a phone user never sees.

### Where Roomix gets its building coordinates, and why that matters a lot

`api.roomix.app/buildings.json` is not a Roomix invention. It is a captured response from an
Ohio State service:

```json
{"status":"success","lastModified":"2019-12-13T21:00:00.788Z","data":{"buildings":[
  {"id":"1","name":"Ackerman Rd, 650","latitude":"40.01899831","longitude":"-83.02985918",
   "address":"650 Ackerman Rd","buildingCode":null,"buildingNumber":"241","zipCode":"43202",
   "imageUrl":"https://www.osu.edu/map/buildingImg.php?id=241&size=mobile&nodefault=1",
   "categories":[],"departments":[]}, ...
```

Measured contents: **386 buildings, 386 distinct `buildingNumber` values, 385 with latitude and
longitude.** Plus a hand-maintained `buildings_custom.json` with exactly **6** additions
(Aero & Astro Research Lab, Heminger Hall, Knowlton Airport Terminal, Theatre Film & Media Arts,
Timashev Family Music Building, Wooster Laboratory Building).

And the join key is exact:

```
Dreese Laboratories      lat 40.00222129  lon -83.01599036  buildingCode DL  buildingNumber 279
Baker Systems Engineering lat 40.00159622 lon -83.01591664  buildingCode BE  buildingNumber 280
Caldwell Laboratory      lat 40.00243311  lon -83.01503371  buildingCode CL  buildingNumber 026
```

The class API's `buildingCode: "279"` is this file's `buildingNumber`. **No fuzzy name matching
is needed at all.** The README's plan of "Overpass pull, fuzzy name match, manual fix pass, an
afternoon of hand-fixing about 130 rows" is solving a problem that has an exact-key solution.
See the corrections section.

I could not determine the live URL of the OSU endpoint this file came from.
`www.osu.edu/map/all_buildings.json`, `/map/buildings.json` and `/map/api/buildings` all return
301 redirects, matching the README's finding. The `imageUrl` field points at
`www.osu.edu/map/buildingImg.php`, which is a PHP backend, so a JSON sibling probably exists or
did. **This is the single highest-value open question in this document.**

---

## Part 2: eight other projects

I searched GitHub with `gh api search/repositories` across six query shapes and the web for
university empty-classroom tools. These eight are the ones worth reading.

### illiniSpots (UIUC) is the best in the world at this and you should copy its honesty

[plon/illinispots](https://github.com/plon/illinispots), MIT, 28 stars, created 2024-10-29, last
push **2026-08-26**, live at [illinispots.com](https://illinispots.com).

This is the only project I found that actually attacks the "empty but not usable" problem, and
it does it with four stacked data sources:

- class schedules from [Course Explorer](https://courses.illinois.edu/)
- **non-class daily events from a university Tableau feed**
  ([Daily Event Summary](https://tableau.admin.uillinois.edu/views/DailyEventSummary/DailyEvents))
- **building hours from Facilities**
  ([Facility Scheduling and Resources](https://operations.illinois.edu/facility-scheduling-and-resources/daily-event-summaries/))
- **live library room reservations from LibCal**

Its README has an "Accuracy & Reliability" section that reads like the section Vacant wants to
write. Quoting the known limitations verbatim:

> - Unofficial use (study groups, ad-hoc meetings) and last-minute changes may not be reflected.
> - Departmental access restrictions can make an "available" room unusable.
> - Special schedules (exams/holidays), maintenance closures, or data source outages can reduce accuracy.
> - Short "micro-gaps" are intentionally filtered out (< ~30 minutes) to avoid noise.

Three things to steal outright:

1. **The micro-gap filter.** "Very short gaps (< ~30 minutes) are not surfaced as 'available' to
   avoid unusable slivers." Vacant's duration input handles this naturally, but the principle,
   never offer a room you cannot actually settle into, should be explicit.
2. **"Availability ends at the earliest of the next class/event or building close."** That is the
   correct formula and it is one term longer than Vacant's current plan, which stops at the next
   class.
3. **A UX lesson from yesterday.** Commit `ref(ui): consolidate time filter into free until (#41)`,
   dated 2026-08-26:

   > The room filter popover contained both "Start Time" and "Free Until" controls executing the
   > same continuous-availability calculation (`availableFor >= target - now`). Labeling
   > continuous availability as "Start Time" contradicted the filter behavior and overlapped with
   > the global header date/time picker.

   They shipped two time controls that computed the same thing, users got confused, and they
   deleted 100 lines to get back to one. Vacant should ship exactly one time control, the
   duration chip, and never add a second.

The failure mode, in its own issue tracker: [issue #10](https://github.com/plon/illinispots/issues/10),
"during summer CIF is closed but still shows as available as of current." The maintainer's reply
is the whole maintenance problem in one line:

> "Sorry, forgot to update building hours and class schedules for summer. It's fixed now"

Cost of the honesty: Supabase Postgres, Hono on Bun, Fly.io staging and production, Mapbox,
Sentry, and a cron pipeline. That is a lot of moving parts for a student project, and it is
exactly what Vacant's static-file design is trying to avoid.

### Freerooms (UNSW) is the biggest OSS peer and it has not shipped walk time either

[devsoc-unsw/freerooms](https://github.com/devsoc-unsw/freerooms), 26 stars, 41 open issues,
created 2019-07-24, active. Live at [freerooms.devsoc.app](https://freerooms.devsoc.app/), plus
[freerooms-mobile](https://github.com/devsoc-unsw/freerooms-mobile) and
[freerooms-scrapers](https://github.com/devsoc-unsw/freerooms-scrapers). Backed by a university
society, so it has a maintainer pipeline that a solo project does not.

Public unauthenticated API, verified live:

```bash
curl https://freerooms.devsoc.app/api/buildings
# {"buildings":[{"name":"AGSM","id":"K-G27","lat":-33.91852,"long":151.235664,"aliases":[]}, ...
curl https://freerooms.devsoc.app/api/rooms
# {"rooms":{"K-G27-108":{"id":...,"school":"MED","usage":"LAB","capacity":26}, ...
```

Their shared type file is a good shopping list of what a mature version of this looks like:

```ts
export type RoomStatus  = { status: "free" | "soon" | "busy"; endtime: string };
export type Rating      = { cleanliness: number; location: number; quietness: number; overall: number };
export type StatusFilters = { capacity?; usage?; location?: "upper"|"lower"; duration?: number; id? };
export type RoomUtilitiesResponse = { floor; seating; microphone[]; accessibility[];
                                      audiovisual[]; infotechnology[]; writingMedia[]; service[] };
```

Notes that matter to Vacant:

- `duration?: number` exists as a filter, so **duration filtering is table stakes**, not a
  differentiator on its own. What Vacant adds is subtracting walk time from it.
- The rating categories are cleanliness, location and quietness. **There is no "was the door
  open" rating anywhere.** Nobody has built the thing Vacant plans as phase 4.
- [STORY#6-2 "Get Directs and walk time from building to building"](https://github.com/devsoc-unsw/freerooms/issues/762)
  and [EPIC#6 "Map Directions"](https://github.com/devsoc-unsw/freerooms/issues/760) have been
  open since 2026-04-14. **Walk time is on the roadmap of the leading OSS project in this
  category and has not shipped.**
- Their README roadmap names the locked-door hole and leaves it open: "**Society Bookings**: Use
  data about society bookings and other bookings besides scheduled classes" and "Detailed Room
  Information: information such as a room's type, **how to book it**, and all its aliases."
- Their partial answer is a "Make a Booking" button that deep-links to the official UNSW booking
  flow, plus [issue #641](https://github.com/devsoc-unsw/freerooms/issues/641) "task: mark
  booking as unavailable," which changes the button to read "Booking Unavailable" for rooms you
  cannot book. That is a real, cheap, honest pattern.
- Scraper breakage history: "fix broken scraper child process path" (#197), "fix certificate
  issue, bump scraper URL to 22T1" (#85), "refactor to reflect new timetable scraper response
  format" (#269). Three separate upstream breaks.

### JKU Room Search is architecturally identical to Vacant and its issue tracker is a warning

[blu3r4y/jku-room-search](https://github.com/blu3r4y/jku-room-search), AGPL-3.0, 10 stars,
created 2019-04-05, last push 2026-08-26. Live at [jkuroomsearch.app](https://jkuroomsearch.app).

`yarn scrape` produces a single `index.json` that gets dropped at `/data/index.json` on a static
GitHub Pages site. That is Vacant's exact architecture, running for seven years, by one person.
Which means it is a viable architecture. It also means its issue list is a preview of Vacant's
next seven years:

| Issue | Date | What broke |
| --- | --- | --- |
| [#3](https://github.com/blu3r4y/jku-room-search/issues/3) | 2020-09-20 | "Fix scraping error if there are no courses for a room" |
| [#7](https://github.com/blu3r4y/jku-room-search/issues/7) | 2020-09-20 | "Optimize the rooms.json storage to ignore 15min breaks" |
| [#9](https://github.com/blu3r4y/jku-room-search/issues/9) | 2020-09-20 | "Make this a progressive web app with offline capabilities" (closed, they did it) |
| [#25](https://github.com/blu3r4y/jku-room-search/issues/25) | 2021-07-12 | "The room capacity of S4 025 is not parsed" |
| [#26](https://github.com/blu3r4y/jku-room-search/issues/26) | 2021-12-14 | **"Buildings are not scraped anymore"** |
| [#27](https://github.com/blu3r4y/jku-room-search/issues/27) | 2023-01-17 | **"Room capacities are not extracted automatically anymore"** |
| [#28](https://github.com/blu3r4y/jku-room-search/issues/28) | 2023-10-03 | still open: "If no free rooms are found, the message wrongly says 'Sorry, we don't have data for this day'" |

Two of the seven are the upstream silently changing shape. One is an empty-state bug that has
been live for three years and is exactly the bug Vacant will ship if the "nothing fits, here are
near misses" fallback is treated as a nice-to-have.

**#7 is the interesting one.** Ignoring 15 minute breaks is the same instinct as illiniSpots'
30 minute micro-gap filter, arrived at independently by two projects.

### Antscoper (UCI) has the most honest README in the category and it is dying of hosting costs

[Krazete/antscoper](https://github.com/Krazete/antscoper), 12 stars, no license, created
2017-03-25, last push 2025-10-03. Live at antscoper.appspot.com.

The README says out loud what every other project hides:

> Please note that rooms are typically closed on weekends and holidays. On days when rooms are
> open, they are usually open from 7am to 10pm. Rooms are sometimes reserved (especially before
> exams), so be prepared to leave a vacant classroom if asked.
>
> Also note the website doesn't consider Finals Week schedules. Antscoper will be inaccurate
> during these times.

That is the honesty differentiator Vacant wants, already written by somebody else in 2017. It is
in the README, not in the app, which is the gap Vacant can still take.

Two structural notes:

- **It confirms the multi-term room union.** "Antscoper was initialized with all of WebSOC's
  data, meaning its database includes rooms from 1990 to now. The website only shows rooms which
  have had some schedule in this year or the past year. Rooms whose latest activity was two years
  ago or more are assumed to be presently nonexistent." That is a clean rule Vacant can adopt
  verbatim.
- **The maintenance failure mode here is money.** "The entire database can be accessed from
  `data.json`, though this is avoided due to quota limits." and "Due to quota limits, the legend
  will not activate until a query is entered in the search box." The README includes a screenshot
  of App Engine quota usage from a single Reddit launch day (178 users, 209 sessions, 38 second
  average). **A dynamic backend turned a good launch into a cost problem.** Vacant's static file
  on GitHub Pages is immune to this and that is worth saying in the README.

### Aula-Finder (Uniandes) has the only shipped restriction dataset

[Open-Source-Uniandes/Aula-Finder](https://github.com/Open-Source-Uniandes/Aula-Finder), MIT,
11 stars, Next.js static export to GitHub Pages, GitHub Actions refresh per semester, active
2026-08-24. Closest peer to Vacant on architecture after JKU.

Their room states are the best in the category:

> - 🟢 **Disponible** (available)
> - 🔴 **Ocupado** (a class is in progress)
> - ⏳ **En cambio de clase** (class changeover, gap under 10 minutes)
> - 🔒 **Restringido** (lab or restricted-access space)

That fourth state is backed by a checked-in, hand-maintained `data/room-restrictions.json`. It is
not automated, it is not complete, and it is the only shipped answer to "this room is empty and
you still cannot use it" in the entire open-source category.
[Issue #48](https://github.com/Open-Source-Uniandes/Aula-Finder/issues/48), "Ocultar por defecto
los salones con restricciones," closed 2026-03-04, hides restricted rooms by default.

They also handle partial-term sessions explicitly, as `ciclos.json` with 8A/8B cycle definitions.

### roomseekr.com killed an open-source project and still has not shipped location

Commercial, React plus Vite plus Supabase plus Vercel. The GitHub project
[kaitwillows/open-classroom-finder-MRU](https://github.com/kaitwillows/open-classroom-finder-MRU)
is archived with the description "made obsolete by roomseekr.com."

But roomseekr is still in beta and its own popup says so:

```bash
curl -sS https://www.roomseekr.com/assets/index-hWtnmN2v.js   # 404,673 bytes
```

> "Please note: Map view and 'Nearest' filter functionality is currently disabled as it's still
> under development."

Grep of that bundle: `geolocation` 0, `getCurrentPosition` 0, `walk` 0. **Even the funded
commercial entrant has not shipped location-based ranking.** It does have nice copy worth
borrowing: "Free for the rest of the day."

### Free Room Finder (UOIT/Durham), dead since 2015, wrote the best problem statement

[gnu-user/free-room-finder](https://github.com/gnu-user/free-room-finder), AGPL-3.0, PHP, last
commit 2015-11-23. From its README:

> **What the Free Room Finder Doesn't Do Well**
>
> Detect students who may have already found the free room before you and are using it.
> *(Don't panic we've got this one solved! We need help setting up a room booking system for
> students who use the service.)*
>
> Detect clubs and other organizations who may have booked the room through other school
> organizations such as the SA, Campus Societies, or the mob.

They named both halves of the problem in 2012, proposed a booking system as the fix, and the
project died before building it. Their contribution list also flags the same brittleness:
"Fixing up parsing errors in the screen scraping scripts as it currently does not work properly
for screen-scraping course info for every year."

### EmptyClassroom (BUPT), 44 stars, explicitly abandoned

[Jraaay/EmptyClassroom](https://github.com/Jraaay/EmptyClassroom), archived, created 2023-12-29,
last push 2026-03-16. The README now opens with a stop-maintenance banner:

> ⚠️ 本项目已停止维护 — 该项目不再进行功能更新与 Bug 修复，仅作为学习参考保留
> ("This project is no longer maintained. No feature updates or bug fixes. Kept as a learning
> reference only.")

It is the highest-starred dedicated empty-classroom project I found and it lasted about two
years. The predecessor, [Jraaay/empty-classroom-public](https://github.com/Jraaay/empty-classroom-public),
is also archived. It had been rewritten once, Go backend plus React and Ant Design front end, and
the rewrite did not save it.

### Others noted but not studied in depth

- [RoomFinder at Bryant University](https://universitybusiness.com/app-helps-students-find-empty-study-space/),
  2013, queries the **Crestron occupancy sensors** in the campus lighting system. This is the only
  approach in existence that measures whether a room is actually empty rather than inferring it.
  Requires the university's cooperation and building automation access, so it is out of reach for
  Vacant, but it is the correct answer and worth citing.
- [StudySpace, App Store](https://apps.apple.com/us/app/studyspace-empty-room-finder/id6751447860),
  released 2025-08-26, cross-references rooms against the student's own class schedule.
- [UofT Synchronous Space Finder](https://apps.apple.com/us/app/-/id1584199861), iOS.
- [cmu-ug/cmu-room-finder](https://github.com/cmu-ug/cmu-room-finder), scrapes **25Live**, the
  CollegeNET room reservation system. If a school exposes 25Live, that is the reservation data
  everyone else lacks.

---

## Part 3: the feature comparison

Legend: Y = shipped and verified, R = on the roadmap or in an open issue, N = absent and verified
absent, ? = I could not determine.

| Feature | Roomix (OSU) | illiniSpots (UIUC) | Freerooms (UNSW) | JKU | Antscoper (UCI) | Aula-Finder | roomseekr | UOIT (dead) | **Vacant as designed** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Data from official class schedule | Y | Y | Y | Y | Y | Y | Y | Y | **Y** |
| Backend required | Y (static JSON API + Firebase) | Y (Supabase + Hono) | Y (Express + Mongo) | **N** | Y (App Engine) | **N** | Y (Supabase) | Y (PHP+MySQL) | **N until phase 4** |
| Works offline / PWA | Y (caches to storage) | Y (PWA) | N | Y (PWA) | N | ? | N | N | **Y** |
| Cold-start payload | ~3.3 MB | dynamic | dynamic | small | dynamic | small | dynamic | dynamic | **~150-200 KB** |
| Uses your GPS | Y (nearest building) | N | N | N | N | N | R (disabled) | N | **Y (core)** |
| Ranks whole campus by proximity | **N (200 m cap)** | N | N | N | N | N | N | N | **Y** |
| Shows walk time | N | N | **R (#762 open)** | N | N | N | N | N | **Y** |
| Subtracts walk time from usable window | N | N | N | N | N | N | N | N | **Y, unique** |
| Duration / "free for how long" filter | N (start+end only) | Y ("Free Until") | Y (`duration`) | Y | N | Y | Y | Y | **Y** |
| Shows seat capacity | Y | ? | Y | Y | N | ? | ? | ? | **Y** |
| Handles partial-term sessions | Y | Y | ? | ? | ? | Y (ciclos 8A/8B) | ? | ? | **Y** |
| Micro-gap suppression | N | Y (<30 min) | ? | R (#7) | N | Y (<10 min "changeover") | ? | ? | **implicit via duration** |
| **Building open hours** | **N (verified)** | **Y** | N | N | prose only | N | N | N | **not in plan** |
| **Non-class events / bookings** | **N** | **Y (Tableau feed)** | R (roadmap) | N | prose only | N | N | N (named, never built) | **not in plan** |
| Holiday / final-exam awareness | **N (verified)** | Y | ? | ? | prose only, admits failure | ? | ? | ? | **not in plan** |
| Restricted-room flag | N | prose only | N | N | N | **Y (hand-curated JSON)** | N | N | **not in plan** |
| In-app locked-door disclaimer | **N (verified)** | prose in README | N | N | prose in README | icon state | N | prose in README | **Y, planned** |
| Crowdsourced "was it open" reports | N | N | N (ratings are cleanliness/location/quietness) | N | N | N | N | proposed, never built | **Y, phase 4, unique** |
| Map view | Y | Y (Mapbox 3D) | Y | N | Y (Leaflet) | N | R (disabled) | ? | N |
| Accounts / bookmarks | Y | N | Y (ratings) | N | N | N | Y | N | N |
| Native app store presence | Y (iOS + Android) | N | R (RN app) | N | N | N | N | Y (Android) | N |
| Currently maintained | Y | Y | Y | Y | slowing | Y | Y | **dead 2015** | n/a |

---

## Part 4: three table stakes Vacant is missing

These appear in most or all of the peers. Shipping without them will read as unfinished.

**1. A per-room weekly timetable view.**
Roomix has "Room Timelines" and a "Display Timeline Info" toggle. Freerooms has a booking
calendar and spent issues #291, #341, #419, #423 on it. Aula-Finder has a week calendar view.
illiniSpots shows the full daily schedule per room. JKU issue #5 wants one. **Every single peer
has this and Vacant's design has no room detail view at all.** Vacant's answer can be minimal,
one tap on a result shows today's blocks and when the room frees up again, but "what is coming
next in this room" is the first question anyone asks after "where do I go."

**2. Seat capacity plus a room-type filter, surfaced as a filter and not just a number.**
Vacant's design shows seats in the result line, which is good. But Freerooms filters on
`capacity` and `usage`, Aula-Finder distinguishes restricted labs, and Roomix stores `type` per
room. Vacant's own README flags this as an open question ("`facilityType` is a code whose meaning
is undocumented, it needs a pass so the app is not sending people into wet labs and studios").
With `1B` at 47% of rooms this is a small decode job with a large payoff, and it is a
correctness issue rather than a nicety, because sending somebody into a wet lab is the worst
possible false positive.

**3. A time control that is not "now."**
illiniSpots calls it time travel, Freerooms takes explicit start and end times, Aula-Finder has a
day and hour picker, Roomix has Start and End. **Vacant's one-tap-from-cold-start design is
right and should stay the default**, but "I have a 3pm gap tomorrow, where do I go" is the second
most common query in this category and every peer supports it. Ship it as a secondary control
that does not cost the primary tap. And per illiniSpots' commit #41 of 2026-08-26, do not let it
become a second control that duplicates the duration chip's math.

---

## Part 5: three things nobody has

**1. Walk time subtracted from the usable window.**
Nobody computes it. Freerooms wants it ([#762](https://github.com/devsoc-unsw/freerooms/issues/762),
open since April). Roomix renders raw metres and caps its search at a 200 metre radius. roomseekr
disabled its Nearest filter. **The "yours for 2h06 after you get there" number does not exist in
any product in this category.** This is the differentiator and the research supports it fully.

**2. Whole-campus ranking from a GPS fix, with no building chosen first.**
Every competitor makes you pick a building, a floor, or a list, and then filters. Roomix's GPS
button picks the nearest building for you and then still runs a building-scoped search inside a
200 metre radius. **The zero-input, ranked, campus-wide list is genuinely unbuilt.**

**3. A per-room "was the door open?" confidence score.**
Freerooms is the only project with crowdsourced input and it rates cleanliness, location and
quietness. Nobody rates access. UOIT proposed a booking system in 2012 and died. **The one-tap
"was it open?" report is the only real moat in this idea and no one has built it**, which is
consistent with it being the hardest part, since it needs a backend and a user base at the same
time.

A fourth, weaker one worth noting: **nobody surfaces rooms with zero classes all term.** Those are
the best rooms on campus and they are invisible to any single-term harvest.

---

## Part 6: the locked-door problem, and who actually solved it

Ranked by how much of the gap each approach closes.

| Approach | Who does it | How much it closes | Available to Vacant? |
| --- | --- | --- | --- |
| Occupancy sensors in the building automation system | Bryant University RoomFinder (2013) | Everything. It measures reality. | **No.** Needs university cooperation and Crestron access. |
| Building open hours dataset | illiniSpots | Large. Kills the "empty at 2am" and "empty on Saturday" false positives. | **YES, see below.** |
| Non-class event feed | illiniSpots (Tableau) | Large. Kills club meetings, review sessions, departmental events. | Unknown at OSU, worth hunting. |
| Live reservation system scrape | illiniSpots (LibCal), cmu-room-finder (25Live) | Large but narrow, usually libraries only. | Unknown at OSU. |
| Hand-curated restricted-room list | Aula-Finder (`room-restrictions.json`) | Medium. Catches labs and studios. | **YES, cheap, do it.** |
| Deep link to the official booking flow | Freerooms ("Make a Booking" / "Booking Unavailable") | Medium. Converts a lie into an action. | Likely, OSU has an event space request form. |
| Prose disclaimer in the README | Antscoper, UOIT, illiniSpots | Small but it is honest. | Yes. |
| In-app per-result disclaimer | **nobody** | Small but it is honest at the moment of decision. | **Yes, and it is unclaimed.** |
| Crowdsourced access reports | **nobody** | Unknown, potentially large | Yes, phase 4. |

### The Ohio State answer, which is better than I expected

Ohio State publishes a per-term
[Classroom Pool Building Schedule](https://registrar.osu.edu/staff-resources/class-catalog-and-space/classroom-pool-building-schedule/).
The Autumn 2026 page is live:

```bash
curl -sS -L -o osu-pool-au2026.html \
  "https://registrar.osu.edu/staff-resources/class-catalog-and-space/classroom-pool-building-schedule/autumn-2026-classroom-pool-building-schedule/"
# HTTP 200, 86,937 bytes
```

Parsed contents, measured:

```
buildings with published hours                47
buildings closed on Saturday                  41   (87%)
buildings closed on Sunday                    36   (77%)
buildings with a keycard or swipe note        10
buildings with any keycard / swipe / lock note 13
```

Header block, verbatim from the page:

```
Semester: August 25 - December 9
University Holidays (no classes, offices closed): September 7, November 11,
    November 26-27, December 24-25, December 28-31
Academic Holidays (no classes, offices open): October 15-16, November 25
Final Exams: December 11 - 17
Commencement: December 20
Football Home Game Schedule: September 5, 19, 26, October 10, November 14, 28
```

And per building, verbatim:

```
Dreese Lab (DL) | 2015 Neil Avenue
  Monday: 7am-7:30pm   Tuesday: 7am-9pm    Wednesday: 7am-7:30pm
  Thursday: 7am-9pm    Friday: 7am-7:30pm  Saturday: closed   Sunday: closed
  Comment: Keycard: William Thalgott 614-292-6218 thalgott.1
           Bridge door open M-F 7am-5pm

Cunz Hall (CZ) | 1841 Neil Avenue
  Comment: Rooms on the second floor and higher lock at 6 pm M-F. Only the first
  floor remains open later. The elevator and upper-floor stairwells are locked at 6 pm.

Theatre, Film & Media Arts (TFM)
  Comment: Only the south side, right hand pair of doors are electronically locked / unlocked.

Hopkins Hall (HC)
  Comment: ART students have swipe card access for courses outside of building hours
```

**All three of the README's own hero examples are in buildings that are closed all weekend.**
Dreese Lab is closed Saturday and Sunday and carries a keycard contact. Baker Systems Engineering
is closed Saturday and Sunday. Caldwell Laboratory is closed Saturday and opens Sunday only at
noon. A Saturday morning Vacant would confidently send a student to a locked door three times in
a row.

One more scale fact that makes this worse: the pool schedule covers **47** buildings, but Roomix's
room matrix spans **116** buildings. **Roughly 60% of the rooms Vacant would surface are not in
the classroom pool at all**, which means they are department-controlled, which means they are
more likely to be locked, not less, and no hours are published for them at all.

Parsing hazards found while extracting it: hours wrap across HTML line breaks
(`Monday: 7am-10` then `pm` on the next node), the comment key appears as both `COMMENT:` and
`Comment:`, some buildings carry separate `LIBRARY HOURS:` and `Lab Hours:` blocks for specific
rooms, and the building header format is `Name (CODE) | address` where `CODE` is the letter code
(`DL`), not the numeric `buildingCode` the class API uses. The join to the class API therefore
goes through `buildings.json`'s `buildingCode` letter field.

### Verdict on the differentiator

Vacant's honesty line, "No class is scheduled here. The door may still be locked," is **still
unclaimed as an in-app, per-result statement**, and it is correct to lead with it. But this
research says Vacant can do much better than a disclaimer for about one day of work: parse the 47
buildings from the registrar page, and turn the line into

> Dreese closes at 7:30pm. You have until then.

and on a Saturday, do not show Dreese at all.

---

## Part 7: what killed the dead ones

Four causes, in order of how likely each is to kill Vacant.

1. **The upstream changes shape and nobody notices.** JKU #26 "Buildings are not scraped anymore"
   (2021), JKU #27 "Room capacities are not extracted automatically anymore" (2023), Freerooms
   #269 "refactor to reflect new timetable scraper response format," #85 "bump scraper URL to
   22T1," UOIT "does not work properly for screen-scraping course info for every year."
   **Vacant's mitigation, the refusal guard on room count in the build step, is the single most
   important line in the whole build plan.** Make it a hard fail, not a warning, and add a guard
   on distinct buildings and total meeting-minutes too, because a partial harvest that returns
   900 rooms instead of 1,067 will pass a naive count check and ship a grid full of false
   "free."

2. **The manual dataset goes stale and the app starts lying.** illiniSpots #10, "Sorry, forgot to
   update building hours and class schedules for summer." Every hand-maintained side table
   (building hours, restricted rooms, coordinates for the 6 missing buildings) is a thing that
   will be wrong in a year. Date-stamp them in the JSON and show the stamp in the app's about
   screen.

3. **Hosting cost or quota.** Antscoper's App Engine quota screenshots, and its two features
   disabled to stay under quota. Vacant's static-file design makes this a non-issue through phase
   3, which is a genuine argument for keeping the "was it open?" backend as late as possible.

4. **The author graduates.** Jraaay/EmptyClassroom archived after about two years with 44 stars
   and a rewrite behind it. kaitwillows/open-classroom-finder-MRU archived after five weeks.
   gnu-user/free-room-finder last touched 2015. **The survivors are the ones with no server to
   pay for (JKU, seven years, one person) or an institution behind them (Freerooms, a university
   society).** Vacant is in the first category, which is the right one.

---

## Part 8: corrections to the README and the plan

Listed by how much they change the work.

1. **The Roomix framing is factually wrong.** Roomix has a nearest-facility GPS button, a
   "nearby" search mode and a "vacancy" search that takes a start and end time and respects
   session date ranges. Rewrite the competitive paragraph around the three things that are
   actually true and measurable: its vacancy search is capped at a 200 metre radius from one
   seed building, it never converts distance to walk time, and it downloads about 3.3 MB before
   it can answer anything.

2. **Do not use Overpass for building coordinates.** `api.roomix.app/buildings.json` is a
   captured Ohio State dataset with 386 buildings, 385 with lat/lon, and a `buildingNumber` field
   that is an exact match for the class API's `buildingCode`. Dreese is `279` in both. **Find the
   live OSU endpoint** (the `imageUrl` fields point at `www.osu.edu/map/buildingImg.php?id=NNN`,
   so a JSON sibling likely exists), and fall back to Overpass only for whatever it misses.
   Roomix needed exactly 6 hand-added buildings, not 130. This turns phase 2 from an afternoon of
   fuzzy matching into a script.

3. **Add building hours to the plan, before phase 4.** The Autumn 2026 Classroom Pool Building
   Schedule gives 47 buildings of hours, a holiday list, a final-exam window and 13 lock notes,
   in one 87 KB HTML page. On a Saturday it changes the answer for 41 of 47 buildings. It is the
   difference between an app that is honest in a footnote and an app that is correct.

4. **The room count is 1,067 in 116 buildings, not 1,200 to 1,800 in 100 to 150.** Use the
   measured number.

5. **Harvest more than one term.** 190 of Roomix's 1,067 rooms have zero classes in Autumn 2026,
   and a single-term pull cannot see them at all. Antscoper's rule, keep any room with activity in
   the last two years, is the tested version of this.

6. **`sessions` in the room index is not enough on its own.** Sample data shows `sessionCode`
   values of `1`, `7W1` and `7W2` in a single subject, so partial-term sessions are common and
   the date-range check is load-bearing. Roomix already gets this right, so it is not a
   differentiator, just a correctness requirement.

7. **`holidaySchedule` is a red herring.** In sampled data its only value is the constant string
   `"OSUSIS"`. It names a schedule, it does not carry dates. The dates come from the registrar
   page.

8. **Ship exactly one time control.** illiniSpots deleted a duplicate one yesterday because users
   could not tell "Start Time" from "Free Until" when both computed
   `availableFor >= target - now`. The duration chips are the right single control.

---

## Reproduction notes

Everything above came from these, run 2026-08-26 on Windows via Git Bash.

```bash
# Roomix client
curl -sS -L -m 60 -o roomix-index.html   https://roomix.app
curl -sS -L -m 60 -o roomix-bootstrap.js https://roomix.app/flutter_bootstrap.js
curl -sS -L -m 60 -o roomix-manifest.json https://roomix.app/manifest.json
curl -sS -L -m 90 -o roomix-main.dart.js https://roomix.app/main.dart.js

# Roomix backend (11 endpoints, discovered by reading A.a_e.prototype.ga5G in the bundle)
curl -sS https://api.roomix.app/api.json
curl -sS https://api.roomix.app/semesters.json
curl -sS -o rx_buildings.json https://api.roomix.app/buildings.json
curl -sS -o rx_kdtree.json    https://api.roomix.app/kd_tree.json
curl -sS -o v2_graph_sorted_rounded.json https://api.roomix.app/v2/graph_sorted_rounded.json
curl -sS -o indexed_1268_room_matrix.json https://api.roomix.app/indexed/1268/room_matrix.json

# OSU registrar
curl -sS -L -o osu-pool-au2026.html \
 "https://registrar.osu.edu/staff-resources/class-catalog-and-space/classroom-pool-building-schedule/autumn-2026-classroom-pool-building-schedule/"

# Competitors
curl -sS https://freerooms.devsoc.app/api/buildings
curl -sS https://freerooms.devsoc.app/api/rooms
curl -sS -o roomseekr.js https://www.roomseekr.com/assets/index-hWtnmN2v.js

# GitHub survey
gh api -X GET search/repositories -f q='<query> in:name,description' -f sort=stars \
  --jq '.items[] | [(.stargazers_count|tostring), .full_name, .pushed_at[:10], (.archived|tostring)] | @tsv'
```

Total HTTP requests to `content.osu.edu`: **zero.** I read a cached sample another agent had
already harvested rather than re-probing the university service.

Environment gotcha for whoever picks this up: on this box, a bash heredoc silently eats
backslashes before Python sees them, so `python -X utf8 - <<'EOF'` breaks any script containing a
regex escape. Write the script to a file first and run `python -X utf8 script.py`.

## Open questions

1. What is the live Ohio State endpoint behind `api.roomix.app/buildings.json`? Its
   `lastModified` is 2019 and its `imageUrl` points at `www.osu.edu/map/buildingImg.php`.
2. Does Ohio State publish a non-class event feed for classroom-pool rooms, the equivalent of
   UIUC's Tableau Daily Event Summary? The registrar page confirms the scheduling office places
   "classes, events and activities" into pool rooms, so the data exists somewhere.
3. Does OSU expose 25Live, Astra, or EMS publicly? The registrar's own page names no product.
   Ohio University (a different school) uses Astra, which is a trap for a careless search.
4. Are the Classroom Pool Building Schedule pages stable enough to scrape per term, or is the
   URL slug hand-made each semester? Two terms exist right now (Summer 2026 and Autumn 2026) and
   the slugs are regular, but that is a sample of two.
5. What do the `facilityType` codes mean? `1B` is 47% of rooms. A registrar space-standards
   document is the likely source and another agent on this fleet appears to have already pulled
   one.
