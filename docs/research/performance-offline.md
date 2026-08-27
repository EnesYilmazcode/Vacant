# Performance and offline: what the redesign actually costs

Measured 2026-08-27 against the tree at `746485d`, on the shipped files, in a
real browser. Every number below has the command that produced it. Where a
number could not be produced it says so.

The lens is narrow on purpose: bytes, milliseconds, and what happens when the
network is not there. Nothing here argues about layout.

---

## 0. The one-sentence version

The redesign is arguing over 301 bytes and 5,809 bytes while 21,108 bytes of
dead address text and 13,180 bytes of pointless coordinate precision sit on the
critical path in front of the answer, and while a single missing file, the map,
takes the whole app down with a "check your connection" error even when the
schedule is already on the phone.

Fix the three things that are free before spending anything on the six asks.

```
   TODAY                              AFTER THREE FREE FIXES
   +-----------------------------+    +-----------------------------+
   | fetch campus.json  51,823   |    | fetch ALL SIX in parallel   |
   |   (gates everything)        |    |   campus  38,643 (regridded)|
   +-----------------------------+    |   rooms   27,389            |
              |                       |   buildings 2,060 (trimmed) |
              v                       |   hours    3,621            |
   +-----------------------------+    |   current    150            |
   | buildBasemap 1,697 paths    |    |   code    19,226            |
   | into a 24.0 MB canvas       |    +-----------------------------+
   +-----------------------------+               |
              |                                  v
              v                       +-----------------------------+
   +-----------------------------+    | ANSWER                      |
   | fetch rooms + buildings     |    +-----------------------------+
   |   + hours                   |               |
   +-----------------------------+               v  (idle callback)
              |                       +-----------------------------+
              v                       | buildBasemap, in a Worker,  |
   +-----------------------------+    | off the main thread         |
   | ANSWER                      |    +-----------------------------+
   +-----------------------------+
   125,079 gz, dies if the map      91,389 gz, answers with no map,
   is missing                       map arrives when it arrives
```

---

## 1. The rig

Chrome 151.0.7922.174 headless, driven over the DevTools protocol from node
22.14.0, against a local gzip-capable static server pointed at the repo root.
Device metrics 390x844 dpr 3 unless stated. CPU throttled with
`Emulation.setCPUThrottlingRate`; network with
`Network.emulateNetworkConditions`.

Everything was run twice, once with `--disable-gpu` and once with
`--enable-gpu --use-angle=default`. That turned out to matter enormously for
one number, so both columns are reported. The GPU column is closer to an
iPhone, which has a GPU-backed 2D canvas. The software column is the ceiling.

Byte figures are `gzip -9`, which is what GitHub Pages serves. Command:

    python -X utf8 -c "import gzip;b=open('data/campus.json','rb').read();
    print(len(b), len(gzip.compress(b,9)))"

Two things could not be measured here and are marked as such: the Cache API is
broken in this headless profile (`caches.open` returns
`UnknownError: Unexpected internal error`, and `Cache.put` into a
freshly-created empty cache throws `InvalidAccessError: Entry already exists`),
and no iOS device was available.

---

## 2. Byte audit

### 2.1 What ships today

```
file                        raw        gz -9      share of total
index.html                7,438        2,866
js/app.js                17,280        6,412
js/campus.js              3,548        1,671
js/engine.js             11,314        4,478
js/map.js                 9,536        3,501
  code subtotal                       18,928        15.1%
data/campus.json        128,842       51,823        41.4%
data/rooms-1268.json    239,468       27,389        21.9%
data/buildings.json     163,277       23,168        18.5%
data/buildings-hours.json 43,734       3,621         2.9%
data/current.json           183          150         0.1%
  data subtotal                      106,151        84.9%
  TOTAL                              125,079       100.0%
```

Two corrections fall straight out of that table.

`docs/research/pwa-ios.md` line 424 budgets the shell at "maybe 60 KB". The
shell is 18,928 gz, so the budget has three times the headroom anyone thought.

`docs/research/pwa-ios.md`'s tier-3 offline copy promises the user "It is about
100 KB and then it works offline forever." The real first download is 125,079
gz today, and 148,768 if the course sidecar in `docs/research/room-screen.md`
ships. That is a user-facing promise that is already 25% understated and would
be 49% understated. Change the copy, or cut bytes until it is true. Section 2.3
cuts enough to make "about 90 KB" true.

