# Ground truth walk

Issue [#26](https://github.com/EnesYilmazcode/Vacant/issues/26). Every other gate in
this project compares the pipeline to itself: the guards diff this week's harvest
against last week's, the tests check the engine against fixtures the engine shaped.
An index that is wrong in the same direction every week passes all of it green.

#26 has two oracles. Only one of them needs shoes.

- **The desk oracle** is a cross-check against Roomix, the other Ohio State room
  finder. It is done, below, and its answer is not the one the issue expected.
- **The walk oracle** is twenty rooms visited in person. It is not done. The table
  at the bottom is empty and the instrument for filling it is built and live.

---

## Part one: the Roomix cross-check. Done 2026-09-02.

Reproduce with:

```
mkdir rx
curl -sS -o rx/rx_matrix.json  https://api.roomix.app/indexed/1268/room_matrix.json
curl -sS -o rx/rx_courses.json https://api.roomix.app/indexed/1268/courses.json
node scripts/roomix-crosscheck.mjs rx --harvest data/harvest-1268.json.gz --adjudicate
```

The two Roomix files are 2.7 MB and are not committed. Everything below is derived
from them plus the committed index, so a reader refetches and reruns.

### What each side holds

```
roomix    3511 course titles, 11967 day intervals, 5 meetings with no day bits, 0 with no time
shipped    425 rooms,          8234 day intervals
harvest   1072 rooms,         11982 day intervals
```

### Rooms

```
in room_matrix.json our index never saw          191 of 1067
  of those, with no class at all this term       189
we saw and room_matrix.json does not carry         4    1064:N368  065:5079  011:345  249:300B
```

The 191 is the honest number and it needs the raw harvest to compute. Against the
**shipped** index the figure is 642 of 1067, but 449 of those are rooms the safety
filter drops on purpose, so quoting 642 would be counting our own policy as a blind
spot. 189 of the 191 have no class at all this term, which is why we never saw them:
`scripts/build-index.mjs` only creates a room record when a meeting references it.

### Intervals, over the 425 rooms that ship

```
roomix has and we do not     143    answer-changing 138
we have and roomix does not  157    answer-changing 152
```

Over the raw harvest and all 1072 rooms it is 216 and 231.

### Who was right

Every disagreement above is a claim about a specific booking, and a booking can be
settled for free against the live `content.osu.edu` class search. 292 bookings sat
behind those intervals. Of the ones carrying a resolvable class number:

```
roomix   0 of 128 claims still true today     section-gone 18   course-gone 22   stale 88
ours   164 of 164 claims still true today     confirmed 164
```

**Roomix was the wrong side of every single disagreement that could be settled.**

Spot-checked by hand, outside the script: Roomix carries ACCTMIS 2300 class number
36244 in 250:275 on Thursdays. The live API returns 200 sections for ACCTMIS 2300
and 36244 is not among them, while its neighbours 36240 and 36245 are.

### What that means, and it is not what the issue assumed

The issue's Notes say a disagreement is "more likely ours than theirs", because
Roomix's `courses.json` is already cleaned. That is backwards, and cleaned is the
reason: Roomix is a **snapshot**, taken once and not re-harvested. 18 sections have
since been cancelled, 22 whole courses have gone, and 88 bookings have simply moved.
Ours is three days old and re-harvests weekly.

So Roomix is not an oracle. It is a second reading of the same API at an earlier
date, and the diff between us mostly measures elapsed time rather than correctness.
Worth rerunning after a term rollover, when a stale snapshot would show as a much
larger diff. Worth little in between.

**It does not touch the error rate the issue actually wants.** Every failure mode #26
exists to catch is invisible to both sides: a locked outer door, a club with the room
booked, a class scheduled with no room recorded. Both readings inherit those blind
spots identically. Only the walk finds them.

### The other thing settled at a desk

The issue's comment says ranking from the Ohio Union on Thursday at 12:15 puts
`HH0120C` first, an 8 seat departmental conference room in Hagerty Hall, and that 35
of the top 40 rows are outside the 1A/1B/1C allow list.

Re-run against the current engine, same origin, same minute, 60 minute ask:

```
top ten   DB0049 UH0037 LZ0018 JE0164 HA0006 CH0228 SM2186 PS0035 DU0024
          all 1B, all general assignment
HH0120C   10th of the 29 rows shown, 23rd of the 397 ranked
outside 1A/1B/1C   1 of the rows shown, down from 35 of 40
departmental       3 of the rows shown
```

[#96](https://github.com/EnesYilmazcode/Vacant/pull/96) made `tierOf()` read the `ga`
flag on 2026-09-02, and [#105](https://github.com/EnesYilmazcode/Vacant/pull/105)
removed the computer labs. The comment's open question, whether to exclude
departmental rooms or just demote them, is answered in shipped code: **demote, and
label**. Every such row renders "departmental" beside its seats. The walk should
still visit some, because whether a student can get into one is a fact about doors
rather than about ranking.

---

## Part two: the walk. Not done. Needs Enes and twenty rooms.

Instrument: **https://enesyilmazcode.github.io/Vacant/spikes/walk.html**, live now.
It picks the twenty with quotas and never more than two per building, restricts to
rooms free on arrival because a room you have to wait for cannot be checked by
opening its door, starts a stopwatch on the row tap, records the outer and the inner
door separately so the five buckets sum to twenty, asks what was inside, persists to
`localStorage` so an interrupted walk survives, and emits the table below already
filled in.

Nine fields, twenty rows, six or more buildings. Four or more rows on a Saturday,
Sunday or after 19:00. Three or more type 1B rooms absent from the general assignment
list. Eight or more rows carrying a stopwatch door-to-door time.

### Two done-whens cannot be satisfied any more, and this is why

**"2 or more rows in buildings with no row in `data/buildings-hours.json`."** There
are none left. `scripts/lib/room-safety.mjs` drops a room whose building has no
published hours, so all 425 shipped rooms sit in one of the 46 buildings that
publish. The unknown-hours tier in `tierOf()` is dead against shipped data. If that
row is wanted it has to come from outside the app.

**"Spend two visits on rooms with no class all term."** Structurally impossible. A
room enters the index by being named in a meeting, so a room with no meetings has no
record. The 189 such rooms are in Roomix and not in us, and the cross-check lists
them by facility id.

### What the stopwatch can and cannot fit

`WALK_MPM = 78` and `DETOUR = 1.3` are both commented as guesses, and #26 asks for
them to be changed or reaffirmed with a measured number written into the comment.

**A stopwatch alone can only fit their ratio.** `1.3 / 78` of a minute is exactly one
second, so the pair is currently one metre to one second, and any fit that preserves
that identity has changed nothing. Splitting them needs a measured path length as
well as a time, from a phone track or a route drawn on a map.

**And the measurement is biased before the stopwatch starts.** `distanceMetres` stops
at the building's published point; the room's own door is somewhere else inside the
footprint. Measured over the 46 shipped buildings by decoding `data/campus.json`
against that point, which `scripts/test/walk-bias.test.mjs` recomputes: the far
corner of a building sits a **median 44 m** from it, **62 m at the 90th percentile**,
and **85 m at PAES**, which at these constants is 44, 62 and 85 seconds of walking
the engine never prices. Subtract that before moving either number. The 38 s and
1 min 45 s quoted in #26 are both low, and Ohio Stadium, which the second one names,
is dropped by the safety filter and never quoted at all.

### The table

Twenty rows go here. Empty on purpose: no walk has happened.

| room | ts | app_usable | app_walk | tier | outer | inner | occupied | by |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |  |  |

### The error rate

One fraction of twenty, split five ways, and the five buckets sum to twenty.

| bucket | n |
| --- | --- |
| locked building |  |
| locked room |  |
| occupied by something unscheduled |  |
| room does not exist |  |
| correct |  |

Until this table carries numbers, **the app's error rate is unknown**, and the caveat
wording and the confidence tiers on the result screen stand as written rather than
reaffirmed. Nothing in part one changes that. It only removes an oracle we thought we
had.
