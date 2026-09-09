# Vacant

Find an empty classroom near you at Ohio State, free for as long as you need it.

### **[enesyilmazcode.github.io/Vacant](https://enesyilmazcode.github.io/Vacant/)**

It is a web page. No account, no search box, nothing to sign up for. It finds you,
asks one question, and hands you **one room** you can walk to, with a photograph of
it. Bin it and it hands you the next one. Take it and it shows you the way.

| | |
| :--: | :--: |
| ![The opening screen: the word Vacant over a dark, blurred campus map, and four buttons reading 30 min, 1 hour, 2 hours and rest of day, with 2 hours selected](docs/media/ask.webp) | ![One card, filling the screen: a photograph of Cunz Hall 160, an empty classroom with rows of tables and yellow chairs, a clock and a door at the far end. A narrow frosted plate floats over the ceiling reading Cunz Hall 160, with no class, 4 min and 42 seats on the line under it. A bin and a tick sit on the bottom corners. Nothing else is on the screen.](docs/media/card.webp) |
| One question. | One answer. |

## Yours for, not free until

Every other tool answers "is this room free right now". That is the wrong
question, because the room is not where you are standing.

Vacant answers **how long the room is yours once you get there**. It takes the gap
in the room's schedule, subtracts the walk, and leaves ten minutes at the end so
you are not packing up while the next class files in. Walk time is straight line
distance times 1.3 for the fact that campus paths bend, at 78 metres a minute.

Read the third row of the list further down. PAES A111 says **free till 4:00pm**.
The next class in that room starts at 4:10pm, you are four minutes away, and
4:00pm is when you have to be packed up.

