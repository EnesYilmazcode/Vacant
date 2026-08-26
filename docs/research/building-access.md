# Building access: is "the door is unlocked" knowable?

Research note, 2026-08-26. Read-only investigation. Nothing here was filed, pushed, or committed
anywhere else.

**The problem in one sentence:** a room with no class in it is still a wrong answer if the building
is locked, and the blueprint assumed no public dataset of building hours exists.

**The fix in one sentence:** it does exist. The Office of the University Registrar publishes a
per-building, per-weekday open/close table for all 47 classroom pool buildings every semester, as
scrapable HTML, with the term's holidays and exam dates on the same page.

```
  BEFORE (blueprint)                      AFTER (measured)
  ------------------                      ----------------
  class API -> busy                       class API -> busy
       |                                       |
       v                                       v
  free = complement                       free = complement
       |                                       |
       |  ??? hours unknown                    |  INTERSECT registrar hours (47 bldgs, per weekday)
       |  guess and warn                       |  MINUS  academic-calendar closure days
       v                                       v
  "probably open"                         "open until 7:30pm today"  + honest warning
```

---

## 1. What I found, and what I could not

| Source | URL | Status | What it gives |
| --- | --- | --- | --- |
| **Registrar Classroom Pool Building Schedule** | `https://registrar.osu.edu/staff-resources/class-catalog-and-space/classroom-pool-building-schedule/` | **LIVE, the answer** | 47 buildings x 7 days open/close, per semester, plus holidays, exam dates, football home games |
| Autumn 2026 page | `.../autumn-2026-classroom-pool-building-schedule/` | LIVE, HTTP 200, 86,937 B | The Autumn 2026 (term 1268) table |
| Summer 2026 page | `.../summer-2026-classroom-pool-building-schedule/` | LIVE | Proves the per-term cadence and that hours really do change term to term |
| **Academic calendar ICS (third party)** | `https://mcmanning.github.io/ohio-state-ics/academic.ics` | LIVE, 82,565 B, 489 events, 2021-2030 | Machine-readable term dates, breaks, exams, and the exact phrase "offices closed" vs "offices open" |
| **Staff/closure ICS** | `https://mcmanning.github.io/ohio-state-ics/staff.ics` | LIVE, 110 events | Just the 11 days a year campus offices are closed |
| Registrar academic calendar | `https://registrar.osu.edu/academic-calendar/` | LIVE, HTML only | Same dates, no official ICS found |
| **OSU GIS building footprints** | `https://services6.arcgis.com/PVrqnRx8k1Ldjgw0/arcgis/rest/services/MainCampusFacades/FeatureServer/0` | **LIVE, no auth** | 436 buildings, polygons, `BLDG_NUM` = the class API's `buildingCode`. See section 7, this replaces the OSM plan |
| **OSU Libraries hours (LibCal)** | `https://api3.libcal.com/api_hours_grid.php?iid=5296&format=json&weeks=1` | **LIVE JSON, no auth** | 29 library locations, weekly hours, lat/lon. Includes a 24-hour location |
| University Space Standards | `https://freedomofexpression.osu.edu/documents/university-space-standards-2024.pdf` | LIVE PDF | The governing policy language (section 4) |
| Ohio Union hours | `https://ohiounion.osu.edu/` | LIVE, HTML | Mon-Fri 8am-11pm, Sat-Sun 10am-11pm. Break hours close at 8pm |
| Learning Spaces Directory | `https://learningspaces.osu.edu/classrooms` | LIVE but client-rendered | Lists the ~300 classroom pool rooms with photos and features. No hours, no JSON. Server HTML has no room links, so it needs a browser to scrape |
| OSU GIS Hub | `https://data-osugis.opendata.arcgis.com/` | LIVE, org `PVrqnRx8k1Ldjgw0` | Entry point to the above. The old dataset id `32665fdcad...._28` 404s now |
| Library hours "API v3" | `https://library.osu.edu/hours/api/v3/map/library` | **DEAD**, HTTP 404 (Drupal soft-404, returns 101 KB of HTML) | Nothing. A stale URL that still ranks in search |
| LibCal instance `iid=4810` | `https://api3.libcal.com/api_hours_grid.php?iid=4810` | LIVE but near-empty | Only Newark Campus Library, status `not-set`. **Use 5296, not 4810** |
| ArcGIS Hub dataset API | `https://hub.arcgis.com/api/v3/datasets/32665fdcad884c18b899327a633a9bb7_28` | DEAD, 404 | |
| `opendata.arcgis.com/datasets/<id>.geojson` | same id | DEAD, 400 "Item does not exist or is inaccessible" | |
| SIMS / Space API | referenced from `https://fits.osu.edu/data-services/data-integration` | **Not public** | Would be the authoritative building/floor/room dataset. Internal, needs institutional access |
| `jake.red/blog/ohio-state-apis/` | | **DEAD**, DNS `ENOTFOUND` | A commonly cited catalog of OSU APIs that no longer resolves |
| Roomix (the competitor) | `https://roomix.app` | **Could not verify**, HTTP 403 to non-browser clients | I could not confirm whether Roomix models building hours. Worth one manual look in a browser |
| Any OSU open data portal with hours | searched `it.osu.edu/data`, DataOhio, GIS Hub | **Does not exist** | No dataset anywhere publishes door state |

