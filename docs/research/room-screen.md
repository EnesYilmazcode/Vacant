# The room screen

Research note, 2026-08-27. Assignment: design the thing that opens when a result
is tapped, showing that room's schedule "so you can see other stuff as well".

Every number below was measured against the repo's own shipped data
(`data/rooms-1268.json`, 871 rooms, 12,168 busy intervals, from a full
545-request harvest) or against live services today. The commands are in
[What I measured](#what-i-measured).

---

## The one thing to read

**The problem:** the owner asked for both "a sheet thing" and "another screen",
and the app already has exactly one panel, `#sheet`, sitting over a full-bleed
map, so a second sheet stacks sheets and a full screen hides the building
highlight that the very same tap just drew.

**The fix:** the room screen is a second route *inside the existing sheet, at the
existing sheet height*. The map never moves, the highlight and the line stay on
screen, and the back arrow swaps the pane back with the list's scroll position
intact.

```
  TAP A ROW -> ONE GESTURE, TWO PAYOFFS, NO NEW SURFACE

  before                        after
  +--------------------+        +--------------------+
  |                    |        |        ___         |
  |    map, campus     |        |     ,-'   `-.      |  building lit up
  |                    |        |    ( HAGERTY )     |  line drawn from you
  |         o you      |        |     `-.___,-'      |
  |                    |        |         \          |
  |                    |        |          o you     |
  +--------------------+ 62%    +--------------------+ 62%  <- sheet does not move
  | Free for 1h        |        | <-  Hagerty 145    |
  | Hagerty 145  3 min |        | Free till 4:10p    |
  | Page 240     3 min |  --->  | Thu Fri Sun Mon    |
  | Drinko 245   3 min |        | 7:00a  free  2h35  |
  | Caldwell 177 10min |        |   9:35a TURKISH    |
  +--------------------+        +--------------------+

  The sheet is the app's only panel. Routing inside it is why both of the
  owner's words are true at once: it IS a sheet, and it DOES take you to
  another screen.
```

Three measurements decide the rest of the design.

```
  a room's whole week of schedule costs        5.3 microseconds to build
    and zero bytes of network                  (busy[] is already in memory)

  a day drawn with gaps as first-class rows    p50 5 rows, p90 9, max 13
    once 15-minute passing periods are seamed  (fits with no scrolling)

  40.0% of the free blocks in a day are        an unfiltered timeline is
    under 20 minutes                           two-fifths corridor traffic
```

---

## Contents

1. [Sheet or screen, and the URL](#1-sheet-or-screen-and-the-url)
2. [The schedule view: today, week, or a switcher](#2-the-schedule-view-today-week-or-a-switcher)
3. [What a schedule row shows, and what the course code costs](#3-what-a-schedule-row-shows-and-what-the-course-code-costs)
4. [Gaps are the content, classes are the frame](#4-gaps-are-the-content-classes-are-the-frame)
5. [The rest of the screen](#5-the-rest-of-the-screen)
6. [The seven states](#6-the-seven-states)
7. [Mockups](#7-mockups)
8. [What I measured](#what-i-measured)
9. [Corrections to existing research](#corrections-to-existing-research)
10. [Risks and open questions](#risks-and-open-questions)

---

## 1. Sheet or screen, and the URL

### What already exists, which settles most of it

`index.html` and `js/app.js` are built. The app is a full-bleed
`<canvas id="map">` with one bottom sheet over it:

```
#sheet   position: fixed; bottom: 0; max-height: 62%
  header   .grip + h2#head "Free for 30 min, nearest first" + button#again "change"
  #list    button.row x40  ->  .name (id + building)  +  .meta (walk / yours for / seats)
```

Tapping a row today does one thing: it sets `state.selected`, moves the accent
bar, and re-targets the map. There is no room screen at all.

That existing shape rules out two of the three candidates before any taste is
involved.

| Candidate | Verdict |
| --- | --- |
| A second sheet stacked over the list sheet | **Rejected.** Two grips, two dismiss gestures, and the map is now two layers back. On iOS, a sheet over a sheet is also where the "cannot dismiss" bugs live |
| A full screen that replaces the map | **Rejected.** The same tap that opens this screen is the tap that highlights the building and draws the line. Hiding the map immediately deletes the owner's headline feature at the exact moment it fires |
| **A route inside the existing sheet, at the existing height** | **Recommended.** The map keeps its 38% of the screen, the highlight stays visible, and the only thing that changes is which pane the sheet is showing |

### The sheet height does not change, and that is arithmetic not taste

The temptation is to grow the sheet to 88% so the schedule has room. Do not.

At 390 x 844, a 62% sheet is 523 px. Header 56, safe-area bottom 34, the facts
block 90, the day strip 48. That leaves **295 px of scrollable schedule, about
six and a half rows at 44 px each**. The measured seamed day timeline is **p50 5
rows**, so half of all rooms show their entire day with no scroll at all, and the
map never leaves.

Growing to 88% buys roughly three more rows and costs 101 px of map, which is a
sliver, not a map. Those three rows are worth less than the highlight they hide.

Keep the grip. Dragging up to full height stays available for anyone who wants
the whole week at once, but it is the user's choice rather than an imposed layout
jump. A layout that never animates is also free `prefers-reduced-motion`
compliance.

### The URL is `?room=`, and that is measured rather than stylistic

The room must be linkable, and on GitHub Pages exactly one URL shape survives a
recipient who has never opened the app:

```
$ curl -sS -o /dev/null -w "%{http_code}  bytes=%{size_download}\n" <url>

https://enesyilmazcode.github.io/Vacant/                 200  bytes=7273
https://enesyilmazcode.github.io/Vacant/?room=HH0145     200  bytes=7273
https://enesyilmazcode.github.io/Vacant/room/HH0145      404  bytes=9379
https://enesyilmazcode.github.io/Vacant/room/            404  bytes=9379
```

**A path segment is a real 404** for anyone without the service worker installed,
which is precisely the population that receives a shared link. The service worker
navigation fallback in [`pwa-ios.md`](pwa-ios.md) rescues the path form only
*after* install, so it fixes the case that was never broken and misses the case
that matters.

So:

```
  /Vacant/?room=HH0145                  one room, today
  /Vacant/?room=HH0145&on=2026-09-04    one room, one date  (optional)
```

Four consequences worth writing down now.

1. **`start_url` stays `/Vacant/`.** An installed app must open clean.
   [`ux-states.md`](ux-states.md) already decided the selected room does not
   persist, and a `start_url` carrying a room would quietly break that.
2. **A cache-first service worker that calls `caches.match(request)` will MISS on
   `?room=`.** Pass `{ ignoreSearch: true }`, or match the shell path explicitly
   the way `pwa-ios.md` already writes it. This is a one-line bug that turns every
   shared link into a cold network fetch, and offline into a blank screen.
3. **A shared link opens in Safari, not in the installed app.** iOS does not route
   in-scope links to a home-screen web app. Nobody should design as if it does.
4. **The optional parameter is a date, not a weekday.** See
   [section 2](#2-the-schedule-view-today-week-or-a-switcher) for why a weekday is
   not enough for 13% of rooms.

### The back arrow, history, and getting back to row 40

The owner asked for a back arrow top left in place of `#again`. On the room
screen it does exactly one thing: return to the list.

```js
// open
history.pushState({ room: id }, '', `?room=${id}`);
showRoom(id);

// the back arrow and popstate are the same path
back.onclick = () => history.back();
addEventListener('popstate', (e) => (e.state?.room ? showRoom(e.state.room) : showList()));
```

**Keep both panes in the DOM and toggle `hidden`. Do not rewrite the sheet's
`innerHTML`.** That is the entire scroll-restoration mechanism: `#list` keeps its
`scrollTop` because it was never destroyed, so someone 40 rows down comes back to
row 40 for free, with no saved offset and no restore logic to get wrong.

This contradicts `ux-states.md` on purpose. That note says scroll position
"deliberately does not persist" and that restoring it "is a desktop instinct that
actively hurts". That is right **across launches** and wrong **within a session**.
Losing your place in a 98-row list because you looked at one room is the most
annoying thing this screen could do. The rule should read: scroll position is
discarded on launch, preserved across an in-session room visit.

iOS standalone mode has no reliable browser back gesture, so the arrow is the only
affordance guaranteed to exist. Give it a 44 px target, put it top left where the
owner asked, and additionally let a downward drag on the grip return to the list
rather than collapsing the sheet.

### The one thing this screen does not need is a GPS fix

The schedule is a pure function of the room index and the clock. It renders before
geolocation resolves, which is what makes the cold deep-link path work:

```
  t+0ms      shell paints from cache
  t+~80ms    room index is in memory
  t+~80ms    ROOM SCREEN IS COMPLETE except for two fields
  t+0.5-3s   fix arrives  ->  "3 min" and "176 m" fill in
```

Render walk time as an empty slot that fills, never as a spinner that blocks the
schedule. This is the only screen in the app that is fully useful before the fix
lands, and a deep link opened in a stairwell should demonstrate that by working.

---

## 2. The schedule view: today, week, or a switcher

### It costs nothing, so the question is only what is readable

Building a full Mon-to-Fri timeline for a room, merging intervals, applying the
active session mask and computing the gaps, takes **5.3 microseconds**. For all
871 rooms at once it is 4.6 ms. The `busy[]` array is already in memory from the
cold-launch parse, so a week grid costs **zero extra network and zero extra
bytes**. Any argument that a week is "too expensive" is false here.

```
$ node tl.mjs
build a FULL WEEK timeline for all 871 rooms, ms: 21.92 8.86 5.44 4.60 4.98 5.11 5.01
per room, whole week, us: 5.3
```

So the four candidates get judged on legibility alone.

| Candidate | Rows on screen | Verdict |
| --- | --- | --- |
| Today only | p50 5, p90 9 | **Not enough.** 18% of room-weekdays have no class at all, so today collapses to one row and the screen says nothing |
| Full week grid, five columns | 5 columns at ~8 chars | **Rejected.** At 390 px a five-column grid gives each column about 70 px. Course codes are 10.5 characters. Every cell truncates |
| Full week as one scrolling list | mean 31.6, p90 59, max 86 | **Rejected as a default.** Fine as a drag-up, hostile as the thing that appears on tap |
| **A day strip that swaps the list in place** | 5 chips + p50 5 rows | **Recommended** |

**Recommendation: a five-chip day strip above a single-day timeline, defaulting to
today, except when today is empty, where it defaults to the week list.**

That default flip is the whole trick. Measured on the shipped index:

```
  room-weekdays (Mon-Fri) with no class at all   790 / 4355 = 18%
  rooms with no class on a given weekday         Mon 23%   Tue 13%   Wed 12%
                                                 Thu 13%   Fri 30%
```

On roughly one visit in five, "today" is a single row reading "free all day",
which is true, useless, and looks like a bug. The week is exactly the right thing
to show there, because a room with an empty Thursday and one class on Monday is a
*good* room and the week is what proves it.

### The chips are dates, and they are the days this building is open

Two rules, both forced by data rather than chosen.

**Rule 1: label the chips with a date, not a weekday.** 110 of 871 rooms, **13%**,
have a different Monday-to-Friday pattern in the second half of the term than in
the first, because Ohio State runs 7-week sessions inside the 14-week term. The
shipped index carries ten distinct session date ranges. A chip reading "Mon" is
therefore ambiguous for one room in eight, and the ambiguity resolves silently and
wrongly. A chip reading "Mon 31" is a date, resolves the session mask, and is one
character wider.

```
$ python -X utf8 sess.py
rooms whose Mon-Fri pattern CHANGES between the two halves of the term: 110/871 = 13%
room-weekdays that differ: 210/4355 = 5%
```

**Rule 2: the strip lists today, then the next four days on which this building is
open.** Not "the next four weekdays". The published Registrar hours make weekends
a per-building fact rather than a global one:

```
  buildings with published hours that are CLOSED on Saturday   42 of 47
  buildings with published hours that are CLOSED on Sunday      36 of 47
  rooms with any Saturday interval in the index                 4 of 871
  rooms with any Sunday interval                                2 of 871
```

So the strip is different per building, and correctly so. From Thursday Aug 27:

```
  Caldwell Laboratory   Thu 27  Fri 28  Sun 30  Mon 31  Tue 1
    (Sun 12p-10p, Sat closed)            ^^^^^^ Sunday afternoon is real inventory

  Page Hall             Thu 27  Fri 28  Mon 31  Tue 1   Wed 2
    (Sat and Sun closed)
```

A day the campus calendar marks "no classes, offices closed" is dropped from the
strip too, because the door is locked. A day marked "no classes, offices open"
(Autumn Break, Oct 15 and 16) stays, because those are the best days of the term.
Today is always the first chip whatever it is, so a closure day that *is* today
still gets its own screen ([state G](#7-mockups)).

### "Next 7 days" is the same thing with worse ergonomics

It was worth taking seriously, because it is the only candidate that carries
closure and exam dates natively. It loses on two counts. It produces a seven-row
list where five chips fit on one line, and the extra information it carries is
already carried by rule 2 above, which drops closed days from the strip and marks
today. Ship the strip, not the list.

### This is not a second time control

illiniSpots deleted 100 lines on 2026-08-26 (commit `ref(ui): consolidate time
filter into free until (#41)`) because they had shipped two controls that computed
the same number and users could not tell them apart. `ux-states.md` and issue #18
both carry that warning forward.

The day strip is safe from it, but only if it is enforced as read-only:

- Switching off today **does not re-run the ranking query**, does not change the
  result list, and does not change the duration chip.
- The header's live claim must visibly change when you leave today. Mockup A says
  "Free till 4:10p" because that is a claim about now. Mockup D says "Fri 28, free
  2:45p to 9:00p", which is a description, not a promise.
- Walk time stays labelled as being from where you are standing now, because it is.

---

## 3. What a schedule row shows, and what the course code costs

### Show the course subject and number. Never the title, never a person.

`legal-privacy.md` is unambiguous that `instructors[]` is stripped at the parse
boundary and never enters the model, so instructor names are not available and
must not be. Everything else in the meeting object is course metadata rather than
person data.

What remains worth showing, in order:

| Field | Ship it? | Why |
| --- | --- | --- |
| Time range | Yes | It is the row |
| Subject + catalog number, e.g. `ENGLISH 2291` | **Yes** | It is the trust builder. It shows the raw fact the recommendation came from, and it lets a student recognise their own class |
| Course title, e.g. "Intro to Computing Technology" | **No** | 30 to 60 characters against a 46-character grid, and it answers a question nobody standing outside is asking |
| Component (Lecture / Laboratory / Recitation) | **No** in v1 | Available and it does hint at run-over risk (`Lecture` 64.2%, `Laboratory` 16.9%, `Recitation` 11.6%, `Seminar` 5.7% of labelled intervals), but it is a third field on a row that already has two |
| Instructor | **Never** | Stripped at the parse boundary, by design and by guard |
| Enrollment count | No | Off-thesis and it changes hourly, which would break the weekly build cadence |

**Coverage is not a problem.** Joining the harvest back onto the shipped index by
`(facilityId, weekday, start, end, session)` labels **12,115 of 12,168 intervals,
99.6%**. The 53 misses are worth an unlabelled row, not a feature.

**One case needs a shape, not a special case.** 713 intervals, **5.9%**, sit in a
merged block that holds more than one distinct course. Those are cross-listed
sections sharing a room and slot. Render them joined with a slash
(`MATH 5633 / CSE 5633`) and truncate at two with a `+2`, rather than emitting two
rows for one occupancy.

### There is a harvester bug here, and it doubles the label table

The API exposes the subject twice, and the harvester currently stores the wrong
one. Verified live today:

```
course.subject   = 'CSE'                              <- the short code
section.subject  = 'Computer Science & Engineering'   <- the display name

$ python probe.py   # 6 subjects, all confirmed
philos    course.subject='PHILOS'   section.subject='Philosophy'
ece       course.subject='ECE'      section.subject='Electrical and Computer Eng'
turkish   course.subject='TURKISH'  section.subject='Turkish'
hindi     course.subject='HINDI'    section.subject='Hindi'
pubafrs   course.subject='PUBAFRS'  section.subject='Public Affairs, John Glenn Sch'
law       course.subject='LAW'      section.subject='Law'
```

`data/harvest-1268.json.gz` records `section.subject`. Measured over the 3,526
distinct course labels campus-wide, that is a **mean label length of 22.3
characters instead of 10.5**, and a label table of 88,535 raw bytes instead of
47,432. It also does not fit a 46-character row:
`Kinesiology:Sprt, Ftns & Hlth Pr 1169.11` is 40 characters before the room name
is on screen.

**Switch the harvester to `course.subject`.** That is the fix, and it belongs to
issue #7 or #8 rather than to this screen.

### What the course code costs, measured on the real index

Four encodings, all built from the shipped 871-room index and the real harvest:

```
                                              raw bytes    gzipped
  data/rooms-1268.json as it ships today        239,466     27,382
  the same, with a course id on every interval  343,332     61,874   +126% gz
  packed .bin (query-engine.md layout)           96,304     22,247
  packed .bin with a u16 course id inline       168,083     55,638   +150% gz

  courses-1268.bin  as a SIDECAR (labels only)   71,772     23,689
```

Two things fall out that I did not expect.

**The sidecar is cheaper than inlining, not just better placed.** Packed base plus
sidecar is 22,247 + 23,689 = **45,936 bytes gzipped**, against **55,638** for the
same data inlined. Splitting the high-entropy course-id stream away from the
low-entropy interval stream lets gzip do better on both, a **17% saving** for
free.

**All of that cost is install bytes, none of it is cold-launch time.** The sidecar
never touches the critical path. Parsed lazily on the first room-screen open,
measured on this box:

```
$ node bench.mjs
sidecar.json JSON.parse ms:  4.4 14.1 2.9 4.5 2.5 2.3 4.3
sidecar.bin  read ms:        1.4 0.4 0.4 0.4 0.4 0.4 0.4
```

At the 4x to 8x mid-range-phone multiplier that `query-engine.md` uses, the binary
sidecar is 2 to 11 ms, comfortably inside one frame of a sheet transition. The
JSON form is 10 to 110 ms, which is visible.

**Recommendation:**

```
  data/rooms-<term>.bin      intervals, no courses    cold path, parsed at launch
  data/courses-<term>.bin    u16 per interval +
                             the label table          precached, parsed on first
                                                      room-screen open, never at launch
```

Layout, mirroring the packed format in `query-engine.md`:

```
  offset  bytes            contents
  0       4                u32LE  labelJsonLen
  4       labelJsonLen     JSON array of "SUBJ 1234" strings, sorted
  ...     2*nIntervals     u16LE index into that array, in the same order as
                           the interval block in rooms-<term>.bin
                           0xFFFF means no label
```

Same order, same count, one file. If the phone measurement in issue #29 says
install size matters after all, the sidecar is the single file you delete and the
screen degrades to unlabelled `in use` rows with no other change.

### One privacy line worth putting in writing

A room plus a time plus a course code is a lookup for "which class is in this room
right now", and Ohio State already publishes exactly that on
`classes.osu.edu`. Nothing new is exposed. What would be new is the instructor
name attached to it, which is why `legal-privacy.md`'s parse-boundary strip and
its fatal PII guard are load-bearing for this feature and not only for the index.
The guard should stay fatal after the sidecar exists, and the sidecar should be
scanned by it too.

---

## 4. Gaps are the content, classes are the frame

### The inversion

A normal timetable draws classes and leaves the gaps as whitespace. This screen
must do the opposite, because the person reading it came here to find the gap.
Free blocks get the left margin, the full weight and the duration. Classes are
indented, dimmed, and carry no duration at all.

```
  a timetable                      the room screen
  +--------------------------+     +--------------------------+
  |                          |     | 7:00a   free        2h35 |  <- content
  |  9:35 TURKISH 3797       |     |         9:35a  TURKISH   |  <- frame
  |                          |     | 10:55a  FREE        5h15 |
  |  4:10 HINDI 1101         |     |         4:10p  HINDI     |
  |  5:20 HINDI 1103         |     |         5:20p  HINDI     |
  |                          |     | 6:15p   free         45m |
  +--------------------------+     +--------------------------+
     the eye lands on classes         the eye lands on free time
```

In CSS that is: free rows at full width with an accent left border and 1rem type,
busy rows inset by 8ch at 0.85rem in `--dim`. Never encode the difference in
colour alone. The words "free" and the indent both carry it, per the accessibility
contract in `ux-states.md`.

### Seam the passing periods, do not row them

**40.0% of the free blocks in a Mon-to-Fri day timeline are under 20 minutes.**
Ohio State's standard passing period is 15 minutes and `query-engine.md` measured
it at 69.3% of all inter-class gaps. Giving each one a row fills the screen with
corridor traffic.

```
$ python -X utf8 micro.py
free rows in a Mon-Fri today view, by length: total 14773
   60+     7714 = 52.2%
   <20     5911 = 40.0%
   20-59   1148 =  7.8%
rows, every gap a row      : mean 6.32 p50 5 p90 13 p95 14 max 20
rows, gaps under 20m seamed: mean 4.96 p50 5 p90  9 p95  9 max 13
```

Seaming gaps under 20 minutes takes p90 from 13 rows to 9 and the worst case from
20 to 13. The 20-minute floor is the same one `ux-states.md` already sets for
near-miss results, so the two screens agree.

**Seam, do not merge.** A merged block would report the gap's end as the start of
the *second* class, which is a lie about when the room is actually free. The seam
is a 2 px rule between two busy rows with no text, which preserves the truth that
they are separate classes while spending no vertical space. Under VoiceOver the
seam is `aria-hidden`, and the two busy rows read as two rows, which is correct.

### The block is not your share, and this trap is easy to fall into

Hagerty Hall 145 on Thursday at 12:15 renders a free block of **5h15**, from
10:55a to 4:10p. The header says **3h42**. Both are right and they are different
things.

```
  the schedule row  ->  how long the room is empty      10:55a to 4:10p   5h15
  the header        ->  how long YOU get                arrival to 4:00p  3h42
                        = (gapEnd - PACKUP) - (now + walk)
                        = (970 - 10) - (735 + 3)  =  222 min
```

The 10-minute pack-up buffer and the walk time are both in the second number and
neither belongs in the first. Label them differently and never let the same word
serve both: the row says **free**, the header says **yours**.

### Row grammar, fixed

```
  FREE   |  <start>   free            <duration right-aligned>
         |  10:55a    FREE            5h15        <- the block containing now
  busy   |            <start>  <SUBJ NUM>
         |            9:35a    TURKISH 3797
  seam   |            (a 2px rule, no text, aria-hidden)
  edge   |            7:00a    <Building> opens
         |            7:00p    <Building> closes
```

`FREE` in caps is the block containing "now" on today's view. Every other free
block is lower case. That is one glyph of state and it removes the need for an
arrow, a colour, or a badge.

---

## 5. The rest of the screen

### The facts line

One line, one glyph and four facts, in the order the eye needs them:

```
  (>) 3 min   176 m   30 seats   seminar
   ^     ^      ^        ^         ^
   |     |      |        |         `- room type, words not codes
   |     |      |        `----------- capacity, or "seats unknown" for the 44
   |     |      |                     rooms with facilityCapacity 0
   |     |      `-------------------- metres, because "3 min" hides a 2x range
   |     `--------------------------- walk minutes
   `--------------------------------- the walking glyph the owner asked for,
                                       replacing the word "walk"
```

Room *type* appears here and nowhere else. `ux-states.md` correctly keeps it out
of the result row, because the query already restricts to `1A`, `1B` and `1C` so
printing it in a list of 98 identical values is noise. On a single room it is not
noise, it is the difference between a 20-seat seminar room and a 221-seat lecture
hall, and it is one word: `seminar`, `classroom`, `lecture hall`.

### Building hours: three states, and 28% of rooms are in the third

```
  rooms in a building with published Registrar hours   626 / 871 = 72%
  rooms with no published hours at all                 245 / 871 = 28%
  restricted to safe types 1A / 1B / 1C                126 / 514 = 25%
```

`data/buildings-hours.json` says it plainly at the top: *"A building absent from
every term below has NO published hours. It must be shown as unknown, never as
assumed or usually open."* The room screen is where that instruction has teeth,
because it is the screen with room for a sentence.

- **Hours known:** draw them as the timeline's edges. `7:00a Hagerty Hall opens`,
  `7:00p Hagerty Hall closes`. The free block after the last class ends at close,
  not at midnight.
- **Hours known and closed today:** the day is dropped from the strip. It cannot
  be reached.
- **Hours unknown:** **bound the timeline by the room's own first and last class
  that day, and draw nothing outside it.** Not 8am to 10pm, not midnight.
  `before 10:00a, not known` and `after 6:25p, not known` are the honest terminal
  rows. The app knows the door was open at 10:00a because a class met there. It
  knows nothing about 8:00a. See [mockup E](#7-mockups).

That last rule is the one place the room screen is stricter than the result list,
and it should be. The list has to rank something; this screen only has to be true.

### The map, the highlight and the line

`data/campus.json` already ships: 302 building polygons, 836 streets, 398
landscape and 8 water features, delta-encoded, 128,842 bytes raw and 51,823
gzipped, decoded by `js/campus.js` and drawn by `js/map.js`, which already carries
`PALETTE.target` and `PALETTE.line`. The no-map recommendation in `ux-states.md`
was overtaken by that work, and the room screen should assume the map exists.

On the room screen the map does three things and no more:

1. Fill the 38% above the sheet.
2. Light the one building this room is in.
3. Draw the line from the user to it.

It does **not** re-centre, animate, or zoom when the day strip changes, because
the building does not move on Friday.

**If the basemap does not ship,** the schedule is unaffected. The 38% collapses,
the sheet takes the screen, and the bearing arrow from `ux-states.md` fills the
gap. Nothing in this note depends on the map existing.

### Action buttons: one survives, and it is not the one that was planned

`ux-states.md` proposes `[ Open in Maps ]`. Now that an in-app map ships, that
button is answering a question the screen above it already answered, and it costs
a 44 px row plus a hand-off to a network-dependent app in a building where the app
promises to work offline.

| Button | Verdict |
| --- | --- |
| `Open in Maps` | **Cut.** The in-app map with a highlight and a line answers "where is it". Keep the `geo:` hand-off as a long-press on the map, not a button on the sheet |
| `Was it open?` | **The one that survives**, but phase 4 only. It is the project's only real moat per `prior-art.md`, and the room screen is the only place in the app with a single unambiguous room to report about |
| Share / copy link | **Cut.** The URL is already in the address bar in Safari, and in standalone mode there is no address bar and no share button that would not need building |
| Favourite / bookmark | **Cut.** Roomix has accounts and bookmarks. Adding them here reopens the backend question that the whole architecture exists to avoid |

So v1 ships zero action buttons on this screen. The exam-window state
([mockup F](#7-mockups)) is the single exception, where a link out to the
Registrar's exam schedule is the only useful thing left to offer.

### The caveat

Once, at the bottom, in full. This is the screen where it earns its space, because
there is one room rather than 98 and it is the last thing read before someone
walks. The wording matches the list footer so it does not read as a new warning:

```
  Class schedule only. Clubs book rooms and doors get locked.
```

Plus, per the accessibility contract, in the accessible name of the room screen's
heading, so a VoiceOver user who lands here from a deep link meets it too.

---

## 6. The seven states

| State | Trigger | What changes |
| --- | --- | --- |
| **Free now, bounded end** | a later class exists today | header claims a clock time; the containing block renders `FREE` in caps |
| **Free now, open ended** | no later class today | header says "no class in here till tomorrow"; the free block still ends at building close when hours are known |
| **Busy right now** | `now` falls inside a busy block | header becomes `In use till 12:30p` plus `Next free 2:05p, for 55 min`. Reachable by deep link and from a near-miss row |
| **No class at all today** | the day's interval set is empty (18% of room-weekdays) | the strip stays, the pane defaults to the **week list**, and a line says why |
| **No class all term** | `busy[]` is empty for every day | not reachable from `rooms-1268.json`, which is harvested from the class API and therefore contains 0 such rooms. It appears once three terms are unioned (issue #30). The copy is a boast, not an apology: *"No class is scheduled in this room at any point in Autumn 2026."* That is the best room on campus |
| **Campus closure day** | today is in the `closed` array | two sub-states. *Offices closed* (Labor Day, Veterans Day, Thanksgiving Day): empty and locked, say both. *Offices open* (Autumn Break Oct 15-16, Thanksgiving Break Nov 25): genuinely the best day of the term, say that instead |
| **Exam window** | `exams.start <= today <= exams.end` | the schedule pane is replaced by a refusal. The facts line, the building, the hours and the map all stay |

Two notes on the last two, both of which depend on issue #11, which is not built:
`data/rooms-1268.json` currently has only `term`, `schema`, `sessions` and `rooms`,
with no `closed` array and no `exams` block. Until they land, the room screen
cannot detect either state, and on Nov 26 it will confidently render an empty
Thursday for a locked building.

**Why exam week refuses rather than shows.** The meeting `endDate` is the last day
of instruction, never the last day of the term, so from Dec 10 to Dec 17 every
room's busy list is empty and the naive screen reports 100% of campus free for a
week. `schedule-edge-cases.md` measured that across three terms. The refusal keeps
the room identity, capacity, building and hours, because those are still true. It
removes only the claim the data cannot support.

---

## 7. Mockups

46-character interior grid, roughly 390 px at body size, matching
`ux-states.md`. Every room, time, course code, capacity, walk distance and
building-hours figure below is read out of the shipped data files or verified
against the live API. Nothing is invented.

### A. Free now, with a bounded end. The default.

```
+----------------------------------------------+
| <-  Hagerty Hall 145                         |
|----------------------------------------------|
| Free till 4:10p                              |
| (>) 3 min   176 m   30 seats         seminar |
|----------------------------------------------|
| Thu 27   Fri 28   Sun 30   Mon 31   Tue 1    |
| ======                                       |
|----------------------------------------------|
| 7:00a   free                            2h35 |
|         9:35a   TURKISH 3797                 |
| 10:55a  FREE   <- you are in this one   5h15 |
|         4:10p   HINDI 1101                   |
|         5:20p   HINDI 1103                   |
| 6:15p   free                             45m |
|         7:00p   Hagerty Hall closes          |
|----------------------------------------------|
| Class schedule only. Clubs book rooms and    |
| doors get locked.                            |
+----------------------------------------------+
```

`HH0145`, capacity 30, `facilityType` 1A, building 037, 176 m and bearing NW from
the Ohio Union. Note the 15-minute seam between HINDI 1101 and HINDI 1103, drawn
as a rule rather than a row, and the Sunday chip, which is there because Hagerty
opens 6:00p to 8:30p on Sundays.

### B. Busy right now.

```
+----------------------------------------------+
| <-  Caldwell Laboratory 177                  |
|----------------------------------------------|
| In use till 12:30p                           |
| Next free 2:05p, for 55 min                  |
| (>) 10 min  759 m   41 seats       classroom |
|----------------------------------------------|
| Thu 27   Fri 28   Sun 30   Mon 31   Tue 1    |
| ======                                       |
|----------------------------------------------|
| 7:00a   free                            2h35 |
|         9:35a   PHILOS 2338                  |
|         11:10a  ENGLISH 2291   <- now        |
|         12:45p  ECE 6001                     |
| 2:05p   free                             55m |
|         3:00p   MATH 1075                    |
|         4:10p   MATH 1075                    |
| 5:05p   FREE                            4h55 |
|         10:00p  Caldwell closes              |
|----------------------------------------------|
| Class schedule only. Clubs book rooms and    |
| doors get locked.                            |
+----------------------------------------------+
```

`CL0177`, capacity 41, type 1B. Three 15-minute passing periods are seamed away
here (10:55-11:10, 12:30-12:45, 3:55-4:10). Without seaming this day is 11 rows;
with it, 8. The header deliberately skips the 12:30 gap: it is 15 minutes, which
is 5 usable minutes after the pack-up buffer, so the next real answer is 2:05p.

### C. No class at all today, so the week takes over.

```
+----------------------------------------------+
| <-  Page Hall 240                            |
|----------------------------------------------|
| No class in here all day                     |
| (>) 3 min   186 m   20 seats         seminar |
|----------------------------------------------|
| Thu 27   Fri 28   Mon 31   Tue 1   Wed 2     |
| ======                                       |
|----------------------------------------------|
| Thu 27  free 7:00a to 8:00p            13h00 |
| Fri 28  free 7:00a to 5:30p            10h30 |
| Mon 31  9:00a   PUBAFRS 8000                 |
| Tue 1   3:00p   HTHRHSC 7574                 |
| Wed 2   2:20p   PUBAFRS 7573                 |
|----------------------------------------------|
| Nothing is scheduled here today or           |
| tomorrow, so the week is showing instead.    |
|----------------------------------------------|
| Class schedule only. Clubs book rooms and    |
| doors get locked.                            |
+----------------------------------------------+
```

`PA0240`, capacity 20, type 1A. This is the 18% case. Its free-block durations
differ per day because Page Hall's published hours differ per day: 8:00p Tuesday
and Thursday, 6:30p Monday, 5:30p Wednesday and Friday, closed both weekend days,
which is why the strip skips to Mon 31.

### D. Another day, chosen from the strip.

```
+----------------------------------------------+
| <-  Caldwell Laboratory 177                  |
|----------------------------------------------|
| Fri 28, free 2:45p to 9:00p                  |
| (>) 10 min  759 m   41 seats       classroom |
|----------------------------------------------|
| Thu 27   Fri 28   Sun 30   Mon 31   Tue 1    |
|          ======                              |
|----------------------------------------------|
| 7:00a   free                            2h10 |
|         9:10a   PHILOS 2338                  |
|         10:20a  CSE 6520                     |
|         11:30a  MATH 3345                    |
|         12:40p  CSE 2231                     |
|         1:50p   ECE 5000                     |
| 2:45p   FREE                            6h15 |
|         9:00p   Caldwell closes              |
|----------------------------------------------|
| Tomorrow. Walk time is still from where      |
| you are standing now.                        |
+----------------------------------------------+
```

Five classes back to back with four 15-minute seams. The header has dropped its
live claim and become a description, which is the rule that stops the day strip
turning into a second time control. Caldwell closes at 9:00p on Fridays rather
than 10:00p, so the last block is 6h15 rather than 7h15.

### E. Nobody publishes hours for this building.

```
+----------------------------------------------+
| <-  Drinko Hall 245                          |
|----------------------------------------------|
| No class in here till 2:30p                  |
| (>) 3 min   175 m   44 seats       classroom |
|----------------------------------------------|
| Thu 27   Fri 28   Mon 31   Tue 1   Wed 2     |
| ======                                       |
|----------------------------------------------|
| !  Drinko Hall is not in the Registrar's     |
|    pool table, so Vacant does not know       |
|    when the doors are unlocked.              |
|----------------------------------------------|
|         before 10:00a, not known             |
|         10:00a  LAW 7004                     |
| 12:00p  FREE                            2h30 |
|         2:30p   LAW 8209                     |
|         4:40p   LAW 6320                     |
|         after 6:25p, not known               |
|----------------------------------------------|
| Class schedule only. Clubs book rooms and    |
| doors get locked.                            |
+----------------------------------------------+
```

`DI0245`, capacity 44, type 1B, building 049, 175 m due south of the Union. One of the 245 rooms with no
published hours. The timeline is clamped to the first and last class, so no free
block is claimed before 10:00a or after 6:25p, because there is no evidence either
way. The 12:00p to 2:30p block is claimable, because a class provably met in that
room on both sides of it.

### F. Inside the exam window. The schedule refuses, the facts stay.

```
+----------------------------------------------+
| <-  Hagerty Hall 145                         |
|----------------------------------------------|
| (>) 3 min   176 m   30 seats         seminar |
| Open 7:00a to 7:00p today                    |
|----------------------------------------------|
| !! Finals week, Dec 11 to Dec 17.            |
|                                              |
|    Ohio State moves classes into exam        |
|    rooms this week and does not publish      |
|    which room gets which exam. The class     |
|    schedule is empty, and empty does not     |
|    mean free.                                |
|                                              |
|    Vacant is not answering for this room     |
|    until Dec 18.                             |
|----------------------------------------------|
| [  The Registrar's exam schedule  ]          |
+----------------------------------------------+
```

The dates come from `schedule-edge-cases.md`, which read them off the Registrar's
own Autumn 2026 finals page and cross-checked the same rule against Spring and
Summer 2026. Note what survives the refusal: the room, the walk, the seats, the
type and the published hours are all still true, so they stay. Only the schedule
claim goes.

### G. A campus closure day, offices closed.

```
+----------------------------------------------+
| <-  Caldwell Laboratory 177                  |
|----------------------------------------------|
| Thanksgiving Day. Empty, and locked.         |
| (>) 10 min  759 m   41 seats       classroom |
|----------------------------------------------|
| Thu 26   Mon 30   Tue 1   Wed 2   Thu 3      |
| ======                                       |
|----------------------------------------------|
| x  Nov 26 is a no-class day and Ohio         |
|    State closes offices, so this room is     |
|    empty and you cannot get into it.         |
|                                              |
|    First day it is open again: Mon 30.       |
|----------------------------------------------|
| Class schedule only. Clubs book rooms and    |
| doors get locked.                            |
+----------------------------------------------+
```

Nov 26 2026 is a Thursday. Fri Nov 27 is also a no-class day (Indigenous Peoples'
Day observed) so it is missing from the strip. Today is the first chip even though
it is a closed day, because you have to be able to see the screen you are on. Note
the counter-case this state exists to teach: without it, Vacant would show every
one of the 788 falsely-busy Wednesday rows as free on Veterans Day, which is the
right answer for the wrong reason, and would show Thanksgiving as a bonanza in a
locked building.

---

## What I measured

Data sources: the repo's own `data/rooms-1268.json` (871 rooms, 12,168 intervals),
`data/harvest-1268.json.gz` (27,074 distinct meetings from 545 requests),
`data/buildings.json` (612 buildings from OSU's ArcGIS layer),
`data/buildings-hours.json` (47 buildings with Registrar hours). Plus **28 live
HTTP requests today**: 15 paged subject pulls to `content.osu.edu` for a
course-label cross-check, 8 single-page subject probes to confirm short codes, and
5 `curl` GETs against GitHub Pages. All sequential, 0.8 to 1.0 s apart, 90 s
timeouts.

```
# the label cross-check and the short-code probes
https://content.osu.edu/v2/classes/search?q=&subject=<s>&term=1268&campus=col&p=<n>&sort=catalogNumber

# the URL shape test
curl -sS -o /dev/null -w "%{http_code}  bytes=%{size_download}\n" \
  https://enesyilmazcode.github.io/Vacant/?room=HH0145
```

| Measurement | Value | Why the screen cares |
| --- | --- | --- |
| rooms / intervals in the shipped index | 871 / 12,168 | |
| **time to build a room's whole week timeline** | **5.3 us** | a week grid is free; only legibility decides |
| all 871 rooms, full week | 4.6 ms | |
| merged busy blocks per room-day (days with a class) | mean 3.35, p50 3, p90 6, max 10 | |
| **rows in a today view, every gap a row** | mean 6.32, p50 5, **p90 13**, max 20 | |
| **rows in a today view, gaps under 20m seamed** | mean 4.96, p50 5, **p90 9**, max 13 | this is what fits the 62% sheet |
| free rows under 20 minutes | **40.0%** (5,911 of 14,773) | the case for seaming |
| free rows 60 minutes or longer | 52.2% | |
| rows in a Mon-Fri week list | mean 31.6, p50 29, p90 59, max 86 | why the week is not the default |
| **room-weekdays with no class at all** | **790 of 4,355 = 18%** | why the week is the default when today is empty |
| rooms with no class, by weekday | Mon 23%, Tue 13%, Wed 12%, Thu 13%, Fri 30% | |
| **rooms whose Mon-Fri pattern changes mid-term** | **110 of 871 = 13%** | why chips carry dates, not weekday names |
| distinct session date ranges in the index | 10 | |
| intervals matched to a course label | **12,115 of 12,168 = 99.6%** | the course code is not a sparse field |
| intervals whose slot holds >1 course | 713 = **5.9%** | cross-listing needs a row shape, not a special case |
| distinct course labels campus-wide | **3,526** | the label table size |
| mean label length, `section.subject` | **22.3 chars** (max 40) | too wide for the row |
| mean label length, `course.subject` | **10.5 chars** | the fix |
| `rooms-1268.json` today | 239,466 raw / **27,382 gz** | |
| same, course id inlined | 343,332 raw / **61,874 gz** | +126% |
| packed `.bin`, no courses | 96,304 raw / **22,247 gz** | |
| packed `.bin`, course id inlined | 168,083 raw / **55,638 gz** | +150% |
| **`courses-1268.bin` as a sidecar** | 71,772 raw / **23,689 gz** | base + sidecar = 45,936 gz, **17% cheaper than inlining** |
| sidecar parse, binary | **0.4 to 1.4 ms** desktop | 2 to 11 ms projected on a phone |
| sidecar parse, JSON | 2.3 to 14.1 ms desktop | 10 to 110 ms projected, visible |
| rooms in a building with published hours | 626 of 871 = **72%** | |
| **rooms with no published hours** | **245 of 871 = 28%** | a first-class state, not an edge case |
| same, restricted to types 1A/1B/1C | 126 of 514 = 25% | |
| buildings with hours that are closed Saturday | **42 of 47** | why the day strip is per-building |
| buildings with hours that are closed Sunday | 36 of 47 | |
| rooms with any Saturday interval | 4 of 871 | |
| rooms with any Sunday interval | 2 of 871 | |
| rooms with `facilityCapacity` 0 | 44 | render "seats unknown" |
| rooms with an empty `busy[]` | **0** | the "no class all term" state is unreachable until three terms are unioned |
| share of Mon-Fri 8a-10p room-minutes that are busy | 27.4% | |
| `/Vacant/?room=HH0145` on Pages | **200, 7,273 bytes** | |
| `/Vacant/room/HH0145` on Pages | **404, 9,379 bytes** | the path form is dead for a first-ever visitor |

Example rooms, all read straight out of the shipped files:

```
HH0145  Hagerty Hall 145        cap 30  type 1A  bldg 037   176 m   3 min  NW
        hours Thu 7:00a-7:00p, Sun 6:00p-8:30p, Sat closed
CL0177  Caldwell Laboratory 177 cap 41  type 1B  bldg 026   759 m  10 min  NW
        hours Thu 7:00a-10:00p, Fri 7:00a-9:00p, Sun 12:00p-10:00p, Sat closed
PA0240  Page Hall 240           cap 20  type 1A  bldg 061   186 m   3 min  NW
        hours Thu 7:00a-8:00p, Fri 7:00a-5:30p, Sat and Sun closed
DI0245  Drinko Hall 245         cap 44  type 1B  bldg 049   175 m   3 min  S
        hours NOT PUBLISHED
```

---

## Corrections to existing research

| What the existing note says | What this note found |
| --- | --- |
| `ux-states.md`: "Scroll position deliberately does not persist... restoring it is a desktop instinct that actively hurts" | True **across launches**, wrong **within a session**. Returning from a room to row 40 of 98 must land on row 40. Keeping both panes in the DOM gives that for free |
| `ux-states.md`: the room detail sheet ships `[ Open in Maps ]` | Cut it. `data/campus.json` and `js/map.js` now ship an in-app vector map with a building highlight, which answers "where is it" better and offline. Keep the `geo:` hand-off as a long-press on the map |
| `ux-states.md`: "Recommendation: no map, no tiles" | Overtaken by work already in the repo. `data/campus.json` is 51,823 bytes gzipped of vector polygons, not raster tiles, so the offline argument that killed tiles does not apply to it |
| `ux-states.md`: "weekend meetings 0" from a 4-subject sample | The full harvest finds **4 rooms with Saturday intervals and 2 with Sunday**. Small, but not zero, so a weekend day cannot be hard-coded out of the day strip. The per-building-hours rule handles it correctly anyway |
| `ux-states.md` A4: ship "usually open till 10p" as a static field with `hoursSource: "assumed"` | Contradicted by `data/buildings-hours.json`'s own header note: a building absent from the Registrar table "must be shown as unknown, never as assumed or usually open". 245 rooms, 28%, are in that bucket. The room screen shows "not known" and clamps the timeline to observed classes |
| `ux-states.md`: "intervals per room per weekday, mean 2.85" (4-subject sample) | Full harvest: **3.35 merged blocks** per room-day on days with a class. Same order, and it does not change any conclusion |
| `prior-art.md` Part 4: "Vacant's design has no room detail view at all" | Closed by this note. Vacant now has a per-room timetable with a day switcher, which was the first of the three named table stakes |
| `prior-art.md` Part 4 item 3: ship a time control that is not "now" | Partially closed, and deliberately only partially. The day strip answers "what about Friday" for **one room**, read-only. It does not re-rank, which is what keeps it from becoming illiniSpots' duplicated control |
| Issue #18: "the detail sheet ships... today's timeline, a bearing arrow and Open in Maps" | Today's timeline becomes today-plus-a-day-strip, the bearing arrow is superseded by the map's line, and Open in Maps is cut |
| Harvester (`data/harvest-1268.json.gz`) records `section.subject` | It should record `course.subject`. 22.3 characters against 10.5, and an 88,535-byte label table against 47,432. Belongs to issue #7 or #8 |

---

## Risks and open questions

**The two states this screen cannot yet detect are the two that produce confident
lies.** `data/rooms-1268.json` has no `closed` array and no `exams` block, so
issue #11 is a hard dependency for states F and G. Until it lands, this screen will
render an empty, cheerful Thursday for a locked building on Nov 26, and a wide open
week for a room holding a final on Dec 15.

**The course sidecar roughly doubles the install payload, from 22 KB to 46 KB
gzipped.** That is still two orders of magnitude under Roomix's 3.3 MB and it costs
zero cold-launch milliseconds, but it is the single biggest byte decision on this
screen and it should be re-checked against the real phone measurement in issue #29
rather than assumed. The mitigation is built in: delete one file and the screen
degrades to unlabelled `in use` rows.

**The short subject codes are not in the harvest yet.** Seven were verified live
today (PHILOS, ECE, TURKISH, HINDI, PUBAFRS, HTHRHSC, LAW, plus the six from the
earlier sample). The other ~230 come free once the harvester reads
`course.subject`, but until it does, every course code in a mockup or a test
fixture is a translation rather than a fact.

**The 5.9% cross-listed case is the one row shape I could not fully verify.** I
know 713 intervals hold more than one course label, but not how many hold more
than two, because the merge that produced them also merged across sessions. A
`+2` overflow is specified; whether it ever fires is unmeasured.

**Nobody has walked to any of these rooms.** Issue #26 is the ground-truth walk and
this screen is the one that most needs it, because it is the screen that prints
`before 10:00a, not known` and asks the user to believe the app knows the
difference between what it measured and what it assumed.

**Open: should the day strip persist across rooms?** If someone is planning
Friday, tapping back and opening a second room probably wants Friday again. That
is one line of state and it directly contradicts `ux-states.md`'s "reopening
should be a fresh question". I lean toward resetting to today, on the grounds that
the app's whole promise is about now, but it is genuinely arguable and worth
watching once anyone uses it.

**Open: does the component field earn a place after all?** `Laboratory` is 16.9% of
labelled intervals, and a wet lab that runs over is a materially different risk
from a lecture that runs over. It is cut from v1 for width, but if the ground-truth
walk in issue #26 finds that labs are the rooms that turn out to be occupied, the
field is already in the harvest.
