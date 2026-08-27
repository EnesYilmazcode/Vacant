# Vacant

Find an empty classroom near you at Ohio State, free for as long as you need it.

### **[enesyilmazcode.github.io/Vacant](https://enesyilmazcode.github.io/Vacant/)**

It is a web page. Nothing to install, no account, no search box. It finds you, asks
one question, and hands you rooms you can walk to, nearest first.

| | | |
| :--: | :--: | :--: |
| ![The opening screen: the word Vacant over a dark campus map, the question "How long do you need?", and three buttons reading 30 min, 1 hour and 2 hours](docs/media/ask.webp) | ![The ranked list over the map, with a blue dot showing where you are. Townshend Hall 038, 2 min walk, till 6:50pm, 40 seats. Townshend Hall 245, 2 min, till 2:35pm, class, 20 seats.](docs/media/list.webp) | ![One room picked. Its building footprint is outlined in red on the map and a dashed line runs from the blue dot to it, labelled 2 min walk.](docs/media/room.webp) |
| One question. | The answer. | Where it is. |

## Yours for, not free until

Every other tool answers "is this room free right now". That is the wrong
question, because the room is not where you are standing.

Vacant answers **how long the room is yours once you get there**. It takes the gap
in the room's schedule, subtracts the walk, and leaves ten minutes at the end so
you are not packing up while the next class files in. Walk time is straight line
distance times 1.3 for the fact that campus paths bend, at 78 metres a minute.

Read the second row of the middle screenshot. Townshend Hall 245 says **till
2:35pm**. The next class in that room starts at 2:45pm, you are two minutes away,
and 2:35pm is what is actually left for you.

The word after the time is the other half of the answer. `till 2:35pm, class`
means a class walks in then. `till 6:50pm` with nothing after it means no class
is coming at all, and the time is when the building locks, less the same ten
minutes.

| | |
| :--: | :--: |
| ![The list dragged up to fill the screen, showing ten rooms across three buildings, all two or three minutes away](docs/media/list-full.webp) | ![The room screen for Townshend Hall 245: free till 2:45pm, 2 min walk, then a timeline reading 7:00am Townshend Hall opens, 7:00am free for 7h45, 2:45pm in use, 4:45pm free for 2h15, 7:00pm Townshend Hall closes](docs/media/timeline.webp) |
| Drag the sheet up for the rest. | Tap a room twice for its whole day. |

## What it refuses to guess

Vacant reads the class schedule. A class schedule is not a reservation calendar
and it is not a door. Three things are true and the app says all three on screen:

**Doors get locked.** This is the failure every other tool in this category ships
with, and at Ohio State it is avoidable, because the Registrar publishes an open
and close time per building per weekday. Measured against the committed index,
**867 of the 871 rooms have no Saturday class at all this term**. A tool that
stops at the schedule calls all 867 of them free on a Saturday. **549** of those
sit in a building the Registrar publishes as closed that day, and **243** more sit
in a building nobody publishes hours for at all. **75** are in a building that is
genuinely open.

**Hours are not published everywhere.** The Registrar's table covers 47
buildings. The index touches 96. So 245 of the 871 rooms, 28%, are in a building
whose door nobody documents. Those rooms say `hours not published` and rank below
every room that has real hours. They are never given an assumed window, because
"usually open" is a guess wearing the clothes of a fact.