Take it and the room screen says the same minute, then spells the rest out:
**Yours for 5h36 once you get there.** The two screens agreeing is the point.
They did not for a while: the room screen printed the raw class start, handing
back the ten minutes the row had already taken off
([#77](https://github.com/EnesYilmazcode/Vacant/issues/77)).

A card that says **no class rest of today** instead of a time means no class is
coming at all, and the timeline behind it ends where the building locks.

## Bin it, or take it

Drag the card and it tells you what letting go will do. Each badge sits on the
corner the card is *not* leaving by, so the word is still on screen at the moment
you commit to it.

| | |
| :--: | :--: |
| ![The same card dragged left and held. The photograph of Cunz Hall 160 has slid off the left edge and tilted, and a grey NEXT badge has appeared on the corner still on screen.](docs/media/swipe-next.webp) | ![The same card dragged right and held. The photograph has slid right and tilted the other way, and a red GO badge has appeared on the corner still on screen, over the plate reading Cunz Hall 160.](docs/media/swipe-go.webp) |
| Left: the next room, nearest first. | Right: this one, and the way there. |

The buttons under the card do the same two things, and so do the left and right
arrow keys. A gesture nothing announces is unreachable from a keyboard and
invisible to a screen reader. They were also, until `scripts/shoot.mjs` tried to
press one, doing nothing at all: the card takes the pointer capture to follow a
drag, and pointer capture retargets the *click* onto the capturing element, so
every press of the bin went to the card and was swallowed. A hundred and twenty
presses left the first room on screen. The card steps aside for a control now,
the way the sheet already did for its handle and its search field.

**Throw the card down and you are back at the question.** There is no back arrow
on this screen: it was a third piece of chrome on a photograph, and the duration
is one tap to set again. The gesture is not printed anywhere either, because a
label is one more thing to read on a screen whose whole argument is that one room
is the answer -- but it is in the card's accessible name, where a screen reader
reads it out, since a gesture nothing announces is not learnable at all by
somebody who cannot see the card move.

## Three lines in the corner

What the back arrow used to be, on the two screens that no longer have one. It
holds the choices a screen with one room on it has nowhere else to put.

| |
| :--: |
| ![The same photograph of Cunz Hall 160, darkened, with a dark rounded panel open under three lines at the top left. It reads Back, See all rooms, Pick your building, Check again, What Vacant knows.](docs/media/menu.webp) |
| Back first, because that is the one a screen without an arrow is missing. |

It is a disclosure and not a `role="menu"`: that role promises the arrow keys
move between the items, and announcing a keyboard model the app does not
implement is worse than announcing none. Escape closes it, so does a press
anywhere off the panel, and so does leaving the screen it was opened on.

## Take it and it shows you the way

The map with the room lit on it, an arrow to it, one plate naming it, and the
rest of the ranking peeked underneath. The room's **calendar** is what taking a
room makes irrelevant, not the other rooms: one tap on a row moves the arrow and
the plate to it, which is the cheapest change of mind in the app.

| |
| :--: |
| ![The campus map at night filling the top of the screen, with Cunz Hall's footprint outlined in red, a dashed line running from the blue dot to it and an arrowhead pointing into the building. A frosted plate near the top reads Cunz Hall 160, with no class, 4 min and 42 seats under it. Below the map, the ranked list with Cunz Hall 160 lit in red at the top of it, then Dulles Hall 012, PAES A111 and Journalism Building 106.](docs/media/way.webp) |
| The answer, the way to it, and the runners-up. |

This screen has no back arrow either. The menu's **Back** leaves it, and so does
pulling the sheet's grip down through its travel, which is the same gesture that
leaves every other screen in the app. Both land on the card you took, deck still
on the same room, so one more swipe is the next one.

## Say no to all of them

Then the last card offers the ranking as a list, which is every row the deck
would have shown you, one per building, nearest first.

| |
| :--: |
| ![The ranked list, filling the screen with no map behind it. One room per building, under a line reading "You asked for 2h00." Cunz Hall 160, 4 min walk, no class rest of today, 42 seats. Dulles Hall 012, 4 min, no class rest of today, 25 seats. Seven more below them.](docs/media/list.webp) |
| Behind the end of the deck, for when you would rather scan. |

| | |
| :--: | :--: |
| ![The same list after one tap, dropped to make room for the map. Cunz Hall 160's building footprint is outlined in red, a dashed line runs from the blue dot to it with an arrowhead pointing into the building, and its row is lit in the list below.](docs/media/room.webp) | ![The room screen for Cunz Hall 160: no class in here for the rest of today, yours for 8h26 once you get there, 4 min walk, 42 seats, classroom, then Wednesday drawn as a calendar from 6 AM with two red blocks, KNSISM 3208 from 8:00am to 8:55am and KNSISM 3550 from 9:10am to 10:05am, and everything else empty](docs/media/timeline.webp) |
| Take a room and the map comes up pointing at it. | Tap it again for its whole day, doors included. |

## The picture is the room

The card shows the room, because a room you can see is a room you can recognise
from the corridor, and "Cunz Hall 160" never told anybody that. It is the whole
screen: one frosted plate near the top, and the two verdicts on the bottom
corners. The plate is narrower than the phone and centred in it, so it reads as a
label ON the photograph rather than as a bar across it.

**The top of the frame is stretched to make it fit.** A 3:2 photograph in a
1:2.2 screen is a 3.25x aspect gap, and a cover crop pays for it in width: 31%
of the room, and since every one of these is shot from the back, half of that
column is foreground carpet. So the ceiling pays instead. It is flat, the plate
sits over it, and stretching it buys back **72% of the width** for the part of
the room you are looking at. `drawWarp()` maps the source to the screen as
`y ** p` over 240 bands on a canvas. The exponent is derived per photograph
rather than fixed, because 219 of the 306 are 3:2 and the rest run from 4:3 to
16:9: the knob is how much taller than natural the BOTTOM of the picture may be
drawn, and `p` falls out of that and the aspect. At the shipped 1.23x, the top
120px of the phone comes from the top 14 source rows of a 3:2 room and the top 6
of a 16:9 one, and both read as a high ceiling rather than as a distortion.
`dev/warp.html` is the bench those numbers came off: both sliders, all 306
rooms, and a line showing how much of the picture the plate hides.

The screen is the picture and two icons, the same size and the same distance
from their own corner. There is no third one. The back arrow that used to sit
opposite them went because the card is a photograph and every glyph on it is
something between the reader and the room, and the ranking has never had a
control because an unlabelled glyph is a puzzle and a label is one more thing to
read.

**306 of the 425** have one. The other 119 are departmental rooms nobody has
photographed, and they get the same card without a picture: the words were always
the answer.

They come from OTDI's [Learning Spaces
directory](https://learningspaces.osu.edu/classrooms), which serves them from
`rooms.app.it.osu.edu` at an address that can be built from a room id. The
Registrar publishes the same rooms behind an opaque `/media/<hash>/` path with
a **REGISTRAR - 2022** watermark burnt into the frame, so that copy is neither
addressable nor the one you want.

The originals are 1620x1080 JPEGs of up to 1.34 MB. `scripts/fetch-room-photos.mjs`
resizes them to 900 wide and re-encodes them as WebP, which is **39 KB each and
11.7 MB for all 306**, and commits them. Hotlinking would have put a megabyte on
the one screen a student opens in a stairwell, would break the day OSU moves a
file, and would tell OSU's server which room each reader is looking at, which
[the privacy page](privacy.html) promises this app does not do with anything
else. None of them are precached: each arrives with the card that shows it, and
is kept from then on.

Photographs &copy; The Ohio State University, OTDI Classroom Services.

## Put it on your home screen

You do not have to. But it is built to be installed, and installing it is what
makes it answer in a stairwell.

On iPhone, open it in Safari and tap Share, or **...** then Share if your tab bar
sits at the bottom, then **Add to Home Screen**. iOS 26 defaults to that Compact
layout, which is why the app offers you both. On Android, Chrome has **Install
app** in its menu.

Installed, the whole app is 144 KB of shell and 90 KB of schedule, gzipped, and
none of it is fetched again to answer a question. Turn the network off, open it,
and it still ranks rooms. That matters because the moment you want it most is the
moment you are in a basement with one bar.

## What it refuses to guess

Vacant reads the class schedule. A class schedule is not a reservation calendar
and it is not a door. Three things are true and the app says all three on screen:

**Doors get locked.** This is the failure every other tool in this category ships
with, and at Ohio State it is avoidable, because the Registrar publishes an open
and close time per building per weekday. Measured against the committed index,
**424 of the 425 rooms have no Saturday class at all this term**. A tool that
stops at the schedule calls all 424 of them free on a Saturday. **367** of those
sit in a building the Registrar publishes as closed that day, and **57** are in a building that is
genuinely open.

**A door nobody documents is not offered at all.** The Registrar's table covers 47 buildings.
The index touches 46 of them, and 0 of the 425 rooms sit in a building whose hours are unpublished,
because a room in one does not ship.

That used to be a label. 90 rooms rode along in their own tier reading `hours not
published`, which was honest and was still the wrong answer: "here is a room, and
we cannot tell you whether you can get into the building" is not an answer, and
it cost four blocks of explanatory text across three screens to say. Over 5,040
ranked rows measured from four origins across a week, not one of them ever
reached a top ten. They were paying for themselves in prose and returning
nothing.

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

Everything the page fetches to produce a ranked list is **fourteen files, 472 KB,
or 108 KB over the wire once gzipped**. Measured with `node:zlib` over the tree
as committed. The campus map is another 98 KB, 38 KB gzipped, and is warmed after
the first answer rather than before it.

| Where | What is in it |
| --- | --- |
| `index.html` | The whole shell. Markup and CSS, no framework. |
| `js/app.js` | Four screens in one sheet: the card, the list, one room, the buildings. |
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
npm test                        # node --test, 842 tests, no network
node scripts/shoot.mjs          # redraw docs/media from the real app
```

### Stand somewhere else, on a different day

Open **`http://localhost:8000/dev/`**. It asks the two questions first: what
minute, and where are you standing. Tap the campus map to drop a pin anywhere,
or pick a building, or take one of seven one-tap jumps to Thanksgiving, finals
week, Saturday at 3am or winter break. Then it hands off to the real app.

Once you are in, `?dev=1` or three presses of **D** opens a panel that changes
the same two things without leaving the screen you are on.

It is not a preview. It moves the same clock every screen reads and the same
origin the ranking measures from, then repaints through the same code path a
duration button uses, so the answer on screen is the answer a student would get.
The readout at the bottom of the panel says whether the clock is live or
simulated, and it says which rooms came back and why the app refused if it did.

`js/dev.js` is loaded on demand and is not in the service worker's shell list, so
a phone that never asks for it never downloads it.

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

- **The list is a room list where it should be a place list.** Forty rows came
  back across thirteen buildings, and one of them took six of them.
  [#62](https://github.com/EnesYilmazcode/Vacant/issues/62).
- **Nobody has walked to a room the app called free and checked.** That is the
  measurement the whole thing rests on and it has not been taken.
  [#26](https://github.com/EnesYilmazcode/Vacant/issues/26) is the walk, and
  `spikes/walk.html` is the checklist to walk it with.

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
  the real app, on a pinned clock and a pinned location, and refuses to write a
  frame of a screen that has not stopped moving. Re-running it on an unchanged
  tree writes the same five files. It also writes down what each screen said, in
  `docs/media/frames.json`, and a test holds the alt text above to it.

## Licence

The code is MIT, in [LICENSE](LICENSE).

The data is derived from Ohio State's own public services: the class schedule at
`content.osu.edu`, the building layer published by OSU Facilities Information and
Technology Services GIS, and the classroom pool schedule from the Office of the
University Registrar. Each file in `data/` carries its source and attribution
inside it. Vacant is not affiliated with Ohio State. How that gets stated on the
site is [#25](https://github.com/EnesYilmazcode/Vacant/issues/25).
