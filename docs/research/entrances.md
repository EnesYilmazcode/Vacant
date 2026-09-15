# Walking to a door instead of to the middle of a building

Research and implementation note for the endpoint half of
[#115](https://github.com/EnesYilmazcode/Vacant/issues/115), measured
2026-09-15 on the shipped Autumn 2026 index.

Reproduce every figure below from the repository root:

```sh
node docs/research/entrances-sample.mjs
node docs/research/entrances-sample.mjs --ranking
```

No network. It reads the committed data and calls the shipped `rank()` and
`shape()`.

## What was wrong

`data/buildings.json` carries one point per building, and that point is a
polygon centroid. `data/buildings.draft.json` has said so in a note since the
layer was first pulled: "The published Latitude/Longitude is a polygon CENTROID,
not an entrance." Every walk Vacant quoted ended there, which is to say inside a
wall.

`js/engine.js` already priced the consequence in the comment above `DETOUR`, and
`scripts/test/walk-bias.test.mjs` kept the figure honest: the far corner of a
shipped building sits a median 44 m from its published point, 62 m at the 90th
percentile, and 85 m at PAES. At the engine's constants a metre is a second, so
that is up to 85 seconds of walking nobody had priced.

That figure conflated two different errors, and this note separates them:

- the **outdoor** error, the difference between the middle of a building and the
  door you actually walk to. That is what this change removes.
- the **indoor** error, the difference between the door and the room. Untouched,
  and now the only thing the 44/62/85 m figure describes.

## The source

Ohio State publishes the doors, in the same read-only data family the building
table already comes from:

```
https://gissvc.osu.edu/arcgis/rest/services/Data/ReferenceData_RO/MapServer/10/query
```

2,181 points, carrying `Accessible`, `Automated`, `Ramp`, `Button`, `Status` and
a free-text `Description` per door. Same attribution as the building layer:
Facilities Information and Technology Services, GIS.

`scripts/fetch-entrances.mjs` writes `data/entrances.json`, and
`scripts/fetch-buildings.mjs` folds the offsets into
`data/buildings-<term>.json`, which is the file the app boots with.

### The join is not the obvious one

The layer carries two building-code fields and neither is the key the rest of
the repository uses. `buildingNumber` is populated on 42 of the 2,181 points and
null on the rest. `BLDG_NUM` is populated on nearly all of them and zero-padded
to four digits. `data/buildings.json` and the room index are keyed on the
three-wide form.

`data/footprints.draft.json` already recorded the fact — "BLDG_NUM is zero padded
to 4, buildingNumber is padded to 3" — and it is the whole difficulty:

| read | class-hosting buildings resolved |
| --- | ---: |
| `BLDG_NUM` literally | 2 of 46 |
| `buildingNumber` literally | 0 of 46 |
| either, stripped of padding, used as the key | 21 of 46 |
| either, stripped to **compare**, canonical key returned | **45 of 46** |

The third row is the trap, and it is the one a careful person writes. `"0279"`
stripped is `"279"`, the table has `"279"`, so Dreese resolves and the
normalisation looks correct. `"0003"` stripped is `"3"`, the table has no `"3"`
because it is keyed `"003"`, so Agricultural Administration vanishes — along
with every other building whose code has a leading zero. Just under half the
campus resolves, nothing throws, and the output is a plausible-looking file.
Strip to compare; hand back the key the building table actually uses.

The join was then checked rather than assumed: every resolved building's GIS
name matches the index name for that code — Arps Hall against "Arps, George F,
Hall", Dreese Laboratories against "Dreese Laboratories, Erwin E" — and
`scripts/fetch-entrances.mjs` refuses to write the file if any door lands more
than 200 m from the building it claims. The furthest real door is 72 m out.

### `Description` is not a point type

The values read like a taxonomy — `Building`, `Sidewalk`, `Stairs`,
`Parking Lot`, `North Entrance` — so the obvious move is to keep the
entrance-shaped ones and drop the rest. That would have been wrong, and quietly:
it deletes 78 of the 217 doors on shipped buildings, and for several buildings
every door it has.

Measured as distance to the building outline drawn in `data/campus.json`:

| `Description` | doors | median | p90 | max |
| --- | ---: | ---: | ---: | ---: |
| named entrance | 82 | 0.7 m | 2.9 m | 17.8 m |
| `Building` | 57 | 0.7 m | 1.5 m | 3.6 m |
| `Sidewalk` | 51 | 0.5 m | 1.6 m | 3.1 m |
| other | 18 | 0.8 m | 1.3 m | 2.4 m |
| blank | 9 | 0.5 m | 2.3 m | 2.3 m |

A `Sidewalk` point sits half a metre from the wall, not out on the pavement.
They are all doors; `Description` says what the door faces or how you reach it.
The single point not within a few metres of a wall is a Knowlton Hall entrance
17.8 m inside its own drawn outline, on a building with a covered ramp running
up through the middle of it.

## Coverage

44 of the 46 buildings the Autumn 2026 index references have at least one
standing door, carrying 217 doors between them.

| | |
| --- | ---: |
| Points in the layer | 2,181 |
| No building code | 519 |
| Not built yet (`Under Construction`, `Pending`) | 23 |
| On a building outside the 612-building index | 276 |
| The same door recorded twice | 37 |
| **Written to `data/entrances.json`** | **1,326 on 302 buildings** |
| Of those, on class-hosting buildings | 217 on 44 |

The two without doors fall back to the published point, which is what every
building did before this existed:

- **276 Biological Sciences Building** — absent from the entrance layer.
- **1025 Theatre, Film and Media Arts Building** — all four of its doors are
  `Under Construction`, which is true; the building is being rebuilt.

The four non-teaching buildings in the subset all have doors, so 48 of its 50
rows carry one.

A `Status` of `null` is kept rather than dropped. 20 doors on shipped buildings
have one, they sit on the outline like every other point, and reading unknown as
absent would delete them.

## What it costs

The doors ship as whole-metre east/north offsets from the building's own point,
not as coordinate pairs. Every offset is inside the 72 m the furthest real door
sits from its building, so each is a number under three digits.

| `data/buildings-1268.json`, same 50 buildings | gzipped |
| --- | ---: |
| Without doors | 1,616 B |
| **With 237 doors as offsets** | **2,431 B** |
| With the same doors as coordinate pairs | 5,139 B |

815 bytes. Whole metres is a 0.7 m worst-case rounding error, half a second at
`WALK_MPM`, against doors the GIS layer places to about 10 cm.

The committed file actually *shrank*, 2,563 B to 2,431 B, but that is not a
discount on the doors. See the note on the stale subset at the end.

The subset is 50 buildings rather than 46 because four of the picker's six
shortcut origins host no class; see the last section.

## What it changes

`js/engine.js` gains `approachMetres(origin, building)`, which adds the metre
offsets onto the origin-to-building vector in the same equirectangular plane
`distanceMetres` already works in, and takes the minimum. The only approximation
is the cosine term being evaluated at the building rather than at the door;
measured over every shipped door from four origins, the worst disagreement
against a direct `distanceMetres` call to the door's own coordinate is **5 mm**.

Every screen that quotes a walk uses it — the ranking, the room screen, the
repaint while you walk, and the buildings list — so the two screens still agree,
which is the property `README.md` makes a point of.

### Distances, six public origins against 46 buildings

| | |
| --- | ---: |
| Pairs | 276 |
| Mean change | **-23.3 m** |
| Median change | -23.1 m |
| 10th / 90th percentile | -38.8 m / -8.1 m |
| Shorter / longer | 262 / 10 |
| Lost a whole walk minute | **108** |
| Gained a whole walk minute | 2 |
| Building-order inversions | **111 of 6,210 pairs** |

The inversions are the point. A change that shortened every walk by the same
amount would move no rows at all; 111 pairs come out in a different order
because the door that faces you is not in the same place as the middle of the
building.

### The card, 238 replayed searches

Six origins, Monday to Friday 2026-09-14 to 2026-09-18, at 09:10, 12:10, 15:10
and 18:10, asking for 30 and 60 minutes. 240 attempted; two Friday-evening
Veterinary Medicine scenarios return nothing under either model.

| | |
| --- | ---: |
| First building changed | 7 / 238 (**2.9%**) |
| First room changed | 11 / 238 (**4.6%**) |
| Ordered top three changed | 92 / 238 (38.7%) |
| Baseline top room still shown | 234 / 238 |
| Mean change in that room's usable time | **+0.18 min** |
| Rooms whose usable time moved at all | 109 / 234 |

One concrete case, already pinned in `scripts/test/engine.test.mjs`: from
downtown at 14:10, Pomerene Hall and Jennings Hall used to tie at 71 minutes and
a **seat count** decided which room got named. Measuring to the door moves
Jennings to 70 and leaves Pomerene at 71, so distance now decides what a
tiebreak used to.

## What this does not fix

**It does not fix the detour bias, and it moves the aggregate the wrong way.**

#115 measured OSU's own pedestrian network at 1.49x the straight line at the
median and 2.15x at the 90th percentile, with route durations averaging 3.84
minutes above Vacant. This change makes Vacant's walks 23.3 m *shorter* on
average. Those two facts do not cancel and should not be reported as though they
argue with each other: they are errors in different terms of the same estimate.

- The **endpoint** was wrong, and is now right. The walk ends where a walk ends.
- The **path** is still a straight line times 1.3, and is still wrong.

Correcting the endpoint while leaving the path alone leaves a net underestimate.
The right reading is that `DETOUR` was silently absorbing part of the endpoint
error, and now has less to hide behind — which makes it easier, not harder, to
fit against a real walked route, because the two errors are no longer summed
into one fudge factor.

Anyone fitting `DETOUR` or `WALK_MPM` from a stopwatch now has to know the
endpoint moved on 2026-09-15. A time compared against a prediction made before
that date is being compared against a different quantity. The two buildings with
no doors should be dropped from any such fit, because they still carry the old
bias.

## What is now possible that was not

- **Phase C routing** wants entrance points to route *to*; ending a route at a
  centroid puts it inside the building. `data/entrances.json` is that input.
- **Accessible routing.** The layer carries `Accessible`, `Automated`, `Ramp`
  and `Button` per door and `data/entrances.json` keeps all four. Nothing reads
  them yet. 84 of the 217 doors on shipped buildings are marked accessible, and
  a preference that routes to those alone is now a query rather than a data
  collection problem. The flags are three-state: `null` means nobody surveyed
  that door, and it must not be read as "no".
- **A ground-truth walk that means something.** `docs/research/ground-truth-walk.md`
  asks for path length and elapsed time. It can now also ask *which door*, and
  compare against the door the app actually predicted.

## Two things found on the way

Neither is about entrances; both were in the path of this change.

**`scripts/fetch-buildings.mjs` could not write the term subset at all.** Its
`MIN_CLASS_BUILDINGS` floor was 90, measured when term 1268 carried 871 rooms in
96 buildings. The room safety filter has since cut the index to 425 rooms in 46,
so the guard sat above the real number and `only 46 of 46 class-hosting codes
resolved` was fatal on a perfect run. The floor is now 40. A floor that outruns
its own dataset fails on success and names the healthy number while doing it.

**`data/buildings-1268.json` was stale.** Because of the above it had not been
rebuilt since 2026-08-27 and carried 96 buildings, 50 of which the room index no
longer references. Rebuilding it drops those 50, which is why the file shrank
even after gaining 217 doors, and it moved three measured constants that had
been read off the stale slice:

- the tie-break count in `scripts/test/screens.test.mjs`, 2,984 to 2,836, and a
  row can now move two places rather than one, because the slice has a tie run
  three buildings long where it had none;
- the off-campus note in `js/app.js`, which claimed seven of 96 buildings sit
  outside the 2.2 km gate. None of the 50 does. The claim is true of the full
  612-building index — 268 sit outside it, the furthest being Main St, 153 W at
  19.32 km — and is now read off that, because the term slice is a list of
  classroom buildings rather than a sample of OSU property.

**The picker's shortcut bar was standing on the stale rows.** `js/app.js`
hardcodes six buildings as one-tap origins on the "Where are you?" screen, and
four of them — the Ohio Union, Thompson Library, the RPAC and the Eighteenth
Avenue Library — host no classes at all. They are places a student *stands*,
not places with a classroom to send them to. `paintPick()` renders each button
from `state.buildings[code].name` and `pickBuilding()` reads `lat`/`lon` off the
same row, so keyed on the room index alone the bar is Dreese and Hitchcock and
the other four are simply absent.

They had been rendering only because the subset still held the 96 codes an older
room index referenced. The first correct rebuild deleted four of the six, which
is how this was found — the regression was latent in the design and any correct
rebuild would have shipped it. `scripts/fetch-buildings.mjs` now keys the subset
on the room index **plus** `ORIGIN_CODES`, refuses to write a file missing a
shortcut, and counts the `MIN_CLASS_BUILDINGS` floor over the room index alone
so four buildings of padding cannot hide a collapsed harvest.
`scripts/test/buildings.test.mjs` reads `SHORTCUTS` out of `js/app.js` and fails
if the two lists drift, because nothing else connects them.
