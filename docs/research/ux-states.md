# Vacant: screen and state inventory

Research note, 2026-08-26. Covers every state the app can be in, the result row,
the duration input, the map question, accessibility, and what persists between
launches.

Every number here was measured today against the live API and Overpass, and the
commands are in [What I measured](#what-i-measured). Where I contradict the
README I say so in [Corrections to the blueprint](#corrections-to-the-blueprint).
Mockups are drawn on a 46-character grid, which is roughly 390px at the body text
size this app should use.

---

## The one thing to read

**The problem:** Ohio State's class schedule constrains only 11% of the hours in a
year, so during the other 89% every room in the index reads as free, and the
ranked list quietly degrades into a plain distance sort that is pretending to know
something it does not.

**The fix:** grade every row by what the schedule actually knows about that room
right now, in three tiers, and let the weakest tier restructure the whole screen
instead of hiding in a footnote.

```
  WHAT THE SCHEDULE KNOWS                     WHAT THE ROW MAY CLAIM
  ---------------------------------------------------------------------
  a class ends at 12:10 and the next
  one in that room starts at 1:55         ->  "free till 1:55p"    STRONG
    53% of free rooms at peak                 a real bounded number

  a class ended and nothing else is
  booked in that room all day             ->  "no class rest of    MEDIUM
    47% of free rooms at peak                  today", open ended

  nothing is scheduled anywhere on
  campus at this hour, all week           ->  "nothing is            WEAK
    89% of the year: every night,               scheduled now"
    every weekend, 70 days between              the list is only a
    terms                                       distance sort
```

The README designs for the strong tier and treats the weak tier as an edge case.
The measurements say the weak tier is the ordinary case, so it needs the most
design attention, not the least.

---

## What I measured

Sample: subjects `cse`, `math`, `english`, `psych` for term 1268 (Autumn 2026).
20 requests to content.osu.edu total, run sequentially 0.7s apart with 90s
timeouts and retry: 12 paged subject pulls, 5 single-page term probes, 1
unfiltered probe, 2 spare. Plus 2 Overpass calls.

```
# the harvest, 12 requests
https://content.osu.edu/v2/classes/search?q=&subject=<s>&term=1268&campus=col&p=<n>&sort=catalogNumber

# building coordinates, 1 call after a rate-limit retry
curl -G https://overpass-api.de/api/interpreter --data-urlencode \
  'data=[out:json][timeout:120];way[building][name](39.990,-83.040,40.008,-83.008);out center tags;'
```

| Measurement | Value | Why the UX cares |
| --- | --- | --- |
| meetings in sample | 1982 | |
| usable (room + time + weekday all present) | 1174, **59.2%** | the build guard needs a ratio floor, not only a room count |
| distinct rooms / buildings | 233 / 40 | |
| **peak occupancy, whole week** | **91/233 = 39%**, Thu 12:15 | at the busiest minute of the week, 61% of rooms are free |
| weekend meetings | **0** | Saturday and Sunday the entire index reads free |
| earliest start / latest end | 08:00 / **20:15** | outside that window every room reads free |
| schedule-constrained hours | 943 of 8760 = **11% of the year** | the other 89% the app is guessing |
| median inter-class gap | **15 min** | 73.7% of all gaps are under 20 minutes |
| free rooms with no bounded end (at peak) | **47%** | "yours for 2h06" is the minority case |
| median bounded gap (at peak) | 30 min | and 40 of the 75 bounded ones are under an hour |
| room capacity | median 40, range 12 to 727 | 53% of rooms seat 21 to 40 |
| classroom buildings within a 12 min walk of centroid | 36/38 = **95%** | campus is small, so distance barely discriminates |
| nearest classroom building from 5 miles north | **8193 m = 102 min walk** | off campus is trivially detectable |
| between-term dead days per year | **70 = 19% of the calendar** | |

Term spans, read off `startDate` and `endDate`:

```
  Spring 2026  2026-01-12 .. 2026-04-27
  Summer 2026  2026-05-11 .. 2026-07-30
  Autumn 2026  2026-08-25 .. 2026-12-09
  Spring 2027  term=1272 returns totalItems: 0   (not published yet)
```

### Does a 4-subject sample generalise?

The obvious worry is that 4 of 243 subjects understates occupancy. It moves less
than you would think, because each added subject brings its own rooms along with
its own meetings:

```
subjects                      rooms   mtgs  mtg/room  peak busy%  open-ended%
cse                              54    784      14.5         43%          34%
cse+math                        157   1860      11.8         40%          57%
cse+math+english                206   2160      10.5         39%          51%
cse+math+english+psych          233   2464      10.6         39%          47%
```

Peak busy% runs 43, 40, 39, 39 across a fourfold expansion and meetings per room
settles near 10.6. The 39% peak is likely to survive the full harvest. It is still
a sample, so re-measure once `rooms-1268.json` exists, but do not design on the
assumption that the full pull will be different in kind.

One thing I could not close: the unfiltered query `?q=&term=1268&campus=col`
returns `totalItems: 10000, totalPages: 50`, which is the documented result cap
rather than a true count. There is no cheap way to get real campus scale without
the full 243-subject harvest, so treat "1200 to 1800 rooms" as still unverified.

---

## Six things that surprised me

**1. The duration filter barely changes the answer.** Real query, standing at the
Ohio Union at the measured weekly peak (Thu 12:15), walk time already subtracted:

```
  need  15 min -> 137 rooms qualify, nearest 1 min walk
  need  30 min ->  98 rooms qualify, nearest 1 min walk
  need  60 min ->  98 rooms qualify, nearest 1 min walk
  need 120 min ->  74 rooms qualify, nearest 1 min walk
  need 180 min ->  71 rooms qualify, nearest 1 min walk
```

Between a 30-minute need and a 3-hour need the qualifying set only falls from 98
to 71, and the top answer does not change at all. This is the strongest argument
against building anything expensive behind the duration input, and it decides the
"until my next class" question below.

**2. The median gap between two classes in the same room is 15 minutes.** 939 of
1282 gaps are exactly 15 minutes, because the standard pattern is 55-minute
classes with 15-minute passing periods. Start minutes cluster on :10, :20 and :00,
and 73.7% of all gaps are under 20 minutes. So "free right now" with no duration
attached is usually a passing period. Never render a row whose only claim is
"free now".

**3. `holidaySchedule` is the literal string `"OSUSIS"`.** It is a schedule name,
not a list of dates, and there is no holiday data anywhere in the response. So
Thanksgiving week, Labor Day and fall break will all show rooms as **falsely
busy**. That is the opposite of the failure mode the README worries about, and it
hides good rooms on exactly the days campus is emptiest.

**4. Spring 2027 does not exist yet.** `term=1272` returns `totalItems: 0` today.
The app cannot roll forward when Autumn ends on 2026-12-09, because there is
nothing to roll forward to. That is a real 32-day state, not a theoretical one.

**5. Fuzzy building matching fails silently and confidently.** 29 of 40 building
names matched OSM exactly (72%). Of the 11 that needed fuzzy matching, 5 matched
the wrong building:

```
  'Campbell Hall'             -> 'McCampbell Hall'    0.93   WRONG
  'Derby Hall'                -> 'Fry Hall'           0.78   WRONG
  'Hagerty Hall'              -> 'Page Hall'          0.76   WRONG
  'Knowlton Hall'             -> 'Newton Hall'        0.75   WRONG
  'Scott Lab'                 -> 'Scott Hall'         0.74   WRONG, 2034 m off
  'Baker Systems Engineering' -> '...Building'        0.85   right
  'Mathematics Tower'         -> 'Math Tower'         0.74   right
```

The highest-scoring fuzzy match in the set is wrong and one of the lowest-scoring
is right, so **similarity ratio cannot be the safety net**. A distance sanity
check can: reject any match more than about 1200 m from the campus centroid, which
catches Scott Hall at 2034 m, then hand-verify what is left. A wrong coordinate is
worse than a missing one, because it produces a confident walk time to the wrong
building.

**6. Overpass returns an HTML error page under load, not JSON.** My second call
came back as `<?xml ... <html>` and the parse threw. It succeeded after a 20-second
pause. The build script has to check content type before parsing, or a rate limit
will look like a parse bug.

---

## 1. State inventory

Seventeen states. The trigger column is what the code actually branches on.

| # | State | Trigger | Screen |
| --- | --- | --- | --- |
| A0 | Shell | always, first paint | header and chips from cache, no network |
| A1 | First run | no `vacant.perm` key in localStorage | permission explainer |
| A2 | Locating | permission granted, awaiting fix | skeleton rows |
| A3 | Answer, scheduled hours | fix acquired, Mon-Fri 08:00 to 20:15, in term | ranked list |
| A4 | Answer, unscheduled hours | fix acquired, outside that window | reframed building list |
| A5 | Answer, coarse fix | `coords.accuracy > 75` | list plus accuracy banner |
| B1 | Permission denied | `PERMISSION_DENIED` (1) | building picker |
| B2 | Position unavailable | `POSITION_UNAVAILABLE` (2) | last known, or picker |
| B3 | Timeout | `TIMEOUT` (3) after 8s | last known position, marked |
| C1 | Offline, fresh cache | offline, data age under 14 days | silent, no banner |
| C2 | Offline, stale cache | offline, age 14 days or more, term current | soft banner |
| C3 | Offline, expired term | today past the term's last `endDate` | hard banner, results gated |
| C4 | Offline, no cache | no cached data at all | hard fail |
| D1 | Nothing fits duration | filtered set empty | relaxed near misses |
| D2 | Nothing fits at all | free set empty | practically unreachable, still specified |
| E1 | Between terms | today outside every session range | calendar message |
| E2 | Next term unpublished | term ended and successor returns 0 items | calendar message with check time |
| F1 | Off campus | nearest building over 1500 m | off-campus screen |
| G1 | Data guard tripped | room count or usable ratio below floor | refuse to show anything |

Two of these are not in the original brief and are the ones I would build first:
**A4** because it covers 89% of the year, and **E2** because it is unavoidable
every December.

### A0 Shell, and the cold-launch budget

The promise is "cold launch to answer in one tap". Concretely that means the
header and the duration chips paint from the service worker cache before any
JavaScript decides anything, and the geolocation call starts in the same tick.
Nothing in the first paint may depend on the fix, on the network, or on parsing
the room index.

```
  t+0ms     service worker serves shell from cache
  t+0ms     navigator.geolocation.getCurrentPosition fires
  t+~40ms   header, chips, and last-used duration are on screen
  t+~80ms   rooms-1268.json parsed from Cache Storage
  t+0.5-3s  fix arrives, list renders
  t+8s      timeout -> B3
```

The list is the only thing that waits. Everything else is already there, so the
screen never looks empty.

### A1 First run

The permission prompt must be fired by a tap, never on load. Safari on iOS will
suppress or auto-deny an unprompted geolocation request and the second chance is
buried in Settings, which is a dead end for a user standing outside. So the first
screen is a real explainer with a button, and the browser prompt appears only
after that button.

```
+----------------------------------------------+
| VACANT                                       |
|                                              |
|                                              |
| Find an empty classroom near you,            |
| free for as long as you need it.             |
|                                              |
|                                              |
| Vacant needs your location to rank           |
| rooms by walking distance.                   |
|                                              |
| It stays on your phone. There is no          |
| server and no account.                       |
|                                              |
|                                              |
|                                              |
|                                              |
|----------------------------------------------|
| [      Use my location      ]                |
|                                              |
| [   Pick a building instead   ]              |
+----------------------------------------------+
```

Two things earn their place: why it needs location, and that the location does not
leave the phone. "Pick a building instead" is not a courtesy, it is the escape
hatch that makes B1 recoverable later.

### A2 Locating

```
+----------------------------------------------+
| VACANT                             12:15 Thu |
|----------------------------------------------|
| Finding you...                               |
|----------------------------------------------|
| #######################                      |
| ############           ###############       |
|----------------------------------------------|
| ###################                          |
| ############           ###############       |
|----------------------------------------------|
| ######################                       |
| ############           ###############       |
|----------------------------------------------|
| [ 30m ] [*1h*] [ 2h ] [ rest of day ]        |
+----------------------------------------------+
```

Skeleton rows, not a spinner. A spinner says "wait", a skeleton says "this is
about to be a list", and it keeps the chip bar tappable so the user can change
duration while the fix lands. Do not animate if `prefers-reduced-motion` is set.

### A3 Answer, scheduled hours

The main event, and the only state where the schedule genuinely constrains
anything. Rows below are real: Hagerty Hall 050 and Derby Hall 049 are actual
rooms in the sample with actual capacities, queried at Thu 12:15 from the Ohio
Union.

```
+----------------------------------------------+
| VACANT                             12:15 Thu |
|----------------------------------------------|
| Hagerty Hall 050                       2 min |
| free till 1:55p        40 seats              |
|----------------------------------------------|
| Mendenhall 175                         4 min |
| free till 2:20p        42 seats              |
|----------------------------------------------|
| Derby Hall 049                         2 min |
| no class rest of today 28 seats              |
|----------------------------------------------|
| Sullivant Hall 220                     1 min |
| no class rest of today  300 seats            |
|----------------------------------------------|
| 94 more                                      |
|                                              |
| Class schedule only. Doors may be locked.    |
|----------------------------------------------|
| [ 30m ] [*1h*] [ 2h ] [ rest of day ]        |
+----------------------------------------------+
```

Note the mixed tiers. Two rows carry a real end time, two say "no class rest of
today". That mix is what 12:15 on a Thursday actually looks like, and hiding the
difference would be the easy, dishonest choice.

### A4 Answer, unscheduled hours

This is the state the brief called "late night when everything is closed", and the
measurement says it is much bigger than late night: every evening after 20:15,
every weekend, and all 70 between-term days. 89% of the year.

The schedule contributes nothing here, so the app must stop pretending it is
ranking empty rooms and start doing the only honest thing it can, which is naming
the nearest buildings that contain classrooms.

```
+----------------------------------------------+
| VACANT                             9:40p Thu |
|----------------------------------------------|
| Nothing is scheduled anywhere on             |
| campus right now, so the schedule            |
| cannot tell you what is empty.               |
|                                              |
| These are the nearest buildings that         |
| hold classrooms. Whether they are            |
| unlocked is not in any public data.          |
|----------------------------------------------|
| Derby Hall                             2 min |
| 14 classrooms          usually open till 10p |
|----------------------------------------------|
| Hagerty Hall                           3 min |
| 9 classrooms           usually open till 10p |
|----------------------------------------------|
| Thompson Library                       5 min |
| open till 2a           not a classroom       |
+----------------------------------------------+
```

Three deliberate changes from A3: the unit becomes the **building** not the room,
because ranking 233 equally-free rooms by distance is noise; the duration chips
disappear, because filtering by a duration nothing constrains is theatre; and the
caveat is promoted from footer to the first thing on screen.

"Usually open till 10p" is a guess until the phase 4 reports exist. Ship it as a
static per-building field in `buildings.json` with an explicit `hoursSource:
"assumed"` so it is greppable later, and word it as "usually" so it never reads
as fact.

### A5 Coarse fix

`coords.accuracy` is routinely 100 m or worse indoors and among tall buildings.
At 80 m/min that is more than a minute of error, and campus is small enough that a
240 m error reorders the top five.

```
+----------------------------------------------+
| VACANT                             12:15 Thu |
|----------------------------------------------|
| ! Your location is rough (+/- 240 m),        |
|   so walk times could be 3 min out.          |
|   [ Try again ]                              |
|----------------------------------------------|
| Hagerty Hall 050                      ~2 min |
| free till 1:55p        40 seats              |
|----------------------------------------------|
| Mendenhall 175                        ~4 min |
| free till 2:20p        42 seats              |
+----------------------------------------------+
```

Threshold: warn above 75 m, since that is about a minute of walking. Prefix walk
times with `~` so the imprecision is visible in the row itself, not only in the
banner a scrolling user has already passed.

### B1 Permission denied

```
+----------------------------------------------+
| VACANT                             12:15 Thu |
|----------------------------------------------|
| Location is off, so nothing can be           |
| ranked by how far you have to walk.          |
|                                              |
| Turn it on in Settings > Vacant, or          |
| pick where you are:                          |
|----------------------------------------------|
| [ Ohio Union      ] [ Thompson Lib  ]        |
| [ RPAC            ] [ 18th Ave Lib  ]        |
| [ Dreese          ] [ Hitchcock     ]        |
|----------------------------------------------|
| [      Search all buildings      ]           |
+----------------------------------------------+
```

Denial is permanent from the app's point of view, so do not re-prompt, and do not
nag. Offer the six or so places students actually stand, then a search. The picked
building becomes the origin and every other state works normally from there.

### B2 and B3 Unavailable or timed out

```
+----------------------------------------------+
| VACANT                             12:15 Thu |
|----------------------------------------------|
| Could not get a fix in 8 seconds.            |
| That happens indoors and in stairwells.      |
|----------------------------------------------|
| Showing results from where you were          |
| at 11:02a, near Derby Hall.                  |
|----------------------------------------------|
| Derby Hall 049                         2 min |
| free till 1:55p        28 seats              |
|----------------------------------------------|
| Hagerty Hall 050                       3 min |
| free till 1:55p        40 seats              |
|----------------------------------------------|
| [ Try again ]   [ Pick a building ]          |
+----------------------------------------------+
```

The important decision is to use the cached last position rather than showing
nothing, and to be specific about how old it is and where it was. A vague "using
your last location" is worse than useless when the user has since walked half a
mile.

Timeout of 8 seconds, `enableHighAccuracy: true`, `maximumAge: 60000`. Accepting a
60-second-old fix is free accuracy on a campus where nobody moves 100 m in a minute.

### C1 to C3 Offline

Offline is the normal case, not the error case, so C1 shows no banner at all. A
persistent "you are offline" badge on an app designed to work offline is an
apology for a feature.

```
+----------------------------------------------+
| VACANT  (offline)                  12:15 Thu |
|----------------------------------------------|
| Schedule last updated 23 days ago.           |
| Rooms rarely move mid-term, so this          |
| is probably still right.                     |
|----------------------------------------------|
| Hagerty Hall 050                       2 min |
| free till 1:55p        40 seats              |
|----------------------------------------------|
| Mendenhall 175                         4 min |
| free till 2:20p        42 seats              |
+----------------------------------------------+
```

Staleness matters much less than the README implies, because the room schedule is
static within a term. The 14-day threshold is a soft prompt, not a warning.

```
+----------------------------------------------+
| VACANT  (offline)                  12:15 Wed |
|----------------------------------------------|
| !! This schedule is for Autumn 2026,         |
|    which ended on Dec 9.                     |
|                                              |
|    Nothing below is trustworthy.             |
|    Connect once to refresh.                  |
|----------------------------------------------|
| [      Try to refresh now      ]             |
|----------------------------------------------|
| [  Show the old data anyway  ]               |
+----------------------------------------------+
```

C3 is different in kind and deserves the hard treatment. The term's own `endDate`
tells you exactly when the data becomes fiction, so gate the results behind a
second tap rather than showing them with a banner nobody reads.

```
+----------------------------------------------+
| VACANT                                       |
|                                              |
|                                              |
| Vacant has never finished loading the        |
| room schedule, and there is no               |
| connection now.                              |
|                                              |
| It needs one online launch. After that       |
| it works with no signal.                     |
|                                              |
|                                              |
|----------------------------------------------|
| [         Try again         ]                |
+----------------------------------------------+
```

C4 is the one true hard failure. Say plainly that one online launch is needed and
that it is a one-time cost. This state is reachable in practice: someone installs
the PWA from a shared link, and opens it first in a basement.

### D1 Nothing fits the duration

```
+----------------------------------------------+
| VACANT                             12:15 Thu |
|----------------------------------------------|
| Nothing near you is free for 2 hours.        |
|----------------------------------------------|
| FREE FOR LONGER, FURTHER AWAY                |
|----------------------------------------------|
| Caldwell Lab 177                      11 min |
| free till 3:10p        30 seats              |
|----------------------------------------------|
| FREE SOONER, CLOSE BY                        |
|----------------------------------------------|
| Hagerty Hall 050                       2 min |
| free till 1:20p, 59 min  40 seats            |
|----------------------------------------------|
| Derby Hall 049                         2 min |
| free at 1:10p, then 2h05  28 seats           |
|----------------------------------------------|
| [ 30m ] [ 1h ] [*2h*] [ rest of day ]        |
+----------------------------------------------+
```

Two named groups rather than one relaxed list, because "further but longer" and
"closer but shorter" are different answers to different people and a merged sort
serves neither.

The floor matters: **never offer a near miss under 20 minutes**. 73.7% of gaps are
shorter than that, so an unfloored fallback fills the screen with passing periods,
and the user arrives exactly as the next class walks in. That single rule is worth
more than the ranking logic above it.

### D2 Nothing fits at all

Given a 39% peak occupancy this needs roughly 61% of campus to be simultaneously
booked, which the data says never happens. Build it as the same screen as D1 with
the groups empty and a line pointing at the 24-hour spaces (Thompson Library,
the Union), but do not spend design time here. It is a correctness backstop.

### E1 and E2 Outside the term

```
+----------------------------------------------+
| VACANT                                Aug 12 |
|----------------------------------------------|
| No term is in session.                       |
|                                              |
| Summer ended Jul 30. Autumn starts           |
| Aug 25, in 13 days.                          |
|                                              |
| Until then no classes are scheduled          |
| anywhere, so every room is technically       |
| free and none of that is useful.             |
|                                              |
| Buildings keep reduced summer hours.         |
|----------------------------------------------|
| [  Show nearest buildings anyway  ]          |
+----------------------------------------------+
```

```
+----------------------------------------------+
| VACANT                                Dec 18 |
|----------------------------------------------|
| Autumn 2026 ended Dec 9.                     |
|                                              |
| Ohio State has not published the             |
| Spring 2027 schedule yet. Vacant will        |
| pick it up automatically when it             |
| appears, usually in October.                 |
|                                              |
| Checked 2 hours ago.                         |
|----------------------------------------------|
| [  Show nearest buildings anyway  ]          |
+----------------------------------------------+
```

E2 is the state I would most expect to be forgotten. Autumn ends December 9 and
Spring 2027 is not in the API today, so for roughly a month there is no next term
to load. Say when the app last checked, so the screen is a status report rather
than a shrug.

### F1 Not on campus

```
+----------------------------------------------+
| VACANT                             12:15 Thu |
|----------------------------------------------|
| You are about 5 miles from campus.           |
|                                              |
| Walk times from here would all be an         |
| hour or more, so ranking by distance         |
| tells you nothing.                           |
|----------------------------------------------|
| WHEN YOU GET TO CAMPUS                       |
| at 12:15 today, 98 rooms are free for        |
| an hour or more.                             |
|----------------------------------------------|
| [   Show them from the Oval   ]              |
|----------------------------------------------|
| [   Take me back to my location   ]          |
+----------------------------------------------+
```

The brief was right that this one matters. From a house 5 miles north the nearest
classroom building is 8193 m away, which is a 102-minute walk, so every "usable"
number would be negative and a naive implementation would either show an empty
list or rank buildings by a meaningless distance.

Threshold: **nearest classroom building further than 1500 m**. That is clean,
because south campus sits at 369 m and the north dorms at 325 m, while 4 miles out
is already 3615 m. There is no ambiguous middle to tune.

The right behaviour is not an error. Someone checking from home before they leave
has a real question, so answer it from a campus anchor point and label it clearly
as a preview.

### G1 Data guard tripped

```
+----------------------------------------------+
| VACANT                             12:15 Thu |
|----------------------------------------------|
| The room schedule did not load               |
| correctly, so Vacant will not guess.         |
|                                              |
| Nothing here is safe to show.                |
|----------------------------------------------|
| [         Reload         ]                   |
|----------------------------------------------|
| Detail: rooms-1268.json had 3 rooms,         |
| expected at least 400.                       |
+----------------------------------------------+
```

The README already calls for a refusal guard on room count. Add a second on the
usable-meeting ratio: my sample measured 59.2% usable, so a build that drops to
20% means the API changed shape and the grid is quietly wrong rather than
obviously empty. Refuse rather than ship a half-built index, and put the actual
numbers in the UI so a bug report writes itself.

### Room detail

```
+----------------------------------------------+
| Hagerty Hall 050                       [ x ] |
|----------------------------------------------|
| 2 min walk, 160 m                            |
| free till 1:55p, that is 1h38                |
| 40 seats, classroom                          |
|----------------------------------------------|
|             ^                                |
|            /|\        head north-west        |
|             |                                |
|----------------------------------------------|
| TODAY IN THIS ROOM                           |
|   8:00a  ENGL 1110                           |
|   9:10a  ENGL 2367                           |
|  11:10a  free                                |
|   1:55p  HIST 2001                           |
|----------------------------------------------|
| [      Open in Maps      ]                   |
|----------------------------------------------|
| Class schedule only. Doors may be            |
| locked, and clubs book rooms too.            |
+----------------------------------------------+

ALL WIDTHS OK
```

Today's timeline is the cheapest trust-builder in the app. It shows the user the
raw fact the recommendation came from, which is what converts "some app said so"
into "I can see why".

---

## 2. The result row

Visual priority, in order:

1. **Room name.** The only thing the user has to carry in their head while walking.
2. **Walk time.** The ranking key, and the actual decision between rows.
3. **The confidence phrase.** "free till 1:55p" or "no class rest of today".
4. **Capacity.** Matters at the extremes only.
5. **The locked-door caveat.** Once per screen, plus in every row's accessible name.

Room *type* is deliberately not in the row. Per
[`facility-types.md`](facility-types.md), v1 should return only `1A`, `1B` and `1C`
(seminar room, general classroom, lecture hall), so if a room reached the list its
type is already safe and printing it would be noise.

Three candidates, all at the same width:

```
  A. Three columns, README style
  +----------------------------------------------+
  | Hagerty Hall 050    2 min   1h38   40 seats  |
  +----------------------------------------------+

  B. Two lines, walk time right-aligned  <-- recommended
  +----------------------------------------------+
  | Hagerty Hall 050                       2 min |
  | free till 1:55p        40 seats              |
  +----------------------------------------------+

  C. Two lines with a per-row caveat
  +----------------------------------------------+
  | Hagerty Hall 050                       2 min |
  | free till 1:55p        40 seats              |
  | may be locked                                |
  +----------------------------------------------+
```

**A is rejected** because four columns at 390px forces every field to about 11
characters, which truncates real building names ("Agricultural Administration",
"Baker Systems Engineering") and makes every field the same visual weight, so
nothing is scannable. It also fails immediately at large text sizes.

**C is rejected** because a warning repeated on 98 rows is wallpaper. Users stop
seeing the third line by row four, so it costs a third of the vertical space and
buys nothing. The caveat belongs once per screen where it is read, and in the
accessible name where a screen reader user will actually encounter it per row.

**B is the recommendation.** Name and walk time on one line at full weight,
everything else demoted to a quieter second line. The two ends of line one are the
two things that matter, and the eye lands on both without reading the middle.

Two specifics worth fixing now:

- **Show a clock time, not a duration.** "free till 1:55p" beats "yours for 1h38"
  because the user checks it against their own next commitment without doing
  arithmetic while walking. Put the duration in the detail sheet.
- **Say "no class rest of today", never invent an end.** The measurement says 47%
  of free rooms at peak have no bounded end, and a synthetic "free for 9h44"
  (which is what a naive midnight cap produces, I generated exactly that) is a lie
  the moment the building locks at 10pm.

---

## 3. The duration input

**Recommendation: four chips, at the bottom of the screen, defaulting to the last
one used.**

```
  +----------------------------------------------+
  | [ 30m ] [*1h*] [ 2h ] [ rest of day ]        |
  +----------------------------------------------+
```

Against a slider: it needs fine motor control the target user does not have while
walking, gloved, one-handed; it produces false precision (47 minutes is not a
meaningful input when the median gap is 15); and it is genuinely hard to operate
under VoiceOver.

Against free entry: it summons a keyboard, which ends the zero-input promise and
covers the results.

For chips: four fixed values fit one row at 390px, each is a 44px target, they are
a natural radio group for assistive tech, and the choice is recoverable in one tap.

**"Until my next class" is a trap. Do not build it in v1.** The reasoning is not
taste, it is the measurement:

- It needs the student's own schedule. There is no public per-student API, so the
  only routes are an OSU login the project cannot have as a static site, or manual
  timetable entry, which is a multi-screen onboarding flow bolted to the front of
  an app whose entire pitch is that it has no input.
- Even if it were free, it would rarely change the answer. Going from a 30-minute
  need to a 3-hour need moves the qualifying set from 98 rooms to 71 and leaves
  the top result identical. A precise duration is not scarce information here.
  Rooms are not scarce; open doors are.

The engineering budget that "until my next class" would consume is better spent on
the phase 4 "was it open?" reports, which attack the constraint that actually
binds.

"Rest of day" as the fourth chip captures most of the intent anyway, at zero cost.

---

## 4. Should v1 ship a map?

**Recommendation: no map, no tiles. Ship a bearing arrow and a hand-off.**

The case for a map: "where is Mendenhall" is a real question for a first-year, a
map answers it instantly, and a list of building names assumes campus knowledge
the newest users lack, which is precisely the population Roomix underserves.

The case against: tiles mean network. Raster tiles for campus at usable zoom are
several megabytes, and the whole architecture is built on a ~100 KB payload that a
service worker can hold. Pre-caching tiles would make the install an order of
magnitude larger and slower, for a feature used after the decision is already
made. Worse, a half-cached map fails visibly and looks broken in exactly the
stairwell-and-basement conditions the app promises to survive.

The resolution is that a map is being asked to do two separable jobs, and only one
of them needs tiles:

```
  "which way do I walk?"     -> a bearing arrow. Device orientation,
                                zero bytes, works offline, answers
                                the question while walking.

  "show me the campus"       -> the OS maps app, one tap, on the ONE
                                building already chosen. Online, but by
                                then the decision is made and a failure
                                costs nothing.
```

So: a compass arrow in the detail sheet, and an "Open in Maps" button that hands
off a geo: URI. The offline promise survives intact and the newcomer still gets
directions.

Revisit only if the reports layer ships and a per-building confidence overlay
needs a spatial view. That is a phase 4 conversation.

---

## 5. Accessibility

The repo already carries an `accessibility` label ("Barrier affecting people with
disabilities"), so these are the concrete acceptance criteria, not aspirations.

**Screen reader**

- Each result is **one** button, not a row of nested elements. A row that exposes
  name, walk time and capacity as three separate nodes makes VoiceOver read three
  disconnected fragments.
- The accessible name is ordered identity, distance, window, size, caveat:
  `"Hagerty Hall 050, 2 minute walk, free until 1:55 pm, 40 seats. Class schedule
  only, the door may be locked."` The caveat goes **in every row's name**, because
  a sighted user sees the footer once but a VoiceOver user swiping row to row never
  reaches it.
- Write `2 min` visually but `2 minute walk` in the label. `min` is read as "min".
- The duration chips are `role="radiogroup"` with `aria-checked`, so the reader
  says "1 hour, selected, two of four". A row of plain buttons loses the selected
  state entirely.
- Put `aria-live="polite"` on the **result count only** ("98 rooms"), never on the
  list. Announcing 98 rows on every duration change is hostile.
- State changes between A3, A4, F1 and E1 must move focus to the message heading,
  or a screen reader user taps a chip and hears nothing change.

**Large text**

- No `px` for anything typographic. `rem` throughout, and the row must survive 200%
  zoom (WCAG 1.4.4) and iOS Dynamic Type at AX5.
- The row is the hard case: at AX5 the name alone wraps to three lines. Specify the
  reflow now: name wraps freely, walk time drops **below** the name rather than
  being truncated, capacity and window stack. Never truncate the room name, it is
  the one field the user must carry.
- Test at 320px CSS width and 200% zoom. If the chip row cannot hold four chips
  there, it wraps to two rows rather than scrolling sideways.

**One hand, outdoors**

- Everything interactive lives in the bottom 60% of the viewport. This is why the
  duration chips are at the **bottom** and not under the header, which is where a
  desktop instinct would put them.
- Minimum target 44x44 CSS px. The two-line row is about 64px, which is
  comfortable; the chips need explicit `min-height`.
- Respect `env(safe-area-inset-bottom)` so the chip bar clears the home indicator.
- Contrast: 4.5:1 is the floor, but the real environment is a phone in winter sun,
  so target **7:1 for the row's primary line**. Sunlight, not the guideline, is the
  binding constraint.
- Honour `prefers-color-scheme: dark`. This app is used outdoors after dark and a
  white screen at 9pm is a genuine usability failure, not a preference.
- Never encode the confidence tier in colour alone. The words "free till 1:55p"
  and "no class rest of today" carry it; colour only reinforces.
- `prefers-reduced-motion: reduce` disables the skeleton shimmer and any list
  transition.
- `:focus-visible` with a 2px outline and 2px offset, and a `forced-colors` block,
  both of which Finder already implements in `css/finder.css` and can be lifted.

**Cognitive and situational**

- No timers, no auto-refreshing list. A list that reorders under the thumb while
  someone is reading it is the worst possible behaviour for a walking user. Refresh
  on foreground and on explicit pull, nothing else.
- Plain times ("1:55p"), never relative countdowns that force mental arithmetic.

---

## 6. What persists

**Persists**

| Key | Where | Why | Expiry |
| --- | --- | --- | --- |
| `vacant.duration` | localStorage | the one real preference, restores the zero-input promise on launch two | never |
| `vacant.perm` | localStorage | distinguishes first run from returning, so A1 shows once | cleared on denial |
| `vacant.lastpos` | localStorage | lets B2 and B3 answer instead of failing | 6 hours |
| `vacant.lastpos.at` | localStorage | so the UI can say "at 11:02a" | with the above |
| `rooms-<term>.json` | Cache Storage | the whole product | term `endDate` |
| `buildings.json` | Cache Storage | coordinates | never |
| `vacant.checked` | localStorage | when the next term was last looked for, for E2 | never |
| `vacant.installhint` | localStorage | so the add-to-home-screen nudge appears once | never |

**Deliberately does not persist**

- **The result list.** It is a function of time and recomputes in milliseconds.
  Caching it risks showing a stale answer, which is the one unforgivable bug here.
- **Scroll position.** Someone reopening the app outdoors wants the nearest room,
  which is at the top. Restoring scroll is a desktop instinct that actively hurts.
- **The selected or expanded room.** Reopening should be a fresh question.
- **Any identifier.** No user id, no analytics id, no fingerprint.
- **Position history.** One last-known point with a 6-hour expiry, never a track.
  The position never leaves the device in v1, and the A1 copy promises exactly
  that, so the promise has to stay literally true.
- **"Was it open?" answers.** Not until phase 4, and then server-side, since a
  local-only confidence score is worthless.

The 6-hour expiry on `lastpos` is the one judgement call. Long enough to cover a
class day, short enough that yesterday's position never silently ranks today's
rooms.

---

## 7. Visual direction

Vacant should read like a departure board or a parking meter: one typeface at two
or three sizes, hairline rules instead of cards, no shadows, no gradients, no
illustration, and a single functional accent colour that marks walk time and
nothing else, so the eye learns one meaning for it.

Borrow Finder's tokens and its `:focus-visible` treatment directly so the two apps
are visibly siblings, but drop the display face and the three-pane density,
because this is one column read at arm's length in the cold, and every pixel of
decoration is a pixel not spent on the room name.

---

## Corrections to the blueprint

| What the README says | What I measured |
| --- | --- |
| The marquee row is "Dreese 357, 4 min walk, yours for 2h06" | 47% of free rooms at peak have **no bounded end at all**, and of the 75 bounded ones the median gap is 30 minutes. The headline example is the uncommon case, and a naive midnight cap renders it as an absurd "9h44" (I reproduced this). |
| "no rooms match the requested duration" is a key empty state | Nearly unreachable. Peak occupancy is 39%, so 61% of rooms are free at the busiest minute of the week. The real problem is too many results, not too few. |
| Say the locked-door caveat "out loud on every result" | Repeated on 98 rows it becomes wallpaper. Once per screen visually, plus in every row's accessible name, plus promoted to the top in A4 where it is the whole story. |
| Overpass spot-check: "6 of 8 matched exactly, the two misses were wording differences rather than absences" | 29 of 40 matched exactly (72%). Of 11 fuzzy matches **5 matched the wrong building**, including Knowlton Hall to Newton Hall, which is a different building and not a wording difference. Ratio does not separate right from wrong: the worst error scored 0.93 and a correct match scored 0.74. Add a distance sanity check. |
| Sessions and date ranges handle part-of-term classes | True, but `holidaySchedule` is only the string `"OSUSIS"`. No holiday dates exist in the API, so Thanksgiving and Labor Day produce **falsely busy** rooms. Not mentioned in the README. |
| Weekly rebuild, roll to the next term | `term=1272` (Spring 2027) returns `totalItems: 0` today. There is a real ~32-day window with no next term to load, so the term roll cannot be automatic and needs state E2. |
| Add "a refusal guard on room count" | Necessary but not sufficient. 59.2% of meetings in my sample were usable; guard that ratio too, or a shape change in the API ships a quietly half-empty grid that passes a room-count check. |
| Phase 3 lists "map optional" | Recommend no map in v1. Tiles break the offline promise for a question a bearing arrow and an OS hand-off answer for zero bytes. |
| Duration chips "30m / 1h / 2h / until a time" | Keep chips, drop "until my next class". It needs the student's timetable, and the measurement shows duration barely changes the answer (98 rooms at 30m, 71 at 180m, same top result). |

---

## Open questions

1. **Building access hours are now the product's binding constraint, not a
   footnote.** For 89% of the year the schedule says nothing and the only thing
   that matters is whether the door is unlocked. Worth a public records request
   (Finder already has `docs/public-records-request.md` as a template) before
   phase 4 rather than after.
2. **`facilityType` codes: answered elsewhere, and it changes the row.** My sample
   distribution was `1B` 832, `1C` 148, `2P` 72, `2A` 57, `2K` 19, `1A` 14, `5K` 11,
   `5J` 11, `2Q` 8, `6C` 2, with `1B` at 71%. The sibling note
   [`facility-types.md`](facility-types.md) identifies these against a larger sample:
   `1B` general classroom, `1C` lecture hall, `1A` seminar room, and `2A` teaching
   laboratory, mostly wet, which is the main hazard. The UX consequence is that v1
   should show `1A`, `1B` and `1C` only, and that decision belongs in the query, not
   in a filter chip, because a filter the user has to find does not protect anyone.
   Rooms outside those three types should be absent rather than deprioritised.
3. **Are there rooms with classes that my 4 subjects never touch, and does the
   full harvest change the 39% peak?** The saturation test says probably not, but
   re-measure once `rooms-1268.json` exists.
4. **12 In Person lectures had no `facilityId`.** Small (1% of usable meetings) but
   they are real classes in unknown rooms, which is a false-free source. Worth
   checking whether they resolve later in the term.
5. **Does OSU publish anything for non-class bookings** (club meetings, review
   sessions)? If any of it is public it closes the gap far more cheaply than
   crowdsourced reports.

## Risks

- **The app is confidently wrong at night and on weekends** if A4 is not built.
  That is the reputational risk, since a student who walks to a locked building at
  9pm does not come back.
- **Wrong building coordinates produce confident wrong walk times.** Five of
  eleven fuzzy matches were wrong, and one was 2 km off.
- **Holiday weeks show falsely busy rooms**, hiding good results on the emptiest
  days of the term.
- **The term roll in December has no data to roll to**, so a naive implementation
  shows an empty or expired grid for about a month.
- **Duration is close to decorative at current occupancy.** If it stays that way,
  the differentiator versus Roomix is the geo ranking and the honesty, not the
  clock. Worth knowing before the pitch leans on "yours for 2h06".
