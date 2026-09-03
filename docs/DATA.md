# What Vacant fetches from Ohio State, how often, and how to make it stop

If you work at Ohio State and you found this repository, this is the page to
read. It should take about four minutes and it should answer every question you
have. The last section is the off switch.

**Contact.** Open an issue at
<https://github.com/EnesYilmazcode/Vacant/issues>, or email the address on the
commits in this repository. If you want the harvest throttled, rescheduled or
stopped, say so and it will be done the same day. You do not have to explain why.

---

## The short version

Vacant is a student project. It is not affiliated with, authorized by, or
endorsed by The Ohio State University.

It downloads the public class schedule, turns it into a table of which rooms are
busy when, and serves that table as a static file. Students' phones never talk to
an Ohio State server. All the load is one harvest job, run about once a week.

**That job is started by hand.** There is no scheduled workflow in this
repository, so the harvest runs when a person runs it and at no other time. A
weekly cron is planned, Sunday 3:25am Eastern, and the off switch below tells you
how to disable it on the day it lands. Until then the off switch is that nobody
is pressing the on switch.

```
                    by hand, about once a week
   content.osu.edu ----------------------------------> a laptop
   registrar.osu.edu                                        |
   gissvc.osu.edu                                           | writes JSON,
   courses.erppub.osu.edu                                   | commits it
                                                            v
   a student's phone <------------------------------- GitHub Pages
                        every day, all term, zero
                        requests to anything at OSU
```

That last arrow is the whole design. Every competing app queries a university
endpoint on each search. Vacant queries it never.

---

## What is fetched, from where

### 1. The class schedule

```
https://content.osu.edu/v2/classes/search?q=&campus=col&term=<term>&sort=catalogNumber&catalog-number=<bucket>&p=<page>
```

The same endpoint `classes.osu.edu` calls from a student's browser. It is
hardcoded in Ohio State's own class-search bundle and served with
`Access-Control-Allow-Origin: *`.

The harvester pages by `catalog-number` bucket, eight buckets of 200 sections a
page, and repeats until two consecutive passes find no new meeting in a real
room. A single pass is not enough: measured on Autumn 2026, one pass missed 609
meetings, 13 of them in a real room, which is thirteen rooms that would have read
free with a class sitting in them.

| | |
| --- | --- |
| Cadence | Run by hand, about once a week. **No scheduled workflow exists in the repository.** The planned cron is `'25 7 * * 0'`, Sunday 07:25 UTC, which is 3:25am Eastern |
| Requests per run | **545**, measured on term 1268 over 4 passes |
| Advertised ceiling | **1,900 a week**, for everything in this repository together. `MAX_PASSES` x 8 buckets x 17 pages is 1,089 for the harvest, plus 323 for room features and 427 for room events, all cold. The `User-Agent` states that ceiling rather than the typical run |
| Hard stop | `MAX_REQUESTS` is 4,000 and throws rather than fetches |
| Concurrency | 2, with a 500 ms delay, about 2.9 requests a second |
| Bytes per page | **37,460 on the wire, gzipped**, measured 2026-08-27 with one request |
| Bytes per run | about **19.5 MB gzipped** (545 x 37,460). At the advertised ceiling, about 41 MB |
| Timeout | 60 s. Retries back off, and a 403 gets exactly one retry per run |
| Conditional requests | None available. The API sends no `ETag`, `Last-Modified` or `Cache-Control`, so fewer and slower requests is the only lever there is |

The `User-Agent` says who is calling and how much:

```
Vacant/0.1 (+https://github.com/EnesYilmazcode/Vacant; contact via repo issues)
weekly classroom-schedule index, <=1900 requests/week
```

That string is hardcoded in `scripts/lib/fetch.mjs`, and while the harvest is run
by hand it is a promise rather than a description of a timer. Running it more than
once a week would make the `User-Agent` a lie to your logs, so it does not get run
more than once a week.

