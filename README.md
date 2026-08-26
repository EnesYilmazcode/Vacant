# Vacant

Find an empty classroom near you, free for as long as you need it.

> **Status: blueprint.** Nothing is built yet. This document is the design, and
> the numbers in it come from real probes of Ohio State's class API on
> 2026-08-26, not from guesses.

---

## The problem

You have ninety minutes between classes and nowhere to sit. The library is full,
the union is loud, and there are roughly fifteen hundred classrooms within a ten
minute walk that are sitting empty right now. You cannot find any of them without
walking into buildings and trying doors.

[Roomix](https://roomix.app), an unofficial room matrix for Ohio State, already
does part of this, and it is the reason this project exists rather than being a
copy of it. Roomix is organized building by building, so you pick a building
first. That only helps if you already know which buildings are near you, which
ones have classrooms as opposed to offices and labs, and which ones you are
allowed to walk into. It answers "what is free in Dreese," when the question you
actually have is **"where do I go, right now, from here."**

The second thing it does not do is respect the clock. A room being empty is
useless if it is empty for eleven more minutes. What you need is a room that is
empty for as long as you need it, *after* accounting for the time it takes you to
walk there.

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
   Ohio State class API  (content.osu.edu/v2)
              |
              |  weekly harvest, all 243 subjects
              v
     +------------------------+
     |  invert the schedule   |     course -> sections -> meetings
     |  into a room index     |          becomes
     +------------------------+     room -> when it is busy
              |
              |  rooms-1268.json   (~100 KB gzipped)
              v
     +------------------------+
     |  static site on Pages  |  <---- service worker caches everything
     +------------------------+
              |
     GPS + duration + clock
              |
              v
     complement of busy = free
     minus walk time = usable
     sort by distance
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

Extrapolated across all 243 subjects, that is roughly 1,200 to 1,800 rooms in
about 100 to 150 buildings. Small enough that the whole campus fits in one file
the phone can hold offline.

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

### 6. Where the coordinates come from

The class API gives `buildingCode: "279"` but no latitude or longitude, and Ohio
State's campus map is a single-page app with no JSON behind it. Three candidate
endpoints were probed and all three return the same HTML shell.

OpenStreetMap has it. This Overpass query returns 298 named buildings across
campus:

```
[out:json][timeout:90];
way[building][name](39.990,-83.040,40.008,-83.008);
out center tags;
```

Of eight spot-checked Ohio State building names, six matched exactly and the two
misses were wording differences rather than absences. So building coordinates are
a one-time script plus an afternoon of hand-fixing about 130 rows, committed as
`buildings.json`, and then it never changes again.

---

## What Vacant will not pretend to know

**A class schedule is not a room reservation calendar.** A room with no class in
it can still be booked for a club meeting, a review session, a departmental
event, or simply locked for the night. Every tool in this category has this hole,
including Roomix, and most of them hide it.

Vacant says it out loud on every result:

> No class is scheduled here. The door may still be locked.

The plan to actually close the gap is a one-tap **"was it open?"** report on each
room, which builds per-room confidence over time from people who walked there.
That crowdsourced layer is the only real moat this idea has, and it is also the
only piece that needs a backend, so it comes last rather than first.

Two known unknowns to sort out before launch:

- `facilityType` is a code (`"1B"` and friends) whose meaning is undocumented.
  It needs a pass so the app is not sending people into wet labs and studios.
- Building access hours are a separate dataset that may not exist publicly. Start
  with plausible open hours and let the reports refine it.

---

## Build order

| Phase | What | Notes |
| --- | --- | --- |
| 1 | Harvester emitting `rooms-<term>.json` | Port the fetch pipeline from [Finder](https://github.com/EnesYilmazcode/Finder), swap the projection, add a refusal guard on room count so a bad pull cannot ship an empty grid |
| 2 | `buildings.json` | Overpass pull, fuzzy name match, manual fix pass |
| 3 | The app | Geolocation, duration chips, ranked list, PWA manifest, service worker |
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

---

## License

TBD.
