# Vacant: the result screen, second pass

Research note, 2026-08-27. Answers the owner's asks 2 to 5 (cut the term label,
cut the duration-state text, back arrow top left, walk icon instead of the word)
and specifies what the result screen becomes once they land.

Every number here was measured against the **shipped code and the shipped data**,
not against a sample. `docs/research/result-screen-v2.repro.mjs` reproduces the
three headline figures from the repo root in about two seconds.

Mockups are on a 46-character interior grid, roughly 390px at body size, matching
[`ux-states.md`](ux-states.md).

---

## The one thing to read

**The problem:** the result screen's chrome is a header that says the same
sentence 94.1% of the time, a term label nobody is deciding anything with, and a
word ("walk") repeated on forty rows, all of it sitting on top of a list whose
forty rows point at only eight buildings.

**The fix:** delete the persistent chrome outright, move the term and the caveat
onto the screen the back arrow goes to, and let a single line appear above row
one only in the 5.9% of hours when the answer is actually degraded.

```
  BEFORE, every launch                AFTER, 94.1% of launches
  +------------------------------+    +------------------------------+
  | Free for 30 min, nearest     |    |  <-        (over the map)    |
  | first        Autumn 2026     |    |                              |
  |                    [change]  |    |                              |
  |------------------------------|    |------------------------------|
  | PA0110B  Page Hall           |    | Page Hall 110B        % 4 min|
  | 4 min walk . yours for 7h31  |    | till 7:50p   22 seats        |
  |          . 22 seats          |    |------------------------------|
  +------------------------------+    | Sullivant Hall 247    % 4 min|
                                      | till 7:20p   30 seats        |
  3 lines of chrome, always           +------------------------------+
  38 characters of row detail
                                      0 lines of chrome, 94.1% of the
                                      time. 20 characters of row detail
```

Everything cut lands somewhere. Nothing is deleted, three things are moved.

---

## Before anything else: two premises in the brief are wrong

The brief says "NO CODE EXISTS YET" and "the app opens directly on results with
zero input, so there may be no previous screen". Both were true yesterday. Neither
is true against the tree as it stands this morning.

```
$ ls -la Vacant/index.html Vacant/js/
-rw-r--r--  7438  Aug 27 08:42  index.html
-rw-r--r-- 17280  Aug 27 08:42  js/app.js
-rw-r--r-- 11314  Aug 26 23:38  js/engine.js
-rw-r--r--  9536  Aug 27 08:42  js/map.js
-rw-r--r--  3548  Aug 27 00:05  js/campus.js
```

Three consequences that change the assignment:

**1. The app already opens on a question, not on results.** `index.html` paints
`#ask` (a title, three duration buttons, an "until" time field) and `js/app.js`
hides it only inside `choose()`. There is no auto-skip. So the root screen is the
duration question and the result sheet is its child. **The back arrow has a real
destination and the owner is right to ask for it.** Item 3 of my assignment is
answered by the code rather than by a design argument, and `#again` already
performs exactly the action a back arrow would.

**2. The map shipped, so ask 1 is no longer in conflict with anything.**
`DECISIONS.md`, 2026-08-26, "The map is vector, drawn from OSU's own GIS, with no
tiles", 50.1 KB gzipped, no network on the critical path. The no-map
recommendation in [`ux-states.md`](ux-states.md) section 4 was superseded the same
day it was written. `js/map.js` already exports `drawTarget()`, which lights a
building footprint and draws a dashed line from you to it. Ask 1 is largely built.

**3. The chrome the owner is describing is the shipped chrome, not the A3
mockup.** "Autumn 2026" is `#sheet h2 .term`. "Free for 30 min" is `#head`.
"change" is `#again`. "walk" is the literal word in the row's `.meta` line. A3 in
`ux-states.md` contains none of those strings. So the audit below covers both, and
where they disagree the shipped screen wins.

---

## What I measured

All figures come from the shipped `data/` and the shipped `js/engine.js`, ranked
from the Ohio Union at Thu 12:15 unless stated. The room index is real: 871 rooms,
612 buildings, 47 of them with published hours.

```
$ cd Vacant && node docs/research/result-screen-v2.repro.mjs
need  15 -> 578 rooms
need  30 -> 578 rooms
need  60 -> 578 rooms
need 120 -> 578 rooms
need 180 -> 578 rooms
top 40 rows cover 8 buildings
bounded by the doors 3362, by a class 558 -> 85.8% doors
```

| Measurement | Value | Why the screen cares |
| --- | --- | --- |
| rooms surviving `rank()` at 15m vs 180m | **578 either way** | duration is not a filter at all |
| identical row **count**, 30m vs 2h, 112 time cells | **100%** | the chip cannot change what is available |
| identical **top row**, 30m vs 2h | 75.0% | it is a tie-breaker, and only after 16:00 |
| distinct buildings in the rendered top 40 | **8**, across 40 rows | the list repeats; the map does not move for 8 taps |
| longest run of consecutive rows in one building | **8 rows** (Hopkins Hall) | |
| walk minutes across the top 40, from the Union | **4 distinct values** (4, 7, 8, 9) | distance barely discriminates, as predicted |
| header reads "Free for X, nearest first" | **1024 of 1088 cells = 94.1%** | the header is dead chrome |
| header degrades to "closest anyway" | 64 cells = **5.9%** | and never to either of the other two states |
| rows bounded by the **doors**, not by a class | **83.4%** across 4 origins, 100% after 18:00 | the row's tier language is now wrong |
| median `usable` in the top 40 | **391 min = 6h31**, max 8h56 | "yours for 6h31" is the ordinary row, and it is noise |
| longest room label, `<building> <number>` | **37 chars** of 46 | a name-first row fits |
| longest building name in the ranked set | 47 chars | but the name alone can fill the whole grid |
| top-40 rows with unknown seat count | 0 to 5 of 40, by origin | rare enough to spell out in words |
| `JSON.parse(rooms-1268.json)`, node 22, warm | **4.0 ms** for 234 KB | the cold-launch panic is smaller than feared |
| one full ranked query over 871 rooms | **2.48 ms** | |