**Clubs book rooms.** A club meeting, a review session or a departmental event is
invisible to every public source, so it is invisible to Vacant too. Every screen
carries that caveat, and [#26](https://github.com/EnesYilmazcode/Vacant/issues/26)
is the plan to go and measure how often it bites.

## How it works

Ohio State publishes, for every class, the room it meets in and the minutes it
occupies. Nobody publishes which rooms are empty. But empty is the complement of
busy, so the whole product is one inversion of a public dataset. A script walks
the class API, drops everything that is not a real Columbus room, and writes a
room-keyed list of busy intervals. The page downloads that file, subtracts today's
intervals from the building's published opening hours, and ranks what is left by
walk time. There is no server, no database, no build step and no dependencies.

Everything the page fetches to produce a ranked list is **ten files, 470 KB, or
102 KB over the wire once gzipped**. Measured with `node:zlib` over the tree as
committed.

| Where | What is in it |
| --- | --- |
| `index.html` | The whole shell. Markup and CSS, no framework. |
| `js/app.js` | Three screens in one sheet: the question, the list, one room. |
| `js/engine.js` | The ranking, and the formula that decides how long a room is yours. |
| `js/map.js` | The campus map, drawn as vectors on a canvas. No tiles, no key. |
| `js/campus.js` | Latitude and longitude into map grid space. |
| `scripts/` | The harvest, the inversion, and the screenshots. |
| `data/` | The committed artefacts the page reads. |

## Run it

```sh
git clone https://github.com/EnesYilmazcode/Vacant.git
cd Vacant
python3 -m http.server 8000     # or any static file server
```

Then open `http://localhost:8000`. It has to be served rather than opened as a
file, because the page is ES modules and it fetches JSON.

```sh
npm test                        # node --test, 208 tests, no network
node scripts/shoot.mjs          # redraw docs/media from the real app
```

## Rebuild the data

Nothing here needs a key or an account. Each of these takes `--dry-run`.

```sh
node scripts/fetch-buildings.mjs        # OSU's GIS layer  -> data/buildings.json
node scripts/fetch-campus.mjs           # campus polygons  -> data/campus.json
node scripts/fetch-building-hours.mjs   # Registrar table  -> data/buildings-hours.json
node scripts/fetch-rooms.mjs 1268       # the class schedule -> data/harvest-1268.json.gz
node scripts/build-index.mjs 1268       # invert it        -> data/rooms-1268.json
```

The harvest itself is not committed, because it is regenerated weekly, so a fresh
clone has to run `fetch-rooms` before `build-index`. One pass over the schedule is
136 requests against `content.osu.edu`, sent at about three a second. The
committed Autumn 2026 harvest took four passes and 545 requests, because paging
that API is not deterministic: the harvester repeats until two passes in a row
turn up no meeting in a room it has not already seen. Pass two found thirteen of
them. `data/harvest-1268.manifest.json` records what every pass saw.

`data/raw/1262` and `data/raw/1264` are committed and must stay. Those terms have
already left the API and cannot be refetched at any price.

## Not built yet

- **It does not install and it does not work offline.** There is no service worker
  and no web app manifest yet, which is
  [#21](https://github.com/EnesYilmazcode/Vacant/issues/21),
  [#22](https://github.com/EnesYilmazcode/Vacant/issues/22) and
  [#23](https://github.com/EnesYilmazcode/Vacant/issues/23). The architecture is
  built for it: the whole schedule is one small static file on purpose.
- **Campus holidays and finals week are not subtracted.** The Registrar publishes
  both on the same page the hours come from.
  [#11](https://github.com/EnesYilmazcode/Vacant/issues/11) puts them in the index,
  [#19](https://github.com/EnesYilmazcode/Vacant/issues/19) puts the refusal on the
  screen.
- **The list is a room list where it should be a place list.** One building can
  take a third of the forty rows.
  [#62](https://github.com/EnesYilmazcode/Vacant/issues/62).

## Roomix

[Roomix](https://roomix.app) is the incumbent at Ohio State and deserves an honest
description. It is a maintained three platform product: a Flutter app with iOS and
Android builds, a backend, accounts, bookmarks, themes, a nearest facility button
and a vacancy search. Anyone calling it a toy has not looked at it.

Two differences are measurable rather than matters of taste. Both were taken off
its own API and its own compiled bundle on 2026-08-26.

It downloads about **3.3 MB** on first launch. Its API is eleven static JSON
files and `courses.json` alone is 2.4 MB.

It has no building hours. Grepping the bundle for "building hours", "holiday" and
"final exam" returns nothing, and `api.roomix.app/hours.json` is a 404. Its
vacancy search also needs a building selected first and then stops at a 200 metre
radius from it, and it prints raw metres rather than walk time.

The full teardown, with the commands, is in
[docs/research/prior-art.md](docs/research/prior-art.md). It also corrects an
earlier draft of this README, which said Roomix was organised building by building
and ignored the clock. Both halves were wrong.

## Docs

- [docs/BACKLOG.md](docs/BACKLOG.md) is the thirty issues, in order.
- [docs/DECISIONS.md](docs/DECISIONS.md) is append only, and records what each
  decision was made against and which measurement settled it.
- [docs/research/](docs/research/) is the measurement itself: the live API, OSU's
  GIS server, the Registrar's table, Roomix's bundle.
- [docs/BLUEPRINT.md](docs/BLUEPRINT.md) is the design note this README used to
  be, kept whole, with the places it turned out wrong marked at the top.
- [scripts/shoot.mjs](scripts/shoot.mjs) regenerates every screenshot above from
  the real app on a pinned clock, so they cannot quietly stop being true.

## Licence

The code is MIT, in [LICENSE](LICENSE).

The data is derived from Ohio State's own public services: the class schedule at
`content.osu.edu`, the building layer published by OSU Facilities Information and
Technology Services GIS, and the classroom pool schedule from the Office of the
University Registrar. Each file in `data/` carries its source and attribution
inside it. Vacant is not affiliated with Ohio State. How that gets stated on the
site is [#25](https://github.com/EnesYilmazcode/Vacant/issues/25).