**What genuinely does not exist:** a live "is this door unlocked right now" feed, and any published
room-level reservation calendar. The registrar table is a *published intent*, not a sensor. That gap
is real and is exactly what phase 4 crowdsourcing is for.

---

## 2. The registrar table: format and how to parse it

The page is a Bootstrap accordion, not a `<table>`. `grep -c "<table"` returns **0**. Do not write a
table parser.

Each building is one `div.panel.panel-default` containing:

```html
<h3 class="panel-title">
  <a ...>Dreese Lab (DL) | 2015 Neil Avenue </a>
</h3>
<div class="panel-body">
  <p>DAY HOURS: </p>
  <ul>
    <li><strong>Monday: 7am-7:30pm</strong></li>
    ... seven of these ...
  </ul>
  <p>Comment:</p>
  <p>Keycard: ...</p>
  <p>Bridge door open M-F 7am-5pm</p>
</div>
```

So the recipe is: split on `<div class="panel panel-default">`, take the `panel-title > a` text for
`Name (CODE) | Street address`, strip tags from `panel-body`, and regex
`(Monday|...|Sunday)\s*:\s*(.*)` out of it.

**Measured: 47 panels, 47 parsed, 47 with all seven days, 47 with a bracketed code. No failures.**
The title also carries a street address, which is a free geocoding fallback.

### Parsing gotchas found in the live Autumn 2026 data

These are real, in the current page, and a naive parser will produce wrong answers:

1. **Three malformed cells, all Caldwell Lab (CL).** `Tuesday: 8am-`, `Wednesday: 8am-`,
   `Thursday: 8am-` have no closing time at all, and `Monday: 8am-10` has no am/pm marker. A parser
   that reads `10` as 10:00 will close Caldwell at 10am on a day it has a class running until 7:25pm.
   The Summer 2026 page shows Caldwell as `7am-5pm`, so `8am-10` is almost certainly `8am-10pm`.
   **Fail loudly on an unparseable cell. Do not guess.**
2. **Case and separator drift.** Orton Hall uses `Closed` (capital C) where everyone else uses
   `closed`, and `2pm to 6pm` where everyone else uses a hyphen.
3. **Minute-format drift.** Animal Science says `7am-5:00pm`; everything else says `5pm`.
4. **Midnight.** Journalism is `8am-12am`. Treat a `12am` close as 1440 minutes, not 0.
5. **The comment block carries staff names, personal phone numbers, and OSU name.n IDs.** This is an
   internal operations document that happens to be public. **Scrape the hours, drop the comments, and
   never ship the contact details in `buildings.json` or anywhere a user can see them.**

### Hours conflict with the class schedule in a way that matters

Hopkins Hall (HC) is published as closing 6:30pm Monday through Thursday, but has classes ending at
8:45pm. Its comment explains it: *"ART students have swipe card access for courses outside of
building hours."*

That is the single most important sentence on the page. **A class existing at 8pm does not prove the
building is publicly open at 8pm.** It may prove only that the enrolled students have badges. This
kills the naive form of "derive hours from the schedule" (option C in the brief).

Cunz Hall (CZ) proves the same point at finer grain: *"Rooms on the second floor and higher lock at
6 pm M-F. Only the first floor remains open later. The elevator and upper-floor stairwells are locked
at 6 pm."* Access is not always uniform within a building.

### The full Autumn 2026 table, as parsed

Mon | Tue | Wed | Thu | Fri | Sat | Sun.