### 2. The Registrar's classroom pool building schedule

```
https://registrar.osu.edu/staff-resources/class-catalog-and-space/classroom-pool-building-schedule/
```

One index page plus one page per term, so two or three requests. This is the file
that makes Vacant different from every other room finder: it is the only public
statement of when a building's doors are actually open. Cached under
`data/cache/registrar/` so a parser change does not cost a refetch.

### 3. The room feature sources

```
https://registrar.osu.edu/staff-resources/class-catalog-and-space/general-assignment-rooms/
https://learningspaces.osu.edu/classrooms
```

Two published sources, merged by `scripts/fetch-room-features.mjs` into
`data/room-features.json`. The Registrar's general assignment list is one index
request plus one term page and covers 327 rooms with capacity and 13 coded
characteristics. OTDI's Learning Spaces Directory is one index plus one page per
classroom, 321 requests, and joins to 311 rooms. **323 requests on a cold cache,
0 on a warm one.**

The two are merged rather than concatenated because they use the word "moveable"
on different axes. The Registrar means not bolted to the floor; Learning Spaces
means on casters. Held together they support a bolted / freestanding / casters
scale that neither source publishes alone, and every room records which sources
decided it.

Registrar pages are cached under `data/cache/registrar/`, shared with
`fetch-ga-rooms.mjs`, and committed. The 321 Learning Spaces pages are 12 MB and
are **not** committed: `.gitignore` excludes `data/cache/learningspaces/` and a
clean checkout refetches them once.

Photos and 360 tours are **linked, never copied**. Nothing under
`rooms.app.it.osu.edu` is mirrored into this repository, so the images stay on
Ohio State's own server and remain Ohio State's.

### 4. The building and campus geometry

```
https://gissvc.osu.edu/arcgis/rest/services/Data/FacilitiesStreets_RO/MapServer/11/query
https://gissvc.osu.edu/arcgis/rest/services/Data/FacilitiesStreets_RO/MapServer  (layers 11, 12, 9, 13)
```

One request for the building table. A handful more for the map geometry, which is
paged. Neither is on the weekly schedule: building coordinates change once a
decade, so these run by hand when something moves.

Credit, per the FITS grant on the OSU GIS Hub:

> Building locations (c) 2025 The Ohio State University, Facilities Information
> and Technology Services.

`docs/outreach/gismaps-email.md` is the note to `gismaps@osu.edu` asking whether
they want that worded differently. No answer is not permission, and that is
recorded in `docs/DECISIONS.md` rather than assumed away.

### 5. The Registrar's SIS room matrix

```
https://courses.erppub.osu.edu/psc/ps/EMPLOYEE/PUB/c/OSR_CUSTOM_MENU.OSR_ROOM_MATRIX.GBL
```

The public room matrix, read by `scripts/fetch-room-events.mjs` into
`data/room-events-<term>.json`. One GET to open the session, one 302 hop, then one
POST per room: **427 requests for a 425-room sweep, 232 seconds, one at a time**.
It is the only sweep here that is not a fresh anonymous GET per URL, because
PeopleSoft hands out its session cookies on a redirect and expects them echoed
back on every hop. That is also why this one script keeps its own HTTP client
instead of `scripts/lib/fetch.mjs`: Node's redirect following drops the cookie
jar and lands on a "you must have cookies enabled" page that returns a healthy
200 and parses as a campus with no bookings at all.

This is the occupancy the class harvest cannot see: registered events (student
org meetings, tours, info sessions) and Registrar ROOM BLOCK holds. On the week
of 08/31/2026 that was 327 events and 347 block cells, and 323 of the events and
343 of the block cells land in a window `rooms-1268.json` calls entirely free.
Blocks alone cover 10.7% of every weeknight 5-10pm free room-minute and 8.95% of
Saturday 8am-10pm.