### 2.2 The additions the redesign proposes, priced against that table

```
addition                                        gz      of total
buildingKey array in campus.json              +301        +0.2%
three inline SVG glyphs                       +297        +0.2%
standalone footprints file, DP 2 m          +5,809        +4.6%
courses-1268.bin sidecar                   +23,689       +18.9%
```

The `buildingKey` figure reproduces `basemap-feasibility.md`'s +319 to within
18 bytes. Appending the real 302-entry key array from
`data/footprints.draft.json` to the real `data/campus.json` and re-gzipping
gives 52,124 against 51,823. It is the cheapest correctness fix on the board
and it should ship.

The standalone footprints file measures 5,809 gz, which is 21.2% of the room
index and 4.6% of everything. `basemap-feasibility.md` is right to reject it.

The course sidecar is the only addition that is actually large. At 23,689 gz it
is nearly the whole room index again, and it sits on the horns of a dilemma
nobody has stated: if the service worker precaches it, it is +18.9% on the
first-download promise; if it is fetched lazily on first room-screen open, then
the room screen does not work in a stairwell, which is the exact place the app
exists for. There is no third option. Pick one deliberately and write it down.

### 2.3 Two cuts that are free, measured

**`data/buildings.json` is 18.5% of the payload and the app reads three fields
from it.**

`js/engine.js:206` reads `building.lat` and `building.lon`, `js/engine.js:229`
reads `building.name`, and `js/app.js:149` looks the record up by code. Nothing
anywhere reads `address`, `city`, `campus`, `status`, `floors`, `km_from_oval`
or `short`. The file ships 612 buildings; `data/rooms-1268.json` references 96,
and all 96 are present.

```
variant                                  raw      gz -9
as shipped                           163,277     23,168
all 612, only name/lat/lon            44,827     12,261
96 referenced, only name/lat/lon       6,646      2,060
96 referenced, parallel arrays, 5 dp   4,453      1,772
```

Trimming to the 96 referenced buildings saves 21,108 gz. That is 70 times the
`buildingKey` the design is currently debating, and 16.9% of everything the app
downloads.

