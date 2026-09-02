# The original blueprint

This is the design note that used to be the README, moved here whole when the
README was rewritten for people who just want to open the app
([#56](https://github.com/EnesYilmazcode/Vacant/issues/56)). It is kept because
it is the argument the project was built from, and because the research in
[`research/`](research/) is answering questions this document asked.

It is a **pre-build document**. Where it disagrees with the code, the code is
right. Three places where it is known to disagree, checked against the shipped
tree on 2026-08-27:

- **1,067 rooms across 116 buildings.** That was read out of Roomix's published
  index for the same term, which was the best evidence available at the time.
  Vacant's own filter yields **871 rooms across 96 buildings**. See
  [#61](https://github.com/EnesYilmazcode/Vacant/issues/61).
- **"minus the 7 campus closure days, minus the exam window."** The app does not
  do this. There is no holiday or exam handling anywhere in `js/`. It is
  [#11](https://github.com/EnesYilmazcode/Vacant/issues/11) and
  [#19](https://github.com/EnesYilmazcode/Vacant/issues/19).
- **The packed binary index.** The 29 to 38 ms figure is from a research
  benchmark, not from the shipped app, which parses JSON. The decision is parked
  in [#29](https://github.com/EnesYilmazcode/Vacant/issues/29).

Two other things dated badly and were corrected elsewhere before this move. The
Roomix framing here is the corrected one; the earlier draft said Roomix was
"organized building by building" and "does not respect the clock", and both
halves are wrong. The correction and the teardown behind it are in
[`research/prior-art.md`](research/prior-art.md). The licence line said TBD and
recommended ODbL for OpenStreetMap-derived building data; no OSM data ships,
because the buildings come from Ohio State's own GIS layer.

---

## The problem

You have ninety minutes between classes and nowhere to sit. The library is full,
the union is loud, and there are hundreds of classrooms within a ten minute walk
that are sitting empty right now. You cannot find any of them without
walking into buildings and trying doors.

[Roomix](https://roomix.app), an unofficial room matrix for Ohio State, already
does a lot of this, and it deserves an honest description. It is a maintained
three year old product: a Flutter app with iOS and Android builds, a backend,
accounts, bookmarks, a GPS "nearest facility" button and a vacancy search. Its
data was regenerated the day before this was written. Anyone calling it a toy has
not looked at it.

What it does is bolt location and time onto a building browser, and the seams show
in two places that are measurable rather than matters of taste.

**It costs 3.3 MB to open.** Its API serves eleven static JSON files and
`courses.json` alone is 2.4 MB. Vacant's entire index is one file in the low
hundreds of kilobytes. Outdoors on a phone, that is the difference between an
answer and a spinner.

**It answers Saturday wrong.** Roomix computes "no class is scheduled, therefore
free." On a Saturday that reports over a thousand rooms free while 41 of the 47
classroom pool buildings are locked. Every project in this category makes that
mistake, and at Ohio State it is avoidable, because the Registrar publishes the
open hours and nobody reads them.

Neither app can tell you the thing that actually decides where you go, which is
how long a room is yours **after** you finish walking to it.

## What Vacant does

You open it. It already knows where you are. You tap how long you need. It hands
you a ranked list:

```
  Dreese 357            4 min walk     yours for 2h06     46 seats
  Baker Systems 120     6 min walk     yours for 3h14     80 seats
  Caldwell 177          7 min walk     yours for 1h48     30 seats
```

No search box, no building picker, no term selector. One tap from cold start to
an answer.

The "yours for" number is the differentiator. It is not when the room frees up,
it is how long you get **once you arrive**, with walking time already subtracted.
That turns "how long do you need" from a filter into a real constraint, and it
makes the fallback behavior obvious: if nothing fits two hours, Vacant offers the
closest room that fits ninety minutes, and the room that frees up in twelve
minutes if it is closer or bigger.

## Save it to your home screen

Vacant is built to be installed, not visited. On iPhone, open it in Safari, tap
the Share button and choose **Add to Home Screen**. On Android, Chrome offers
**Install app** from its menu.

That is not a nice-to-have, it drives the whole architecture:

- The app has to open **instantly**, because you are standing outside in the cold
  with one hand free.
- It has to work with **no signal**, because you will open it in a stairwell or a
  basement. The entire room schedule is a single small static file, so a service
  worker caches it and the app answers from local storage with the network off.
- It has to look like an app, not a web page. Standalone display mode, no browser
  chrome, a real icon, a splash screen.

The only thing that needs the network is refreshing the schedule file, and that
matters about once a week.

---

## How it works

The whole thing is a static site. There is no server, no database, and no login.

```
 SOURCES                       BUILD, weekly on a Sunday cron
 =======                       =============================

 content.osu.edu/v2
 the class schedule
 26,298 sections
        |
        |   1. walk 8 catalog-number buckets
        |      136 requests, about 52 seconds, twice to catch page drift
        v
   +------------------------------------------------------------------+
   | 2. funnel, and count every row you drop                          |
   |      drop the ONLINE and OFFCAMPUS pseudo-rooms      (465 rows)  |
   |      drop cancelled, no room, no time, no weekday                |
   |      strip instructors[] HERE, their emails are in the payload   |
   +------------------------------------------------------------------+
        |
        v
   +------------------------------------------------------------------+
   | 3. invert                                                        |
   |      section -> meetings        becomes        room -> busy[]    |
   |      merge overlapping intervals    (607 pairs, cross-listed)    |
   |      key every interval to its own session date range            |
   +------------------------------------------------------------------+
        |
 gissvc.osu.edu ---------> 4. join on buildingCode, exact string match
 OSU's own building           80 of 80 first try. lat, lon, address
 layer, 80 buildings          |
                              |
 registrar.osu.edu -------> 5. scrape open and close, per weekday
 classroom pool table         47 buildings, plus holidays and exam week
 47 bldgs x 7 days            |
                              v
   +------------------------------------------------------------------+
   | 6. GUARDS. fail the build rather than ship a confident wrong     |
   |    answer. A healthy harvest already reads 81% free, so lost     |
   |    data does not look like breakage, it looks like good news.    |
   |                                                                  |
   |      busy BLOCKS and busy MINUTES above floor  <- not room count |
   |      weekday balance within range                                |
   |      zero instructor emails in the output       <- fatal         |
   +------------------------------------------------------------------+
        |
        v

 ARTIFACTS, committed to the repo
 ================================
   data/rooms-1268.json        room -> busy[]        about 30 KB gzipped
   data/buildings.json         code -> name, lat, lon           (ODbL)
   data/buildings-hours.json   code -> open/close per weekday
   data/current.json           which term is live, and when it was built
        |
        v

 THE PHONE
 =========
   installed PWA on GitHub Pages, service worker, two caches
        |
        |   cold launch: shell from cache, data stale-while-revalidate
        |   must answer with the network off, in a stairwell
        v
   GPS fix          +     duration ask       +     the clock
   (watchdog,             30m / 1h / 2h            today's date, so
    off-campus gate)                               closures apply
        |
        v
   +------------------------------------------------------------------+
   |   free    = complement of busy                                   |
   |             minus the 7 campus closure days                      |
   |             minus the exam window                                |
   |   open    = intersect the building's published hours             |
   |   usable  = gap end - arrival time - buffer                      |
   |   rank    = distance first, then how long it stays yours         |
   +------------------------------------------------------------------+
        |
        v
   STRONG   "Dreese 357, 4 min walk, yours till 1:55p"
            a real bounded number, because a class starts then

   MEDIUM   "no class here for the rest of today"
            open ended, which is 47% of free rooms at peak

   WEAK     "nothing is scheduled anywhere on campus right now"
            89% of the year. The list is a distance sort and the
            screen has to say so instead of faking confidence.
```

### 1. The insight

Ohio State publishes, for every class, the exact room it meets in and the exact
minutes it occupies that room. Nobody publishes which rooms are empty. But
**empty is just the complement of busy**, and busy is fully derivable from the
class schedule. So the entire product is one inversion of a public dataset.

### 2. The data already exists

A real meeting object, pulled live from
`GET https://content.osu.edu/v2/classes/search`:

```json
{
  "facilityId": "DL0357",
  "facilityType": "1B",
  "facilityDescription": "Dreese Laboratories",
  "facilityDescriptionShort": "Dreese Lab",
  "facilityCapacity": 46,
  "buildingCode": "279",
  "room": "357",
  "buildingDescriptionShort": "DL 357",
  "startTime": "8:00 am",
  "endTime": "8:55 am",
  "startDate": "2026-08-25",
  "endDate": "2026-12-09",
  "monday": false, "tuesday": true, "wednesday": false,
  "thursday": true, "friday": false, "saturday": false, "sunday": false
}
```

Room-level ID, seat count, the exact window, the day flags, and the date range so
a class that only meets in the second half of the term does not falsely block a
room all semester. Everything an occupancy grid needs is already there.

### 3. Scale, measured

Six subjects (cse, math, english, psych, history, physics) for Autumn 2026:

```
sections 2699    meetings 2719
distinct rooms 272    distinct buildings 45
```

The true campus figure, read directly out of Roomix's own published index for the
same term, is **1,067 rooms across 116 buildings**. The index for all of it lands
in the low hundreds of kilobytes raw and well under 100 KB gzipped, so the whole
campus fits in one file the phone holds offline without noticing.

One number in there is a free feature. **190 of those 1,067 rooms, 17.8%, have no
class at all this term.** A room with zero classes all semester is the best study
room on campus, and a single term harvest cannot see it, because a room with no
meetings never appears in that term's class API. Harvesting three terms and
unioning the room identities finds them.

One pass of the harvest costs **136 requests**, by paging the
`catalog-number` facet in 8 buckets rather than walking 243 subjects the way
Finder does. See `research/harvest-feasibility.md`.

### 4. The room index

The build step inverts sections into a room-keyed busy list:

```json
{
  "term": "1268",
  "generated": "2026-08-26",
  "sessions": [["2026-08-25", "2026-12-09"]],
  "buildings": {
    "279": { "name": "Dreese Laboratories", "short": "DL",
             "lat": 40.0023, "lon": -83.0155 }
  },
  "rooms": {
    "DL0357": { "b": "279", "n": "357", "cap": 46, "type": "1B",
                "busy": [[2, 480, 535, 0], [4, 480, 535, 0]] }
  }
}
```

Each `busy` entry is `[weekday, startMinute, endMinute, sessionIndex]`. Minutes
since midnight, so the math is integer comparisons and nothing has to parse
"8:00 am" at query time. The `sessions` table is deduped by date range so
part-of-term classes do not repeat ISO dates on every row.

Free time is whatever the busy list does not cover.

### 5. The query

Given your location, the current time, and a duration `D`:

1. For each room, find the gap containing `now` in the complement of today's busy
   set, respecting the session date range.
2. `usable = gapEnd - now - walkTime(room)`, where walk time is straight-line
   distance at about 80 metres per minute.
3. Keep rooms where `usable >= D`.
4. Sort by distance. Break ties by how long the room stays free, then by seats.
5. If nothing survives, relax `D` and surface the best near-misses instead of an
   empty screen.

Haversine distance to the building centroid is plenty at campus scale. No routing
engine, no map tiles required.

Step 2 is wrong and the code does not do it. See `js/engine.js`, which counts the
wait in the corridor as time you do not get, and reserves ten minutes at the end.

### 5b. Cold launch is the real performance problem

The query is a non-problem. Benchmarked over a synthetic 1,800 room index with no
spatial index at all, a full ranked answer takes **0.4 to 1.3 ms** warm.

Cold launch is where the time goes. `JSON.parse` plus building the in-memory index
costs **365 to 469 ms** before the first answer appears, which is exactly the
moment the app is being judged. Shipping the busy intervals as a packed binary
blob that the app reads straight off an `ArrayBuffer`, with only the names and
coordinates left as JSON, takes that to **29 to 38 ms** with byte identical
results. See `research/query-engine.md`.

### 6. Where the coordinates come from

The class API gives `buildingCode: "279"` but no latitude or longitude, and Ohio
State's campus map is a single-page app with no JSON behind it.

The original plan was to fuzzy match building names against OpenStreetMap, which
works but leaves about one in eight for a human to fix. There is something much
better. **Ohio State publishes its own building layer on its own public ArcGIS
server, and its `buildingNumber` field is character for character the same value
as the class API's `buildingCode`.**

```
   THE PLAN                                 WHAT ACTUALLY WORKS

   facilityDescription                      buildingCode = "279"
     = "Dreese Laboratories"                       |
          |  normalise, fuzzy match               |  exact string equality
          v                                       v
   OpenStreetMap via Overpass               OSU's own GIS building layer
     70 of 80 matched  (87.5%)                80 of 80 matched  (100%)
     10 need a human                          lat, lon, campus, address
     Ohio Stadium silently missing            all already on the record
```

It is a key join, not a name match, and every building observed in live Autumn
2026 schedule data joined on the first try. OSM stays useful as a second opinion
for cross-checking coordinates, not as the source. Details and the draft dataset
are in `research/geocoding.md` and `../data/buildings.draft.json`.

---

## What Vacant will not pretend to know

**A class schedule is not a room reservation calendar.** A room with no class in
it can still be booked for a club meeting, a review session, or a departmental
event, and it can simply be locked. Every tool in this category has this hole and
most of them hide it.

Three quarters of it turns out to be closeable, which was the biggest surprise in
the research.

**Building hours are published.** The Registrar puts out a per building, per
weekday open and close table covering all 47 classroom pool buildings, refreshed
every semester, as scrapable HTML, with the term's holidays and exam dates on the
same page. The blueprint assumed this dataset did not exist. It does, and reading
it is what separates "no class is scheduled" from "open until 7:30pm today."

**The calendar is knowable.** Twelve of the 83 weekdays between the first day of
class and the last final are wrong for calendar reasons alone, before any room
level problem: seven no class weekdays that the naive model calls busy and hides,
and five exam days it calls free and walks you into a final.

**Non class bookings are not knowable.** A club meeting in an empty room is
invisible to every public source. This is the part that stays honest rather than
solved, so every result carries the caveat and phase 4 adds a one tap "was it
open?" report that builds per room confidence from people who actually walked
there.

One thing that is now answered rather than open: `facilityType` is a property of
the room and never varies within a term, across 633 rooms and 8,284 meetings, so
the index stores one type per room and trusts it. Twenty seven codes exist and
`research/facility-types.md` has the decode.

---

## Build order

| Phase | What | Notes |
| --- | --- | --- |
| 1 | Harvester emitting the room index | Port the bucket walk from [Finder](https://github.com/EnesYilmazcode/Finder), swap the projection, union three terms so zero-class rooms are not lost, strip instructor emails, and guard on busy blocks rather than room count |
| 2 | `buildings.json` | Key join on `buildingCode` against OSU's own GIS layer. OSM as a cross-check |
| 2 | Building hours and the academic calendar | Scrape the Registrar's classroom pool table and the term's holiday and exam dates. This is what makes Saturday correct |
| 3 | The app | Geolocation, duration buttons, ranked list, PWA manifest, service worker |
| 4 | "Was it open?" reports | Only if it gets real use. Needs a small backend |

---

## Relationship to Finder

[Finder](https://github.com/EnesYilmazcode/Finder) is the sibling project: Ohio
State course search that leads with the instructor. It reads the same API, and
Vacant borrows its API client, its paging and determinism handling, and its
documentation of the API's quirks.

They are deliberately separate apps rather than two tabs of one, because they
disagree on every axis that shapes an app:

|  | Finder | Vacant |
| --- | --- | --- |
| Opens with | a search box | your GPS, zero input |
| Rebuild cadence | nightly, seat counts move hourly | weekly, the room schedule is static |
| Shell | three panes, desktop first | one list, phone first, installable |
| Offline | needs the network | must work with no signal |
| Used | hard for two weeks at registration | between classes, all term |

A mode picker joining them would cost the one tap that is the entire point of
this one.