```
AA   Ag. Admin.                8am-6pm      8am-6pm      8am-6pm      8am-6pm      8am-5pm      closed        closed
AE   Ag. Engineering           7am-7:30pm   7am-8:30pm   7am-5:30pm   7am-8:30pm   7am-5pm      closed        closed
AS   Animal Science            7am-5:00pm   7am-7pm      7am-6:30pm   7am-7pm      7am-5:30pm   closed        closed
AP   Arps Hall                 9am-5pm      9am-5pm      9am-5pm      9am-5pm      9am-5pm      8:30am-4pm    closed
BE   Baker Systems Eng         7am-8:30pm   7am-7:30pm   7am-8:30pm   7am-7:30pm   7am-5:30pm   closed        closed
BI   Biological Sciences       10am-4pm     10am-4pm     10am-4pm     10am-4pm     10am-4pm     closed        closed
BO   Bolz Hall                 7am-7:30pm   7am-8pm      7am-7:30pm   7am-8pm      7am-5:30pm   closed        closed
BK   Bricker Hall              7am-6pm      7am-6pm      7am-6pm      7am-6pm      7am-6pm      closed        closed
CL   Caldwell Lab              8am-10 (!)   8am- (!)     8am- (!)     8am- (!)     8am-6pm      closed        12pm-10pm
CM   Campbell Hall             7am-7:30pm   7am-7pm      7am-8:30pm   7am-8:30pm   7am-5:30pm   closed        closed
CB   CBEC                      7am-7:30pm   7am-5:30pm   7am-5:30pm   7am-5pm      7am-7:30pm   closed        closed
CH   Cockins Hall              7am-5:30pm   7am-6:30pm   7am-6pm      7am-6:30pm   7am-5pm      closed        12:30pm-4:30pm
CZ   Cunz Hall                 6:30am-8pm   6:30am-6pm   6:30am-7pm   6:30am-7:30pm 6:30am-7pm  closed        closed
DE   Denney Hall               7am-7pm      7am-8pm      7am-7pm      7am-8pm      7am-5:30pm   closed        closed
DB   Derby Hall                8am-6pm      8am-6pm      8am-6pm      8am-6pm      8am-6pm      closed        closed
DL   Dreese Lab                7am-7:30pm   7am-9pm      7am-7:30pm   7am-9pm      7am-7:30pm   closed        closed
DU   Dulles Hall               7am-5:30pm   7am-5:30pm   6:30am-5:30pm 7am-5:30pm  7am-5:30pm   closed        closed
EA   209 W Eighteenth Ave      7am-5:30pm   7am-6:30pm   7am-6:30pm   7am-6:30pm   7am-5:30pm   closed        closed
EC   Enarson Classroom         7am-11pm     7am-11pm     7am-11pm     7am-11pm     7am-11pm     7am-11pm      7am-11pm
EL   Evans Lab                 7am-11pm     7am-11pm     7am-11pm     7am-11pm     7am-11pm     closed        closed
FL   Fontana Lab               7am-7pm      7am-6:30pm   7am-7pm      7am-5:30pm   7am-6pm      closed        closed
HH   Hagerty Hall              7am-8pm      7am-8pm      7am-7pm      7am-7pm      7am-6pm      closed        6pm-8:30pm
HA   Hayes Hall                6am-6pm      6am-7pm      6am-7pm      6am-7pm      6am-7pm      closed        closed
HI   Hitchcock Hall            7am-11pm     7am-11pm     7am-11pm     7am-11pm     7am-11pm     7am-11pm      7am-11pm
HC   Hopkins Hall              7am-6:30pm   7am-6:30pm   7am-6:30pm   7am-6:30pm   7am-5:30pm   closed        closed
IH   Independence Hall         7am-11pm     7am-11pm     6:30am-11pm  7am-11pm     7am-11pm     7am-11pm      7am-11pm
JE   Jennings Hall             7am-9pm      7am-10:30pm  7am-9:30pm   7am-9pm      7am-9:30pm   closed        closed
JR   Journalism Building       8am-12am     8am-12am     8am-12am     8am-12am     8am-7pm      closed        closed
KN   Knowlton Architecture     9am-7:30pm   9am-7:30pm   9am-7:30pm   9am-7:30pm   9am-6pm      closed        closed
KH   Kottman Hall              7am-8:30pm   7am-7pm      7am-10pm     7am-7pm      7am-5:30pm   closed        closed
LZ   Lazenby Hall              7am-11pm     7am-11pm     7am-11pm     7am-11pm     7am-11pm     closed        closed
MP   McPherson Lab             7am-7:30pm   7am-7:30pm   7am-9pm      7am-6:30pm   7am-7pm      closed        closed
ML   Mendenhall Lab            7am-7pm      7am-7pm      7am-8pm      7am-7pm      7am-5pm      closed        closed
OR   Orton Hall                8am-5pm      8am-5pm      8am-5pm      8am-5pm      8am-5pm      Closed        2pm to 6pm
PA   Page Hall                 7am-6:30pm   7am-8pm      7am-5:30pm   7am-8pm      7am-5:30pm   closed        closed
PE   PAES Building             5am-10:30pm  5am-10:30pm  5am-10:30pm  5am-10:30pm  5am-8:30pm   closed        10am-10:30pm
PO   Pomerene Hall             7am-9:30pm   7am-9:30pm   7am-9:30pm   7am-9:30pm   7am-9:30pm   closed        4pm-9:30pm
PS   Psychology Building       7am-6pm      7am-8pm      7am-8:30pm   7am-6pm      7am-6pm      closed        closed
RA   Ramseyer Hall             7am-7pm      7am-7pm      7am-10pm     7am-7pm      7am-5pm      closed        closed
SB   Schoenbaum Hall           7am-9pm      7am-8:30pm   7am-9pm      7am-8:30pm   7am-9pm      closed        closed
SO   Scott Lab                 7am-9pm      7am-8:30pm   7am-8:30pm   7am-8:30pm   7am-8:30pm   closed        closed
SM   Smith Lab                 7am-10pm     7am-7:30pm   7am-10pm     7am-7:30pm   7am-7:30pm   closed        closed
SH   Stillman Hall             7am-8:30pm   7am-8:30pm   7am-8:30pm   7am-8:30pm   7am-5:30pm   closed        2pm-8pm
SU   Sullivant Hall            9am-5pm      9am-5pm      9am-5pm      9am-5pm      9am-5pm      12:30pm-5pm   12:30pm-5pm
TFM  Theatre, Film & Media     7am-8pm      7am-8pm      7am-8pm      7am-8pm      7am-6:30pm   closed        closed
TO   Townshend Hall            7am-8pm      7am-7pm      7am-7pm      7am-6pm      7am-5pm      closed        closed
UH   University Hall           7am-8pm      7am-7pm      7am-7pm      7am-7pm      7am-5pm      closed        closed
```

`(!)` marks the four malformed Caldwell cells.

