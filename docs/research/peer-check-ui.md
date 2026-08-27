# Peer check: the five UI changes, against what comparable apps actually do

Research date: 2026-08-27. Everything here was probed live or run locally on that date, and every
number has the command that produced it. Where I could not determine something I say so. This note
builds on [`prior-art.md`](prior-art.md) and does not repeat it; it corrects it in two places.

Scope: the six asks decoded from the owner's message. Ask 6 (a room detail sheet) is already the
"Room detail" mockup in [`ux-states.md`](ux-states.md), so this note treats it as confirmed and
spends its effort on what peers put *in* that sheet.

---

## The one thing to read

**The problem:** four of the five changes are safe and peer-backed, but the new one, tap a row to
draw a line to the building, ships a failure that the leading open-source peer hit and patched one
day after they shipped the same feature: the target is frequently off screen, so the line runs off
the edge to nothing.

**The fix:** fit the view to both points on selection instead of leaving it centred on the user.
Measured against the shipped engine and the shipped data, from the Ohio Union at 9:40pm, **88% of
the top 40 rows point at a building outside the current view**.

```
  WHAT HAPPENS TODAY                  WHAT EVERY MAP APP DOES
  ------------------------------------------------------------
  view stays centred on YOU       ->  on selection, fit the view
  at a fixed 622 m x 1344 m           to BOTH points, with padding
  window                              for the sheet

  line is drawn to a point        ->  both ends visible, target
  outside the viewport                highlighted, list still there

  user sees a dashed line         ->  user sees where they are
  leaving the screen and a            going and how far around
  "13 min walk" label                 the buildings it is
```

