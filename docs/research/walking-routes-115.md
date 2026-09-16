# Walking-route accuracy and provider decision

Research for [#115](https://github.com/EnesYilmazcode/Vacant/issues/115),
checked 2026-09-12. Prices and service terms can change. This is engineering
research, not legal advice.

## Update, 2026-09-16: it ships, over OSU's own sidewalks

Everything below stands as written and is the reason for what was built. The
answer turned out to be none of the providers this note compared. OSU publishes
the network itself -- layer 9 of `Data/ReferenceData_RO`, "Sidewalk Centerline",
on the same read-only server `data/buildings.json` and `data/entrances.json`
already come from, under the same attribution. It does not need a key, an
account, a request at query time or a privacy transfer, because it can simply be
downloaded and committed.

`scripts/fetch-sidewalks.mjs` builds it, `js/route.js` searches it, and
`data/walk-graph.json` is 21 KB gzipped. **[Routing over OSU's own
sidewalks](#routing-over-osus-own-sidewalks)** at the end of this note has the
build, the measurements and what is still wrong with it.

## Executive conclusion

Vacant should not integrate Google Maps as the production fix for #115 yet.
Google can calculate the routes, but the evidence does not justify adding its
cost, privacy transfer, online dependency, and map-policy constraints.

The current estimator is too simple for a precise walking-time claim. It uses one
second per straight-line metre everywhere. A 36-pair sample across six campus
areas found that Ohio State's pedestrian network is 1.49 times the straight-line
distance at the median and 2.15 times at the 90th percentile. Its routed ordering
reversed 20 of 90 strictly ordered building pairs. The error is geographic, not a
single campus-wide bias: OSU's route durations averaged only 0.70 minutes above
Vacant near Thompson Library but 7.97 minutes above Vacant near Prior Hall.

That difference reaches the product, not only a distance table. Replaying Vacant's
real schedule and ranking across 238 weekday scenarios, OSU route **geometry** at
Vacant's existing pace changed the first building 14.3% of the time and the ordered
top three 66.0% of the time. Using OSU's slower configured duration changed the
first building 18.9% of the time and the ordered top three 75.6% of the time. The
current model is consequential enough to fix, while the spread between those two
results shows why route geometry and walking pace must be chosen separately.

Google's consumer map told a milder and partly contradictory story: its rounded
times were only 0.22 minutes longer than Vacant on average, with 1.22 minutes mean
absolute error and 13 inversions among 75 strictly ordered pairs. This is not a validation of
Vacant. The near-zero average hides six-origin results ranging from 1.33 minutes
shorter around Ohio Stadium to 2.33 minutes longer around Prior Hall. The website
also rounds durations and appears to snap some coordinates to named places or
entrances, so it is unsuitable as exact ground truth.

Ohio State already operates a purpose-built pedestrian network with sidewalks,
building restrictions, and campus-specific data. The best next move is to ask OSU
FITS for sanctioned access or a redistributable graph extract, verify entrance
points, and complete physical walks. In parallel, an OpenStreetMap/Valhalla proof
of concept is the best privacy-preserving fallback. Keep Vacant's estimator as the
offline fallback, but describe it as an estimate and stop treating one global
detour constant as measured truth.

## What Vacant calculates today

`js/engine.js` uses:

```text
straight-line distance × DETOUR 1.3 ÷ WALK_MPM 78, rounded up
```

Because `1.3 / 78 minute = 1 second`, one straight-line metre always becomes one
minute per 60 metres, regardless of paths, crossings, barriers, entrances, or
campus region. The same number affects both result order and the room's “yours
for” duration. A route error can therefore both recommend the wrong building and
overstate the time available after arrival.

The destination is a building point, not a verified entrance. Existing footprint
tests find the far corner of the 46 indexed buildings is 44 metres from that point
at the median, 62 metres at the 90th percentile, and 85 metres at PAES. Routing
cannot remove this endpoint error unless the destination itself improves.

## Comparative experiment

### Sample

The sample uses six fixed, public origins chosen to cover central, north, south,
medical, athletic, and west-campus conditions:

- Ohio Union;
- Thompson Library;
- Recreation and Physical Activity Center (RPAC);
- Ohio Stadium;
- Prior Hall; and
- Veterinary Medicine Academic.

For each origin, the six nearest of Vacant's 46 room-bearing buildings were chosen
by the app's current straight-line distance. This creates 36 routes and 90
within-origin building pairs. It deliberately stresses the close alternatives for
which an ordering error matters. It is not a random sample of all trips and does
not measure indoor walking.

Three estimates were compared:

1. **Vacant:** the shipped `ceil(distance × 1.3 / 78)` calculation.
2. **Google Maps:** walking directions from a public-coordinate directions URL,
   rechecked on 2026-09-12.
   The consumer site reports rounded whole minutes and coarse distance. Raw
   Google route responses were not retained or committed because Google restricts
   storage and extraction of Routes content.[1]
3. **Ohio State campus routing:** exact route distance and duration from the public
   ArcGIS network used by `maps.osu.edu`. Its metadata identifies a pedestrian
   network, `Sidewalk_state_plane`, restrictions for buildings and absent
   sidewalks, and a speed of 170 feet per minute.[2]

Run the committed OSU comparison from the repository root:

```sh
node docs/research/walking-route-sample.mjs
node docs/research/walking-route-sample.mjs --ranking
```

The script reads Vacant's current building data, selects the sample deterministically,
and queries only public coordinates. The OSU endpoint is an observed public service,
not a documented API contract; repeat results may change as OSU updates the map.

### Aggregate results

| measure, 36 routes | Google Maps vs Vacant | OSU network vs Vacant |
| --- | ---: | ---: |
| mean signed difference | +0.22 min | +3.84 min |
| mean absolute difference | 1.22 min | 3.84 min |
| median signed difference | 0 min | +2.48 min |
| 90th-percentile absolute difference | 2 min | 8.83 min |
| Pearson correlation | 0.898 | 0.904 |
| straight-distance order inversions | 13 / 75* | 20 / 90 |
| jointly strict inversions after Vacant rounds | 6 / 64 | 11 / 74 |
| strict first choice changed | 1 / 6 | 3 / 6* |

`*` Google tied 15 pairs at its whole-minute precision, so only 75 pairs have a
strict Google order. Thompson's OSU change is a 0.02-minute flip between Townshend and Lazenby;
it should be treated as a tie, not a meaningful recommendation change.

Correlation is high because all methods agree that longer trips usually take
longer. It does not make their top-building choice interchangeable. The first
inversion row asks how often routed order contradicts the underlying straight-
distance order. The second drops every pair tied after Vacant or the provider
rounds; it is closer to the ordering signal the shipped engine currently receives.
Both are building-distance diagnostics, not the app's final room order, which also
depends on availability, usable duration, room tier, capacity, and type.

### Product-level ranking replay

The optional `--ranking` pass routes all 46 room-bearing buildings before applying
Vacant's normal 12-minute bound. This matters because selecting candidates by
straight-line distance first could hide the inversion the experiment is trying to
measure. It then runs the shipped `rank()` and `shape()` functions with the real
Autumn schedule and building hours.

The replay covers six public origins, Monday through Friday 2026-09-14 through
2026-09-18, 09:10, 12:10, 15:10 and 18:10, and 30- and 60-minute requests: 240
attempted scenarios. Two Friday-evening Veterinary Medicine scenarios have no rows
under any distance model, leaving 238 comparisons.

| change against Vacant | OSU route length at Vacant's 78 m/min pace | OSU configured duration |
| --- | ---: | ---: |
| first building changed | 34 / 238 (14.3%) | 45 / 238 (18.9%) |
| ordered top three buildings changed | 157 / 238 (66.0%) | 180 / 238 (75.6%) |
| baseline top room still shown | 234 / 238 | 221 / 238 |
| mean change in that room's usable time | -1.08 min | -3.33 min |

The geometry column is the cleaner diagnosis of #115: it replaces only the path
while retaining Vacant's pace. The configured-duration column combines path and
OSU's deliberately slower 51.8 m/min pace, so it is a useful sensitivity bound, not
a recommendation to adopt that number. A changed ordered top three includes swaps
inside the set and is therefore more sensitive than a changed first building.

The usable-time row confirms the issue's second failure mode. Even when the original
top room remains visible, correcting geometry removes about a minute from the claim
on average. Under OSU's conservative duration it removes more than three. Some
baseline rooms leave the shown result entirely after the routed walk crosses the
12-minute bound.

### Geographic pattern

| public origin | Google mean difference | OSU mean difference | main finding |
| --- | ---: | ---: | --- |
| Ohio Union | +1.17 min | +2.01 min | all six providers' routes exceed Vacant |
| Thompson Library | −0.33 min | +0.70 min | current model is closest here |
| RPAC | −0.33 min | +1.61 min | route ordering favors Cunz over PAES |
| Ohio Stadium | −1.33 min | +4.76 min | Google and OSU disagree strongly |
| Prior Hall | +2.33 min | +7.97 min | consistent underestimation hotspot |
| Veterinary Medicine Academic | −0.17 min | +6.01 min | network and pace dominate longer trips |

A global recalibration cannot remove this pattern. Increasing the detour factor to
fit Prior or Veterinary would overstate many central-campus routes. Leaving it at
1.3 understates barrier-sensitive routes.

### Geometry and pace are different errors

OSU's network duration is intentionally conservative. Its configured 170 feet per
minute is 51.8 metres per minute, or 0.86 m/s. Vacant assumes 78 metres per minute,
or 1.30 m/s, after applying the detour. A systematic review of 35 studies and
14,015 healthy adults found a mean usual outdoor speed of 1.31 m/s and a slow speed
of 0.82 m/s.[3] Vacant's pace is plausible for an unencumbered healthy adult; OSU's
is close to a deliberately slow estimate. Neither represents every student,
especially with mobility limitations, crowds, weather, or a backpack.

Holding Vacant's 78 m/min pace constant and substituting only OSU's route lengths
adds 1.19 minutes on average before UI rounding. The route-length difference has a
median of 0.48 minutes, a 90th percentile of 3.22 minutes, and a maximum of 7.19
minutes. The rest of OSU's larger duration difference comes from its slower pace.

This decomposition matters: #115 should adopt route geometry without automatically
adopting a single conservative speed. The UI could show an approximate duration
or a small band, while accessibility work can provide a separately tested slower
profile. A stopwatch alone cannot fit detour and pace independently; a walked
route also needs a measured path length.

### Examples that expose the model

- **RPAC → PAES:** Vacant says 2 minutes; OSU says 4.48. The straight-line-nearest
  building loses to Cunz under both OSU and Google routing.
- **Prior → Biological Sciences:** Vacant says 6 minutes; OSU says 18.81. The OSU
  pedestrian path is roughly three times the straight-line distance.
- **Ohio Stadium → Enarson:** Vacant says 5 minutes, Google says 3, and OSU says
  9.25. This three-way disagreement is evidence of endpoint snapping and provider
  assumptions, not evidence that one result is physically correct.
- **Thompson → Townshend/Lazenby:** all three approaches put these within seconds or
  the same rounded minute. A product should avoid reordering ties as if meaningful.

## What counts as ground truth

None of the three providers measures the actual time from a student's present spot
to a usable classroom door. A defensible ground-truth record needs:

- a fixed public start and the exact exterior entrance used;
- GPS/drawn path length and a stopwatch time, recorded separately;
- crossing waits, construction, locked doors, stairs/elevators, weather, crowding,
  and mobility profile;
- the exterior-to-room-door segment; and
- repeat walks in both directions where slopes or crossings differ.

The existing [ground-truth walk](ground-truth-walk.md) instrument already covers
door access and occupancy but has no completed physical samples. Extend it with
path length and entrance identity, then walk at least 20 of the cases above,
oversampling the Prior, Stadium, and RPAC disagreements. Until then, the research
compares routing models, not “real pedestrian routes.”

## Provider options

### 1. Google Routes

Technically, Google is straightforward. Compute Route Matrix accepts one origin
and many destinations; one origin by all 46 room-bearing buildings is 46 billable
elements, within the 625-element non-transit request limit.[4] A 20-origin
evaluation is 920 elements. Request only duration, distance, element status, and
indices with a field mask.

As of 2026-09-10, Route Matrix Essentials includes 10,000 monthly elements, then
uses progressive pricing beginning at $5 per 1,000 elements.[5]

| routed searches/month | 5 buildings | 10 buildings | all 46 buildings |
| ---: | ---: | ---: | ---: |
| 1,000 | $0 | $0 | $180 |
| 5,000 | $75 | $200 | $970 |
| 10,000 | $200 | $450 | $1,890 |
| 50,000 | $1,050 | $2,050 | $5,500 |

Dynamic Google map loads are a separate charge. Budget alerts do not cap spending;
a deployment also needs hard quotas.[6]

The larger problems are product fit:

- `WALK` remains beta, and Google requires a warning that walking routes can omit
  pedestrian paths.[7]
- A live request transfers the student's precise origin to Google, contradicting
  Vacant's current local-location privacy claim unless the app adds explicit opt-in,
  updated disclosures, and a local fallback.
- Routes shown on a map must use a Google map; attribution is required even for
  non-map display, and caching is restricted.[1] Google's current service-specific
  terms also restrict using Routes content with a non-Google map.[8] Vacant's ranked
  results sit over its custom campus map, so maintainers need written clarification
  or a UI/map redesign before production.
- Browser keys can be domain/API restricted but are still public. A proxy adds
  authentication, rate limiting, abuse controls, hosting, and a server dependency.

Google remains useful as an evaluation reference. It is not presently the lowest-
risk production provider.

### 2. Ohio State campus routing

This is the best semantic match. OSU says its upgraded campus map provides
step-by-step pedestrian directions, accessible entrances, and weekly updates to
building footprints, sidewalks, and streets.[9] The observed network explicitly
discourages routing through buildings and prohibits segments without sidewalks.[2]

But no public API licence, service-level commitment, quota, or embedding terms were
found. Do not silently depend on the ArcGIS endpoint. Ask OSU FITS whether Vacant may:

1. call it from a public application;
2. cache route distances;
3. receive the pedestrian network and entrance points under a redistributable
   licence; and
4. learn its update cadence and accessibility attributes.

A sanctioned graph extract would provide campus quality without sending live
student positions to a third party and could support offline routing.

### 3. OpenStreetMap plus an open router

An exploratory 0.02° × 0.04° Overpass extract around campus was 3.2 MB as geometry
JSON and 0.44 MB gzip-compressed when repeated on 2026-09-12. It contained 4,274
ways tagged footway, path, pedestrian, or steps and 1,018 entrance-tagged nodes.
The bounding box includes nearby streets, and JSON is not a production routing
graph, but the counts show that useful campus pedestrian detail exists. The query
used `(39.99,-83.04,40.01,-83.00)` and `out geom`; these live counts will change as
OpenStreetMap contributors edit the area.

OpenStreetMap data is reusable under the ODbL with attribution and share-alike
obligations for adapted databases.[10] Valhalla is an open-source router with
pedestrian routing and one-to-many time/distance matrices over OSM data.[11] A
campus-only Valhalla or smaller custom graph can keep queries local; it trades API
cost for graph build/update work, entrance QA, download size, and licensing review.

Do not copy paths, entrances, or durations from Google into OSM or the bundled
graph. OSM explicitly warns contributors not to import copyrighted Google Maps
data.[10]

### 4. Improved local approximation

This is the cheapest interim change:

- replace destination centroids with verified accessible/public entrances;
- fit separate region or barrier-aware factors from walked route lengths;
- treat sub-minute differences as ties;
- label the value “estimated walk”; and
- preserve external Apple/Google Directions for navigation.

It will not model every closure or crossing, but it can reduce the largest endpoint
and geographic errors while remaining instant, private, free, and offline.

## Recommended implementation decision

Use a provider-neutral route boundary, but do not turn on a network provider yet.
Prioritize evidence and reusable campus data in this order:

1. **OSU permission/data request.** A sanctioned campus graph is the best fit.
2. **Physical validation.** Walk route length and time must decide whether OSU's
   slow pace, Vacant's fast pace, or a range is appropriate.
3. **Offline OSM prototype.** Measure graph size, cold-start latency, missing
   entrances, and the same 36/20-route metrics.
4. **Local estimator improvement.** Ship verified entrances and honest estimate
   wording even if full routing is deferred.
5. **Google only if it wins materially.** Require written policy clearance,
   explicit location consent, cost ceiling, and a map/UI decision first.

## Next-steps plan

### Phase A — finish the evidence

- [ ] Expand to at least 20 fixed public origins and route all 46 buildings per
      origin; report top-1, top-3, and pairwise order changes.
- [ ] Complete at least 20 physical walks, including the largest provider
      disagreements. Record route length, outdoor time, entrance, and indoor time.
- [ ] Add uncertainty rules: report ties when estimates differ by less than one
      minute and avoid implying stopwatch precision from rounded providers.
- [ ] Verify at least one public/accessibility entrance for every room-bearing
      building.

Exit: a committed dataset with redistributable observations can say which provider
best predicts actual walks, not merely which providers agree.

### Phase B — decide the data source

- [ ] Get a written OSU FITS answer on API use or a graph/entrance export.
- [ ] Build the same test against a campus OSM/Valhalla graph.
- [ ] Document graph/download size, browser memory, cold/warm latency, update job,
      ODbL attribution, offline behavior, and missing-route rate.
- [ ] If Google remains a candidate, obtain written map-policy clarification and
      approve the privacy/consent design before creating a production key.

Exit: merge a short decision record naming the selected source and why.

### Phase C — implement behind one contract

- [ ] Add `routeTimes(origin, buildings, signal)` with the local estimator as the
      always-available provider.
- [ ] Route distinct buildings, not 425 rooms, and use the same duration for rank
      and “yours for.”
- [ ] Protect asynchronous results with generation tokens, timeout/abort, and
      origin/date/duration checks; never let a stale response reorder a new answer.
- [ ] Fall back explicitly on offline, quota, partial, timeout, or no-route errors.
- [ ] Keep external Directions for turn-by-turn navigation.

Exit: every provider failure leaves an immediate usable local result.

### Phase D — validate and launch

- [ ] Re-run the fixed benchmark in CI or a scheduled data check without collecting
      user location history.
- [ ] Launch off by default to maintainers; measure latency, fallback rate, and
      useful rank corrections without storing precise origins.
- [ ] Publish estimate, attribution, accessibility, and privacy language appropriate
      to the selected provider.
- [ ] Keep a kill switch and a hard spend quota for any paid service.

Exit: production improves physically walked top-choice accuracy enough to justify
its privacy, reliability, maintenance, and cost.

## Routing over OSU's own sidewalks

Built 2026-09-16. Reproduce every figure here with:

```sh
node docs/research/walking-graph-sample.mjs          # offline, no network
node docs/research/walking-graph-sample.mjs --osu    # the control, ~230 requests
```

### What is committed

`data/walk-graph.json` is OSU's Sidewalk Centerline layer over a campus
envelope, reduced to a routing graph and nothing else:

| pass | in | out |
| --- | ---: | ---: |
| fetched, 8 paged requests | 47,745 statewide | 15,531 in the envelope |
| noded at 0.5 m | 38,077 drawn vertices | 19,197 nodes |
| largest connected component | 15 components | 18,593 nodes, 96.9% |
| degree-2 contraction | 18,593 nodes | 6,069 junctions |
| pruned past 1,000 m of any door | 6,069 | **5,242 nodes, 7,977 edges** |

44,223 bytes on disk, **21,594 gzipped**. The shape of the pavement between two
junctions is not in the file. Only its length is, because the app quotes a walk
and never draws one -- [#44](https://github.com/EnesYilmazcode/Vacant/issues/44)
settled that the line on the map is a direction rather than a route -- and
throwing the geometry away is most of why this fits in 21 KB.

Two encoding decisions carry the rest. Nodes are written in Hilbert order and
delta-encoded, so a junction costs about two bytes. And an edge stores its
**excess over the straight line between its own two endpoints**, which the
decoder can recompute, rather than its length: a contracted sidewalk run is
nearly straight, so 5,583 of 7,977 edges store a zero. That alone takes the bare
binary from 23.3 KB gzipped to 18.4 KB without meaningfully changing its raw
size.

### What was NOT filtered, and why

The layer's `Descriptio` field looks like a walkability taxonomy and is not one.
Filtering on it was tried and scored against 220 routes from OSU's own routing
service:

| kept | mean abs err | median | pair inversions |
| --- | ---: | ---: | ---: |
| everything | 43.6 m | 28.8 m | 90 / 990 |
| without `Building` | 57.9 m | 50.3 m | 151 / 990 |
| without `No Sidewalk` | 43.7 m | 28.8 m | 91 / 990 |
| without `Warning Pad` | 359.4 m | 109.6 m | 245 / 990 |

`Building` segments are the paths that run along and into a building, not routes
through its middle; dropping 1,270 of them forces detours OSU's own network does
not make. `Warning Pad` is the tactile pad at a kerb, 1.7 m long on average, and
it is the piece that *joins* a sidewalk to its crosswalk: dropping 2,010 of them
shatters the graph from 6,069 junctions to 2,139.

`No Sidewalk` is the one that is arguably wrong to keep. It marks 34.6 km where
a road has no pavement, which is a real thing to know and a thing this graph has
no way to express, since an edge is only a length. It changes one control pair
in 990, because those stretches are not on the way to a classroom. It goes back
on the table the day the graph carries a cost per edge.

Contracted runs were also **not** split to keep edges short, which was the
obvious worry, since a standing point snaps onto the graph at a node. Pinning an
extra node every 40, 25 or 15 m makes accuracy flat-to-worse and the file 34% to
74% larger. The snap leg gets walked either way.

### Against OSU's own router

230 centroid-to-centroid walks from 24 origins -- 12 buildings and 12 points
inside the envelope. Centroids on both sides, because a centroid is the only
endpoint OSU's service can be given, and comparing a routed *door* against a
routed *centroid* would measure the doors rather than the routing.

| model | mean signed | mean abs | median abs | p90 abs | pair inversions |
| --- | ---: | ---: | ---: | ---: | ---: |
| straight line x 1.30 (shipped) | -37.3 m | 60.6 m | 43.4 m | 145.8 m | 142 / 1,125 |
| **this graph** | **-24.5 m** | **52.5 m** | **33.0 m** | **126.8 m** | **112 / 1,125** |
| straight line x 1.38 (best fit) | -6.7 m | 55.6 m | 37.2 m | 140.3 m | 142 / 1,125 |

The third row is the one that decides this. Refitting the constant to 1.38 is
cheap, needs no new file, and closes most of the gap **in magnitude**. It closes
none of it in **order**: a single multiplier is monotone, so it cannot move one
pair out of 1,125. Ordering is what picks the room on the card, and only
geometry moves it.

OSU circuity over this sample is a median 1.41 and a p90 of 1.85. A constant
near the median is right for the median walk and wrong for the tails, which is
exactly the failure the first sample in this note found around Prior Hall.

### What it changes in the product

Offline replay, no network: 169 standing points on a grid over the envelope,
every one of the 46 room-holding buildings, 4,574 rows inside `MAX_WALK`.

| | |
| --- | ---: |
| same whole minute as before | 44.9% |
| old model understated by >= 1 min | **19.0%** |
| understated by >= 2 min | 4.7% |
| understated by >= 3 min | 1.5% |
| understated by >= 5 min | 0.3% |
| offered as walkable, actually out of reach | 115 rows, 2.5% |
| excluded as too far, actually reachable | 257 rows, 5.6% |
| **nearest building changes** | **34 of 163 points, 20.9%** |
| ordered top three changes | 103 of 163, 63.2% |

The 20.9% and 63.2% are an independent reproduction of this note's own earlier
finding -- OSU's online service moved the first building in 14.3% of 238 replayed
searches and the top three in 66.0% -- from a file on disk with no network.

Note that the old model **overstated** about as often as it understated: the mean
signed error is +11.1 m. The problem was never the size of `DETOUR`. It was that
one number cannot be right in two places at once.

The worst rows are all the same shape, and it is a bridge:

| standing at | building | quoted | walks |
| --- | --- | ---: | ---: |
| 39.99875, -83.02865 | Animal Science | 9 min | **16 min** |
| 39.99875, -83.02865 | Kottman Hall | 8 min | 14 min |
| 40.00176, -83.02367 | Knowlton Hall | 10 min | 16 min |
| 40.00101, -83.02367 | Dreese Laboratories | 11 min | 16 min |

### How it behaves when it cannot answer

The graph answers or it does not, **per origin and never per building**. A
standing point more than 150 m from any centreline gets no field at all, and
every row in that ranking falls back to `straight line x DETOUR` together. A
ranking that mixed the two would be sorted on the difference between two models
that disagree by a median 33 m, which is the failure this note warned about.

There is no route request at query time, so there is no timeout, no quota, no
stale asynchronous result and nothing to reorder a list already on screen.
`js/app.js` **awaits** the file in its boot `Promise.all` rather than letting it
arrive late, and the service worker warms it, so an installed app routes with the
network off. A missing or unreadable file leaves the router null and the app does
exactly what it did before this change.

`walkMinutes` no longer contains `DETOUR`. Geometry now lives upstream in
`walkMetres` and `walkMinutes` is pace alone, which is the separation the
comparative experiment above argued for: route geometry and walking speed had to
be choosable separately, and while one constant meant both, neither could be
fitted without moving the other.

### Cost, licensing, privacy

- **Download.** 21,594 gzipped bytes, once, cached until OSU repaves. That is a
  23.1% increase in what the app fetches to answer a question, and it is the
  single largest thing this app has ever added.
- **Latency.** One Dijkstra per origin over 5,242 nodes and 7,977 edges, about a
  millisecond, then every building reads its distance out of the result.
- **Update method.** `node scripts/fetch-sidewalks.mjs`, 8 requests. Not on the
  weekly schedule clock; sidewalks do not change weekly.
- **Licensing.** OSU FITS GIS, the same source and the same attribution string
  `data/buildings.json` and `data/entrances.json` already carry, recorded inside
  the file.
- **Privacy.** Strictly better than before. The walk is computed on the device
  from a committed file, and no position is sent anywhere. The external
  **Directions** handoff from
  [#86](https://github.com/EnesYilmazcode/Vacant/issues/86) is untouched and is
  still the only thing that hands a coordinate to anybody.

### What is still wrong with it

- **It is still not ground truth.** It is one published network measured against
  another published network. [#26](https://github.com/EnesYilmazcode/Vacant/issues/26)
  is still the walk nobody has taken, and `WALK_MPM` is still unfitted. What
  changed is that there is now one error to explain rather than two.
- **It routes as the crow walks on pavement.** No stairs penalty, no slope, no
  door-open check, no construction. The layer carries `PercentSlo`,
  `Accessible`, `SurfaceMat` and `PotentialH` per segment and this graph reads
  none of them, because an edge is a length. A cost per edge is the next
  version, and it is what would make an accessible-route option possible.
- **The off-campus gate is now loose on paper.** `OFF_CAMPUS_KM` is 2.2, and the
  old analytic bound was the farthest room-holding building (1.41 km) plus
  `MAX_WALK x WALK_MPM / DETOUR` (0.72 km). A routed walk can only be longer
  than the straight line, so the correct bound is `MAX_WALK x WALK_MPM`
  (0.936 km), which is 2.346 km and sits above the gate. Five building pairs fall
  in that window, the nearest being Scott Hall at 857 m. Reaching one needs a
  route with no detour at all against a measured median circuity of 1.41, so the
  note the gate prints holds in practice. It is worth a separate issue.
- **The building the graph cannot reach is not distinguished from the building
  it can reach slowly.** `metresTo` returns null for both, and the caller falls
  back. On the committed data every one of the 50 buildings has a landing, so
  this has never fired.

## Limitations

- Thirty-six pairs from six origins are an exploratory, deliberately difficult
  sample, not a campus-wide error rate.
- Google consumer results are rounded and may snap endpoints; they are not Routes
  API output.
- OSU's public endpoint has no discovered usage contract and its configured pace is
  conservative.
- Building coordinates are not verified entrances, and no indoor path is modeled.
- No physical walk in this project has yet supplied both path length and elapsed
  time. Provider agreement must not be presented as ground truth.
- Construction, closures, weather, crowds, mobility, and direction of travel can
  change real results.

## Sources

1. [Google Routes policies and attribution](https://developers.google.com/maps/documentation/routes/policies), updated 2026-09-01.
2. [Ohio State Campusmap Routing service metadata](https://gissvc.osu.edu/arcgis/rest/services/Apps/Campusmap_Routing/NAServer/Route?f=pjson), accessed 2026-09-12.
3. Murtagh et al., [“Outdoor Walking Speeds of Apparently Healthy Adults”](https://pmc.ncbi.nlm.nih.gov/articles/PMC7806575/), *Sports Medicine* 51 (2021), DOI 10.1007/s40279-020-01351-3.
4. [Google Compute Route Matrix documentation](https://developers.google.com/maps/documentation/routes/compute_route_matrix) and [usage limits](https://developers.google.com/maps/documentation/routes/usage-and-billing).
5. [Google Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing), accessed 2026-09-12.
6. [Google Maps cost controls](https://developers.google.com/maps/billing-and-pricing/manage-costs).
7. [Google walking travel mode](https://developers.google.com/maps/documentation/routes/reference/rest/v2/RouteTravelMode).
8. [Google Maps Platform Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms), accessed 2026-09-12.
9. Ohio State FITS, [“Upgraded Campus Map Now Available”](https://fits.osu.edu/news/2025/08/19/upgraded-campus-map-now-available) and [Campus Map how-to guide](https://fits.osu.edu/kb/how-guide-campus-map).
10. [OpenStreetMap copyright and licence](https://www.openstreetmap.org/copyright).
11. [Valhalla routing overview](https://valhalla.github.io/valhalla/api/turn-by-turn/overview/) and [matrix API](https://valhalla.github.io/valhalla/api/matrix/).