The 8,288 class cells in the same grids are counted and thrown away. The 425
gzipped pages are cached under `data/cache/sis-room-matrix/` and are **not**
committed: 5.2 MB a week that refetches in four minutes.

---

## What is deliberately thrown away

**`instructors[]` is deleted at the parse boundary, before anything reaches
disk.** Every meeting the API returns carries an array of instructor records with
real `name.n@osu.edu` addresses in it. Across the two archived terms that was
**45,483 records**. They are deleted the moment a page is parsed, in
`scripts/lib/funnel.mjs` and `scripts/snapshot-term.mjs`, and then
`scripts/snapshot-term.mjs` runs a fatal `@osu.edu` scan over the serialised page
and refuses to write if one survived.

The guard is a release blocker, not a nicety. It is the difference between a
policy conversation and a story.

Re-verified 2026-08-27 by decompressing all 210 committed archive pages and
walking every object in them:

```
files                            210
decompressed bytes        93,528,295
email addresses                    0
"instructors" keys                 0
lastName / firstName / emplid      0
```

**The room matrix's free-text booking labels are dropped the same way.** Every
event and room block in the SIS room matrix carries a Registrar-typed label, and
23 of the 189 distinct labels on the week of 08/31/2026 name a real person. No
heuristic separates those from the student org names reliably, so the whole
string is discarded inside `parseRoom()` before a record is built. Only the type
code survives: MTG, TOUR, INFO, WRKS, SMNR, or null for a block.
`scripts/test/room-events.test.mjs` asserts that against the shipped bytes.

Vacant also stores no enrolment numbers, no student data of any kind, and no
course descriptions in the shipped index. The room table is room, weekday, start
minute, end minute, and the date range the meeting runs over. That is all.

---

## Why this is not a robots.txt violation, and what it is instead

Stated once, plainly, so nobody has to reconstruct it.

- `content.osu.edu/robots.txt` returns **HTTP 404**. There is no file, so there is
  no rule and no `Crawl-delay` to honour.
- `www.osu.edu/robots.txt` allows everything except one PDF, with no crawl delay.
- The endpoint is served with `Access-Control-Allow-Origin: *` and Ohio State's
  own public class search calls it from the browser.
- The class schedule is **Public (S1)** under Ohio State's own Institutional Data
  Policy: "institutional data intended for public use that has no access or
  management restrictions". That policy names students, so it applies here and it
  helps rather than hurts.
- There are no terms of service on the endpoint. Nothing was clicked, no key was
  issued, no agreement exists. No authentication was bypassed and no access
  control was circumvented.

The two sources added on 2026-09-03 were checked the same way before anything
was written.

- `learningspaces.osu.edu/robots.txt` is the stock Drupal file. It disallows
  `/admin/`, `/user/login`, `/core/`, `/profiles/` and the other machinery paths.
  `/classrooms` and `/classroom/*` are allowed, and those are the only paths read.
- `courses.erppub.osu.edu/robots.txt` returns **HTTP 404**, so again there is no
  file and no rule.
- The room matrix is **not a private page reached sideways**. It sits on
  PeopleSoft's `PUB` portal node, the Registrar links it publicly from the Event
  Space Request page, and Ohio State publishes a how-to for it at
  `it.osu.edu/student-information-system-sis/sis-room-class-scheduling/11-use-the-room-matrix`.
  It serves the grid to an anonymous session. No credential is sent, none is
  held, and nothing is bypassed: the cookie jar the scraper keeps is the same
  anonymous session cookie a browser is handed on first load, and the only
  reason it is handled by hand is that Node's redirect following drops it.
- Neither host publishes terms of service, and the free-text field that could
  carry a person's name is discarded before a record is built.

So: nothing was agreed to and nothing was breached. The clause that does apply is
the Responsible Use policy's I.D, which asks users to "limit use so as not to
consume an unreasonable amount of those resources", and says plainly that "the
reasonableness of any particular use will be judged by the university in the
context of the relevant circumstances". There is no number to hit. That is
exactly why the harvester is slow, weekly, self-identifying and reachable, and
why this page exists.