---

## 3. The academic calendar is machine-readable, and it cross-validates

The Autumn 2026 registrar page header carries the term's calendar:

```
Semester:                                          August 25 - December 9
University Holidays (no classes, offices CLOSED):  Sep 7, Nov 11, Nov 26-27, Dec 24-25, Dec 28-31
Academic Holidays  (no classes, offices OPEN):     Oct 15-16, Nov 25
Final Exams:                                       December 11 - 17
Commencement:                                      December 20
Football Home Games:                               Sep 5, Sep 19, Sep 26, Oct 10, Nov 14, Nov 28
```

`academic.ics` independently agrees on every one of those dates. Both say the term runs
2026-08-25 to 2026-12-09, which also matches `startDate`/`endDate` on the live meeting objects from
the class API. Three independent sources, no disagreement.

**The ICS is the better feed for code**, because the distinction the app needs is already in the
`SUMMARY` string as literal text:

```
20260907  Labor Day - no classes, offices closed          <- room is free AND the door is locked
20261015  Autumn Break - no classes, offices open         <- room is free AND you can get in
20261111  Veterans Day observed - no classes, offices closed
20261125  Thanksgiving Break begins - no classes, offices open
20261126  Thanksgiving Day - no classes, offices closed
20261127  Indigenous Peoples' Day/Columbus Day observed - no classes, offices closed
20261211..20261218  Final examinations for semester and second-session classes
```

A regex for `offices closed` versus `offices open` on `SUMMARY` gives you door state directly.
`staff.ics` is even smaller: 11 events per year, and they are exactly the closed days.

**This is the highest-severity correctness bug available to this app.** On 2026-10-15 there are no
classes, so a naive Vacant shows every room on campus as free all day, and it happens to be right.
On 2026-09-07 it shows the same thing and every single answer is wrong, because campus is shut. The
two days look identical to the class API and different in one word of the ICS.

Caveats on the ICS:

- It is **third party** (`McManning/ohio-state-ics` on GitHub Pages), not an OSU service. It can go
  stale or vanish. **Vendor the file into the repo at build time; never fetch it at runtime.**
- It has 49 events per year through 2030, which means it is pre-generated, not live-synced. Diff it
  against the registrar page each term rebuild.
- It is missing the registrar's `Dec 28-31 offices closed` block. Outside the term, so harmless here,
  but it shows the two sources are not identical.
- Times are `VALUE=DATE`, all-day, no timezone. Fine, but do not assume `DTEND` is inclusive. It is
  exclusive: `20261015..20261017` means Oct 15 and 16.

---

## 4. The access policy, with citations

There is no single published rule saying "academic buildings are open to any student from X to Y."
What exists is three things that together answer the question.

**a. The formal designation is closed, not open.** University Space Standards (2024), the policy
behind `freedomofexpression.osu.edu`:

> "the University has designated its classrooms, laboratories, athletic and recreational facilities,
> residential facilities, as well as administration, office, patient care, research, farm and
> facilities buildings, **as closed for public use, unless otherwise specified**."

That is a nonpublic-forum designation aimed at outside groups and events, not a rule that a student
cannot sit in an empty classroom. But it does mean **there is no affirmative right of entry**, so
Vacant must never phrase a result as an entitlement. The same document sets a general 10 p.m. curfew
on events that are not official university functions.

**b. Card access after hours is per-building and per-department.** Facilities Operations and
Development runs ACAMS (Access Control and Alarm Monitoring System) for "nearly 200 academic
buildings on the Columbus main campus"
(`https://fod.osu.edu/make-request/lock-and-key-services`). Assignment of card access is handled by
the department that operates the space, which is why the registrar page lists a different keycard
contact per building (Caldwell and Dreese share one, Lazenby and Psychology share another, Knowlton
routes to ETS, Sullivant routes to Library Security). **There is no campus-wide after-hours rule to
encode.** The Hopkins Hall art-students note is the concrete example.

**c. The whole campus can be locked down at once.** In May 2024 the university locked "all academic,
administrative and research buildings" to "valid BuckID/swipe card access only" for four days
(`https://www.thelantern.com/2024/05/university-restricts-access-to-campus-buildings-thursday-through-sunday/`).
An offline-first PWA holding a static weekly file cannot know this happened. It is a real, if rare,
failure mode and an argument for the crowdsourced layer being able to override the static table.

For contrast, a regional campus does state a blanket rule: Ohio State Lima says most academic
facilities are "open from 7 a.m. until the last evening class lets out"
(`https://lima.osu.edu/safety-and-security/campus-buildings-and-grounds`). That is the schedule-derived
heuristic, adopted as official policy. Columbus does not make that promise, and the Hopkins Hall case
shows why it would be wrong here.

---

## 5. Measurements

All numbers below came from commands in the appendix, not from reasoning.

### Coverage: how much of the schedule sits in a building with published hours

Sampled 12 subjects (page 1 each) for term 1268, 12 HTTP requests total:

```
total meetings                                  2421
  with a facilityId                             1988
  facilityId == "ONLINE"                         203
  no facilityId at all                           433   (26% of meetings are not in a room)
in-person meetings                              1785
distinct rooms                                   367
distinct buildings                                48
```