The 1088-cell header sweep walks one day a week across the whole instruction
window (2026-08-25 to 2026-12-09), 4 origins, hourly 07:00 to 23:00, need 60.

### The measurement that decides the most

```
  WHAT BOUNDS THE "till" TIME ON A ROW

  hour   doors   class   % doors
  ----   -----   -----   -------
    08     565     555      50%
    10     699     421      62%
    12     858     262      77%     <- the app's peak hour
    14     972     148      87%
    16    1092      28      98%
    18    1120       0     100%
    20    1120       0     100%

  15,680 ranked rows sampled: 7 days x 4 origins x 14 hours
```

[`ux-states.md`](ux-states.md) built the row around "a real bounded number" versus
"no class rest of today", and measured that split at 53/47. It was measured before
the Registrar hours scrape existed. With hours in the index there is no open-ended
row left: every row now ends at a clock time, and **83.4% of the time that clock
time is when the building locks, not when a class arrives.** The strong and medium
tiers did not disappear, they moved, and the row has to move with them.

---

## 1. Chrome audit

### 1a. The shipped screen, element by element

| Element | Where | Call | Reason |
| --- | --- | --- | --- |
| `#head` "Free for 30 min, nearest first" | sheet header | **CUT** | says the same thing in 1024 of 1088 measured cells |
| `#head` "Nothing free for X, closest anyway" | sheet header | **MOVE** | the 5.9% case; becomes a strip above row one |
| `#head` "Nothing free this second" | sheet header | **KEEP as strip** | 0 of 1088 cells, but it is a correctness backstop |
| `#head` "Every building we have hours for is closed" | sheet header | **KEEP as strip** | same, and it already carries its own caveat paragraph |
| `.term` "Autumn 2026" | sheet header | **MOVE** | to the root screen and the hard states, section 4 |
| `#again` "change" | sheet header, right | **MOVE** | becomes the back arrow, top left, floating over the map |
| `.grip` | sheet header | **KEEP** | the only thing that says the sheet is draggable |
| the whole `<header>` element | sheet | **CUT** | with the above moved there is nothing left in it |
| `.row .name` = `PA0110B` | row line 1 | **CUT** | an internal facility ID is the boldest thing on the screen |
| `.row .name em` = `Page Hall` | row line 1, dimmed | **KEEP, promoted** | this plus the room number is the identity |
| `<b>4 min</b>` | row line 2 | **MOVE to line 1** | it is the ranking key and belongs beside the name |
| the word `walk` | row line 2 | **CUT, icon instead** | the owner's ask 5, and it saves 5 characters on 40 rows |
| `yours for 7h31` | row line 2 | **CUT** | median 6h31, and `ux-states.md` already ruled a duration here loses to a clock time |
| `till 7:50p` | row line 2 | **NEW** | the clock time the research asked for, now available on every row |
| `22 seats` | row line 2 | **KEEP** | the only field that separates rows inside one building, and inside one building it is the whole decision |
| `seats unknown` | row line 2 | **KEEP** | 0 to 5 rows in 40, rare enough that spelling it out is not wallpaper |
| `hours not published` | row line 2 | **KEEP** | 0 of 160 rows in the sample, but it is the honesty the parked 60%-of-rooms decision turns on |
| `from 1:10p` on waiting rows | row line 2 | **KEEP** | never fired in 1088 cells, still a correctness backstop |
| `#note` accuracy and geolocation pill | fixed, top centre | **KEEP** | already the right home, already floating over the map |
| the caveat "class schedule only" | **does not exist yet** | **ADD, once** | issue [#18](https://github.com/EnesYilmazcode/Vacant/issues/18) requires it and the shipped screen dropped it |
| the result count | does not exist yet | **ADD, once** | 578 exist, 40 render, and the screen currently never says so |

### 1b. The `ux-states.md` mockups

| Mockup | Element | Call | Reason |
| --- | --- | --- | --- |
| A3 | `VACANT` wordmark | **CUT** | the home-screen icon already said it, and a standalone PWA has no address bar to lose it in |
| A3 | `12:15 Thu` clock | **CUT** | `viewport-fit=cover` with `black-translucent` leaves the system clock visible two millimetres above it |
| A3 | room name | **KEEP** | the one field the user carries while walking |
| A3 | walk time, right-aligned | **KEEP** | the two ends of line one are the two things that matter |
| A3 | confidence phrase | **KEEP, reworded** | "no class rest of today" no longer occurs; section 5 |
| A3 | capacity | **KEEP** | |
| A3 | `94 more` | **KEEP, corrected** | the shipped app caps at 40 and says nothing; the real number from the Union is 538 more |
| A3 | footer caveat | **KEEP, and copy it** | once at the end of the list, once on the root screen, once per row's accessible name |
| A3 | chip bar, bottom | **CUT from this screen** | section 2 |
| A4 | reframed building list | **KEEP** | but its trigger has changed, see Risks |
| A4 | "usually open till 10p" | **CUT** | the Registrar table shipped; a guess dressed as a fact is now unnecessary |
| A5 | accuracy banner | **MOVE** | into the existing `#note` pill, which already floats over the map |
| A5 | `~` prefix on walk times | **KEEP** | the imprecision belongs in the row, not only in a banner |
| A5 | `[ Try again ]` | **KEEP**, inside the pill | |
| B1 | denial message | **KEEP** | |
| B1 | six-building grid | **KEEP** | this is issue [#17](https://github.com/EnesYilmazcode/Vacant/issues/17), a sibling of the root screen, not chrome on the result screen |
| B1 | `Search all buildings` | **KEEP** | |
| B2 | "could not get a fix" message | **MOVE** | into `#note`; `app.js` already routes all four geolocation outcomes there |
| B2 | "showing results from where you were at 11:02a" | **KEEP** in `#note` | vagueness here is worse than useless |
| B2 | `[ Try again ] [ Pick a building ]` | **KEEP** | |
| C1 | `(offline)` badge | **CUT** | already decided: a permanent offline badge on an offline-first app is an apology for a feature |
| C1 | no banner at all | **KEEP** | |
| C2 | staleness banner | **MOVE** | becomes the same strip above row one |
| D1 | "Nothing near you is free for 2 hours" | **MOVE** | becomes the strip; this is the 5.9% case |
| D1 | `FREE FOR LONGER, FURTHER AWAY` group header | **KEEP** | two named groups still beat one merged sort |
| D1 | `FREE SOONER, CLOSE BY` group header | **KEEP** | |
| D1 | second row shape `free at 1:10p, then 2h05` | **KEEP** | |
| D1 | chip bar | **CUT from this screen** | section 2 |

Nine cuts and seven moves. The only genuinely new elements are the caveat line and
the result count, and the shipped screen is missing both of those against issue
[#18](https://github.com/EnesYilmazcode/Vacant/issues/18) already.

---

## 2. Where duration lives

**Recommendation: duration stays a question on the root screen, asked once,
remembered, and reachable in one tap through the back arrow. That is option (b),
and it is what the code already does. Keep it, and stop trying to put a copy of it
on the answer.**

The measurement first, because it rules out two of the four options on its own.

```
  DOES THE DURATION CHIP CHANGE ANYTHING?

  the SET of rooms       15m -> 578      180m -> 578        no, never
  the row COUNT          112 of 112 time cells identical    no, never
  the TOP ROW            84 of 112 identical  (75.0%)   only in the evening
  the TOP FIVE           83 of 112 identical  (74.1%)

  every disagreement in the 112-cell sweep falls at 16:00 or later, or
  on a weekend afternoon. Not one falls between 08:00 and 15:00.
```

Duration is not a filter. In `js/engine.js` it never removes a room; it sets
`meetsNeed`, which moves a row between tier 0 and tier 1 in `tierOf()`. It is a
tie-breaker, and it only breaks ties when the building close is what binds, which
is after 16:00.

**Against dropping it entirely (option d).** This is the option "less is more"
pulls hardest toward, and it is the one I spent longest on. It fails on two
measurements. First, it is not free: ranking with `needed = 0` against
`needed = 120` changes the top row in 13.4% of 448 cells, the top five in 24.1%
and the top ten in 35.3%. Deleting the question would silently reorder a third of
the list's visible depth. Second, the tap it saves is spent inside a wait that
exists anyway. `boot()` runs geolocation concurrently with the fetches, and
geolocation is the long pole at 0.5 to 3 seconds typical with an 8 second
watchdog, against 4.0 ms to parse the room index on this box. The question is the
only useful thing a user can do during a wait the app cannot shorten, which is
what the comment at the top of `app.js` already says about the flyover. Removing
the question does not make the app faster. It makes it emptier and slightly wrong.

**Against a first-run choice remembered thereafter (option a).** A preference with
no visible control is the worst of the four. "How long do I need" is a per-visit
fact, not a setting like a theme: the same person wants 30 minutes on Tuesday and
three hours on Thursday. A remembered value with no way back teaches the user the
app is guessing at them. Option (b) is option (a) plus a door, and the door costs
one glyph.

**Against making it a sort rather than a filter (option c).** It already is a
sort, and that is the problem. A control whose only effect is invisible reordering
is a control the user concludes is broken, because the list length never moves and
the top row usually does not either. Promoting it to persistent chrome would put a
permanently visible widget on screen to advertise an effect nobody can see. And a
sort control still has to live somewhere, so it is not a cut, it is the same
chrome wearing a different label.

**What option (b) costs, said plainly.** Changing duration now takes two taps
(back, then the chip) instead of one. That is a real regression against
`ux-states.md` section 3, which put the chips at the bottom of the results screen
specifically so the choice was "recoverable in one tap". I am overruling that
recommendation because the thing being recovered turns out not to be worth a
persistent bar: in the daytime hours anybody uses this app, changing the chip
changes nothing at all. A control that is inert 100% of the time between 08:00 and
15:00 does not earn a permanent row of the screen at the price of two result rows.

**One thing to add while it is there.** The root screen offers 30 min, 1 hour, 2
hours and a time field. `ux-states.md` argued for a fourth "rest of day" chip, and
the data now argues for it harder: 83.4% of rows run to the building close, so
"rest of day" is the honest name for what most rows already give you. It costs
nothing and it belongs on the root, not on the answer.

---

## 3. Where the back arrow goes back to

**The root screen is the duration question, so the arrow is correct on the result
screen, and the result screen is the only place it belongs.**

This is settled by `index.html` and `js/app.js` rather than by argument:

```
  #ask visible at load  ------ tap a duration ----->  #sheet visible
       (the root)         choose() hides #ask           (the answer)
            ^                                                |
            +-------------- #again, today ------------------+
                       "change", top right of the sheet
```

`#again.onclick` already hides the sheet, shows `#ask`, unsets `state.settled` and
restarts the flyover. The owner's ask 4 renames a control that exists and moves
it. Nothing has to be invented.

**Three reasons the move to top left is right, and one reason it is not.**

Right: it frees the entire sheet header row, which is what makes asks 2 and 3
possible at all. Right: in `display: standalone` there is no browser back chrome,
so the app has to draw its own or the gesture has no affordance
([`pwa-ios.md`](pwa-ios.md) section 1). Right: fixed over the map rather than
inside the sheet means it does not scroll away and does not move when the sheet is
dragged.

Wrong: `ux-states.md` section 5 says everything interactive lives in the bottom
60% of the viewport, one-handed, outdoors, and the top left corner of a 932px
phone is the single hardest place a right thumb can reach. I am accepting that,
because frequency decides it. Back is used once per session, to change a value the
measurement above says almost never changes the answer. The top left is the right
home for a rare escape and the wrong home for a primary control, and this is a
rare escape. Two mitigations make it cheap: bind the same action to a downward
drag on the sheet grip, and push a history entry in `choose()` so the Android
hardware back button and the iOS edge swipe both work. Neither exists today, and
without the history entry Android back exits the app from the result screen, which
is a real bug worth filing on its own.

**Do not put a back arrow on the root screen.** It has no parent. If the building
picker ([#17](https://github.com/EnesYilmazcode/Vacant/issues/17)) later opens
from the root, that screen gets its own arrow back to the root, and the root still
has none. A back arrow on a root screen is the one version of this ask the owner
should refuse.

---

## 4. The term label, and where the honesty goes

**It can be cut from the result screen. It has to appear in four other places, two
of which already exist, and one of those is a hard gate rather than a label.**

The comment at `js/app.js:301` is the objection to beat, and it is a good one:

> The term goes here rather than nowhere. Deleting the corner label removed the
> app's only on-screen provenance, and current.json is refreshed by hand, so a
> stale snapshot would otherwise serve the wrong term with no tell.

That is right about the risk and wrong about the remedy. A five-word grey label in
the corner of a list nobody reads the corner of is not a tell, it is the
appearance of one. The remedy is to put the term where a user is actually reading
words, and to make the app refuse rather than annotate when the term is genuinely
wrong.

**The rule: the term is not chrome, it is a fact, and a fact appears where it can
change what you do.** On the result screen the term can never change what you do,
because if the term were wrong the rows would be fiction and a label would not
save you. So the result screen never names the term, and four other places do.

```
  1  THE ROOT SCREEN, every launch, under the question
       "Autumn 2026, schedule read Aug 27"
       replaces the existing "finding campus..." line once boot()
       resolves. Read BEFORE the answer, not beside it. Costs the
       result screen nothing.

  2  THE ROOM DETAIL SHEET, under today's timeline
       the timeline is the raw fact the row came from, so it is the
       one place a term stamp is load-bearing rather than decorative.

  3  THE HARD STATES, where the term IS the message
       C3 expired term  "This schedule is for Autumn 2026, which
                         ended on Dec 9", results gated behind a
                         second tap. Already specified.
       E2 no next term  "Autumn 2026 ended Dec 9. Ohio State has not
                         published Spring 2027 yet. Checked 2h ago."
       C2 stale cache   the strip above row one, section 5.

  4  THE DIAGNOSTICS PANEL, issue #24
       term, generated stamp, room count, guard results. The screen
       where a bug report writes itself.
```

Places 1 and 4 are new. Places 2 and 3 are already in the plan.

**The gate that replaces the label.** `data/current.json` carries
`instruction: ["2026-08-10", "2026-12-11"]`. If today falls outside that window
the root screen must say so **before** the question, and the question does not
appear at all. That is states E1 and E2 from `ux-states.md`, and it is strictly
stronger than the label it replaces: a label lets a wrong-term answer render, a
gate does not. Cutting the label does not cut the honesty as long as this gate
ships with it, and the two belong in the same commit. Issue
[#19](https://github.com/EnesYilmazcode/Vacant/issues/19) owns it.

**The screen-level caveat moves the same way.** "Class schedule only, doors may be
locked" belongs on the root screen under the question, where it is read once
before any answer exists, plus once at the end of the list, plus in every row's
accessible name. The shipped screen has it in none of those three places, which is
a regression against issue
[#18](https://github.com/EnesYilmazcode/Vacant/issues/18) worth catching now.

---

## 5. The screens redrawn

Legend for every mockup below:

```
  %      the walking figure icon, 1em, currentColor, decorative
  <-     the back arrow, fixed, top left, over the map
  ...    the sheet grip
  >      the "tap again for detail" chevron, selected row only
  ####   the vector map: campus, you, the lit building, the line
```

### A3, the answer during scheduled hours

```
  BEFORE, ux-states.md                BEFORE, as shipped today
  +--------------------------------+  +--------------------------------+
  | VACANT               12:15 Thu |  | Free for 30 min, nearest first |
  |--------------------------------|  |          Autumn 2026  [change] |
  | Hagerty Hall 050         2 min |  |--------------------------------|
  | free till 1:55p    40 seats    |  | PA0110B  Page Hall             |
  |--------------------------------|  | 4 min walk . yours for 7h31    |
  | Mendenhall 175           4 min |  |          . 22 seats            |
  | free till 2:20p    42 seats    |  |--------------------------------|
  |--------------------------------|  | PA0130  Page Hall              |
  | Derby Hall 049           2 min |  | 4 min walk . yours for 7h31    |
  | no class rest of today 28 seats|  |          . 48 seats            |
  |--------------------------------|  |--------------------------------|
  | 94 more                        |  | PA0240  Page Hall              |
  | Class schedule only. Doors...  |  | 4 min walk . yours for 7h31    |
  |--------------------------------|  |          . 20 seats            |
  | [30m] [*1h*] [2h] [rest of day]|  +--------------------------------+
  +--------------------------------+
```

```
  AFTER
+----------------------------------------------+
|                                              |
| <-                                           |
|      ########   ##########   ####            |
|    ######   #######    #########             |
|   ####  [ Page Hall, lit ]  #####            |
|    ###\                     ######           |
|      ##\####    ########   #####             |
|        (you)                                 |
|~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~|
|                     ...                      |
| Page Hall 110B                       % 4 min |
| till 7:50p     22 seats                    > |
|----------------------------------------------|
| Page Hall 130                        % 4 min |
| till 7:50p     48 seats                      |
|----------------------------------------------|
| Sullivant Hall 247                   % 4 min |
| till 7:20p     30 seats                      |
|----------------------------------------------|
| Hagerty Hall 145                     % 4 min |
| till 4:00p, class     30 seats               |
+----------------------------------------------+

ALL WIDTHS OK. Every row above is a real ranked result from the
Ohio Union at Thu 12:15 against the shipped index, including the
class-bounded one: Hagerty Hall 145 has a class at 4:10p and the
building closes at 7:00p, so the class is what binds. The longest
real label in the ranked set is "Agricultural Engineering
Building 156" at 37 of 46.
```

Four changes carry the whole redesign.

**The header is gone**, and with it the term, the duration sentence and the word
"change". The sheet now starts at the grip.

**The row leads with the human name.** `PA0110B` is an internal facility ID and it
was the boldest thing on the screen. `Page Hall 110B` is what is written on the
door. It is built from `buildings[b].name` plus `rooms[id].n`, both already in the
index. Two buildings need a rule: a name over 24 characters that contains " - "
keeps the segment after the dash, so "Physical Activity and Education Services -
PAES A010" becomes "PAES A010". That is 2 of the 96 buildings holding ranked
rooms.

**The walk time moved to line one and lost its word.** It is the ranking key, so
it belongs at the right end of the line the eye already lands on. The icon
replaces "walk", not "min": with both gone the row reads "Page Hall 110B 4", the
number has no unit, and the accessible name gets much worse.

**"yours for 7h31" became "till 7:50p".** `ux-states.md` section 2 already argued
that a clock time beats a duration, because the user checks it against their own
next commitment without doing arithmetic while walking. The measurement makes it
urgent rather than preferable: the median `usable` in the top 40 is 391 minutes,
so the shipped row prints "yours for 6h31" as its ordinary case. That is the same
absurdity as the "9h44" the research reproduced and rejected, wearing a defensible
number.

**One extra word, on the minority of rows.** 83.4% of rows end because the
building locks and 16.6% end because a class arrives. Those are different
promises: a locked door at 7:50p is the Registrar's published hours, a class at
1:55p is thirty people walking in. So class-bounded rows carry the single word
`class`, and door-bounded rows carry nothing. Marking the 17% keeps the mark
visible. Marking the 83% would be the "warning on 98 rows" that `ux-states.md`
already rejected as wallpaper.

### The root screen, which receives what was cut

```
  BEFORE                          AFTER
+------------------------+  +----------------------------------------------+
| Vacant.                |  |                                              |
|                        |  |         ######  #########  ####              |
| [30 min] [1 hour]      |  |      #####   ########   #######              |
|           [2 hours]    |  |                                              |
|                        |  |                  Vacant.                     |
| until [  :  ]          |  |                                              |
|                        |  |          How long do you need?               |
| finding campus...      |  |                                              |
+------------------------+  |  [ 30 min ]  [ 1 hour ]  [ 2 hours ]         |
                            |  [ rest of day ]     until [  :  ]           |
                            |                                              |
                            | Autumn 2026, schedule read Aug 27            |
                            | Class schedule only. Doors may be locked,    |
                            | and clubs book rooms too.                    |
                            +----------------------------------------------+
```

The question finally gets a question. The term and the caveat get a home where
they are read before the answer rather than ignored beside it. `finding
campus...` still occupies that space until `boot()` resolves and is then replaced
in place, so nothing new lands on the critical path.

### D1 and C2, the only conditional chrome left

Both used to be a header. Both become the same single line above row one, inside
the scroll, so it explains the list and then gets out of the way once the user is
reading row twelve.

```
  D1, nothing meets the duration        C2, cache is 23 days old
+----------------------------------+  +----------------------------------+
| <-                               |  | <-                               |
|        ####  (the map)  ####     |  |        ####  (the map)  ####     |
|~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~|  |~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~|
|               ...                |  |               ...                |
| Nothing near you is free for 2   |  | Schedule last read 23 days ago.  |
| hours. Closest anyway:           |  |                                  |
|----------------------------------|  |----------------------------------|
| Evans Laboratory 1008   % 11 min |  | Page Hall 110B           % 4 min |
| till 10:50p   227 seats        > |  | till 7:50p    22 seats         > |
|----------------------------------|  |----------------------------------|
| Evans Laboratory 2001   % 11 min |  | Page Hall 130            % 4 min |
| till 10:50p    35 seats          |  | till 7:50p    48 seats           |
+----------------------------------+  +----------------------------------+
```

The D1 rows are a real cell: Monday 22:00 from the Ohio Union with a two hour
need. Nothing is free that long anywhere, the nearest thing that is open at all is
Evans Laboratory at 11 minutes, and it gives you 39 minutes before the building
closes at 11:00p. That is exactly the answer the strip has to frame, because
without it the list reads as though it met the request.

Measured, this strip is absent in 1024 of 1088 cells. That is the whole argument
for the redesign in one number: the chrome the owner asked to remove was carrying
a message that mattered 5.9% of the time and was paid for 100% of the time.

C2's line is deliberately flat. `ux-states.md` is right that staleness matters far
less than the README implies, because the room schedule is static within a term.
It is a note, not a warning, and it does not get an exclamation mark.

### A5, the coarse fix

```
  BEFORE                                AFTER
+----------------------------------+  +----------------------------------+
| VACANT              12:15 Thu    |  |  ( Location is rough, +/-240 m.  |
|----------------------------------|  |    Walk times could be 3 min     |
| ! Your location is rough         |  |    out.       [ Try again ] )    |
|   (+/- 240 m), so walk times     |  | <-                               |
|   could be 3 min out.            |  |        ####  (the map)  ####     |
|   [ Try again ]                  |  |    the you-dot draws its         |
|----------------------------------|  |    accuracy halo, already built  |
| Hagerty Hall 050        ~2 min   |  |~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~|
| free till 1:55p   40 seats       |  |               ...                |
+----------------------------------+  | Hagerty Hall 145       % ~4 min  |
                                      | till 4:00p, class  30 seats    > |
                                      +----------------------------------+
```

No new chrome at all. `#note` is a fixed pill at the top centre that `app.js`
already fills for all four geolocation outcomes, and `drawYou()` in `js/map.js`
already renders the accuracy radius, so the imprecision shows up on the map, in
the pill, and in the `~` on every row. The banner slot inside the list disappears.

---

## 6. The tap target and its accessible name

**The whole row is one `<button type="button">`, full width, min-height 56px as
shipped, and it is the only focusable node in the row.** No nested control and no
separate detail affordance, which is the rule
[`ux-states.md`](ux-states.md) section 5 already set and the shipped markup
already honours.

**Two-stage tap, because one tap cannot serve both asks.** The owner asked for a
row tap to highlight the building and draw the line (ask 1) and for a row tap to
open a schedule sheet (ask 6). Those fight, because the sheet covers the map the
line was drawn on. The resolution:

```
  tap an unselected row  ->  select it. The map lights that building,
                             draws the line and reframes to fit both.
                             The sheet drops to its peek height.
  tap the SELECTED row   ->  open the detail sheet (ask 6).
```

The selected row is the only row showing a `>` at its right edge, which is one
character of chrome on one row and is the visual promise that a second tap goes
deeper. Keyboard behaves identically: Enter selects, Enter again opens.

**The accessible name has to be explicit, because the visible text no longer
computes to a sentence.** Today the row's name computes from its contents to
"PA0110B Page Hall 4 min walk . yours for 7h31 . 22 seats". After the redesign the
computed name would be "Page Hall 110B 4 min till 7:50p 22 seats": no verb, "min"
read as "min", and a bare number where the icon used to be. So the button carries
an `aria-label` and the icon carries `aria-hidden="true"`.

```
  name order: identity, distance, window, size, caveat

  door-bounded (83.4% of rows)
  "Page Hall 110B, 4 minute walk, free until 7:50 pm, 22 seats.
   Class schedule only, the door may be locked."

  class-bounded (16.6%)
  "Hagerty Hall 050, 2 minute walk, free until 1:55 pm when a class
   starts, 40 seats. Class schedule only, the door may be locked."

  unknown seats (0 to 5 rows in 40)
  "...free until 7:50 pm, seat count not published. Class schedule
   only, the door may be locked."

  unknown hours (the parked 60%-of-rooms decision)
  "...4 minute walk, opening hours are not published for this
   building so Vacant cannot say when it locks, 22 seats. Class
   schedule only, the door may be locked."

  coarse fix (A5)
  "...about 4 minutes walk, ..."        not "~4"

  selected
  the same, plus aria-current="true"    not a CSS class alone
```

The caveat repeats in every row's name on purpose. A sighted user meets it once at
the end of the list; a VoiceOver user swiping row to row never reaches the end.
That asymmetry is why issue
[#18](https://github.com/EnesYilmazcode/Vacant/issues/18) already writes the rule
down, and this redesign does not change it.

**`aria-current` is a real defect today, not a refinement.** `paintList()` toggles
a `.on` class and nothing else, so the row driving the map is invisible to a
screen reader. Now that the map answers ask 1, the selected row is the most
important state on the screen.

**One polite live region, reused.** Issue
[#18](https://github.com/EnesYilmazcode/Vacant/issues/18) requires exactly one
`aria-live` hit in the source, on the count. Keep that literal: one visually
hidden `<p aria-live="polite">` that holds "578 rooms, 40 shown" on load and on a
duration change, and is replaced with "Page Hall 110B, 4 minute walk, shown on the
map" when the selection changes. One region, one purpose (say what just changed),
one grep hit.

### The walk icon

```html
<svg class="wk" viewBox="0 0 16 16" width="1em" height="1em"
     aria-hidden="true" focusable="false">
  <circle cx="9" cy="2.6" r="1.6" fill="currentColor"/>
  <path d="M9.4 5.2 6.9 6.6 5.6 9.4M9.4 5.2l1.9 1.1.9 2.6
           M9.4 5.2 8.1 9.1l2.1 1.8.6 3.4M8.1 9.1 5.6 11l-.7 3.3"
        fill="none" stroke="currentColor" stroke-width="1.5"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

Constraints, in order of how easily each is got wrong:

- **Inline SVG, not an emoji.** An emoji walking figure renders in colour on iOS,
  ignores the row's colour, has inconsistent metrics across platforms, and
  VoiceOver reads it as "person walking" in the middle of the label even when the
  label is overridden.
- **Not an icon font.** It needs either a network request on the critical path or
  a base64 blob in the CSS, and `forced-colors` mode drops glyph fonts.
- **`currentColor` and `1em`**, so it inherits the row's colour and grows with iOS
  Dynamic Type at AX5 rather than shrinking into a dot beside 40px text.
- **`aria-hidden="true"` and `focusable="false"`.** The second still prevents a
  stray tab stop in some engines and costs six characters.
- The path above is a sketch. **Draw it at 1em on a real phone before it ships.**
  A four-stroke figure at 16px can turn into a smudge, and I could not check it
  from here.

### Reflow at AX5

Unchanged from `ux-states.md`, restated because the row's fields moved. The name
wraps freely and is never truncated. When the name plus the walk figure no longer
fit one line, the walk figure drops **below** the name, left aligned, above the
window and seats. Window and seats stack. The longest real label is 37 of 46
characters, so this only bites at large text sizes, which is exactly when it has
to be right.

---

## 7. What this costs, and what I would not do

**Two taps to change duration instead of one.** Defended in section 2, and it is
the one place this redesign is measurably worse than `ux-states.md`.

**The back arrow sits in the worst place a right thumb can reach.** Defended in
section 3, mitigated by the sheet-grip drag and a history entry, and it is the
price of the sheet header going away.

**A first-time user has no visible way to know a second tap opens the schedule**
until they have selected a row and seen the `>`. The alternative is a permanent
chevron on all forty rows, which is forty characters of chrome to advertise a
gesture, and that is exactly the trade this note exists to refuse.

Three things I considered and rejected:

**Collapsing the list to one row per building.** Tempting: the top 40 rows point
at 8 buildings, and 8 rows would fit one screen with no scrolling. Rejected
because inside one building the seat count is the entire decision, and it varies
enormously. Hagerty Hall's nearest free room seats 8, Sullivant's seats 30, and
both are 4 minutes away. Collapsing hides the only field separating those rows.
This idea belongs to A4, where the unit genuinely is the building, not to A3.

**A "15 rooms in Sullivant Hall" group header.** The same idea, less destructive,
still rejected for v1: it adds a row of chrome to remove a row of chrome, and the
group sizes at the top of the list are 5, 15, 14 and 10, so it would put a header
above almost every fourth row.

**Cutting the seat count.** It is the fourth-priority field in `ux-states.md` and
the obvious candidate under "less is more". Rejected on the measurement above:
with 8 buildings across 40 rows, seats is doing more work than walk time is.

---

## 8. One thing outside my assignment that the result screen decides

Ask 1 is nearly built, and the result screen is what breaks it. `drawTarget()`
lights the footprint and draws the dashed line correctly, but `drawFrame()`
centres the view on the middle of the **viewport** while the sheet covers the
bottom 62% of it. Measured on three phone sizes:

```
  span 0.28, sheet at the shipped max-height: 62%

  390x844   map band 321px = 510m   you-dot HIDDEN   targets on screen 20/40
  375x667   map band 253px = 419m   you-dot HIDDEN   targets on screen 20/40
  430x932   map band 354px = 511m   you-dot HIDDEN   targets on screen 20/40

  the you-dot sits 101px BELOW the top of the sheet on a 390x844 phone,
  so on every phone tested the ORIGIN of the line is behind the sheet
  and 0 of 40 lines are drawn in full.
```

Three changes fix it, and all three are about the sheet, so all three are the
result screen's business:

**Give the map its own viewport.** Translate to `(width/2, band/2)` rather than
`(width/2, height/2)`, where `band` is the height above the sheet. Then "you" is
centred in what the user can see instead of in what the CSS box is.

**Frame you and the target, do not use a fixed span.** The span needed to fit both
with 18% padding runs from 0.113 at the median to 0.431 at the worst of 160
sampled rows, against the shipped fixed 0.28. Fit the pair, clamp to [0.12, 0.45].

**Give the sheet two heights.** Peek at about 38%, which is roughly three rows,
and full at about 78% for scanning. Selecting a row drops the sheet to peek so the
map can answer, which is also what makes the two-stage tap in section 6 feel like
a reason rather than a rule. Measured at a 38% sheet on a 390x844 phone: the map
band is 523px, which is 832m of ground, 32 of 40 targets land on screen and all 40
lines are drawn in full.

One more thing the sheet decides. Selecting a row currently does not move the map
at all beyond swapping which footprint is lit, so a user tapping rows 1 through 8
from the Ohio Union sees the identical highlight eight times, because those eight
rows are all in the same building. Reframing on selection is what makes that
legible, and without it ask 1 will look broken to the person who asked for it.

---

## Corrections to ux-states.md

| What `ux-states.md` says | What the shipped data and code say |
| --- | --- |
| No map in v1; tiles break the offline promise | Superseded by `DECISIONS.md` 2026-08-26. The map is vector, 50.1 KB gzipped, drawn from OSU's own GIS, no network. Ask 1 is already half built in `js/map.js` |
| Four duration chips at the bottom of the results screen, recoverable in one tap | The chips are on the root screen and the answer is its child. Duration never changes the row count (578 at 15m and at 180m) and never changes the top row between 08:00 and 15:00, so a persistent bar costs two result rows to advertise an inert control |
| 47% of free rooms have no bounded end, so say "no class rest of today" | Measured before the Registrar hours scrape. Every row now ends at a clock time, and 83.4% of them end because the **building locks**, not because a class arrives. The tier language has to change, not the tier |
| The row's confidence phrase is "free till 1:55p" or "no class rest of today" | "no class rest of today" never occurs against the shipped index. The live distinction is `till 7:50p` versus `till 1:55p, class` |
| "94 more" at the end of the list | The shipped app caps at 40 and prints nothing. From the Ohio Union the real figure is **538 more**, across 94 buildings |
| Cold launch is the perf problem: 365 to 469 ms to parse and index | Measured against a synthetic 1,800-room index. The shipped index is 871 rooms and 234 KB and parses in **4.0 ms** on this box, with a full ranked query at 2.48 ms. Still worth the phone measurement in [#29](https://github.com/EnesYilmazcode/Vacant/issues/29), but the ask screen is not needed as a parse gate. Geolocation at 0.5 to 3 s is the only long pole left |
| A3's header carries `VACANT` and `12:15 Thu` | Neither shipped, and neither should. The home-screen icon names the app, and the system clock sits two millimetres above the app's own |

---

## Risks

- **The strip is the single point of honesty failure.** With the header gone,
  every degraded state routes through one line above row one. If it renders and
  the list does not update, or the other way round, the screen lies confidently.
  It needs a test per state, not a visual check.
- **A4's trigger has changed and nobody has re-derived it.** `ux-states.md` fires
  A4 outside 08:00 to 20:15, because the schedule constrains nothing then. With
  building hours in the index the app now has something real to say at 21:00, and
  the measured header state at 21:00 is still "meets". A4 may be far smaller than
  89% of the year now, or it may need a new trigger entirely. That is issue
  [#20](https://github.com/EnesYilmazcode/Vacant/issues/20)'s problem, but this
  redesign assumes A3 covers the evening, and that assumption is untested.
- **Cutting the term label before the E1 and E2 gate ships leaves a real hole.**
  The two belong in one commit. Landing the cut alone is strictly worse than
  today.
- **`aria-current` and the history entry are both missing today**, so a screen
  reader user cannot tell which row drives the map, and an Android user's back
  button exits the app. Both are small, and both are invisible until someone hits
  them.
- **The walk icon is unverified.** I could not render it. A four-stroke figure at
  1em is easy to get wrong, and it is now the only thing carrying the word "walk".

## Open questions

1. **Does the two-stage tap survive contact with a real thumb?** Select then open
   is an Apple Maps pattern, but this list has eight buildings across forty rows,
   so a user may tap four rows in a row expecting the map to move and see nothing
   change. Worth watching during the ground-truth walk,
   [#26](https://github.com/EnesYilmazcode/Vacant/issues/26).
2. **Should the room number lead instead of the building?** "110B, Page Hall"
   scans faster inside a building you are already in, and "Page Hall 110B" scans
   faster from outside. The app is used from outside, so I chose the building, but
   this is a preference I could not measure.
3. **Is "rest of day" a fourth chip or the default?** 83.4% of rows already run to
   the doors, so "rest of day" may be what the user means most of the time, in
   which case it is the default and 30 min is the exception.
4. **What replaces the strip in landscape?** Every mockup here is portrait. At
   844x390 the sheet at 62% leaves 148px of map, which is 235m of ground, and the
   whole geometry in section 8 needs redoing.