Freerooms shipped walking directions on 2026-08-02 and filed the fix on 2026-08-03. The PR title is
[#849 "feature: Center map on selection"](https://github.com/devsoc-unsw/freerooms/pull/849) and the
body is one sentence:

> If someone clicks View on Map and it's not on the screen its a pretty useless feature

---

## What I measured

31 HTTP requests total, sequential, generous timeouts. No requests to `content.osu.edu`.

```bash
# Roomix, the direct competitor (4,069,039 bytes, unchanged since prior-art.md measured it)
curl -sS -L -m 120 -o roomix-main.dart.js https://roomix.app/main.dart.js

# illiniSpots, the only peer with a real in-app map
gh api repos/plon/illinispots/git/trees/HEAD?recursive=1
curl -sS https://raw.githubusercontent.com/plon/illinispots/main/src/components/map.tsx
curl -sS https://raw.githubusercontent.com/plon/illinispots/main/src/components/left.tsx
curl -sS https://raw.githubusercontent.com/plon/illinispots/main/src/client/routes/index.tsx
gh api -X GET repos/plon/illinispots/commits -f per_page=100
gh api repos/plon/illinispots/commits/d25087342e439ef1390cebe41ddd110bc403c89a

# Freerooms, which shipped this exact feature three weeks ago
gh api -X GET search/issues -f q='repo:devsoc-unsw/freerooms map OR direction OR walk OR distance'
gh api repos/devsoc-unsw/freerooms/pulls/848/files
gh api "repos/devsoc-unsw/freerooms/contents/frontend/components/Map.tsx?ref=80fc34dd"
gh api "repos/devsoc-unsw/freerooms/contents/frontend/components/DirectionSummary.tsx?ref=80fc34dd"
gh api "repos/devsoc-unsw/freerooms/contents/frontend/components/MapMarker.tsx?ref=80fc34dd"
gh api "repos/devsoc-unsw/freerooms/contents/frontend/views/BuildingDrawer.tsx?ref=80fc34dd"

# OpenTripPlanner, the reference transit UI, for the walk-leg drawing convention
curl -sS https://raw.githubusercontent.com/opentripplanner/otp-ui/master/packages/transitive-overlay/src/index.tsx

# the off-screen measurement: the SHIPPED rank() against the SHIPPED data
node scratch/sweep.mjs      # imports js/engine.js, js/campus.js, data/*.json
```

Environment gotcha, worse than [`prior-art.md`](prior-art.md) records it: on this box a bash
heredoc eats backslashes **even when the delimiter is quoted** (`<<'PYEOF'`), so a Python regex
containing `[^"\\]` reaches the interpreter as `[^"\]` and throws
`re.PatternError: unterminated character set`. Build such patterns with `chr(92)*2` at runtime, or
write the file with an editor rather than a heredoc.

---

## Change 1: tap a row, highlight the building, draw a line

**Verdict: do it, this is the current convention, but do not ship it without fitting the view.**

### What is already in the tree

This is not a greenfield ask. [`js/map.js`](../../js/map.js) already has `drawTarget()`, which fills
the building footprint with `targetGlow`, strokes it in `target` red, and draws a **dashed straight
line** from the user to the building centroid with a `"N min walk"` label at the midpoint.
[`js/app.js`](../../js/app.js) already sets `state.selected` on row click and toggles `.row.on`. The
feature is roughly 80% built. What is missing is the camera move.

### The measurement that matters

`settle()` centres the view on the **origin** at `SETTLED_SPAN = 0.28` and never moves again. From
`data/campus.json`'s bounding box that is a window of **622 m wide by 1344 m tall** on a 390x844
phone. (`px_per_m` came out 0.6280 north-south and 0.6270 east-west, a 0.2% difference, so the
aspect correction in `buildBasemap` is working.)

I ran the shipped `rank()` over the shipped `rooms-1268.json`, `buildings.json` and
`buildings-hours.json`, took the same top 40 the app takes, and counted how many rows have a
building outside that window.

```
% of the top-40 rows whose building falls OUTSIDE the settled view
(need = 60 min, term dates inside Autumn 2026)

origin                  Thu 12:15  Thu 21:40  Sat 11:00   top-row walk (eve)
Ohio Union                    15%        88%        80%   13 min
Thompson Library               0%         0%         0%   2 min
RPAC                          63%         5%         5%   6 min
Dreese                         0%         0%         0%   2 min
18th Ave Library               0%        33%        80%   6 min
Ohio Stadium                  53%         5%         5%   5 min
South campus/High St         100%       100%       100%   22 min
Wexner Center                  0%        88%        80%   6 min
```

Ten of those 24 cells are above 50%. Five are at 80% or more. The median is 10%, so this is not
uniform, it is **conditional and severe where it bites**: it bites when the buildings near you are
closed and the ranking has to reach across campus, which is the night and weekend case that
[`ux-states.md`](ux-states.md) measured at 89% of the year. From the Ohio Union at 9:40pm the top
row is already a 13 minute walk.

A caution on my own method: my first pass at this reported a flat 0% everywhere, because `rank()`
returns the building code on `row.building` and I had read `row.b`, so every row hit a `continue`.
The uniform zero looked like a clean negative result. Anyone re-running this should assert the
lookup found a building before trusting the count.

### What peers do on selection

| App | In-app map | On selecting a result | Camera |
| --- | --- | --- | --- |
| **Roomix** (OSU) | **none in the web build** | "View on Map" opens Google Maps externally | n/a |
| **illiniSpots** (UIUC) | Mapbox, toggleable | marker click expands the matching list row | `flyTo({center, zoom: 17})` |
| **Freerooms** (UNSW) | Mapbox | marker scales 2x, inverts, glows; drawer opens | `fitBounds(route, {padding})` |
| **Vacant today** | vector canvas, no tiles | footprint lit, dashed line drawn | **nothing, stays on you** |

Freerooms' fit is worth copying literally, including the asymmetric padding that keeps the
destination clear of the bottom sheet:

```js
mapRef.current?.fitBounds(routeBounds, {
  padding: { top: 80, bottom: 150, left: 60, right: 60 },
  duration: 900,
  maxZoom: 18.5,
});
```

`bottom: 150` is the sheet. Vacant's sheet is `max-height: 62%`, which is far more than 150px, so
the bottom padding has to be computed from the sheet's actual height or the target lands underneath
it and the fix accomplishes nothing.

### The highlight itself

Freerooms' selected marker doubles in size, inverts fill and ring, gains a glow, and lifts its text
label, over a 0.2s transition:

```js
const isSelected = isCurrentBuilding || isRouteDestination;
// ...
border: isSelected ? `5px solid ${colour}` : "4px solid white",
backgroundColor: isSelected ? "white" : colour,
scale: isSelected ? 2 : 1,
boxShadow: isSelected ? `0px 0px 6px 4px ${alpha(colour, 0.5)}` : "",
```

Note `isCurrentBuilding || isRouteDestination`: one highlight serves both "selected in the list" and
"this is where the line goes". Vacant should keep the same single meaning.

**Vacant is ahead of every peer here and should not give it up.** Roomix has no map, illiniSpots
draws a 2x2 pixel dot, and Freerooms draws an 18px circle. Vacant has real building **footprint
polygons** from the ArcGIS `MainCampusFacades` layer that [`building-access.md`](building-access.md)
section 7 documents, and `drawTarget` already fills the actual outline. Lighting the true footprint
is strictly better than scaling a pin, and no competitor can do it without that layer.

---

## Change 2: remove the term label ("Autumn 2026")

**Verdict: remove it from the results header, but move it rather than delete it.**

The code comment in [`js/app.js`](../../js/app.js) `paintList()` argues against removal:

> The term goes here rather than nowhere. Deleting the corner label removed the app's only on-screen
> provenance, and current.json is refreshed by hand, so a stale snapshot would otherwise serve the
> wrong term with no tell.

That concern is real and the peers agree with it, but none of them solve it in the results header.

- **Roomix** carries 11 semesters and reads `{"semester":{"title":"Autumn 2026","term":"1268"}}` from
  `api.json`, yet the bundle contains **no static "Semester" UI label at all** and no "Last Updated"
  or "Updated" string. Grep counts on `roomix-main.dart.js`: `"Last Updated"` 0, `"Updated"` 0. The
  only `semester` hits are the JSON key and an endpoint enum. Confidence: the absence of a literal
  label is verified; a widget could still render the title from data, so "Roomix never shows the
  term anywhere" is **likely, not proven**.
- **illiniSpots** puts provenance in a popover behind an overflow menu, not in the header:

  ```
  Data Updates:
  • General campus events: Daily
  • Class schedules: Weekly
  ```

So the peer pattern is: **freshness and provenance live in an about or overflow surface, one tap
away, not in the chrome above the answer.** Ask 2 is safe. Put the term and the snapshot date in the
room detail sheet's footer or behind a help control, and the `current.json` staleness tell survives.

---

## Change 3: remove the persistent duration text ("free for 30 min")

**Verdict: remove the happy-path headline, keep the three exception headlines. Do not delete the
element.**

This one has a trap. `paintList()` writes four different headlines into `#head`, and only the first
is chrome:

| Condition | Headline | Is it chrome? |
| --- | --- | --- |
| `meets` | `Free for 30 min, nearest first` | **yes, delete this one** |
| `shorter` | `Nothing free for 30 min · closest anyway` | **no, this is a correctness warning** |
| `waiting` | `Nothing free this second · 30 min` | **no** |
| none | `Every building we have hours for is closed` | **no** |

Deleting `#head` outright removes the app's promise-versus-delivery guard, which is the thing that
stops the list from implying a duration the rows do not honour. The comment in the source is
explicit: "The headline must not promise a duration the rows do not deliver."

The peer precedent is exact. illiniSpots' `ActiveTimeBanner` renders **only when the state is not
the default**, states the active parameter in words, and offers a labelled reset:

```jsx
{!isCurrentDateTime && (
  <ActiveTimeBanner ... onReset={resetToCurrentDateTime} />
)}
// renders: <CalendarClock/> Viewing Today at 12:15pm   [<RotateCcw/> Reset to now]
```

So: silence when everything is normal, one line when it is not. That is exactly "less is more"
applied correctly, and it is what ask 3 should mean.

There is also direct evidence of a peer stripping duration text three days ago. illiniSpots commit
`d250873`, 2026-08-24, `fix(ui): Fix schedule block styles and remove legends and duration text`,
removed 73 lines from `FacilityRoomDetails.tsx` including a computed line that read
`45-minute reservations` or `Mixed durations: 30, 60 minutes`. What they removed was **derived
metadata about the schedule**, not the answer itself. They kept every availability number. See the
negative-evidence section for what that removal cost them.

---

## Change 4: replace "change" with a back arrow, top left

**Verdict: fine, and the arrow is the right glyph here, but peers put an X on the right for a
sheet. The distinction is which one Vacant actually is.**

What peers use:

- **Freerooms** `BuildingDrawer`: `<CloseIcon />` in a `CloseButton`, **top right**, with
  `aria-label="Close"`. It is a sheet over a map, so it closes rather than goes back.
- **Roomix**: the bundle contains `"Close Bottom Sheet"`, Flutter's own sheet semantics.
- **illiniSpots**: an accordion, so there is no back affordance at all.
- **Freerooms** also puts the selection in the URL, `params.set("building", buildingId)` followed by
  `router.push('/map?' + params)`, so the platform back gesture works and the state is linkable.

Vacant's `#again` is not a sheet dismissal. It hides `#sheet`, shows `#ask`, and restarts the
flyover, which is a move backwards through two screens. A back arrow at top left is therefore the
honest glyph, and it matches the platform convention for a navigation stack.

Two things to carry over from the peers:

1. Keep an accessible name on it. Freerooms' icon-only close button still has `aria-label="Close"`.
   A bare `<button><svg/></button>` announces nothing.
2. `#sheet header` currently renders a `.grip` pill, which is the standard signal for a
   drag-to-dismiss sheet, but nothing implements dragging. Either implement it or drop the grip; a
   grip that does not drag is a promise the app does not keep, and with a back arrow added there
   would be two competing dismissal signals.

---

## Change 5: replace the word "walk" with a walking icon

**Verdict: use the icon, but this is the one ask where every peer contradicts the strict reading.
Not one of them ships a walking icon without a word beside it.**

Freerooms is the only peer that has a walking icon at all, and it appears three times, always with
text:

```jsx
// DirectionSummary.tsx, the route card
<WalkingIconContainer><DirectionsWalkIcon /></WalkingIconContainer>
<Typography sx={{ fontWeight: 700 }}>12 min (850 m)</Typography>
<Typography variant="body2">Walking to {summary.destinationName}</Typography>

// BuildingDrawer.tsx, the action button
<DirectionsButton startIcon={<DirectionsWalkIcon />}>
  {isDirectionsLoading ? "Getting directions..." : "Get Directions"}
</DirectionsButton>
```

The word "Walking" survives directly under a walking icon. illiniSpots is stricter still: **every
icon in the app is paired with a visible text label**, with no exceptions.

```
<Star size={16} />      Manage Favorites
<MapIcon size={16} />   Show Map
<BadgeHelp size={16} /> Important Notes
<Github size={16} />    View on GitHub
<CalendarClock/>        Viewing Today at 12:15pm
<RotateCcw/>            Reset to now
```

The one control there without visible text on itself, the map toggle `Switch`, carries
`aria-label="Toggle map display"`.

**The resolution that respects both the owner and the evidence:** the row is the one place where the
icon can stand alone, because the adjacent value already carries the meaning. `[walk] 2 min` is
unambiguous in a way that a lone `[walk]` is not, and the row is the densest surface in the app so
it is where the saved characters are worth most. Everywhere with room, meaning the detail sheet and
the directions summary, keep the word the way Freerooms does. And give the row's icon an accessible
name: [`ux-states.md`](ux-states.md) already specifies `"2 minute walk"` in the row label, and an
icon makes that requirement stricter, not looser, because a screen reader gets nothing from an
undecorated `<svg>`.

---

## Beyond universities: the tap-a-row-see-it-on-a-map convention

The pattern is stable across transit and mapping apps and all three peers that have a map follow it.

```
  1. THE LIST NEVER GOES AWAY.
     illiniSpots splits the screen: map 40vh on top, list 60vh
     below on mobile; 63% / 37% side by side on desktop. Freerooms
     puts a drawer over a full-bleed map. Neither ever swaps the
     list out for the map.

  2. SELECTION IS ONE STATE, SHARED BOTH WAYS.
     Freerooms: isSelected = isCurrentBuilding || isRouteDestination
     illiniSpots: a marker click expands the matching list row
     One highlight, one meaning, driven from either end.

  3. THE CAMERA MOVES TO THE SELECTION, ALWAYS.
     illiniSpots flyTo({center, zoom: 17})
     Freerooms fitBounds(bounds, {padding, duration: 900, maxZoom})
     This is the step Vacant is missing.

  4. GETTING BACK IS CHEAP AND OBVIOUS.
     An X on the drawer, the URL query param, or just scrolling
     the list that never left. No app makes you undo a camera move.

  5. THE MAP IS OPTIONAL.
     illiniSpots stores showMap in localStorage and, per commit
     "Avoid loading Mapbox when the map is disabled (#22)", does
     not load the library at all when it is off.
```

Point 5 deserves weight given Vacant's cold-launch budget. illiniSpots spent three commits in one
week decoupling the map from readiness: `Decouple page readiness from map loading (#20)`,
`Avoid loading Mapbox when the map is disabled (#22)`, and
`fix(map): Fix mobile map loading and add timeout fallback (#31)`. Vacant's map is a canvas over
`campus.json`, not a tile library, so the byte cost is already paid, but `campus.json` is 128,842
bytes against a `rooms-1268.json` of 239,468, and `boot()` currently `await`s `campus.json` **before**
it fetches the room index. The answer therefore waits on the basemap. That ordering is worth a look
against the budget in [`query-engine.md`](query-engine.md), and it is the one place where adding to
the map costs the critical path.

---

## Straight line, walking route, or just a pin? What is actually common

This was the question worth answering with evidence, and the evidence is not what the cheap option
would like it to be.

| App | What it draws from you to the destination | Source |
| --- | --- | --- |
| **Roomix** | **nothing.** A "View on Map" button opens `https://www.google.com/maps/search/?api=1&query=...` in an external app. That is Google's **search** URL, which drops a **pin**. Not `dir/?api=1&destination=`, which would be a route. | bundle, `url_launcher` with `LaunchMode.externalApplication` |
| **illiniSpots** | **nothing.** Coloured markers, a hover popup, and a standard Mapbox `GeolocateControl` blue dot. Grep of `map.tsx`: `LineString` 0, `directions` 0, `polyline` 0, `walking` 0, `distance` 0, `bearing` 0. | `src/components/map.tsx` |
| **Freerooms** | a **real walking route** from the Mapbox Directions API, stored as GeoJSON and drawn as a solid 6px orange line | PR [#848](https://github.com/devsoc-unsw/freerooms/pull/848) |
| **OpenTripPlanner** | a **real route**, with walking legs drawn **dotted** and transit legs solid | `otp-ui` transitive overlay |

Freerooms' layer, verbatim:

```jsx
<Source id="walking-route" type="geojson" data={route}>
  <Layer id="walking-route-line" type="line"
    layout={{ "line-cap": "round", "line-join": "round" }}
    paint={{ "line-color": "#EF6C02", "line-width": 6, "line-opacity": 1 }} />
</Source>
```

OpenTripPlanner is the reference implementation for transit UIs and it codifies the dash convention
explicitly. Walking gets its own layer purely because of the dash:

```jsx
{/* Walking legs are under a separate layer
    because they use a different line dash that cannot be an expression. */}
<Layer
  // This layer is for WALK modes - dotted path
  filter={["all", ["==", "type", "street-edge"], ["==", "mode", "WALK"]]}
  layout={{ "line-cap": "round", "line-join": "round" }}
  paint={{
    "line-color": ["get", "color"],   // WALK: blue[400]
    // First parameter of array is the length of the dash which is set to zero,
    // so that maplibre simply adds the rounded ends to make things look like dots.
    "line-dasharray": [0, 1.3],
    "line-width": 6
  }} />
```

Bike and car access legs get `[2, 1]`, a longer dash. Transit routes are solid.

### What this means for Vacant

Two findings, and they point in opposite directions, so keep them apart.

**The dash is right.** Dotted or dashed means "walking, and approximate" across the whole category,
and `drawTarget` already sets `setLineDash([7, 7])` with a round cap. The existing comment in
[`js/map.js`](../../js/map.js) is exactly the convention OpenTripPlanner encodes:

> Dashed, so it reads as a direction rather than a route through doors.

Nobody will read a dashed line as sloppy. A **solid** line would be the mistake, because solid is
what routed geometry looks like and it would claim path knowledge the app does not have.

**The straight geometry is the exposure, and it is not primarily an aesthetic one.** No peer draws a
straight line between two points. They either draw a real route or they draw nothing. The reason to
care is not that it looks cheap, it is that on this campus a straight line crosses buildings, and
the app is already telling the user the walk takes `DETOUR = 1.3` times longer than the straight
distance. Drawing the 1.0 line beside a number computed from the 1.3 assumption is internally
inconsistent, and on the longer rows it is visibly wrong: from the Ohio Union at 9:40pm the top row
is a 13 minute walk, roughly 780 m of straight line, which crosses most of central campus.

The honest options, cheapest first, none of which need a routing server:

1. **Keep the dashed straight line but stop calling it a route.** Label it with the walk time, which
   `drawTarget` already does, and let the dash carry the "as the crow flies" meaning. Cheapest, and
   defensible, but the geometry still runs through buildings.
2. **Keep the line and fit the view.** The off-screen fix is worth more than the geometry fix, by a
   wide margin. Do this one first regardless.
3. **Draw a bearing arrow instead of a line,** which is what [`ux-states.md`](ux-states.md) already
   recommends for the detail sheet, and which no peer has. It makes no path claim at all.
4. **Route offline against the street layer** already in `campus.json`. `PALETTE.street` exists and
   `buildBasemap` strokes `campus.layers.street`, so the geometry is on disk. This is real work and
   it is the only option that produces a line a peer would recognise, but it would make Vacant the
   only app in the category with offline walking directions. Worth a spike, not a v1 commitment.

I would ship 2 now, keep 1, and put 4 in the backlog behind the phase-4 line.

---

## Negative evidence: peers who stripped text or leaned on icons

This is the part the assignment asked for most and it is thinner than the positive evidence, so I am
reporting confidence honestly rather than padding it.

**1. Freerooms shipped tap-to-map and patched it the next day.** Verified. Directions merged
2026-08-03 ([#848](https://github.com/devsoc-unsw/freerooms/pull/848)), the centring fix merged
2026-08-04 ([#849](https://github.com/devsoc-unsw/freerooms/pull/849)) with the body "If someone
clicks View on Map and it's not on the screen its a pretty useless feature". This is the strongest
negative evidence in the note and it is aimed squarely at ask 1. Vacant has the same defect in the
tree right now.

**2. illiniSpots stripped a legend three days ago and left a colour-only display behind it.**
Verified from the diff. Commit `d250873` deleted this from both `AcademicRoomSchedule.tsx` and
`FacilityRoomDetails.tsx`:

```jsx
{/* Legend */}
<div className="w-3 h-3 ${SCHEDULE_BLOCK_STYLES.availableBase}" /> Available
<div className="w-3 h-3 ${SCHEDULE_BLOCK_STYLES.occupiedBase}" />  Class/Event
```

The schedule strip is still colour coded. The words that explained the colours are gone. Whether
users complained is unknown, the commit is three days old and the tracker says nothing, so I am not
going to claim regret that has not happened. But it directly violates the rule
[`ux-states.md`](ux-states.md) already sets for Vacant, "Never encode the confidence tier in colour
alone", and it is a worked example of how a "less text" pass removes the labels and leaves the
colours. Confidence: the removal is verified, the harm is **unverified**.

**3. Nobody in the category ships an icon-only interface.** This is absence-of-evidence rather than
a documented failure, but the absence is consistent across every peer I could read: illiniSpots
labels all six of its icons, Freerooms labels its walking icon in all three placements, and the only
unlabelled controls anywhere (Freerooms' close X, illiniSpots' map switch) carry `aria-label`. I
searched the four peer trackers for confusion reports:

```bash
gh api -X GET search/issues -f q='repo:devsoc-unsw/freerooms repo:plon/illinispots
  repo:Open-Source-Uniandes/Aula-Finder repo:blu3r4y/jku-room-search
  confusing OR unclear OR "not obvious" OR misleading OR "hard to" OR intuitive'
```

It returned 25 results and **none of them is a user complaining about an icon**. The matches were
body-text noise and dependency bumps. So: no peer has been burned by icons in a way their tracker
records, and no peer has given icons the chance.

**4. The one documented UX regret in the category is a duplicated control, not a missing label.**
[`prior-art.md`](prior-art.md) already has this: illiniSpots' `ref(ui): consolidate time filter into
free until (#41)`, where two controls computed the same thing and 100 lines were deleted to get back
to one. It is worth restating here because ask 3 and ask 4 both touch controls, and the lesson cuts
in favour of the owner's instinct: fewer controls is the direction that has actually been validated
in this category. Fewer *labels* is not.

---

## What peers put on a room detail screen that this design has not thought of

Ask 6 confirms the "Room detail" mockup in [`ux-states.md`](ux-states.md), which currently holds
walk time, distance, the free-until window, seats, a bearing arrow, today's timeline, an "Open in
Maps" button and the locked-door caveat. Here is what the peers have that it does not.

| Peer feature | Who | Cost to Vacant | Worth it? |
| --- | --- | --- | --- |
| **Room type in words** | Roomix | free, see the decode table below | **yes** |
| **A photo of the building** | Freerooms, `/assets/building_photos/{id}.webp`, `priority={true}`, 946x648, above the directions button | see the dead-endpoint note below | maybe, blocked |
| **Multi-day schedule, not just today** | Roomix has Day / Week / Work Week / Month timeline views; illiniSpots shipped `feat(schedule): Add full-day room timeline and 7-day navigation (#33)` on 2026-08-23 | moderate, the data is already in `busy` | **yes, 7-day** |
| **Calendar export** | Roomix: `"Add to Calendar"` and `"Download (.ics)"` | small, an ICS blob is ~20 lines | nice to have |
| **Progressive disclosure inside the row** | Roomix: `p = e ? "Collapse" : "Expand for more details"` | free | alternative to a sheet |
| **A directions action with a loading state** | Freerooms: `"Getting directions..."` then `"Get Directions"` | free | yes if a route ships |
| **The honesty list, one tap away** | illiniSpots "Important Notes" popover | free | **yes**, see below |

**The room type is free and it is the highest-value item.** Roomix's bundle carries the complete
`facilityType` decode table, which closes open question 5 in [`prior-art.md`](prior-art.md) and
extends [`facility-types.md`](facility-types.md) from 4 identified codes to 23:

```
1A seminarRoom            2A scheduledTeachingLab    5A facultyOffice
1B classroom              2D researchLaboratory      5F graduateStudentOffice
1C lectureHall            2P scheduledComputerLab    5G officeLaboratory
                          2H gymnasium               5J officeService
3A teachingLabService     2J tvAndRadioFacility      5K conferenceRoom
4A studyAndReadingRoom    2K unscheduledTeachingLab  5L staffOffice
                          2M specialUseLab           6C auditoriumSeating
                          2Q unscheduledComputerLab  6E lounge
                                                     6F activityRoom
                                                     6L meetingRoom
```

Recovered with:

```bash
grep -o '.\{0,300\}"1B".\{0,400\}' roomix-main.dart.js
# r($,"bH_","b1j",()=>A.ab(["1A",B.pB,"1B",B.LD,"1C",B.pM,"2A",B.pQ,"2D",B.pR, ...
grep -o 'B\.pB=new [A-Za-z0-9_.]*([^)]\{0,60\}'   # B.pB=new A.eo(0,"seminarRoom"
```

Two consequences beyond the label. First, **`4A` is "Study & Reading Room"**, which is arguably the
best room type on campus for this app's purpose, and it is not in the `1A/1B/1C` allow list that
[`ux-states.md`](ux-states.md) and issue #9 specify. Worth a deliberate decision rather than an
accident. Second, the shipped `data/rooms-1268.json` already contains types outside the allow list;
the first three rooms I sampled are `2P`, `6C` and `1B`, so either the filter is applied downstream
in `rank()` or the allow list has not landed. Worth checking against issue #9.

**The building photo is blocked, and the blocker is worth recording.** Freerooms leads its drawer
with a photo, which answers "which door" better than a map does, and
[`prior-art.md`](prior-art.md) notes that Roomix's cached `buildings.json` carries
`imageUrl: https://www.osu.edu/map/buildingImg.php?id=241&size=mobile&nodefault=1`. That endpoint is
now dead:

```bash
curl -sS -L -m 45 -w "HTTP %{http_code} type %{content_type} final %{url_effective}\n" \
  "https://www.osu.edu/map/buildingImg.php?id=279&size=mobile&nodefault=1"
# HTTP 200  type text/html; charset=UTF-8  final https://maps.osu.edu/?id=279&size=mobile&nodefault=1
```

It 301s to `maps.osu.edu`, a single-page app, and returns 6,522 bytes of HTML rather than an image.
Roomix's stored URLs are stale. `maps.osu.edu` is also a lead on open question 1 in
[`prior-art.md`](prior-art.md), the live endpoint behind that captured dataset, though
[`geocoding.md`](geocoding.md) has since settled the coordinate problem via ArcGIS.

**The honesty list belongs in the sheet.** illiniSpots ships exactly the content Vacant plans, behind
a labelled popover:

> - Building/room access may be restricted to specific colleges or departments
> - Displayed availability only reflects official class schedules and events
> - Rooms may be occupied by unofficial meetings or study groups
> - Different schedules may apply during exam periods

[`prior-art.md`](prior-art.md) concluded that an in-app per-result disclaimer is unclaimed. That is
still true for the **per-result** case. It is no longer true for the per-app case: illiniSpots has
shipped the list. The remaining unclaimed ground is the single sentence in the row itself, plus the
building-hours line Vacant can already write from `buildings-hours.json`, for example
"Caldwell closes at 7:30pm."

---

## Mockups

Interior grid is 46 characters, matching [`ux-states.md`](ux-states.md).

### The off-screen failure, and the fit

```
  TODAY. Ohio Union, 9:40pm, tap the top row.
  +----------------------------------------------+
  |                                              |
  |                                              |
  |               (o) you                        |
  |                  .                           |
  |                   .                          |
  |                    .   [ 13 min walk ]       |
  |                     .                        |
  |                      .                       |
  |                       .                      |
  |                        .                     |
  |                         .                    |
  |                          .                   |
  +----------------------------------------------+
   The line leaves the screen. The building is
   about 780 m north. 88% of rows do this here.

  AFTER, fitBounds(you, target) with sheet padding
  +----------------------------------------------+
  |          +======+                            |
  |          |######|  Journalism Building       |
  |          +======+                            |
  |             .                                |
  |              .   [ 13 min walk ]             |
  |               .                              |
  |                .                             |
  |                 .                            |
  |               (o) you                        |
  |----------------------------------------------|
  |  the list is still here, unchanged           |
  +----------------------------------------------+
```

### Chrome, before and after the five changes

```
  BEFORE
  +----------------------------------------------+
  | Free for 30 min, nearest first   Autumn 2026 |
  |                                     [change] |
  |----------------------------------------------|
  | CL0071  Caldwell Lab                         |
  | 2 min walk . yours for 1h38 . 40 seats       |
  +----------------------------------------------+

  AFTER, ordinary case: the header goes silent
  +----------------------------------------------+
  | [<]                                          |
  |----------------------------------------------|
  | CL0071  Caldwell Lab                         |
  | [%] 2 min . yours for 1h38 . 40 seats        |
  |----------------------------------------------|
  | DL0095  Dreese Lab                           |
  | [%] 4 min . yours for 2h06 . 28 seats        |
  +----------------------------------------------+

  AFTER, exception case: the warning still speaks
  +----------------------------------------------+
  | [<]   Nothing free for 1h. Closest anyway.   |
  |----------------------------------------------|
  | CL0071  Caldwell Lab                         |
  | [%] 2 min . free till 1:20p . 40 seats       |
  +----------------------------------------------+

  [<] is the back arrow, aria-label "Change how long"
  [%] is the walking glyph, aria-label "2 minute walk"
```

### The detail sheet, with the peer-derived additions

```
  +----------------------------------------------+
  | [<]  Caldwell Lab 071                    [x] |
  |----------------------------------------------|
  | [%] 2 min walk . 160 m                       |
  | yours until 1:55p, that is 1h38              |
  | 40 seats . general classroom                 |
  |----------------------------------------------|
  | IN THIS ROOM      [ M ][ T ][*W*][ T ][ F ]  |
  |    8:00a  ENGL 1110                          |
  |    9:10a  ENGL 2367                          |
  |   11:10a  free                               |
  |    1:55p  HIST 2001                          |
  |----------------------------------------------|
  | Caldwell closes at 7:30pm.                   |
  | Class schedule only. The door may be locked. |
  |----------------------------------------------|
  | [ Open in Maps ]      [ Add to calendar ]    |
  +----------------------------------------------+

  New here versus ux-states.md: the room type in
  words, the 5-day strip, and the building's own
  closing time on the row above the caveat.
```

---

## Corrections to prior-art.md

Two, and the first one matters because it would be repeated in a launch post.

**1. Roomix does not have a map.** The feature table in [`prior-art.md`](prior-art.md) Part 3 lists
"Map view: Y" for Roomix. The web bundle contains no map renderer of any kind. Measured on
`roomix-main.dart.js`, 4,069,039 bytes:

```
GoogleMap 0   MapboxMap 0   mapbox 0   flutter_map 0   leaflet 0
TileLayer 0   tileLayer 0   LatLng 0   CameraPosition 0   bearing 0
Directions 0  directions 0  polyline 0  walking 0
```

The only `Polyline` and `Marker` hits are the DOM interop table for `SVGPolylineElement` and
`SVGMarkerElement`. What exists instead is a `"View on Map"` control appearing in three places, an
error string `"There was a problem when opening Maps. Code: "`, and `url_launcher` with
`LaunchMode.externalApplication` opening `https://www.google.com/maps/search/?api=1&query=...`.

That is a hand-off to an external app, which is precisely the pattern
[`ux-states.md`](ux-states.md) section 4 already recommends for Vacant. The correct row is
"Map view: N (external hand-off)". Caveat: Roomix also ships native iOS and Android apps
(`app-id=6473177665`, `fatih.bal.soy.roomix`) which I did not inspect, so a native-only map cannot be
ruled out. Confidence: verified for the web build, **unverified** for native.

Once corrected, the claim gets stronger, not weaker: **Vacant has an in-app map and Roomix does
not.** Combined with the 15x to 20x cold-start advantage already measured, that is a real gap rather
than a tie.

**2. Freerooms' walk time is no longer only a roadmap item.**
[`prior-art.md`](prior-art.md) Part 5 says "The 'yours for 2h06 after you get there' number does not
exist in any product in this category" and lists
[#762](https://github.com/devsoc-unsw/freerooms/issues/762) as open since April. #762 is still open,
but [#761 "STORY#6-1: Get Directions from current location"](https://github.com/devsoc-unsw/freerooms/issues/761)
is **closed**, and PR #848 shipped a walking time and distance on 2026-08-02:

```
{formatDuration(summary.durationSeconds)} ({formatDistance(summary.distanceMeters)})
Walking to {summary.destinationName}
```

So Freerooms now renders "12 min (850 m)" for a selected building. The Vacant differentiator is
**unchanged and still unique**, because Freerooms computes walk time from you to a building and does
not subtract it from the room's usable window. But the framing "nobody shows walk time" is now
false, and it was true when [`prior-art.md`](prior-art.md) was written three weeks ago. Anyone
writing the launch post should say "nobody subtracts it", which is the claim that survives.

---

## Risks

- **Ask 1 ships a visible bug unless the camera moves.** Verified at 80% to 88% of rows from three
  of eight standing points at night and on weekends, which is the 89% of the year the app is
  designed for. This is the only change in the set that can make the app look broken.
- **Ask 3, read literally, deletes a correctness warning.** `#head` carries three exception
  headlines that are not chrome. Removing the element rather than the happy-path string would let
  the list imply a duration the rows do not deliver.
- **Ask 5, read literally, is unprecedented in the category.** No peer ships an unlabelled walking
  icon. The row is a defensible exception because the adjacent number carries the meaning; the
  detail sheet is not.
- **The dashed straight line is inconsistent with `DETOUR = 1.3`.** The app computes walk time from
  a path 30% longer than the line it draws. On a 13 minute row that gap is visible.
- **`boot()` awaits `campus.json` (128,842 bytes) before fetching the room index.** The map is on
  the critical path to the answer. illiniSpots spent three commits removing exactly this coupling.

## Open questions

1. **Do Roomix's native iOS and Android apps render a map?** The web build does not. This decides
   whether "Vacant has a map and Roomix does not" is safe to say in a launch post without
   qualification.
2. **Is the `1A/1B/1C` allow list actually applied?** `data/rooms-1268.json` contains `2P` and `6C`
   rooms. Either `rank()` filters downstream or issue #9 has not landed.
3. **Should `4A`, "Study & Reading Room", be in the allow list?** It is plausibly the best room type
   on campus for this purpose and it is currently excluded by a list written before the decode table
   was known.
4. **Is there a usable source of building photos?** The `osu.edu/map/buildingImg.php` endpoint Roomix
   cached now redirects to `maps.osu.edu` and returns HTML. Freerooms self-hosts its photos, which
   suggests no peer has found a stable upstream either.
5. **Can the street layer already in `campus.json` carry an offline walking route?** If it can,
   Vacant would be the only app in the category with offline directions, and it would resolve the
   straight-line inconsistency without a network call. This is a spike, not a commitment.