Joining to the registrar's 47 buildings, with the alias map in section 6:

```
ROOM    coverage   326/367  = 88.8%
MEETING coverage  1525/1785 = 85.4%
```

The uncovered buildings are real classroom space the registrar does not schedule centrally:

```
Timashev Family Music Building  (1064)  17 rooms   63 meetings
Celeste Laboratory of Chem       (371)  12 rooms  159 meetings
Weigel Hall                      (355)   5 rooms   26 meetings
Sherman Studio Art Center        (358)   4 rooms    8 meetings
McCampbell Hall                  (303)   2 rooms    2 meetings
Ohio Stadium                     (082)   1 room     2 meetings
```

Music, chemistry, art, and medicine. About 11% of rooms will have no hours row and need to fall back.

### Does the "open until the last class" heuristic hold?

For every (building, weekday) pair that has both a scheduled class and published hours:

```
pairs tested                                        192
registrar close >= last class end   185 = 96.4%
registrar closes BEFORE last class    7 =  3.6%
```

So the registrar hours are a superset of class times 96.4% of the time. The 7 exceptions are five
Hopkins Hall days (card access, explained above), one Caldwell day (the malformed `8am-10` cell), and
Biological Sciences by 5 minutes. **The heuristic is a decent sanity check on the scraped table and a
poor substitute for it.** Use it as a build-time assertion, not as a data source.

### How wrong is a blanket assumed window?

Comparing published hours against a flat "assume 7am-10pm, every building, every day":

```
                 actual open min   blanket window   blanket overstates by
WEEKDAY Mon-Fri          167,130          211,500                    27%
WEEKEND Sat-Sun            9,030           84,600                   837%
ALL WEEK                 176,160          296,100                    68%
```

```
open on Saturday   5 of 47 buildings
open on Sunday    11 of 47 buildings
open all 7 days    4 of 47:  Enarson Classroom (EC), Hitchcock (HI),
                             Independence Hall (IH), Sullivant (SU)
```

EC, HI, and IH are 7am-11pm every single day. Those three are the "this always works" answer.

**This is the number that settles the design question.** On a weekday, ignoring hours makes the app
27% too optimistic, which is annoying. On a weekend it makes it 837% too optimistic, which means
roughly nine of every ten rooms it offers are behind a locked door. A Sunday-afternoon user is
exactly the person who most needs this app, and is the person a blanket assumption fails hardest.

---

## 6. Joining the three datasets

The join key is **`buildingCode`**, the zero-padded numeric field on every meeting object. It is not
the `facilityId` prefix and it is not the building name.

**Verified: all 48 distinct `buildingCode` values in the sample are present in the OSU GIS layer's
`BLDG_NUM`. 48/48 = 100%.**

Two traps that cost me a wrong answer before I found this:

- **The `facilityId` prefix is not stable per building.** Scott Lab emits `SOE####` and `SON####`
  (wings), never plain `SO`, so a prefix join silently drops all 14 Scott Lab rooms. PAES emits `PEA`
  against registrar code `PE`. Both resolve to a single `buildingCode` (148 and 245). Known aliases
  so far: `SOE -> SO`, `SON -> SO`, `PEA -> PE`.
- **Joining on building name produces false positives.** A fuzzy name match confidently mapped
  "McCampbell Hall" (buildingCode 303, the medical center) onto "Campbell Hall" (018), which would
  have shown medical-center rooms with Campbell Hall's hours. Names also disagree across sources on
  6 of 48 rows: the class API says "Scott Lab", GIS says "Scott Laboratory"; API "Phys Activ & Educ
  Srvs Bldg", GIS "Physical Activity and Education Services - PAES". **Exact name agreement is only
  42/48 = 87.5%. Never join on names.**

### Starter table: registrar abbreviation to buildingCode

42 rows derived from observed API data. The last 5 (marked `*`) were resolved by name against the GIS
layer and should be hand-checked once.

```
AA 003    AE 298*   AP 011    AS 156*   BE 280    BI 276    BK 001*   BO 146
CB 248    CH 063    CL 026    CM 018    CZ 293    DB 025    DE 030    DL 279
DU 337    EA 004    EC 072    EL 150    FL 1018   HA 039    HC 149    HH 037
HI 274    IH 338    JE 014    JR 046    KH 340*   KN 017    LZ 041    MP 053
ML 054    OR 060    PA 061    PE 245    PO 067    PS 144    RA 090    SB 251
SH 084    SM 065    SO 148    SU 106    TFM 1025* TO 087    UH 339
```

Note `FL` is 1018 and `TFM` is 1025, four digits. Do not assume three.

---

## 7. Blueprint correction: the geo plan can be replaced

This is outside my assignment but it fell out of the same search, and it is a much better answer than
the current plan, so it should reach whoever owns phase 2.

The README plans to pull 298 named buildings from Overpass/OpenStreetMap, fuzzy-match names, and
hand-fix about 130 rows. That whole step can go away.

`MainCampusFacades` on OSU's own ArcGIS org is public, unauthenticated, returns 436 buildings with
polygon geometry, and carries `BLDG_NUM`, which **joins to the class API's `buildingCode` at 100%**.
No fuzzy matching, no afternoon of hand-fixing, and the geometry is official rather than
crowd-drawn. Fields: `BLDG_NUM`, `BLDG_NAME`, `BldgNumber`, `ComName`, `Facade`, `PhotoLink`, `Link`.
`maxRecordCount` is 2000, so one query returns everything.

