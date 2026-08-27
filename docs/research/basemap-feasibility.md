# Basemap feasibility: highlighting a building and drawing a line to it

Research note, 2026-08-27. Read-only investigation plus one new draft data file. Nothing was
filed, pushed, or committed. Every number below came from a command in
[the appendix](#appendix-commands), run today.

**The problem in one sentence:** the feature the owner asked for is already on screen, and it
points at the wrong building, because the polygons the app draws carry no identifier and the code
picks one by guessing which centroid is nearest.

**The fix in one sentence:** attach OSU's own `BLDG_NUM` to each polygon, which turns the guess
into an exact key join and costs **319 gzipped bytes**, about 0.6% of the map file already
shipping.

```
  TODAY                                    WITH THE KEY

  buildings.json                           buildings.json
    "276" -> 39.99893, -83.01824             "276" -> polygon #144
        |                                        |
        |  nearest centroid wins                 |  exact string equality
        v                                        v
  302 unlabelled polygons                  302 polygons, 87 labelled
        |                                        |
        v                                        v
  lights the PARKING GARAGE                lights Biological Sciences
  3 m closer than the real one             every time, or nothing

  measured: 2 of 86 buildings wrong,       measured: 0 wrong
  15 rooms behind a wrong highlight,       +319 gzipped bytes
  and 20 more decide by under 30 m
```

---

## 0. What changed since the last note, and why this is not the question that was asked

[ux-states.md section 4](ux-states.md) recommended **no map in v1**, on the grounds that tiles
are megabytes against a small payload. That recommendation is still correct about tiles and is
now moot about everything else, because **the map already shipped**. Commits
`a503944`, `f2c8a4d` and `6f60833` built `data/campus.json` from OSU's own GIS server, drew it on
a canvas, and made it the surface of the app. `js/map.js` already exports `drawTarget`, which
fills a footprint and strokes a dashed line from a start point to it.

So the honest framing of the owner's first ask is not "should we add a map." It is: **the map is
built, the highlight is built, and the wiring between them is a proximity guess.** The remaining
work is a correctness fix and a framing fix, not a feature.

The byte question was already answered by that decision, and the answer was expensive:

```
  BEFORE the map (gzipped)              AFTER the map (gzipped)

  rooms-1268.json     27,389            campus.json         51,823  <- new, fetched FIRST
  buildings.json      23,168            rooms-1268.json     27,389
  buildings-hours      3,621            buildings.json      23,168
  current.json           150            buildings-hours      3,621
                     -------            current.json           150
  total               54,328                                -------
                                        total              106,151

  The map is 48.8% of the entire payload and it nearly doubled it.
```

**Be explicit, because the brief asked for it: the map already doubled the payload.** Adding the
highlight does not double it again. The key that makes the highlight correct costs 319 bytes, or
0.30% on top of what is already there. Every large number in this note belongs to a decision that
has already been made and shipped.

---

## 1. The layer is live, unauthenticated, and joins exactly

`MainCampusFacades` on OSU's public ArcGIS org, documented in
[building-access.md section 7](building-access.md), is real and current.

```
GET .../MainCampusFacades/FeatureServer/0?f=json                   200, 16,457 B
GET .../FeatureServer/0/query?where=1=1&outSR=4326&f=geojson       200, 807,321 B, 0.89 s
```

| Property | Measured |
| --- | --- |
| Features | 436 |
| Geometry | 421 Polygon, 15 MultiPolygon, 519 rings, 19,618 coordinate pairs |
| Interior rings | 16 |
| `maxRecordCount` | 2000, so one request is the whole layer, `exceededTransferLimit` absent |
| Auth | none, CORS open, no key, no referrer check |
| Distinct `BLDG_NUM` | 434 numeric, plus 2 rows with the literal string `Never` |
| Duplicate keys | **zero**. Exactly one polygon per building number |

### It joins to the class API, at the full-term scale, not just a sample

`building-access.md` reported 48 of 48 on a 12-subject sample. Re-measured against the **full
harvested term index** (`data/rooms-1268.json`, 871 rooms, 96 buildings):

```
MainCampusFacades           93 of 96 buildings = 96.9%     868 of 871 rooms = 99.7%
gissvc Building layer 11    86 of 96 buildings = 89.6%     846 of 871 rooms = 97.1%
  (restricted to the shipped map bounding box)
```

Spot-checked live against `content.osu.edu/v2/classes/search?subject=cse&term=1268`, one request,
200 meetings:

```
buildingCode 279  (26 meetings) -> 0279  Dreese Laboratories
buildingCode 280  (13 meetings) -> 0280  Baker Systems Engineering
buildingCode 026  (12 meetings) -> 0026  Caldwell Laboratory
buildingCode 046  ( 1 meeting)  -> 0046  Journalism Building
buildingCode 065  ( 1 meeting)  -> 0065  Smith Laboratory
5 of 5 real codes, 57 of 57 in-person meetings
```

**Padding trap.** Three sources pad the same number three different ways: the class API and the
room index use three digits (`"026"`), `BLDG_NUM` uses four (`"0026"`), and `buildingNumber` on
the older layer uses three. Four-digit codes exist (`1018` Fontana, `1025` Timashev, `1064`
Timashev Music), so a fixed-width pad is wrong. Normalise both sides through `String(Number(x))`
and compare.

**A second trap that bites the naive version of that.** Two facade rows carry `BLDG_NUM` of the
literal string `"Never"`: `Harvey Alston Police Substation` and, memorably, one named `Non-OSU`.
If the normaliser maps a non-numeric key to `null` and you then look up the class API's `ONLINE`
pseudo-room, `ONLINE` normalises to `null` too and joins to `Non-OSU`. It looks like a successful
match. Drop non-numeric keys on both sides before building the lookup.

### It is a footprint layer, not a facade layer, and the existing caveat is wrong

`building-access.md` warned that "it is a *facades* layer, so the polygon may be a face rather
than a full footprint." Measured against the true building footprint layer on `gissvc.osu.edu`,
over the 271 shared keys with an area above 50 m2:

```
facade area / footprint area    p10 0.986   p50 1.003   p90 1.034   min 0.857   max 1.154
under 0.8: 0        over 1.2: 0
```

Median disagreement is three parts in a thousand. These are full closed footprints. That caveat
can be retired.

---

## 2. The bug the feature already has

`js/app.js` picks the polygon to light like this, and the comment is honest about it:

```js
// The map layers carry no attributes, so the footprint for a building is found
// by proximity to its known centroid.
```

`scripts/fetch-campus.mjs` requests `outFields: ''`, so `data/campus.json` ships 302 building
polygons with no identity at all. At tap time the app converts the building's `lat`/`lon` from
`buildings.json` into grid space and takes the nearest of the 302 ring-0 centroids, accepting
anything within about 120 m.

I labelled all 302 shipped polygons with ground truth by re-pulling the same GIS layer **with**
`buildingNumber` at the same simplification tolerance, then matching by centroid. Median match
distance was 0.005 m, so the labelling is exact rather than another guess. Then I replayed
`footprintNear` for every building that hosts a class this term.

```
class-hosting buildings                          96
  inside the shipped map bounding box            86
  correct polygon                                84
  WRONG BUILDING                                  2
  off the map entirely, no polygon exists        10   (25 rooms)

rooms behind a wrong highlight                   15 of 846
```

The two failures:

| Building | Rooms | What lights up instead | Centroid gap |
| --- | --- | --- | --- |
| `276` Biological Sciences Building | **14** | Parking Garage, Biological Science Building | 3 m |
| `386` Wexner Center for the Arts | 1 | Weigel Hall | 15 m |

Biological Sciences is not an edge case. It carries 14 rooms, and the app lights the parking
garage next door because that garage's centroid sits three metres closer to the coordinate in
`buildings.json` than the building's own does.

### The 2.3% failure rate understates it, because the margins are thin

For each of the 86 on-map buildings I measured the gap between the nearest polygon centroid and
the second nearest. That gap is the entire safety margin.

```
margin between 1st and 2nd nearest centroid
  p10  21.5 m      p50  42.3 m      p90  69.3 m
  under 30 m: 20 of 86        under 60 m: 67 of 86

  6.7 m   276  Biological Sciences Building      <- already wrong
  8.4 m   297  Howlett Greenhouses
 15.8 m   004  209 W Eighteenth Ave
 16.9 m   007  Mathematics Tower
 20.1 m   052  Younkin Success Center
 20.3 m  1064  Timashev Family Music Building
 21.1 m   144  Psychology Building
```

Twenty buildings are decided by less than 30 m. The median campus footprint is 1,679 m2, roughly
41 m on a side, so those twenty are decided by less than one building width. Anything that moves
a coordinate by a few metres, a GIS refresh, a new annex, a courtyard rebuilt, flips them.

### Why the coordinate cannot be trusted for this

```
the building's own lat/lon falls INSIDE its own GIS footprint   77 of 86 = 89.5%
```

One building in ten is represented by a point that is not on the building. `geocoding.md` already
found the reason and did not connect it to this: "The longitude every source reports for Dreese,
-83.0160, is Neil Avenue." Several of these coordinates are address points on a street, not
footprint centroids. An address point sitting in the road between two buildings is exactly the
input that makes a nearest-centroid match a coin flip.

**This is the finding that matters most in this note.** The owner asked for a highlight. A
highlight that is confidently wrong is worse than no highlight, because the user walks to the
parking garage.

---

## 3. What the fix costs, measured three ways

I built the real key array, with the real distinct codes, appended it to the real
`data/campus.json`, and re-gzipped. These are marginal costs against the shipped file, not
standalone sizes, because gzip shares a dictionary with what is already there.

| Option | Raw | **Gzipped** | Coverage |
| --- | --- | --- | --- |
| A. `buildingKey`, one entry per polygon, all 299 real codes | +1,890 B | **+783 B** | every building on the map |
| B. `buildingKey`, class-hosting codes only, `""` elsewhere | +1,187 B | **+319 B** | 86 buildings, 846 rooms |
| C. sparse dict `code -> polygon index`, 86 entries | +819 B | **+494 B** | 86 buildings, 846 rooms |

**Take B, 319 gzipped bytes.** It is the cheapest of the three because a parallel array of mostly
empty strings compresses almost to nothing, and it keeps the key in the same shape as the
geometry so an index lookup needs no second structure. Option A costs 464 bytes more and buys
nothing the app can use, since a building with no classes never appears in a result row.

Against the app's own budgets:

```
319 bytes is  0.62% of campus.json          (51,823 gz)
              1.16% of the room index       (27,389 gz)
              0.30% of the whole payload   (106,151 gz)
```

One building code, `246`, has two polygons on the shipped map. Light both. The array handles that
for free; a dict would silently keep one.

### The ten buildings this does not fix

Ten class-hosting buildings resolve to nothing, and it is not a data problem. Every one of them
is **outside the map's own bounding box**, which `fetch-campus.mjs` sets at a 2 km radius from
the Oval on the measured argument that 2.5 km triples the area for 1.5% more rooms.

```
358   Sherman Studio Art Center           2.10 km from the Oval     4 rooms
308   Rightmire Hall                      2.12 km                   1
309   Pressey Hall                        2.18 km                   5
222   Heffner Wetland Research            2.24 km                   3
 57   Edison Joining Technology Center    2.66 km                   2
951   1315 Kinnear Rd                     2.65 km                   1
1321  Waterman Multispecies Animal Lab    2.75 km                   6
837   Outpatient Care East                4.85 km                   1
199   Aerospace Research Center          10.03 km                   1
1019  Knowlton Executive Terminal         9.94 km                   1
                                                          total    25 rooms
```

Do not widen the box for 25 rooms, four of which are kilometres past any walk. Handle it in the
UI: when the selected building has no polygon, keep the sheet, drop the map to the distance-only
state, and say so in one line. The app already has to do that for a user who is off campus.

---

## 4. A standalone footprint file, at three quality levels

The brief asked for this measurement even though the recommendation does not use it. Here it is,
built from the raw 807 KB pull, filtered to the 93 class-hosting buildings that
`MainCampusFacades` covers, reduced step by step. Douglas-Peucker tolerances are metres on the
ground.

```
step                                              feats rings    pts     raw B    gz B
0. raw GeoJSON as served, all attributes            436   519  19618   807,337 261,694
1. drop every field but BLDG_NUM                    436   519  19618   762,181 246,641
2. + only the 93 buildings that host a class         93   135   6097   232,964  77,528
3. + outer ring only, biggest part only              93    93   5572   213,479  71,060
4. + Douglas-Peucker  2 m                            93    93   1535    65,017  20,800
5.   DP  2 m + coords at 5 dp                        93    93   1527    40,250   7,080
5.   DP  2 m + coords at 4 dp                        93    93   1246    31,958   3,864
4. + Douglas-Peucker  5 m                            93    93    941    43,176  12,927
5.   DP  5 m + coords at 5 dp                        93    93    933    27,939   4,849
5.   DP  5 m + coords at 4 dp                        93    93    888    25,236   3,176
4. + Douglas-Peucker 10 m                            93    93    765    36,702  10,589
5.   DP 10 m + coords at 5 dp                        93    93    757    24,289   4,115
5.   DP 10 m + coords at 4 dp                        93    93    726    22,180   2,840
4. + Douglas-Peucker 20 m                            93    93    574    29,679   7,986
5.   DP 20 m + coords at 4 dp                        93    93    537    18,615   2,342

6.   DP  2 m, delta ints on the campus grid          93    93   1442    12,871   5,733
6.   DP  5 m, delta ints on the campus grid          93    93    848     8,466   3,893
6.   DP 10 m, delta ints on the campus grid          93    93    672     7,068   3,311
6.   DP 20 m, delta ints on a 4096 grid              93    93    672     5,465   2,395
```

Three shippable levels, and what each is worth:

| Level | Gzipped | Deviation | Use it when |
| --- | --- | --- | --- |
| **High**, DP 2 m, campus grid | **5,733 B** | matches the basemap's own 2.22 m tolerance | the lit outline has to sit exactly on the drawn building |
| **Medium**, DP 5 m, campus grid | **3,893 B** | up to 7 m off the drawn edge | the outline is decorative and small misalignment is acceptable |
| **Low**, DP 20 m, 4096 grid | **2,395 B** | a blocky quadrilateral for most buildings | you only want a "roughly here" blob |

Coordinate rounding is doing most of the work, not simplification. Going from full float to five
decimal places at DP 2 m cuts gzip by 66%, from 20,800 to 7,080, while moving no vertex more than
about a metre. Delta-encoding onto the existing 65,535 grid beats plain rounded GeoJSON at every
tolerance, which is the same result `fetch-campus.mjs` already found.

### Do not ship any of them

The high level costs **5,733 gzipped bytes to duplicate geometry the app is already drawing**.
The building layer inside `campus.json` is 15,779 gzipped bytes of the 51,823, and every one of
these 93 footprints is inside it. Paying 5.7 KB to re-ship 93 of the 302 polygons already
downloaded is 18 times the cost of the 319-byte key that points at them.

There is a second reason, and it is visual rather than budgetary. `fetch-campus.mjs` simplifies
the building layer at `maxAllowableOffset` 0.00002 degrees, which is 2.22 m. A separate file at
DP 5 m disagrees with it by up to 7 m. At the framing this note recommends, the screen shows
between 220 m and 840 m across a 390 px phone, which is **0.57 to 2.16 metres per pixel**. A 7 m
disagreement is 3 to 12 pixels of red outline floating off the grey building underneath it. It
would read as a rendering bug, and it would be one.

The standalone file is written to `data/footprints.draft.json` anyway, as the fallback if
`campus.json` ever stops carrying buildings. It is **15,127 bytes raw, 6,897 gzipped**, and it
holds both blocks:

```
data/footprints.draft.json          15,127 B raw     6,897 B gzipped
  footprints        93 buildings    12,871 B raw     5,733 B gzipped   (the fallback)
  campusBuildingKey 302 entries      1,132 B raw       266 B gzipped   (THE BLOCK TO SHIP)
```

The `campusBuildingKey` block measures 266 bytes alone and 319 bytes as an addition to
`campus.json`. Both numbers are real. The 319 is the one that matters, because that is what the
shipped file grows by.

---

## 5. The render: canvas, and it already is

Canvas, as shipped. The alternatives lose on measured grounds.

```
  what has to be drawn, counted from data/campus.json
  ---------------------------------------------------
  street rings      898  stroked
  landscape rings   426  filled
  building rings    362  filled AND stroked
  water rings        11  filled
  -----------------------
  1,697 paths, 13,258 coordinate pairs
```

**Inline SVG** would mean 1,697 DOM nodes carrying 13,258 coordinate pairs. It would win on
theming, since a stroke on a class is a one-line CSS change and the highlight could be a single
fill swap with no redraw at all. It loses on the flyover: `js/app.js` runs a continuous
`requestAnimationFrame` loop that changes the view every frame, and a 1,697-node SVG subtree
being transformed and hit-tested at 60 fps on a phone is the thing canvas exists to avoid. The
current design renders once into an offscreen bitmap and blits it with a transform, so the
per-frame cost is one `drawImage` no matter how complicated campus is.

**WebGL** is not worth an API surface and a context-loss handler for 1,697 static paths.

**Canvas costs, measured** on node 22 on this machine, so treat these as a floor and re-measure
on a phone:

```
campus.json   JSON.parse                 p50 1.40 ms   p95 2.32 ms
decode EVERY shape in every layer        p50 0.39 ms   p95 0.92 ms
footprintIndex build, all 302 polygons   p50 0.33 ms   p95 1.98 ms
decode ONE polygon, keyed lookup         p50 0.00 ms
```

The geometry math is free. What is not free is `buildBasemap`, which strokes and fills those
1,697 paths into an offscreen canvas, and I cannot measure that without a real 2D context. It has
to be timed on device before this is called settled. What can be computed is how big that canvas
is:

```
MAX_RASTER_PX is 6,000,000, so on every phone shape tested the cap binds, not the ideal:

  dpr 3, 390 css px    2693 x 2229 = 6.00 Mpx = 24.0 MB, magnified 1.88x at the settled span
  dpr 2, 390 css px    2693 x 2229 = 6.00 Mpx = 24.0 MB, magnified 1.25x
  dpr 2, 360 css px    2693 x 2229 = 6.00 Mpx = 24.0 MB, magnified 1.15x
```

Two things follow. A 24 MB offscreen bitmap is a real allocation on an iPhone and is the first
thing to look at if the map ever fails to appear on an older device. And `app.js` already clamps
`dpr` to 2 before calling `pixelsPerGridFor`, so the dpr-3 row never happens in practice. The
constant `MAX_RASTER_PX` and that clamp need to be read together, because right now they live in
two files and either one alone is misleading.

**Theme.** `PALETTE` in `js/map.js` is a hardcoded dark set with no light variant, so the map is
not theme-aware today. Making it so is cheap but not free: the basemap is baked into a bitmap, so
a theme change means calling `buildBasemap` again. Listen for the `prefers-color-scheme` media
query and rebuild once on change. Never per frame.

### Lazy loading: the brief's recommendation is right and the app does the opposite

The brief suggests loading the map only when a row is tapped. That is the correct instinct, and
the app currently does the reverse in the strongest possible way. From `js/app.js`:

```js
const [campus, current] = await Promise.all([json('campus.json'), json('current.json')]);
state.basemap = buildBasemap(campus, pixelsPerGridFor(campus, shorter, dpr));

const [rooms, buildings, hours, located] = await Promise.all([ ... ]);
```

**`campus.json` is fetched and rasterised before the room index is even requested.** The two
fetch groups are serialised, so the 51,823-byte map gates the 27,389-byte file that produces the
answer. The 33 ms cold-launch target in `query-engine.md` is not merely missed, it is not being
aimed at: the first answer now waits on the largest file in the app plus a full canvas
rasterisation.

Two changes, neither of which touches the map's design:

1. **Start every fetch at once.** Move `rooms`, `buildings` and `buildings-hours` into the first
   `Promise.all`. They do not depend on `current.json` except for the room filename, which can be
   taken from the cached previous value and corrected on a miss. That alone removes a full round
   trip from the critical path.
2. **Build the basemap after the answer, not before it.** The flyover can run against a flat
   background fill for its first frames and nobody can tell. Call `buildBasemap` in an idle
   callback, or immediately after the `vacant:ready` mark.

The perceived cost of deferring is close to zero, because the map is not what the user is waiting
for. They are waiting for a room name. The cost of not deferring is that the room name waits on a
24 MB rasterisation.

**What tapping a row costs once the map is loaded: one frame.** `render()` is an unconditional
`requestAnimationFrame` loop, so a tap that sets `state.selected` shows the highlight on the next
frame, about 16 ms. The keyed lookup replaces a 0.33 ms index build with a 0.00 ms array index,
so the fix makes the tap cheaper rather than more expensive. That same always-on loop deserves a
separate look, since it repaints 60 times a second forever after the view stops moving, which is
battery with no visual payoff.

---

## 6. What the user sees

Layers, back to front. Everything except the target is already implemented in `js/map.js`.

```
  campus, dark, static, blitted from the offscreen raster
  every other building, filled flat with a 1.5 m edge stroke
  the target building, filled with a 22% red wash, stroked solid red
  a DASHED red line from your dot to the target centroid
  a walk-time chip at the midpoint of the line
  your dot, blue, with its accuracy radius as a translucent halo
```

Three choices worth stating.

**No streets beyond what is already drawn.** The street layer is 24,906 gzipped bytes, 48% of
`campus.json`, and it is the single most expensive layer in the app. It is already paid for and
it makes campus legible, so keep it. But do not add labels, names, or a second street source. It
is scenery, not navigation.

**Other buildings stay as flat fills, not highlights, in the selected state.** They are the only
thing that makes the target read as a target. `PALETTE.building` at `#28313d` against
`PALETTE.target` at `#ff4d3d` is already the right contrast relationship.

**The user's dot is drawn hollow when the fix is a guess.** `drawYou` already does this and it is
the right call. It is also the piece most likely to be lost in a redesign, so it is worth writing
down: the point the app is least sure of must not be the most confident-looking thing on screen.

### The framing rule is currently wrong, and it is measurable

`settle()` centres the view on the **user** at a **fixed** `SETTLED_SPAN` of 0.28. Against the
shipped bounding box:

```
map bounding box            2,678 m east-west by 2,215 m north-south
settled span 0.28 shows       620 m across the short screen axis, so 310 m from the centre
the engine's MAX_WALK is       12 minutes = 720 m of straight line at 78 m/min with a 1.30 detour
```

**The visible radius is 310 m. The search radius is 720 m.** More than half of what the engine is
allowed to return cannot be on screen. Measured from the Ohio Union, the peak scenario in the
README:

```
buildings within a 12 min walk of the Ohio Union      46,  505 rooms
  further than 310 m from a user-centred view         38,  414 rooms
```

**Tapping 8 of the 46 shows you the building. Tapping the other 38 draws a line off the edge of
the screen at a target you cannot see.**

The fix is to frame the pair, not the user. Centre on the midpoint of the two endpoints and
compute the span from their separation:

```js
// Ground metres the short screen axis must cover, with breathing room at both ends.
const PAD_M = 70;
const NS_M  = (bbox[3] - bbox[1]) * 111000;         // 2215 m for the shipped box
const screenAspect = Math.max(w, h) / Math.min(w, h);

const need = Math.max(
  Math.abs(dxMetres) + 2 * PAD_M,
  (Math.abs(dyMetres) + 2 * PAD_M) / screenAspect,
  180,                                              // floor: never zoom past 180 m across
);
const span = Math.min(need / NS_M, 0.40);           // ceiling: never wider than 0.40
const cx = (youX + targetX) / 2, cy = (youY + targetY) / 2;
```

Measured over every qualifying room from three different origins, that rule needs:

```
                                 required span
                          p10     p50     p90     max    fits in the fixed 0.28
from the Ohio Union      0.103   0.213   0.337   0.356          63% of targets
from Dreese Lab          0.090   0.163   0.300   0.342          83%
from the Olentangy bank  0.172   0.255   0.354   0.380          52%
```

A 0.40 ceiling covers every case measured with room to spare, and the median selection lands
tighter than today's fixed span, so most taps zoom **in** rather than out. That preserves the
intent behind `SETTLED_SPAN` being smaller than `FLYOVER_SPAN`, which `js/map.js` records as a
deliberate correction. Animate the span change over roughly 250 ms so the frame move reads as the
map following the tap.

### Mockups

Selected state, map with the list peeking. 46-character interior, matching `ux-states.md`.

```
+----------------------------------------------+
| <-                                           |
|                                              |
|                          .-----.             |
|                          |#####|  Dreese     |
|                          |#####|             |
|                          '-----'             |
|                            /                 |
|                     4 min /                  |
|                          /                   |
|              .---.      /                    |
|              |   |     /                     |
|              '---'    /                      |
|                     ( o )  you               |
|                                              |
|                                              |
|----------------------------------------------|
| Dreese 357          [w] 4 min   yours 2h06   |
| Baker Systems 120   [w] 6 min   yours 3h14   |
| Caldwell 177        [w] 7 min   yours 1h48   |
+----------------------------------------------+

ALL WIDTHS OK
  <-    back arrow, top left, replaces "change"
  [w]   the walking-person icon, replaces the word "walk"
  #     the target building, filled and stroked
  /     the dashed line, direction only
  ( o ) your dot, the ring is the accuracy halo
  no term label, no duration chip bar, no "free for 30 min"
```

Room detail, the second screen the owner asked for. It confirms the sheet already drawn in
`ux-states.md` and adds the map header.

```
+----------------------------------------------+
| <-              Dreese 357                   |
|----------------------------------------------|
|            .-----.                           |
|            |#####|         [w] 4 min         |
|            '-----'         320 m             |
|              /                               |
|            ( o )           direction only    |
|----------------------------------------------|
| free till 1:55p, that is 1h38                |
| 46 seats, classroom                          |
|----------------------------------------------|
| TODAY IN THIS ROOM                           |
|   8:00a  CSE 2221                            |
|   9:10a  CSE 2231                            |
|  11:10a  free                                |
|   1:55p  CSE 3901                            |
|----------------------------------------------|
| [      Open in Maps      ]                   |
|----------------------------------------------|
| Class schedule only. Doors may be            |
| locked, and clubs book rooms too.            |
+----------------------------------------------+

ALL WIDTHS OK
```

When the building has no polygon, one of the 10 off-map cases, the map block collapses and the
sheet keeps working:

```
+----------------------------------------------+
| <-           Pressey Hall 130                |
|----------------------------------------------|
| [w] 22 min       north-east      1.7 km      |
| Too far out for the campus map.              |
|----------------------------------------------|
| free till 4:10p, that is 2h55                |
| 30 seats, classroom                          |
+----------------------------------------------+

ALL WIDTHS OK
```

---

## 7. What this map cannot do, and how to say so

**It is a direction, not a route.** I measured how badly the straight line lies, by intersecting
every you-to-target line against the 4,293 building segments the app actually draws, from four
realistic origins, for every room inside the 12 minute radius:

```
origin              targets   line crosses >= 1 building   median crossed   max   crosses water
Ohio Union               45      45  = 100%                      5           9         0
Dreese Lab               59      59  = 100%                      4          11         2
18th Ave Library         73      73  = 100%                      3          10         5
RPAC                     40      33  =  82%                      3           8        10

ALL                     217     210  =  97%                      4          11    17 = 8%
```

**97% of these lines pass through at least one building, median four, worst case eleven.** Eight
percent cross the Olentangy. A solid line drawn on a map is read as a path, and this one is a
path through four buildings.

Three things make that honest, and two of them are already done:

1. **Keep the line dashed.** `drawTarget` already sets `[7, 7]`. The code comment says it reads
   "as a direction rather than a route through doors," which is exactly right. Do not let a
   redesign make it solid.
2. **Label the chip with the walk estimate, not the crow-flies distance.** The label is already
   `"4 min walk"`, which is the engine's `Math.ceil(metres * 1.30 / 78)` and therefore already
   carries the detour factor. Showing raw metres next to a straight line would invite someone to
   divide one by the other and conclude the app is slow.
3. **Say the word once, in the detail sheet, not on every row.** "Direction, not a route" under
   the map block. One line. It does not belong on the list screen, where the owner asked for less
   text and where it would repeat on every row.

The one thing not to do is add routing. `query-engine.md` settled this: the flat 1.30 detour
factor already absorbs 96% of river crossings, the median river detour is 1.04x, and the worst
case anywhere is 1.70x. A router would be real work to correct something smaller than the
uncertainty in the walk speed constant, which that note is explicit is a guess. The line is
allowed to be a straight line as long as it does not dress up as a path.

---

## 8. The cheaper alternative, costed honestly

The alternative is what `ux-states.md` recommends: no basemap, a bearing arrow and a distance in
the detail sheet, plus an "Open in Maps" hand-off.

**It is no longer the cheap option, because the expensive thing already shipped.**

```
                                    bytes gz     what it answers

  bearing arrow only                       0     "which way", if you have a compass
  + the map, already shipped          51,823     "which way" and "which building"
  + the key that makes it correct        +319     "which building", correctly
```

Costs of the arrow that `ux-states.md` does not price:

- **A compass arrow needs device orientation events, which on iOS need a second permission
  prompt** triggered from a user gesture. `pwa-ios.md` already documents how fragile the first
  permission prompt is in standalone mode, including an iOS 26 case where geolocation returns
  `PERMISSION_DENIED` in an installed app that works fine in Safari. Adding a second prompt on
  that foundation is a real risk to the one-tap promise.
- **Without the compass it degrades to a north-relative arrow** that the user has to mentally
  rotate while standing outside in the cold. That is worse than a picture of two shapes with a
  line between them.
- **It does not answer "which building".** The strongest argument in `ux-states.md` for a map was
  that a first-year does not know where Mendenhall is, and an arrow does not tell them.

**Recommendation: keep both.** The arrow costs nothing and works when the building is off the map
or the fix is bad, and the 10 off-map buildings need exactly that fallback. Ship the highlight as
the primary and keep a bearing line in the detail sheet as the degraded state. Do not remove the
map to save bytes that have already been spent.

---

## 9. Recommendation

**Ship the highlight. It is 319 gzipped bytes and it fixes a bug that is already on screen.**

In order:

1. **Add `buildingKey` to `data/campus.json`.** Change `outFields: ''` to
   `outFields: 'buildingNumber'` in `scripts/fetch-campus.mjs`, for layer 11 only, and emit a
   parallel array aligned to `layers.building`, blank for any polygon whose code does not host a
   class this term. Costs 319 gzipped bytes. The array is already built and sits in
   `data/footprints.draft.json` under `campusBuildingKey` if it is wanted before the fetcher
   changes.
2. **Replace `footprintNear` with an index lookup.** Delete the 302-polygon centroid index and
   the 120 m proximity threshold. Light every polygon carrying the code, since building `246` has
   two. When the code is absent, return `null` and let the sheet fall back.
3. **Add a build guard, in the spirit of the ones already in `scripts/`.** Refuse the build if
   fewer than 80 class-hosting buildings resolve to a polygon. Today's number is 86 of 96, and
   the ten misses are all outside the bounding box and stable. A drop below 80 means the GIS
   layer or the padding changed, and a silent drop means the app goes back to lighting the wrong
   building with no visible symptom.
4. **Frame the pair, not the user.** Midpoint centre, computed span, floor 180 m, ceiling 0.40,
   animated over about 250 ms. Without this the fix is invisible for 38 of 46 targets from the
   Union, because the target is off screen.
5. **Get `campus.json` off the critical path.** One `Promise.all` for all five files, and build
   the basemap after the ready mark rather than before the room index is requested.
6. **Add the light palette and rebuild the raster on theme change.** Once, on the media query
   event, never per frame.
7. **Do not ship `data/footprints.draft.json`.** Keep it as the fallback if `campus.json` ever
   stops carrying buildings.

What I recommend against, and why:

| Option | Verdict |
| --- | --- |
| A separate footprints file at any quality | **No.** 5,733 gz to duplicate geometry already shipped, and a 2 to 12 pixel outline misalignment against the basemap under it |
| Widen the map bounding box to catch 10 more buildings | **No.** 25 rooms, four of them kilometres past any walk, against an area increase `fetch-campus.mjs` already measured and rejected |
| Raster tiles | **Still no.** `ux-states.md` was right and nothing here changes it |
| A walking router | **No.** `query-engine.md` measured the flat 1.30 factor absorbing 96% of the worst case |
| Drop the map and ship only the arrow | **No.** The bytes are already spent, and an iOS compass prompt is not free |

---

## 10. Corrections to the existing research

| What an existing note says | What I measured |
| --- | --- |
| `ux-states.md` section 4: "no map, no tiles" | Correct about tiles, overtaken about the map. The map shipped in `f2c8a4d` and is 48.8% of the payload. The live question is whether the highlight on it is correct, and today it is not |
| `building-access.md` section 7: "it is a *facades* layer, so the polygon may be a face rather than a full footprint" | Not true. Median facade-to-footprint area ratio is 1.003 over 271 shared keys, p10 0.986, p90 1.034 |
| `building-access.md` section 7: "some buildings may appear as several rows. Verify before trusting the centroid" | Not in this layer. Zero duplicate `BLDG_NUM` across 434 numeric keys. The older `gissvc` layer 11 does have one duplicate, code `246` |
| `building-access.md`: `BLDG_NUM` joins at 100% | 96.9% of buildings and 99.7% of rooms against the full term index rather than the 12-subject sample. The 3 misses carry 1 room each |
| `query-engine.md`: cold launch target of 29 to 38 ms | Not being aimed at. `campus.json` is fetched and rasterised before `rooms-1268.json` is requested, so the first answer waits on the largest file plus a 24 MB canvas |
| `js/app.js` comment: "The map layers carry no attributes, so the footprint is found by proximity" | Accurate, and the attributes are available from the same request for 319 gzipped bytes. `outFields: ''` in `fetch-campus.mjs` is where they are dropped |
| `js/map.js`: `SETTLED_SPAN = 0.28` as the tightest view the app shows | It shows 620 m across the short axis against a 720 m search radius, so 38 of 46 Union targets fall off screen. The span has to be computed per selection |

---

## 11. Open questions

1. **`buildBasemap` on a real phone.** 1,697 paths into a 6 megapixel canvas is the one cost in
   this feature I could not measure. Time it on an actual iPhone before calling the critical-path
   fix done.
2. **24 MB of canvas on an older device.** `MAX_RASTER_PX` is 6,000,000 and `app.js` separately
   clamps dpr to 2. Whether iOS ever refuses that allocation, and what the app does when it
   happens, is untested.
3. **Licence.** `geocoding.md` flags that the OSU GIS layer carries no licence statement on the
   service. That question now covers geometry the app redistributes, not just coordinates, so it
   matters more than it did. `data-osugis.opendata.arcgis.com` is still the place to look.
4. **`MainCampusFacades` versus `gissvc` layer 11 as the long-term source.** Facades covers 7
   more class-hosting buildings and lives on the modern ArcGIS Online org rather than a
   university-hosted server. The app currently pulls from `gissvc`. They agree to within 0.3% on
   area, so this is an availability question, not a data question. Worth a decision before the
   next term rebuild.
5. **Does `buildingNumber` stay stable across a GIS refresh?** The whole fix is a key join. A
   guard on resolved-building count catches a break, but only at build time.
6. **The always-on `requestAnimationFrame` loop.** It repaints 60 times a second forever, with
   nothing moving after the view settles. Out of scope here, but it is on the same screen.

---

## Appendix: commands

Every number above came from one of these. Four external HTTP requests in total, sequential, 90
to 180 second timeouts, well inside the 40 request cap.

```bash
# 1. The layer is live and unauthenticated.
curl -s "https://services6.arcgis.com/PVrqnRx8k1Ldjgw0/arcgis/rest/services/MainCampusFacades/FeatureServer/0?f=json"
#   -> 200, 16,457 B, 436 features, maxRecordCount 2000, polygon, 14 fields

# 2. Every polygon, in WGS84, one request.
curl -s -G "https://services6.arcgis.com/PVrqnRx8k1Ldjgw0/arcgis/rest/services/MainCampusFacades/FeatureServer/0/query" \
  --data-urlencode "where=1=1" \
  --data-urlencode "outFields=BLDG_NUM,BLDG_NAME,BldgNumber,ComName" \
  --data-urlencode "returnGeometry=true" --data-urlencode "outSR=4326" \
  --data-urlencode "f=geojson" --data-urlencode "resultRecordCount=2000"
#   -> 200, 807,321 B, 0.89 s, 436 features, 19,618 coordinate pairs, 16 interior rings

# 3. Ground truth for the mishighlight test: the SAME layer campus.json was built from,
#    at the SAME simplification, but with the key kept.
curl -s -G "https://gissvc.osu.edu/arcgis/rest/services/Data/FacilitiesStreets_RO/MapServer/11/query" \
  --data-urlencode "where=1=1" \
  --data-urlencode "geometry=-83.035762,39.989561,-83.004273,40.009518" \
  --data-urlencode "geometryType=esriGeometryEnvelope" \
  --data-urlencode "spatialRel=esriSpatialRelIntersects" --data-urlencode "inSR=4326" \
  --data-urlencode "outFields=buildingNumber,BLDG_NAME,BLDG_NUM" \
  --data-urlencode "returnGeometry=true" --data-urlencode "outSR=4326" \
  --data-urlencode "maxAllowableOffset=0.00002" --data-urlencode "orderByFields=OBJECTID" \
  --data-urlencode "resultRecordCount=2000" --data-urlencode "f=json"
#   -> 200, 137,946 B, 309 features, 305 distinct buildingNumber, one duplicate (246)

# 4. Live class API spot check on the join.
curl -s -G "https://content.osu.edu/v2/classes/search" \
  --data-urlencode "q=" --data-urlencode "campus=col" --data-urlencode "term=1268" \
  --data-urlencode "subject=cse" --data-urlencode "p=1"
#   -> 200, 456,276 B, 200 meetings, 5 real buildingCodes, all 5 join

# Everything below is local, against the repo's own shipped data.

python -X utf8 err2.py    # replay footprintNear against ground truth
#   -> 84 correct, 2 WRONG BUILDING, 10 off-map, 15 rooms behind a wrong highlight
python -X utf8 err3.py    # margin between 1st and 2nd nearest centroid, and containment
#   -> p50 42.3 m, 20 under 30 m; coordinate inside its own footprint 77/86 = 89.5%
python -X utf8 foot2.py   # the quality-level table, raw and gzip -9 at every step
python -X utf8 keycost.py # marginal cost of the key on the real campus.json
#   -> A +783 gz, B +319 gz, C +494 gz
python -X utf8 cross.py   # how often a straight line passes through a building
#   -> 210/217 = 97%, median 4, max 11, 8% cross water
node bench.mjs            # parse and decode timings
#   -> campus.json parse p50 1.40 ms; decode every shape p50 0.39 ms

# File sizes, raw and gzip -9.
python -X utf8 -c "import gzip,sys;[print(p,len(open(p,'rb').read()),len(gzip.compress(open(p,'rb').read(),9))) for p in sys.argv[1:]]" \
  data/campus.json data/rooms-1268.json data/buildings.json data/buildings-hours.json data/footprints.draft.json
```

Scratch scripts and the raw GIS pulls are in
`C:\Users\galax\AppData\Local\Temp\claude\C--Users-galax-Downloads-Projects\ff09d3ae-8ad6-40bb-942d-f7cf03ac4117\scratchpad`.