**And there is no money in it, ever.** The same policy asks users to "refrain from
using university resources for personal commercial purposes or for personal
financial or other gain". Vacant carries no ads, no donations, no sponsorship, no
affiliate links and no paid tier, and it never will. A paid tier would turn
"please throttle" into a named violation. GitHub Pages independently forbids
running a business off it. Both rules point the same way and the answer is easy.

---

## Reproducing every file in `data/` from scratch

Node 22 or newer. No dependencies to install: `package.json` has none.

```sh
git clone https://github.com/EnesYilmazcode/Vacant.git
cd Vacant
node --test                              # 208 tests, zero network requests
```

Then, in this order. Each script prints its own request count and refuses to
write a file that fails its guards.

```sh
# 1. Building coordinates. One request. Writes buildings.json (612 buildings
#    within 20 km of the Oval) from GIS layer 11.
node scripts/fetch-buildings.mjs

# 2. Campus geometry for the map. Layers 11, 12, 9 and 13, paged, clipped to a
#    box anchored on class-hosting buildings within 2 km of the Oval.
#    Writes campus.json: 1,543 features, 13,254 points, 39,054 bytes gzipped.
node scripts/fetch-campus.mjs

# 3. Registrar building hours. Two or three requests, cached under
#    data/cache/registrar/. Writes buildings-hours.json: 47 buildings a term.
node scripts/fetch-building-hours.mjs

# 3b. Room features. 323 requests cold, 0 warm. Writes room-features.json:
#     328 rooms, from the Registrar's list and OTDI's Learning Spaces Directory.
node scripts/fetch-room-features.mjs

# 4. The class harvest. This is the expensive one: 545 requests, about fifteen
#    minutes, about 19.5 MB. Writes data/harvest-<term>.json.gz, which is NOT
#    committed, plus the manifest beside it, which is.
node scripts/fetch-rooms.mjs

# 5. Invert the harvest into the room index. No network.
#    Writes rooms-<term>.json, buildings-<term>.json and current.json.
node scripts/build-index.mjs

# 6. Non-class room occupancy. Reads the index step 5 wrote, so it runs last.
#    427 requests, about four minutes. Writes room-events-<term>.json: 674
#    records over 425 rooms for the current week.
node scripts/fetch-room-events.mjs
```

Add `--dry-run` to any of the fetch scripts to see what it would request without
requesting it.

The two archived terms are a separate job and you cannot reproduce them, which is
the point:

```sh
node scripts/snapshot-term.mjs 1262      # will now die: totalItems 0
```

A term that has left `searchableTermsV2` is deleted from the search index, not
hidden. Spring 2026 leaves on 2026-08-31 and Summer 2026 on 2027-01-01.
`data/raw/1262/` and `data/raw/1264/` are the only copies of those terms that will
ever exist. Do not prune them to save repository size.

---

## `data/raw/` is published on purpose

GitHub Pages serves the repository root, so
`https://enesyilmazcode.github.io/Vacant/data/raw/1262/1xxx-p01.json.gz` is a
live URL. That is deliberate. Measured 2026-08-27:

```
published tree            7,030,232 bytes   311 files
  data/raw/               4,278,214          212      61%
  docs/                   1,411,520           55      20%
  data/, minus raw/       1,005,060           13      14%
  scripts/                  224,748           22       3%
  js/ + index.html           90,475            5       1%

what the app actually loads on first launch:
  raw                       481,460 bytes
  gzipped                   104,830 bytes    102.4 KB
```

Excluding it was considered and rejected. The full reasoning is in
`DECISIONS.md` under `2026-08-27  data/raw/ stays published`. The short version
is that the repository is public either way, so exclusion buys no privacy at all:
it moves one public URL to a different public URL. It holds no PII, verified by
decompressing all 210 files. And the only concrete harm anyone named, a service
worker caching 4.1 MB onto a phone, is not fixed by excluding one directory when
`docs/` is another 1.4 MB on the same origin. The fix for that is an explicit
precache list, which the service worker needs regardless.