```
https://services6.arcgis.com/PVrqnRx8k1Ldjgw0/arcgis/rest/services/MainCampusFacades/FeatureServer/0/query
  ?where=1%3D1&outFields=BLDG_NUM,BLDG_NAME&returnGeometry=true&f=geojson&resultRecordCount=2000
```

Spot-checked joins, all exact: Dreese `0279`, Scott `0148`, Smith `0065`, Enarson `0072`,
Caldwell `0026`, Jennings `0014`.

Caveats: it is a *facades* layer, so the polygon may be a face rather than a full footprint, and some
buildings may appear as several rows. Verify before trusting the centroid, and keep Overpass as the
backup. But test this first.

---

## 8. Recommended v1

Ship **the scraped registrar table, hard, plus the calendar, plus an honest warning.** Not a
hand-curated table, not a blanket window, not schedule-derived hours.

The brief's four options, scored against what I measured:

| Option | Verdict |
| --- | --- |
| Hand-curate 20-30 buildings | **Unnecessary.** The registrar publishes 47 buildings for free, per term, and hand-curation would go stale silently every term |
| Blanket window with a warning | **No.** 837% overstatement on weekends. This is the failure mode that makes people stop trusting the app |
| Derive hours from the schedule | **Not as a source.** Only 96.4% consistent, and Hopkins Hall shows late classes can mean badge access rather than an open door. Keep it as a build-time assertion |
| Show everything, lean on crowdsourcing | **No, not at v1.** There is no crowd on day one, and this is exactly Roomix's hole |

### The build

**Phase 1 (harvester), add roughly 150 lines:**

1. Scrape `autumn-2026-classroom-pool-building-schedule` into
   `{ buildingCode: { 0..6: [openMin, closeMin] | null } }`. Key by `buildingCode` via the table in
   section 6, never by abbreviation or name.
2. Parse `academic.ics` (vendored) into two date lists: `closedDays` (`offices closed`) and
   `noClassDays` (`no classes`). Also store the term window and the exam window.