Caveat worth writing into the issue: issue
[#17](https://github.com/EnesYilmazcode/Vacant/issues/17), the manual building
picker, may want a wider list than 96. It should load its own file lazily when
the picker opens, not put 21 KB in front of every launch for a screen most
users never see.

**`data/campus.json` stores coordinates 46 times finer than one pixel.**

`js/campus.js`'s own header says the grid is "about 7 cm, far finer than the
~6 m one pixel covers at campus zoom". Nobody costed that. Measured against the
real geometry:

```
bbox 2,685 m x 2,207 m, grid 65535
SETTLED_SPAN 0.28 shows 618 m across a 390 px phone = 1.58 m per CSS px

grid    step (lat)   error at the tightest zoom the app ever shows
65535     0.034 m    0.02 px
16384     0.135 m    0.09 px
 8192     0.269 m    0.17 px
 4096     0.539 m    0.34 px
 2048     1.077 m    0.68 px
```

Re-quantising the shipped file to each grid and re-gzipping:

```
variant                                  raw      gz -9    delta
as shipped (grid 65535)              128,842     51,823
regrid 16384                         113,195     45,525   -12.2%
regrid  8192                         105,485     42,094   -18.8%
regrid  4096                          98,835     38,643   -25.4%
regrid  2048                          91,807     34,592   -33.2%
drop the landscape layer             102,307     41,475   -20.0%
regrid 4096 and drop landscape        78,107     30,532   -41.1%
```

Then rendered both files through the real `buildBasemap` and `drawFrame` at
390x844 dpr 2 and diffed the pixels:

```
variant              span   pixels differing   visibly differing   mean
                            at all             (>24 of 765)        delta
regrid 4096          0.28        20.4%              0.387%      0.40/255
regrid 4096          0.12        17.4%              0.211%      0.30/255
regrid 2048          0.28        23.2%              1.818%      0.74/255
regrid 2048          0.12        20.1%              1.164%      0.58/255
regrid 2048, no
  landscape          0.28        28.4%              7.342%      1.36/255
```

Regridding to 4096 changes 0.387% of pixels by more than one part in twenty and
saves 13,180 gz. That is antialiasing noise for a tenth of the map's weight.
Dropping the landscape layer changes 7.3% of pixels visibly, which is a real
visual change, and it is not recommended.

Together the two cuts take the payload from 125,079 to 91,389 gz, which is
26.9% smaller, and they make the "about 100 KB" copy in `pwa-ios.md` true
again for the first time.

---

## 3. Critical path audit

### 3.1 The map is not off the critical path, it is in front of it

`js/app.js` `boot()` awaits `Promise.all([json('campus.json'),
json('current.json')])`, then runs `buildBasemap`, and only then issues the
second `Promise.all` that fetches `rooms-1268.json`. The 51,823-byte map gates
the 27,389-byte file that produces the answer.

Measured against a patched copy that puts all six requests in one `Promise.all`
and moves `buildBasemap` into `requestIdleCallback`, three runs each, timing
`performance.mark('vacant:ready')` from navigation start:

```
GPU accelerated
network            cpu   shipped   parallel   saving
wifi 30/20 ms       1x     265 ms     229 ms    36 ms   13.6%
wifi 30/20 ms       4x     436 ms     347 ms    89 ms   20.4%
LTE 8/70 ms         1x     608 ms     525 ms    83 ms   13.7%
LTE 8/70 ms         4x     723 ms     595 ms   128 ms   17.7%
3G 400k/300 ms      1x   4,242 ms   3,936 ms   306 ms    7.2%
3G 400k/300 ms      4x   4,407 ms   3,999 ms   408 ms    9.3%

software rasterised (the ceiling)
wifi 30/20 ms       4x   1,477 ms     337 ms 1,140 ms   77.2%
LTE 8/70 ms         4x   1,810 ms     567 ms 1,243 ms   68.7%
```

So the reorder is worth 36 to 408 ms with a GPU and up to 1.2 s without one.
It is a two-line change and it should land regardless of the six asks.

One implementation trap found the hard way: the obvious
`(window.requestIdleCallback || setTimeout)(fn, 1)` throws
`Illegal invocation` in Chrome because the callee is detached from `window`. It
has to be bound. The failure mode is that `boot()` rejects and the app shows
"Could not load the schedule."

The parallel version needs the room filename before `current.json` has landed.
Remembering the previous value in `localStorage` and correcting on a miss works
and costs nothing, and it is the same trick the service worker will need
anyway.

### 3.2 The query is not the problem, and has not been for a while

Tap to painted rows, measured on the real app:

```
                       cpu 1x    cpu 4x
tap to 40 rows        8-13 ms   62-103 ms
```

`query-engine.md` measured 365 to 469 ms cold in node and recommended a packed
binary to get to about 33 ms. In the browser, on the shipped 871-room index,
`JSON.parse` of `rooms-1268.json` is 2.4 to 4.8 ms at cpu 1x and 22.7 to
50.7 ms at cpu 4x. The parse is not the gate. Issue
[#29](https://github.com/EnesYilmazcode/Vacant/issues/29) should be re-scoped
before it is run, or it will measure the wrong bottleneck and conclude the
wrong thing.

### 3.3 `buildBasemap`, the number `basemap-feasibility.md` could not produce

Node has no 2D context, so that note listed this as its top open risk. It is
measurable in a real browser.

```
raster is 2693 x 2229 = 6.00 Mpx = 24.0 MB on EVERY phone shape tested
(390x844 dpr3, 375x667 dpr2, 430x932 dpr3), because MAX_RASTER_PX binds

                       GPU        software
buildBasemap cpu 1x   4.5 ms      12-18 ms
buildBasemap cpu 4x  48.2 ms      69-85 ms
buildBasemap cpu 6x       -      86-143 ms
first drawFrame 1x    0.8 ms         114 ms
first drawFrame 4x    7.3 ms         906 ms
first drawFrame 6x       -         1,612 ms
every later frame     0-0.9 ms     0-0.6 ms
```

The first blit of a 24 MB bitmap is the single largest main-thread block in the
app when the canvas is software rasterised, and it is nearly free when it is
not. On iOS the 2D canvas is GPU-backed, so the GPU column is the likely one,
but iOS also falls back to software under memory pressure, and 6.00 Mpx is a
large allocation to be making during launch. It is under Safari's documented
canvas area ceiling, so it should allocate; the risk is pressure, not the
limit. This is the number that still needs a handset.

Related: the JS heap after a full answer is only 2.0 MB used of 2.9 MB total,
measured with `HeapProfiler.collectGarbage` then `Runtime.getHeapUsage`. The
24 MB canvas does not live in the JS heap, so any memory budget written from a
heap snapshot will be wrong by an order of magnitude.

### 3.4 The whole thing can move off the main thread, and it is not hard

Rebuilt the basemap inside a `Worker` with `OffscreenCanvas`, transferring an
`ImageBitmap` back. `js/map.js` needs almost nothing changed: the drawing code
is already pure, and `drawFrame` accepts an `ImageBitmap` in place of a canvas
without modification.

```
                                    cpu 1x     cpu 4x
wall clock, start to bitmap        137.3 ms   155.8 ms
  of which, in the worker           18.6 ms    15.7 ms
  of which, transferToImageBitmap   96.4 ms   111.1 ms
main thread, first drawFrame         1.8 ms    11.0 ms
main thread, worst rAF gap during   22.3 ms    21.3 ms
```

The worst frame gap on the main thread while all of that runs is 22.3 ms, so
the page never drops below about 45 fps and the question screen stays live.
Compare with the shipped path, where the main thread is blocked for 48 to
143 ms building and another 7 to 1,612 ms blitting.

Honesty note: `Emulation.setCPUThrottlingRate` throttles the renderer's main
thread, and it is not clear it reaches a dedicated worker, so the
"in the worker" figures above are probably unthrottled and the real device
number is unknown. That does not weaken the recommendation. The point is not
that the work got faster, it is that it left the thread the user is waiting on.

---

## 4. Offline audit

### 4.1 There is no service worker

`grep -rn "serviceWorker" js/ index.html scripts/` returns nothing. There is no
`sw.js`, no `manifest.webmanifest`, and no `<link rel="manifest">`. The app is
not installable and does not work offline at all today. Issues
[#21](https://github.com/EnesYilmazcode/Vacant/issues/21) and
[#22](https://github.com/EnesYilmazcode/Vacant/issues/22) are unstarted. Every
offline claim in the research is a plan.

That matters for sequencing: ask 1, the highlight and the line, makes the map
load-bearing for a headline feature at exactly the moment the map is the file
most likely to be missing.

### 4.2 One missing file kills the app, and it is the decorative one

Blocked each data file in turn with `Network.setBlockedURLs` and drove the real
app to the point of tapping "1 hour":

```
scenario                                    result
everything available                        40 rows, correct
campus.json blocked, room index available   DEAD. buttons stay
                                            disabled, note reads
                                            "Could not load the
                                            schedule. Check your
                                            connection and reload."
rooms-1268.json blocked                     DEAD, same message
buildings.json blocked                      DEAD, same message
all of data/ blocked                        DEAD, same message
```

The brief asked what happens when the map data is not cached but the room index
is. The answer is that the user gets a wrong error message and no answer, on a
phone that is holding the entire schedule. The map is decoration for the answer
and it takes the answer down with it.

Parallelising `boot()` does not fix this. `Promise.all` still rejects. Measured
on the patched copies:

```
shipped,  campus.json blocked : buttons DISABLED, no answer possible
parallel, campus.json blocked : buttons DISABLED, no answer possible
map opt,  campus.json blocked : buttons live, 40 rows, correct
```

The fix is one line, `json('campus.json').catch(() => null)`, plus a null guard
in the basemap build and in `settle()`. Verified: with the map blocked, the app
renders a full 40-row ranked answer on a flat background. That is the state the
app was designed to have and does not.

### 4.3 `SHELL_ASSETS` as written cannot produce a working offline app

`pwa-ios.md` line 482 and issue #22 both specify:

    const SHELL_ASSETS = [
      SCOPE, SCOPE + 'index.html', SCOPE + 'app.css', SCOPE + 'app.js',
      SCOPE + 'manifest.webmanifest', SCOPE + 'apple-touch-icon.png',
      SCOPE + 'data/buildings.json',
    ];

Against the tree at `746485d`:

- `app.css` does not exist. The styles are a 4.5 KB inline `<style>` in
  `index.html`.
- `app.js` is at `js/app.js`, not `app.js`.
- `js/campus.js`, `js/engine.js` and `js/map.js` are absent from the list.
  Walking the module graph from `js/app.js` gives exactly four files; three of
  them are not precached.
- `data/campus.json`, `data/current.json` and `data/buildings-hours.json` are
  absent, and `boot()` awaits all three.

`cache.addAll` is atomic: one failed request rejects the whole call and leaves
the cache untouched. So the single wrong path `app.css` means nothing is
precached, install fails, and the app has no offline capability at all, with no
error anywhere a user or a test would see it. This is marked likely rather than
verified because the Cache API is broken in this headless profile; the
`addAll` rejection did reproduce, with the cache left empty, but in an
environment where `put` also fails.

The list should be generated from the module graph and the fetch list at build
time, not hand-maintained, and a test should assert that every file in it
exists on disk. Issue #22 already has that second half; it does not have the
first.

### 4.4 The room screen adds a URL shape, not a render path

Ask 6 opens the room screen as a route inside the existing `#sheet`, per
`room-screen.md`. That is the same document, so there is no second HTML shell
to cache and no second render path. Good.

What it does add is `?room=HH0145`. `caches.match(request)` treats a query
string as part of the key, so a cache-first navigation handler misses on every
shared link unless `{ ignoreSearch: true }` is passed or the shell path is
matched explicitly. `room-screen.md` already flags this and it is correct;
I could not re-verify it here because the Cache API is unavailable in this
profile, so it stays a spec argument rather than a measurement.

The other thing it adds is the course sidecar, which is section 2.2's dilemma.

---

## 5. Is the SVG icon work free?

No. It is 297 gz to download and 17 to 36 ms to render, every time the list
paints.

Measured the three constructions against the plain word, rendering a full list
and forcing layout, nine repetitions, median:

```
40 rows                cpu 1x    cpu 4x     delta at 4x
the word "walk"         1.7 ms   13.4 ms      baseline
<use> + <symbol>        5.8 ms   49.2 ms      +35.8 ms  (3.7x)
inline <svg> per row    5.2 ms   30.5 ms      +17.1 ms  (2.3x)
emoji U+1F6B6           3.2 ms   23.2 ms       +9.8 ms

98 rows                cpu 1x    cpu 4x
the word "walk"         3.4 ms   33.2 ms
<use> + <symbol>       10.0 ms  126.1 ms
inline <svg> per row   13.4 ms   99.8 ms
emoji U+1F6B6           5.1 ms   70.3 ms
```

`docs/research/icons-and-a11y.md` recommends `<use>` referencing a shared
`<symbol>`, on byte and tidiness grounds, and every byte argument in that note
holds. But `<use>` is the slower of the two SVG constructions at the row count
that actually ships, because each instance builds a shadow tree. Inline SVG per
row is 38% cheaper at 40 rows and 21% cheaper at 98, at the cost of about 200
extra bytes of runtime HTML per row, which is not downloaded.

Against a tap-to-rows budget currently measured at 62 to 103 ms on a throttled
main thread, +17 ms is affordable and +36 ms is noticeable. Take the cheaper
one. Nothing else in `icons-and-a11y.md` changes: it is still an inline SVG
with `stroke: currentColor`, still `aria-hidden`, still not a mask and still
not an emoji. The emoji column is here only to complete the comparison; every
reason that note gives for rejecting it stands.

The other half of the answer is to stop repainting the list. `paintList()`
rewrites `innerHTML` wholesale. Selecting a row already avoids that, correctly,
by toggling a class. Returning from the room screen must do the same, which is
what `room-screen.md` means by keeping `#list` in the DOM under `hidden`.

---

## 6. The rAF loop costs more than everything else combined

`js/app.js` `render()` calls `requestAnimationFrame(render)` unconditionally,
forever, including after the view has settled and nothing on screen is moving.
Measured over a 10 second window on the settled result screen, doing nothing,
using `Performance.getMetrics` before and after:

```
                          software raster    GPU accelerated
loop running (shipped)    6,854 ms task      824 ms task
loop stopped (control)       12 ms task        1 ms task
                             571x             824x
```

Script time is only 193 to 329 ms of that. The rest is compositing a 24 MB
texture sixty times a second onto a screen where nothing changes. On a phone,
in a hand, while someone reads a list.

This is not a nit, and it collides with ask 1. Two things have to happen
together:

- Stop the loop when `state.settled` is true and nothing is animating.
- Request exactly one frame when a row is tapped, and run the loop only for the
  duration of a camera animation.

Doing the first without the second makes the highlight never appear. Doing
neither leaves the app burning a phone battery to display a still image.

---

## 7. Mockups

The degraded state that does not exist today and has to, drawn at the 46
character grid.

### The map is missing, the schedule is not

```
+----------------------------------------------+
| <-                                           |
|                                              |
|                                              |
|          (flat background, no map)           |
|                                              |
|                                              |
|----------------------------------------------|
| No campus map on this phone yet.             |
|----------------------------------------------|
| Page Hall 110B                       % 4 min |
| till 7:50p     22 seats                      |
|----------------------------------------------|
| Sullivant Hall 247                   % 4 min |
| till 7:20p     30 seats                      |
|----------------------------------------------|
| Hagerty Hall 145                     % 4 min |
| till 4:00p, class     30 seats               |
+----------------------------------------------+

  The list is complete and correct. Only the
  picture is missing. One line says so, once.
  Today this screen shows "Could not load the
  schedule" and no rows at all.
```

### The room screen with no map polygon and no course labels

```
+----------------------------------------------+
| <-  Hagerty Hall 145                         |
|----------------------------------------------|
| Free till 4:10p                              |
| % 3 min   176 m   30 seats           seminar |
|----------------------------------------------|
| Thu 27   Fri 28   Sun 30   Mon 31   Tue 1    |
| ======                                       |
|----------------------------------------------|
| 7:00a   free                            2h35 |
|         9:35a   in use                       |
| 10:55a  FREE   <- you are in this one   5h15 |
|         4:10p   in use                       |
|         5:20p   in use                       |
| 6:15p   free                             45m |
|----------------------------------------------|
| Course names need another 24 KB. Tap to      |
| download, or leave it.                       |
+----------------------------------------------+

  This is what the room screen looks like if
  courses-1268.bin is lazy rather than
  precached. Decide which of these two screens
  ships before writing either.
```

### Where the milliseconds go, cpu 4x on LTE, GPU accelerated

```
+----------------------------------------------+
| SHIPPED, 723 ms to ready                     |
|                                              |
| net  index.html   #####                      |
| net  4 js modules       ########             |
| net  campus.json                #########    |
| cpu  parse campus                        #   |
| cpu  buildBasemap                        ### |
| gpu  first blit                            # |
| net  rooms+bld+hrs                         ##|
|                                              |
| PARALLEL + WORKER, 595 ms to ready           |
|                                              |
| net  index.html   #####                      |
| net  4 js modules       ########             |
| net  ALL SIX FILES              ###########  |
| cpu  parse rooms                          #  |
| ---- answer -----------------------------|   |
| wkr  buildBasemap          (off thread)   ###|
+----------------------------------------------+

  The saving is one serial round trip plus a
  main-thread block. It is 36 ms on wifi and
  408 ms on slow 3G.
```

---

## 8. What to change, in cost order

1. `json('campus.json').catch(() => null)` plus two null guards. One line.
   Restores a working answer when the map is missing. Verified.
2. Trim `data/buildings.json` to the referenced buildings and three fields.
   Saves 21,108 gz, 16.9% of everything.
3. Re-quantise `data/campus.json` to grid 4096. Saves 13,180 gz for 0.34 px of
   error at the tightest zoom the app shows.
4. One `Promise.all`, `buildBasemap` in an idle callback. Saves 36 to 408 ms.
5. Stop the rAF loop when settled, request one frame on tap. Saves 823 to
   6,842 ms of main-thread work per 10 idle seconds.
6. Add the `buildingKey` array. 301 gz. This is the ask-1 correctness fix and
   it is the cheapest thing in this list except the `catch`.
7. Move `buildBasemap` into a worker with `OffscreenCanvas`. Bigger change,
   removes 48 to 143 ms of main-thread block and the first-blit risk entirely.
8. Inline SVG per row rather than `<use>`. 38% cheaper list paint at 40 rows.
9. Decide the course sidecar. Precached at +18.9% of the payload, or lazy and
   the room screen is blank in a basement.