**There is no way to hide it from crawlers, and that was checked rather than
assumed.** `robots.txt` is origin-scoped: a crawler reads
`https://enesyilmazcode.github.io/robots.txt`, never
`https://enesyilmazcode.github.io/Vacant/robots.txt`. That origin-root URL
returns HTTP 404 today, because the user site it would come from does not exist,
and this repository cannot create it. Pages sets no response headers either, so
`X-Robots-Tag` is out, and a `<meta name="robots">` tag cannot go on a
`.json.gz` file. So a crawler that walks the archive will walk it. At 4.1 MB
against GitHub Pages' 100 GB monthly soft limit, that would take about 24,000
full crawls to matter.

---

## The kill switch

Two edits. Both can be made from a phone, in GitHub's web editor, with no laptop
and no git client. Together they take about two minutes.

Do them in this order. The first stops the load on Ohio State. The second takes
the app down, and it is only needed if somebody has asked for that specifically.

### Edit 1: stop the harvester

**Right now there is nothing to switch off.** There is no `.github/` directory in
the repository, so no job runs on a timer. The harvest is started by hand, which
means it is already stopped between runs. Ask, and it stays stopped.

The rest of this section is for the day the weekly workflow lands, so that the
instructions are already written and already true when somebody needs them at
3am.

Open each file under
[`.github/workflows/`](https://github.com/EnesYilmazcode/Vacant/tree/main/.github/workflows)
in the web editor, find the `schedule:` block near the top, and put a `#` in front
of both its lines. Leave `workflow_dispatch:` alone, so the job can still be run
by hand once whatever is wrong is fixed.

```yaml
on:
  # schedule:
  #   - cron: '25 7 * * 0'
  workflow_dispatch:
```

Commit straight to `main`. The next scheduled run does not happen. Nothing else in
the repository reaches an Ohio State server, so at that point the load is zero.

Whoever adds that workflow owns keeping this section true, and owns changing the
cadence line at the top of this page from "by hand" to "on a timer" on the same
commit. The `schedule:` block has to stay on its own two lines, near the top of
the file, so commenting it out is a two-keystroke edit on a phone and not a YAML
puzzle.

### Edit 2: take the app down

Open [`index.html`](https://github.com/EnesYilmazcode/Vacant/blob/main/index.html)
in the web editor, select all, and replace it with this. Commit to `main`. Pages
redeploys in under a minute.

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vacant is offline</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:2rem;
         background:#0b0d10; color:#eef1f5;
         font:16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width:34rem; }
  h1 { font-size:1.6rem; margin:0 0 1rem; }
  a { color:#4cc2ff; }
</style>
</head>
<body>
<main>
  <h1>Vacant is offline</h1>
  <p>This was a student project that found empty classrooms at Ohio State. It is
     switched off. Nothing is being downloaded from any university server.</p>
  <p>Vacant was not affiliated with, authorized by, or endorsed by The Ohio State
     University.</p>
  <p><a href="https://github.com/EnesYilmazcode/Vacant/issues">Get in touch</a></p>
</main>
</body>
</html>
```

Anyone who has installed Vacant to their home screen may still see the old page
from their service worker cache for a while. There is no way to reach into an
installed app and clear it, and pretending otherwise would be dishonest. The
service worker's own update check replaces it on the next launch that has signal.

### What edit 2 does not do

It does not remove the data files. `data/` is still served, and the repository is
still public. If the ask is to take the *data* down rather than the app, that is a
third action: delete the files and force-push, or make the repository private. Say
which one you want. Note that `data/raw/1262` and `data/raw/1264` are the only
surviving copies of those two terms anywhere, so if the ask is deletion, that is
what gets deleted.