3. **Guards, in the same spirit as Finder's `scripts/guards.mjs`:**
   - refuse the build if fewer than 40 buildings parse
   - refuse if any day cell fails to parse (this catches Caldwell's `8am-` today)
   - refuse if the semester dates on the page disagree with the meeting `startDate`/`endDate`
   - warn if any building's published close is earlier than its last scheduled class
4. Emit `hours` and `calendar` into the same `rooms-1268.json`. It is 47 buildings by 7 days plus
   about 15 dates, so it adds a couple of KB and stays offline-capable.

**Phase 3 (the app), three states, not two:**

```
  open now, closes 7:30pm      -> "yours for 2h06"        normal ranking
  building has no hours row    -> "yours for 2h06 *"      rank below known-open, footnote the *
  building closed now          -> hide by default, one line: "12 more in closed buildings"
```

And on a `closedDays` date, replace the whole list with a single message rather than showing 1,500
free rooms behind locked doors.

**Copy, verbatim, per result:** *"No class is scheduled here. The door may still be locked."* The
README already commits to this and it should not be softened, because section 4 shows even a
correctly scraped table is a statement of intent rather than a sensor.

**Do not ship the keycard contact names and phone numbers.** Strip the comment block.

Two useful extras that cost almost nothing:

- **Hardcode the three all-week buildings.** When a query returns nothing, "Enarson, Hitchcock and
  Independence are open 7am-11pm every day" is a better empty state than an apology.
- **The 24-hour library.** The LibCal call returns 18th Avenue Library as
  `24 Hours (Current OSU ID req'd 12AM-7AM)` with coordinates. That is the correct 2am answer, and
  it is one JSON fetch at build time.

---

## 9. Phase 4: the crowdsourced "was it open?" layer

### The report

Keep it to what is needed to answer the question, and collect nothing that identifies a person.

```jsonc
{
  "r": "DL0357",     // room, or building code alone if the user reports at building level
  "b": "279",        // buildingCode, denormalized so building-level rollup needs no join
  "s": 1,            // 1 open, 0 locked, 2 open-but-occupied (someone is in it)
  "t": "1268",       // term code. The decay model needs this more than it needs the timestamp
  "ts": 1756228800   // SERVER-assigned epoch seconds. Never trust a client clock
}
```

Derive weekday and minute-of-day on the server from `ts`. Do not accept them from the client, and do
not store GPS, IP, user agent, or any account identifier. A report is five short fields, so the whole
thing is well under 100 bytes.

`s: 2` (open but occupied) matters more than it looks. It is the only signal that catches the club
meeting and the review session, which is the other half of the honest hole, and it costs one extra
button.

### Decay

The naive model is "weight by recency." That is wrong here, because the real question is not how old
the report is, it is **how similar that moment was to this moment**. A report from a Tuesday at 8pm in
week 3 says a lot about a Tuesday at 8pm in week 12. A report from a Tuesday at 8pm says nothing
about a Sunday at 8pm, no matter how fresh it is.

So bucket, then decay:

```
bucket     = (buildingCode, dayType, hourOfDay)      dayType in {weekday, Sat, Sun}
weight     = termFactor * 2^(-ageDays / 45)
termFactor = 1.00  same term code
             0.30  a previous term          (hours are republished every term, so this is weak evidence)
             0.00  more than two terms old  (drop it)
```

A 45-day half-life over a 105-day term means a week-1 report is worth about 0.2 by finals, which is
the right shape. And the term factor is what stops a March report from driving an August answer, more
cleanly than any half-life alone can, because the registrar genuinely republishes the table each term.

Then never show a raw percentage off small samples. Use the **Wilson score lower bound** on the
weighted open-rate, so one lucky report cannot render as "100% open":

```
1 report  saying open  ->  "seen open once"        not "100%"
9 of 10   saying open  ->  ~76% lower bound        "usually open"
90 of 100 saying open  ->  ~82% lower bound        "reliably open"
```

**Aggregate at building level first.** The door is mostly a building-level fact, and building-level
buckets fill up roughly 8 times faster than room-level ones at the measured 8 rooms per building.
Promote to room level only once a room has enough weight to beat its building's prior. Cunz Hall's
"second floor and up locks at 6pm" is the case that eventually justifies room-level, and it will take
real traffic to earn.

**Let the crowd override the table, but only loudly.** If the scraped table says open and the recent
weighted signal strongly says locked, believe the crowd and show it, because that is the May 2024
lockdown case and the registrar page will not have been updated.

### Abuse, without accounts

The value of cheating here is close to zero, so the goal is to stop casual nuisance without adding a
login that would kill the one-tap promise.

1. **Cloudflare Turnstile**, invisible mode, on submit. Free, no account, no PII, one script tag.
2. **A signed query token.** When the app renders a result list, have the Worker issue a short-lived
   HMAC token keyed to `(roomId, hourBucket)`, and require it on submit. A report then has to
   correspond to a room the app actually offered, at about the time it offered it. A few lines, and
   it removes scripted bulk submission entirely.
3. **Rate limit on a salted hash, not the IP.** Store `HMAC(ip, dailyRotatingSalt)` and cap it at
   something like 20 reports a day. The salt rotates daily so the table is not an IP log, and it
   still stops one person from voting a thousand times.
4. **One vote per client key per bucket.** Later reports from the same key in the same bucket replace
   the earlier one instead of stacking.
5. **Clamp the influence of any single bucket.** No single (room, hour) bucket should be able to flip
   a building's overall confidence on its own.

Deliberately not doing: accounts, email verification, BuckID SSO, GPS proof. Each one costs more
trust and friction than the abuse it prevents.

### The smallest backend that works

The design that keeps the PWA's offline promise intact is **writes go to the backend, reads stay
static.**

```
   phone --POST /r--> Cloudflare Worker --> D1 (one table)
                              |
                       cron, hourly
                              |
                              v
                   confidence-1268.json  (a few KB)
                              |
   phone <---- GET, cached by the service worker, same as rooms-1268.json
```

The read path never touches the backend, so the app still answers with the network off, and an
outage degrades to "yesterday's confidence" instead of a spinner. The Worker only ever handles tiny
writes.

Concrete free options, evaluated:

| Option | Free tier | Verdict |
| --- | --- | --- |
| **Cloudflare Workers + D1 + Turnstile** | Workers 100k req/day, 10ms CPU; D1 5 GB, 5M row reads/day, 100k row writes/day; Turnstile free with no request cap | **Pick this.** One file, no cold start, CORS is trivial, Turnstile is the same vendor, and the cron trigger that rebuilds the JSON is built in. 100k writes/day is roughly 100x what this will ever need |
| Cloudflare Workers + KV instead of D1 | KV 100k reads/day, 1k writes/day | Write cap is too low and KV cannot aggregate. Use D1 |
| Val Town | Generous free tier, HTTP handlers plus SQLite plus cron | Genuine runner-up. Smallest possible thing that works, one editable file in a browser. Less durable as a long-lived dependency |
| Supabase | 500 MB Postgres, 50k MAU | Works, but pauses free projects after inactivity, which is fatal for something used in bursts between classes |
| Firebase / Firestore | 50k reads, 20k writes/day | Works, and Enes already runs Firebase on proscan-web. Heavier client SDK than a 100-byte POST deserves, and it pushes toward client-side rules for abuse control |
| Vercel Functions + Neon or Upstash | Hobby tier | Fine, but it is two vendors for what one Worker does, and Neon's free tier also idles |
| Deta | | Shut down. Do not |
| GitHub Issues or a repo file as the store | Free | Tempting because the repo is already there, but it needs a token in the client or a proxy, and it rate-limits. No |
| Google Apps Script + Sheets | Free | Genuinely zero-infrastructure and Enes could read the data in a spreadsheet. Slow (hundreds of ms), awkward CORS, and it will not survive real traffic. Good for a two-week experiment only |

**Recommendation: one Cloudflare Worker, one D1 table, one hourly cron, Turnstile on submit.** That is
about 120 lines and it stays inside the free tier permanently at any traffic this app will plausibly
see. Free-tier figures were checked on 2026-08-26 and vendors move them, so re-check before building.

```sql
CREATE TABLE reports (
  id     INTEGER PRIMARY KEY,
  bldg   TEXT NOT NULL,
  room   TEXT,
  state  INTEGER NOT NULL,      -- 0 locked, 1 open, 2 open-but-occupied
  term   TEXT NOT NULL,
  ts     INTEGER NOT NULL,      -- server clock
  dow    INTEGER NOT NULL,      -- derived server-side
  hour   INTEGER NOT NULL,      -- derived server-side
  ckey   TEXT NOT NULL          -- HMAC(ip, daily salt), for rate limiting only
);
CREATE INDEX idx_bucket ON reports(bldg, dow, hour, ts);
CREATE INDEX idx_rate   ON reports(ckey, ts);
```

---

## 10. Open questions

1. Caldwell Lab's four broken cells. Someone should mail the Room and Class Scheduling Office. It is
   a one-line fix on their end and it is the only building the scraper cannot read.
2. Does the registrar page URL slug stay predictable? I have seen `summer-2026-`, `autumn-2026-`, and
   `winter-break-classroom-pool-building-schedule-2025-2026`. The winter-break one breaks the pattern,
   so the scraper should read the index page and follow links rather than construct the URL.
3. What happens to the page between terms? If Autumn 2026 disappears when Spring 2027 is posted, the
   scraper needs to cache the last good copy in the repo.
4. `facilityType` (`"1B"` and friends) is still undocumented and is a separate open item in the
   README. The Learning Spaces Directory looks like the place to decode it, but it needs a browser to
   scrape.
5. Whether Roomix models building hours. It 403s non-browser clients, so this needs one manual look.
6. The 6 uncovered buildings (Timashev, Celeste, Weigel, Sherman, McCampbell, Ohio Stadium) are
   department-scheduled. Their hours may be on department pages, which would be genuine hand-curation
   but only 6 rows rather than 30.
7. Football home games are on the registrar page for a reason. Whether they change building access on
   the 6 listed Saturdays is unknown, and 5 of 47 buildings are open Saturday anyway, so it may not
   matter.
8. My coverage numbers come from 12 subjects, page 1 each. A full harvest could shift them. The
   direction is unlikely to change, but re-measure once phase 1 has the real pull.

---

## Appendix: commands

Every number above came from one of these.

```bash
# The registrar page. 86,937 bytes, HTTP 200, no table elements.
curl -s -o au2026.html \
  "https://registrar.osu.edu/staff-resources/class-catalog-and-space/classroom-pool-building-schedule/autumn-2026-classroom-pool-building-schedule/"
grep -c "<table" au2026.html          # -> 0
grep -c "panel panel-default" au2026.html

# Parse: 47 panels, 47 with 7 days, 47 with a code.
python -X utf8 parse.py au2026.html au2026.json

# Calendar feeds.
curl -s -o academic.ics "https://mcmanning.github.io/ohio-state-ics/academic.ics"   # 82,565 B, 489 events
curl -s -o staff.ics    "https://mcmanning.github.io/ohio-state-ics/staff.ics"      # 110 events

# Class API sample: 12 subjects, page 1 each, 12 requests, 1.5s apart, 90s timeout.
python -X utf8 probe.py                # -> 2421 meetings, 367 rooms, 48 buildings

# Coverage, the heuristic test, and the blanket-window comparison.
python -X utf8 cover3.py               # -> 88.8% rooms / 85.4% meetings
python -X utf8 heur.py                 # -> 185/192 = 96.4%, and the 7 conflicts
python -X utf8 impact.py               # -> weekend blanket overstates by 837%

# OSU GIS: 436 buildings, BLDG_NUM joins to buildingCode 48/48.
curl -s "https://services6.arcgis.com/PVrqnRx8k1Ldjgw0/arcgis/rest/services/MainCampusFacades/FeatureServer/0?f=json"
curl -s "https://services6.arcgis.com/PVrqnRx8k1Ldjgw0/arcgis/rest/services/MainCampusFacades/FeatureServer/0/query?where=1%3D1&outFields=BLDG_NUM,BLDG_NAME&returnGeometry=false&f=json&resultRecordCount=2000"

# Libraries. Use iid=5296 (29 locations). iid=4810 returns only Newark.
curl -s "https://api3.libcal.com/api_hours_grid.php?iid=5296&format=json&weeks=1"

# Dead ends, confirmed:
curl -s -o /dev/null -w "%{http_code}\n" "https://library.osu.edu/hours/api/v3/map/library"   # 404
curl -s -o /dev/null -w "%{http_code}\n" "https://hub.arcgis.com/api/v3/datasets/32665fdcad884c18b899327a633a9bb7_28"  # 404
curl -s -o /dev/null -w "%{http_code}\n" "https://opendata.arcgis.com/datasets/32665fdcad884c18b899327a633a9bb7_28.geojson"  # 400
```

HTTP budget used against `content.osu.edu`: **12 requests**, sequential, 1.5 s apart, 90 s timeout,
well inside the 60-request cap. Scratch scripts and raw JSON are in
`C:\Users\galax\AppData\Local\Temp\claude\C--Users-galax-Downloads-Projects\ff09d3ae-8ad6-40bb-942d-f7cf03ac4117\scratchpad`.
