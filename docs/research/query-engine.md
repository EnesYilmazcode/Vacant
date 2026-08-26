# Query engine: design and measured performance

Research note, 2026-08-26. Assignment: specify the in-memory query engine and prove
it is fast enough on a mid-range phone, with real numbers.

**The one sentence version.** The query itself is a non-problem, warm it runs in
0.4 to 1.3 ms over 1800 rooms with no spatial index at all, but the cold launch is
a real problem at 365 to 469 ms because `JSON.parse` plus index construction
dominate everything else. **The fix is to ship the busy intervals as a packed
binary blob instead of JSON, which takes cold launch to first ranked answer from
~370 ms down to ~33 ms, measured, with byte-identical results.**

```
  JSON path (as the README specifies it)          PACKED path (recommended)

  fetch  rooms-1268.json  414 KB / 54 KB gz       fetch  rooms-1268.bin  170 KB / 37 KB gz
    |                                               |
  JSON.parse        ~85 ms   <-- dominant         read 12-byte header      ~0 ms
    |                                               |
  build typed index ~160 ms  <-- dominant         JSON.parse the name/coord
    |                                             header only (~40 KB)     ~13 ms
  first query       ~150 ms                         |
    |                                             query straight off the
    v                                             ArrayBuffer, no build    ~17 ms
  365 - 469 ms to first answer                      |
                                                    v
                                                  29 - 38 ms to first answer
```

Everything below is measured on this box unless it says otherwise. Nothing here
was tested on an actual phone; see [What I could not measure](#what-i-could-not-measure).

---

## Contents

1. [How the numbers were produced](#1-how-the-numbers-were-produced)
2. [What the real data looks like](#2-what-the-real-data-looks-like)
3. [In-memory data structures](#3-in-memory-data-structures)
4. [The gap-finding algorithm](#4-the-gap-finding-algorithm)
5. [Defining usable](#5-defining-usable)
6. [Passing-period policy](#6-passing-period-policy)
7. [The benchmark](#7-the-benchmark)
8. [Ranking and the fallback ladder](#8-ranking-and-the-fallback-ladder)
9. [Distance and the walk constant](#9-distance-and-the-walk-constant)
10. [Corrections to the blueprint](#10-corrections-to-the-blueprint)
11. [What surprised me](#11-what-surprised-me)
12. [What I could not measure](#what-i-could-not-measure)
13. [Reference implementation](#13-reference-implementation)

---

## 1. How the numbers were produced

### Live API sample, 30 requests

Budget was 60 requests. I used 30 against `content.osu.edu` and 2 against Overpass.
Sequential, 600 ms pause between calls, 90 s timeout, 3 retries with backoff.

```
GET https://content.osu.edu/v2/classes/search
      ?q=&subject=<code>&term=1268&campus=col&p=<n>&sort=catalogNumber
```

Twelve subjects, up to 4 pages each: `cse math english psych history physics econ
chem biology sociol spanish comm`.

```
cse: 800 sections, 4 pages      chem: 768 sections, 4 pages
math: 507 sections, 3 pages     biology: 257 sections, 2 pages
english: 242 sections, 2 pages  sociol: 192 sections, 1 pages
psych: 150 sections, 1 pages    spanish: 206 sections, 2 pages
history: 687 sections, 4 pages  comm: 258 sections, 2 pages
physics: 611 sections, 4 pages  econ: 102 sections, 1 pages
                                                total 30 requests
```

4780 sections, 4963 meetings.

### Building coordinates, 2 requests

```
POST https://overpass-api.de/api/interpreter
data=[out:json][timeout:90];way[building][name](39.990,-83.040,40.008,-83.008);out center tags;
```

298 named buildings, which confirms the plan's figure exactly.

> **New gotcha, not in the plan.** Overpass returns **HTTP 406** with an HTML body
> if you do not send a `User-Agent` header. Node's `fetch` sends `undici` by
> default and gets refused. Add
> `"User-Agent": "vacant-research/0.1 (OSU student project)"` and it returns 200.
> This will bite the phase 2 `buildings.json` script.

### The benchmark index

The 378 real sampled rooms were resampled with replacement up to **1800 rooms
across 150 buildings**, using the **real Overpass coordinates** (evenly sampled from
the 298) and the **real busy patterns** with a plus or minus 5 minute jitter so
rooms are not exact clones. Result: 20,618 intervals, 11.45 per room, which lands on
the assignment's "average of 12" without being told to.

---

## 2. What the real data looks like

### The funnel from meeting to busy interval

```
4963 meetings in 4780 sections
  -  400  online          (buildingDescriptionShort === "ONLINE", Finder's test)
  - 1844  no facilityId   (of these, 1791 have no time and 1813 have no days:
                           TBA placeholders, independent study, thesis credit)
  =  2719 room-bearing meetings
  -> 4679 day-expanded intervals   (one meeting on MoWeFr becomes 3 intervals)
  -  449  exact duplicates dropped (9.6%)
  =  4230 intervals over 378 rooms in 46 buildings, 3 session date ranges
```

The 1844 no-`facilityId` meetings all have an empty building label too, so a single
`if (!m.facilityId) continue` in the harvester is safe and drops all of them.

### Interval density, the number the query actually walks

| Scope | mean | p50 | p90 | p95 | p99 | max |
|---|---|---|---|---|---|---|
| intervals per room per **week** | 11.19 | 10 | 22 | 26 | 39 | 57 |
| intervals per room per **weekday** | 2.85 | 2 | 6 | 6 | - | 15 |

The per-weekday number is the one that matters. A query touches one weekday, so the
inner loop is a sweep over a mean of **2.85 intervals** and a worst case of 15.
There is no data-structure problem here at any scale this project will ever see.

### Duplicates and overlaps are real but tiny

- **449 of 4679 (9.6%) day-expanded intervals are exact duplicates.** This is the
  combined-sections and multi-room-label repeat that Finder documents in
  `js/format.js:distinctMeetings`. The harvester should drop these at build time.
- **32 overlapping non-identical pairs across 8 rooms**, after exact dedupe.
- **Of those 32, only 2 are within the same session date range.** The other 30 are
  the same room at the same clock time in *different* half-term sessions, which is
  not a conflict at all. Filtering by today's active session first removes 94% of
  apparent overlaps.

Two real examples:

```
DL0317 Tue 12:45-14:05  CSE 2501 sec 0080  session 2026-10-19..2026-12-09
DL0317 Tue 12:45-14:05  CSE 2501 sec 0100  session 2026-08-25..2026-10-12
        ^ same room, same slot, different halves of the term. Not an overlap.

BE0470 Tue 14:20-15:40  CSE 2112 sec 0031  session 2026-08-25..2026-12-09
BE0470 Tue 14:20-15:20  CSE 2112 sec 0031  session 2026-08-25..2026-12-09
        ^ same section, two end times. A genuine containment. Merge it.
```

The algorithm below handles duplicates, containment and partial overlap with the
same merge sweep, so none of these needs a special case.

### Other shape facts worth having

| Fact | Value |
|---|---|
| Distinct session date ranges | **3**: full term, `2026-08-25..2026-10-12`, `2026-10-19..2026-12-09` |
| Earliest class start | 450 min (07:30) |
| Latest class end | 1335 min (22:15) |
| Weekend intervals | **0 of 4679** |
| Common durations | 55 min (2387), 80 min (1084), 165, 175, 125, 110 |
| Busiest start times | 12:40, 10:20, 15:00, 11:30, 13:50, 09:10, 08:00 |
| `facilityId` mapping to >1 `buildingCode` | **0**, the id is a safe primary key |
| Room capacity | min 0, p50 34, max 727. **13 rooms report capacity 0** |
| `facilityType` over 378 rooms | 1B 240, 2A 52, 1C 43, 5K 9, 2M 9, 1A 8, 2P 7, 2K 5, 2Q 2, 6C/5J/5L 1 each |

`1B` is 63% of rooms and is almost certainly the general-purpose classroom. That was
inference from the distribution when I wrote it, and the sibling note
[facility-types.md](facility-types.md) has since confirmed it against a larger
sample: `1B` general classroom and `1C` lecture hall are rated confident, `1A`
seminar room likely. The engine should prefer `{1A, 1B, 1C}` and treat everything
else as a fallback rung.

---

## 3. In-memory data structures

### The on-disk shape stays as the README has it, with one change

Keep `[weekday, startMinute, endMinute, sessionIndex]`. Integer minutes past
midnight is right, and the session table deduped to 3 rows is right.

The change: **the harvester should pre-sort and pre-merge within each
`(room, weekday, sessionIndex)` group.** Those three always co-occur, so merging
them at build time is free and permanent. It removes all 449 exact duplicates and
both same-session overlaps before the phone ever sees the file. What cannot be
merged at build time is *across* sessions, because which sessions are live depends
on today's date.

Sort order inside each room: `weekday asc, start asc, end desc`. End-descending
matters, it puts a containing interval before the interval it contains, which is
what lets the merge sweep be a single pass.

### What gets built at load

```js
// per building, parallel arrays
bLat: Float64Array(nB)
bLon: Float64Array(nB)

// per room
rBuilding: Int32Array(nR)     // index into the building arrays
rCap:      Int32Array(nR)

// per weekday, CSR (compressed sparse row) over rooms
off[d]: Int32Array(nR + 1)    // off[d][r] .. off[d][r+1] is room r's slice
st[d]:  Int16Array(m_d)       // start minute
en[d]:  Int16Array(m_d)       // end minute
ss[d]:  Uint8Array(m_d)       // session index

// scratch, allocated once and reused so the hot loop allocates nothing
walkBuf: Int32Array(nB)
```

Bucketing by weekday at load costs nothing and means a query never looks at an
interval for a day it does not care about. Memory at 1800 rooms and 20,618
intervals: 5 bytes per interval is ~103 KB, plus 7 offset arrays at ~50 KB. Call it
150 KB. Irrelevant on any phone.

### Applying session date ranges to "today"

Sessions are a 3-row table, so this is not a per-room problem. Compute one mask per
day and reuse it for every query that day:

```js
function activeMask(sessions, todayISO) {
  const m = new Uint8Array(sessions.length);
  for (let i = 0; i < sessions.length; i++)
    m[i] = (sessions[i][0] <= todayISO && todayISO <= sessions[i][1]) ? 1 : 0;
  return m;
}
```

ISO date strings compare correctly with `<=` because `YYYY-MM-DD` sorts
lexicographically. No `Date` objects, no timezone handling, no parsing. At most two
sessions are live on any given date (full term plus one half), but do not hardcode
that.

The mask is checked per interval inside the sweep. At 2.85 intervals per room-day
that is cheaper than any pre-filtering scheme would be.

**Holidays are not handled and cannot be, from this API.** Sections carry a
`holidaySchedule` field that I did not decode. A room shows as busy on Thanksgiving.
That is a known wrong answer, worth an issue.

---

## 4. The gap-finding algorithm

Every edge case in the assignment collapses into one sweep: **merge the active busy
intervals into maximal blocks, and the free gaps are the complement.** Back-to-back
chaining, duplicates, containment and partial overlap all fall out of the merge.
Nothing needs a branch of its own.

```
function firstFittingGap(room, weekday, arrival, need, activeMask):
    lo, hi = off[weekday][room], off[weekday][room+1]
    cursor = DAY_START            # end of the last busy block seen so far
    firstGap = null               # the immediate gap, for display
    i = lo

    while i < hi:
        if not activeMask[ss[i]]:            # wrong half of the term
            i += 1; continue

        # --- merge every interval that touches or overlaps this one ---
        s, e, j = st[i], en[i], i + 1
        while j < hi:
            if not activeMask[ss[j]]: j += 1; continue
            if st[j] > e: break                       # a real gap opens here
            if en[j] > e: e = en[j]                   # extend, handles containment
            j += 1

        # --- the free gap [cursor, s) sits before this merged block ---
        if s > cursor:
            if s > arrival:                           # still open when you get there
                if firstGap is null: firstGap = (cursor, s)
                usableStart = max(arrival, cursor)
                if (s - PACKUP) - usableStart >= need:
                    return (cursor, s), firstGap      # a gap that actually fits
            if cursor > arrival + LOOKAHEAD: break    # too far in the future to care

        cursor = max(cursor, e)
        i = j

    # --- the open tail of the day, after the last class ---
    if cursor < DAY_END:
        usableStart = max(arrival, cursor)
        if firstGap is null: firstGap = (cursor, DAY_END)
        if (DAY_END - PACKUP) - usableStart >= need:
            return (cursor, DAY_END), firstGap

    return null, firstGap
```

Returning both the fitting gap and the immediate gap in one sweep is what feeds the
"free in 12 minutes" fallback rung without a second pass.

### Edge cases, all verified by test

I ran all of these against both the plain-object and the typed-array
implementation. Standing at the room, so walk is 0, `now` = 12:00 Tuesday,
`need` = 1 min, `PACKUP` = 10, `DAY_END` = 22:00.

| Case | Busy intervals | Result | Right? |
|---|---|---|---|
| No classes today at all | `[]` | free 00:00-22:00, usable 590 | yes |
| **Now is inside a class** | `11:40-12:40` | free **12:40**-22:00, usable 550 | reports when it frees |
| Class already ended | `11:00-11:55` | free 11:55-22:00, usable 590 | yes |
| **Now is before the first class** | `13:00-13:55` | free 00:00-13:00, usable **50** | yes, window ends at the class |
| **Now is after the last class** | `09:00-09:55` | free 09:55-22:00, usable 590 | yes |
| **Back to back, 15 min OSU passing** | `11:00-11:55`, `12:10-13:05` | **no result** | yes, see section 6 |
| Back to back, zero gap | `11:00-11:55`, `11:55-12:50` | free 12:50-22:00, usable 540 | chains correctly |
| **Exact duplicate intervals** | `11:00-11:55` twice | free 11:55-22:00, usable 590 | dedupe not needed at query time |
| **Overlapping, combined sections** | `11:00-12:20`, `11:00-12:00` | free 12:20-22:00, usable 570 | merged |
| Contained interval | `10:00-13:00`, `11:00-11:40` | free 13:00-22:00, usable 530 | merged |
| Inactive session blocks nothing | `11:00-11:55` in session 1, only 0 live | free 00:00-22:00 | yes |
| Unsorted input | `13:00-13:55`, `10:00-10:55`, `11:30-12:25` | free 12:25-13:00, usable 25 | sort at load, not per query |

```
variant disagreements: 0
```

### Grid bounds

`DAY_START = 420` (07:00) and `DAY_END = 1320` (22:00). The earliest measured class
start is 07:30 and the latest measured end is **22:15**, so 22:00 is contradicted by
real data in a handful of rooms. The sweep handles that fine, the room simply drops
out because `cursor >= DAY_END`. Keep `DAY_END` a config constant and say in the UI
that late-evening availability is a guess, because building access hours are an
unsolved dataset problem and this is the place that hole shows up.

Without `DAY_START`, a room with no morning class reports "free since 00:00", which
is true and useless. Clamp it.

---

## 5. Defining usable

The README says:

```
usable = gapEnd - now - walkTime
```

**That is wrong when the gap has not started yet, and it overstates.** Walk time
shifts the *start* of your window. It does not shorten the *end*. Subtracting it
from a fixed end double-counts the wait.

Worked example. The room frees at 14:00, you are 6 minutes away, `now` is 13:50, the
next class starts at 16:00.

```
README formula:   16:00 - 13:50 - 6      = 124 min
Correct:          16:00 - 14:00          = 120 min
```

The 4 minutes you spend standing in the corridor got counted as study time.

### The correct formula

```
arrival     = now + walkMinutes
usableStart = max(arrival, gapStart)          # you cannot start before either
usableEnd   = gapEnd - PACKUP                 # you must be out before the next class
usable      = usableEnd - usableStart
```

**Should walk time be subtracted at the start as well?** It already is, that is what
`arrival` means. Do not subtract it twice, and do not add a separate arrival buffer
on top. The room is empty the instant the previous class ends, and walk time plus
the pack-up buffer already carry all the slack the model can honestly claim.

**What happens when the gap has already started?** `max(arrival, gapStart)` resolves
to `arrival`, and the formula degenerates to `gapEnd - PACKUP - now - walk`, which
is the README's formula with the buffer added. So the README is a special case of
this one, correct for the "already free" branch and wrong for the "frees soon"
branch.

**Round walk time up, never down.** `Math.ceil`. The app must never promise more
time than the student gets. Every rounding decision in this engine should break
pessimistic.

### One thing the UI gets for free

`leaveBy = max(now, gapStart - walkMinutes)`. If the gap starts later, there is no
rush, and the card can say "free at 2:00, leave by 1:54" instead of implying you
should sprint.

---

## 6. Passing-period policy

**The assignment's premise is wrong for Ohio State, and the real number changes the
answer.** OSU's standard passing period is **15 minutes, not 5**, and it is 69.3% of
every inter-class gap on campus.

Measured over 2711 real inter-class gaps in real rooms on real days:

| Gap length | Count | Share | Cumulative |
|---|---|---|---|
| 0 min | 0 | 0.0% | 0.0% |
| 1-9 min | 0 | 0.0% | 0.0% |
| 10-14 min | 35 | 1.3% | 1.3% |
| **15 min** | **1879** | **69.3%** | **70.6%** |
| 16-29 min | 51 | 1.9% | 72.5% |
| 30-59 min | 93 | 3.4% | 75.9% |
| 60-119 min | 362 | 13.4% | 89.3% |
| 120+ min | 291 | 10.7% | 100.0% |

Two things fall out. **There is no such thing as a 5 minute passing period at OSU,
and there is no such thing as a back-to-back class with zero gap.** The minimum gap
observed anywhere in the sample is 10 minutes. And **70.6% of all gaps are corridor
shuffle**, not opportunity. Only 27.5% of gaps are 30 minutes or longer.

### Recommendation: a 10 minute pack-up buffer at the end, nothing at the start

```js
const PACKUP = 10;   // minutes
usableEnd = gapEnd - PACKUP;
```

Four reasons, in the order they actually mattered:

1. **It makes the standard passing period self-eliminate with no special case.** A
   15 minute gap yields `15 - 10 = 5` minutes of usable time, which fails any
   duration a human would ask for. The 69.3% of gaps that are pure corridor traffic
   drop out of the result set by arithmetic. Verified: the "back to back, 15 min OSU
   passing" test case returns nothing even at `need = 1`.
2. **It is the socially correct amount.** You are out with 10 minutes left, so the
   incoming class walks into an empty room rather than into you packing a laptop.
   The student who "stays past 10:15" in the assignment's example is exactly who
   this prevents.
3. **A start buffer would double-count.** Walk time already covers arrival, and the
   previous class clears the room in the first two or three minutes, which is inside
   the walk time of anyone not already standing outside the door.
4. **It fails safe.** Every other rounding rule in this engine is pessimistic, and a
   buffer at the end is the same instinct: under-promise the window.

**Do not implement this as a merge tolerance.** It is tempting to merge busy blocks
separated by less than 15 minutes and be done. That is wrong, because it would also
swallow the 1.3% of genuine 10-to-14 minute gaps and, worse, it would report
`gapEnd` as the start of the *second* class, which is a lie about when the room is
actually free. Keep merge (a fact about the schedule) and buffer (a policy about
politeness) separate.

**A 15 minute buffer is defensible and I rejected it** because it starts eating real
inventory: it would cut a genuine 30 minute gap to 15 usable minutes, and 3.4% of
gaps are in the 30-59 band.

---

## 7. The benchmark

```
Machine   AMD Ryzen 7 5800H, 16 cores, 15.3 GB
Runtime   node v22.14.0, win32
Index     1800 rooms, 150 buildings, 20,618 intervals, 3 sessions
Files     rooms-1268.json  414,192 bytes  ( 53,951 gzipped)
          rooms-1268.bin   170,400 bytes  ( 37,198 gzipped)
```

The workload is 2000 queries at random campus standing points, random weekday,
`now` between 08:00 and 18:00, `need` drawn from 30/60/90/120 minutes.

### Warm, per query

```
A  naive objects + haversine     p50 1.9349  p95 2.9596  max 5.2860  mean 2.0073
B  typed CSR + equirect          p50 0.2335  p95 0.5431  max 1.2620  mean 0.2597
C  typed CSR + "frees soon" list p50 0.3032  p95 0.6399  max 1.1969  mean 0.3274
C  at 3x density (34.4 iv/room)  p50 0.2345  p95 0.5508
```

**Tripling the interval density changes nothing** (0.3032 to 0.2345, inside noise).
The walk-radius filter rejects most rooms before the interval sweep ever runs, so
the sweep is not where the time goes.

Warm time does depend on where you are standing, because that sets how many rooms
survive the radius filter:

| Standing point | Rooms in 12 min radius | p50 | p95 |
|---|---|---|---|
| Oval, dense centre | 988 | 1.3263 ms | 2.4470 ms |
| Mid campus | 667 | 0.8300 ms | 1.6308 ms |
| North edge | 573 | 0.6472 ms | 1.2855 ms |
| Southwest edge | 367 | 0.3781 ms | 0.7358 ms |

**Conclusion on precomputation: none is needed.** Worst case warm is 1.33 ms p50 and
2.45 ms p95 at the busiest point on campus, against a 16 ms frame budget. Even the
naive plain-object implementation at 1.93 ms p50 clears it. Do not build a spatial
index, do not bucket rooms by grid cell, do not precompute distance tables. The
linear scan over 1800 rooms is the right answer and will stay the right answer.

### Cold, which is where the real problem is

Fresh process, each stage timed, three runs:

```
                run 1     run 2     run 3
readFile         20.6      28.0      29.9  ms
JSON.parse       73.8      77.3      57.3  ms
buildFast       186.9     173.1     141.0  ms   <-- dominant
first query     188.0     147.1     136.6  ms   <-- cold JIT
                -----     -----     -----
TOTAL           469.4     425.5     364.9  ms

second query     13.4      10.2       8.2  ms
warm p50          2.6       2.6       2.0  ms
```

The warm query is 100 times faster than the first one. Nothing is wrong with the
algorithm, the first call simply runs in the interpreter before the JIT tiers up.
**For a PWA whose entire promise is "opens instantly," the cold number is the only
number that matters**, and 365 to 469 ms on a desktop is not instant.

### Three cold paths compared, fresh process each time, 5 runs each

```
typed   parse 96.3  answer 285.5  TOTAL 381.8 ms
typed   parse 76.6  answer 251.5  TOTAL 328.2 ms
typed   parse 93.2  answer 286.9  TOTAL 380.0 ms
typed   parse 90.5  answer 282.7  TOTAL 373.2 ms
typed   parse 86.0  answer 240.4  TOTAL 326.5 ms

naive   parse 79.3  answer 162.7  TOTAL 242.0 ms
naive   parse 81.0  answer 181.7  TOTAL 262.7 ms
naive   parse 80.6  answer 198.0  TOTAL 278.6 ms
naive   parse 87.3  answer 218.5  TOTAL 305.9 ms
naive   parse 92.1  answer 179.9  TOTAL 272.0 ms

bin     load+decode 16.2  answer 12.4  TOTAL 28.6 ms
bin     load+decode 13.3  answer 25.1  TOTAL 38.4 ms
bin     load+decode 16.0  answer 17.2  TOTAL 33.1 ms
bin     load+decode 20.5  answer 15.1  TOTAL 35.7 ms
bin     load+decode 15.6  answer 20.8  TOTAL 36.4 ms
```

Two findings, both actionable.

**First: building the typed index is a net loss for the first query.** Cold typed
(326-382 ms) is *slower* than cold naive (242-306 ms), because the 150 ms build
costs more than it saves on a single query. So on cold launch, answer the first
query off the raw parsed JSON, render it, and build the typed index in an idle
callback for every query after that. That is a **21% cold saving** for a five-line
change.

**Second, and much bigger: the packed binary format is a 10x cold win.** 28.6 to
38.4 ms versus 242 to 306 ms, a **reduction of about 88%**. The whole cost of
`JSON.parse` on 20,618 nested arrays disappears, because the intervals arrive as
bytes and are read through a `DataView` with no parse and no build step at all. The
file is also 59% smaller raw and 31% smaller gzipped.

### The packed layout

```
 offset  bytes            contents
 0       4                magic 0x56414331 ("VAC1")
 4       4                metaLen
 8       4                nRooms
 12      metaLen          JSON: term, generated, sessions[],
                                buildings[[short,lat,lon]...],
                                rooms[[number,buildingIdx,cap,type]...]
 ...     4*(nRooms+1)     Int32LE CSR offsets into the interval block
 ...     6*nIntervals     per interval: u8 weekday, u8 session,
                                        i16LE start, i16LE end
```

Intervals are sorted by `(weekday, start asc, end desc)` within each room, so a
room's intervals for one weekday are contiguous and the merge sweep reads them in
order straight off the buffer.

The names and coordinates stay JSON, because they are ~40 KB, they are read once,
and hand-maintaining `buildings.json` in phase 2 is much easier in text.

### Correctness of the fast path

Speed claims are worthless if the answers changed. Cross-checked the packed-binary
reader against the typed-CSR implementation over 500 random queries:

```
cross-check typed-CSR vs packed-binary: 10000 top-20 rows over 500 queries, 0 mismatches
```

### Projecting to a mid-range phone

I did not test on a phone. Applying the usual 4x to 8x single-thread multiplier for
a mid-range Android against this Ryzen 7 5800H:

| Path | Desktop cold | Projected phone cold |
|---|---|---|
| JSON + typed build | 326-382 ms | **1.3 - 3.1 s** |
| JSON naive first | 242-306 ms | **1.0 - 2.4 s** |
| **Packed binary** | **29-38 ms** | **0.12 - 0.31 s** |

Only the packed path is defensibly "instant" on the hardware this app is for. This
row is the argument for doing the format work in phase 1 rather than discovering it
in phase 3. Treat the projection as an estimate, not a measurement, and confirm it
on a real handset before it goes in the README.

---

## 8. Ranking and the fallback ladder

### Score everything in minutes

Distance is primary, but pure distance ranks a 3 minute walk giving exactly the
requested time above a 4 minute walk giving twice as much, which is the wrong
answer. Put both in the same unit and let a big surplus buy a short detour.

```js
const SURPLUS_WEIGHT = 0.1;   // an hour of headroom is worth 6 minutes of walking
const SURPLUS_CAP    = 60;    // beyond an hour of surplus, more is worthless

score = walkMinutes - SURPLUS_WEIGHT * min(usable - need, SURPLUS_CAP)
```

Lower is better. A room 6 minutes further only wins if it gives a full extra hour,
so distance stays genuinely primary and "closer but shorter" only loses to "further
but much longer". The cap exists because the student already said how long they
need, so surplus past an hour is not a real benefit and should not drag them across
campus.

Tie-breaks, in order:

1. `score` ascending
2. `usable` descending, longer window wins
3. **`facilityType` preference**, classrooms first. This is a better signal than
   capacity and it keeps people out of wet labs and studios, which is a stated open
   question in the plan. Use the set `{1A, 1B, 1C}`, per
   [facility-types.md](facility-types.md), which decoded the codes against a larger
   sample and rates `1B` (general classroom) and `1C` (lecture hall) as confident
   and `1A` (seminar room) as likely. Rank `1B` above `1C`, since a lecture hall is
   more likely to be held for an event.
4. `capacity` descending, weakly
5. **`facilityId` ascending**, so ordering is deterministic

That last one is not cosmetic. Finder's own API doc records that non-deterministic
ordering cost it 6% of results per pull. A stable final tie-break costs nothing and
makes the list not reshuffle when the user re-opens the app.

On capacity as a tie-break: I kept it because the README asks for it, but I do not
believe in it. A 727 seat lecture hall is *more* likely to be locked or held for an
event than a 34 seat classroom, so seats may be an inverted signal. Worth testing
once the phase 4 "was it open?" reports exist.

### The fallback ladder

Rungs, descending, stopping at the first that returns 3 or more rooms:

1. `need` as asked, within the default 12 minute radius, preferred room types
2. Same, with the room-type filter dropped
3. `need` relaxed down the chip ladder: 120, 90, 60, 45, 30, 20
4. **Rooms that fit `need` but are not free yet**, ranked by wait time then distance.
   This is the README's "the room that frees up in twelve minutes." The sweep in
   section 4 already returns these, so the rung is free.
5. Radius doubled to 25 minutes, ladder repeated
6. Radius removed entirely, and if that still fails, the single longest-free room on
   campus with an honest "nothing near you is free" headline

Never show an empty screen. Always label a relaxed answer as relaxed.

### How often does the ladder actually fire

I built a deliberately pessimistic "busy campus" index at 3x the sampled interval
density, standing in for the 231 subjects the 12-subject sample never saw, and asked
for 120 minutes.

```
scenario                                   relax%  ladder ms p50/p95
sparse,  12 min radius / all day             0.0     1.421/3.845
busy 3x, 12 min radius / all day             0.0     1.085/3.003
busy 3x, 12 min radius / prime 10:00-15:00   0.0     1.145/2.669
busy 3x,  6 min radius / all day             0.4     0.242/0.781
busy 3x,  6 min radius / prime               0.7     0.209/0.630
busy 3x,  4 min radius / all day            14.3     0.145/0.601
busy 3x,  4 min radius / prime              14.5     0.158/0.672
busy 3x,  2 min radius / all day            52.5     0.355/4.506
busy 3x,  2 min radius / prime              57.9     0.376/4.178
```

At the default 12 minute radius the ladder **never fires**, even on a tripled-density
campus at midday. It only starts mattering below a 6 minute radius, and by 2 minutes
it fires on more than half of queries. Worst observed full-ladder cost is 4.5 ms p95
at the 2 minute radius, which is 13 passes. Still inside a frame.

So the ladder is a safety net that mostly does not fire, and the cost of having it
is negligible. Build it, but do not spend design effort on rungs 5 and 6, because at
the default radius they are unreachable.

---

## 9. Distance and the walk constant

### Use equirectangular, not haversine

```js
const R = 6371008.8;                         // IUGG mean earth radius, metres
const RAD = Math.PI / 180;
const kx = Math.cos(lat * RAD) * RAD * R;    // metres per degree of longitude here
const ky = RAD * R;                          // metres per degree of latitude
const dx = (bLon - lon) * kx, dy = (bLat - lat) * ky;
const metres = Math.sqrt(dx * dx + dy * dy);
```

**Maximum error against haversine over all 298 real campus buildings: 0.1285 metres.**
Campus spans 2034 m north-south by 2814 m east-west, which is far too small for
earth curvature to register. It is also 10x cheaper:

```
DISTANCE over 150 buildings, 10000 reps:
  haversine 0.01956 ms/pass    equirect 0.00197 ms/pass
```

The cost difference is only ~8% of a warm query, so this is a nicety rather than the
thing that saves the app. Take it anyway, because 13 centimetres of error against a
fudge factor of plus-or-minus 30% is not error at all. Keep a haversine somewhere for
reference and for the test that asserts the two agree.

### The walk constant, and it is a fudge factor

```js
const WALK_MPM = 78;     // metres per minute on the ground
const DETOUR   = 1.30;   // fudge factor. Straight lines are not sidewalks.
walkMinutes = Math.ceil(metres * DETOUR / WALK_MPM);
```

Effective straight-line progress is about 60 m/min.

- **78 m/min** rather than the README's 80. Average adult walking speed is ~1.34 m/s
  = 80.4 m/min. Students walk faster, but the whole engine breaks pessimistic and
  the student carrying a backpack up the Oval in February is the case to design for.
- **1.30 is a fudge factor and should be labelled one in the code.** It is not
  derived from OSU's sidewalk network. It comes from the standard pedestrian
  circuity range of 1.15 to 1.45, anchored near the 4/pi = 1.273 detour ratio of a
  perfect grid. Nobody measured it here.

Both belong in one config block with a comment saying they are guesses, so that when
the phase 4 "was it open?" reports start arriving there is an obvious place to
calibrate them against reality.

### The river turns out not to matter, which I did not expect

The Olentangy runs through campus at longitude **-83.02338** (range -83.02421 to
-83.02121 in the campus band), and **87 of 297 buildings sit west of it**. The
intuition is that a west-campus room 400 m away straight-line is really a 1200 m
walk, and that a flat fudge factor cannot cover that.

It is not true here, because the crossings are dense. Measured from Overpass, five
of them inside the campus band:

```
King Avenue          39.99081, -83.02403
John H Herrick Drive 39.99793, -83.02395
footbridge           39.99971, -83.02235
Woody Hayes Drive    40.00431, -83.02376
West Lane Avenue     40.00651, -83.02187
```

Over **7241 real river-straddling building pairs under 1500 m straight-line**,
comparing the straight line against the shortest path through the nearest crossing:

```
detour ratio  p10 1.00   p50 1.04   p90 1.20   max 1.70
fraction needing more than 1.30x:  4%
fraction needing more than 2.00x:  0%
```

**The flat 1.30 fudge factor already absorbs 96% of river crossings**, and the worst
case anywhere is 1.70. So do not build a barrier model, a zone table, or a
crossing-graph. It would be real work for a correction that is smaller than the
uncertainty in the walk speed constant.

The honest caveat: this assumes all five crossings are walkable. King Avenue and
Woody Hayes Drive are roads, and I checked that they exist, not that they are
pleasant. If the 4% tail matters later, the cheap fix is a single `zone` tag per
building and a small penalty table, not a router.

---

## 10. Corrections to the blueprint

| What the README or plan says | What the data says |
|---|---|
| `usable = gapEnd - now - walkTime` | Overstates when the gap has not started yet. Use `usable = (gapEnd - PACKUP) - max(now + walk, gapStart)`. See section 5. |
| "back-to-back classes with a 5 minute passing period" (assignment framing) | OSU's passing period is **15 minutes** (69.3% of all gaps). The minimum gap anywhere in the sample is 10 minutes. Zero-gap back-to-back **never occurs**. |
| "Walk speed around 80 m/min is a fine first estimate" | Fine, but incomplete without a detour factor. Straight-line understates. Recommend 78 m/min with a 1.30 fudge factor. |
| "rooms-`<term>`.json (~100 KB gzipped)" | Measured 54 KB gzipped at 1800 rooms, so the estimate is conservative. The packed binary is 37 KB. |
| "Haversine distance to the building centroid is plenty" | True, and equirectangular is plenty-er: 0.13 m max error over the whole campus, 10x cheaper. |
| Plan implies the river is a hard problem for straight-line distance | Five crossings inside the campus band make the median river detour 1.04x. 96% of crossings fall inside a flat 1.30 factor. Do not build a barrier model. |
| Overpass query as given in the plan | Returns **406** from Node's `fetch` without a `User-Agent` header. The plan does not mention this. |
| Ship one JSON file and parse it on the phone | Works, but costs 242-382 ms cold on a desktop, projecting to 1-3 s on a phone. A packed binary is ~33 ms. |

Nothing here is fatal to the project. The core insight, the data source, the static
architecture and the weekly cadence all hold up.

---

## 11. What surprised me

1. **The query was never the problem.** I expected to be proposing an index. Warm
   queries run in 0.4 to 1.3 ms over 1800 rooms with a naive linear scan, and
   tripling the data density does not move the number. The interesting cost is
   entirely in getting the data into memory.
2. **Building the typed index makes cold start worse.** 150 ms of construction to
   save 1.7 ms per query does not pay back until query 90, and a typical session is
   one query. The optimisation is a pessimisation for the case that matters.
3. **15 minutes, not 5.** I would have shipped a 5 minute buffer on intuition and it
   would have surfaced 1879 corridor-shuffle gaps as real study opportunities.
4. **Session date ranges do 94% of the overlap work.** Of 32 apparent overlaps, 30
   are the same room at the same time in different halves of the term, which is not
   a conflict at all. Filter by session first and the "overlapping intervals" problem
   mostly evaporates.
5. **The river is a non-issue.** I set out to design a barrier penalty and the data
   said not to bother.
6. **No weekend classes at all**, 0 of 4679 intervals. Saturday and Sunday are
   entirely free in the schedule, which means the app's answer on a weekend is
   "every room is free," which is exactly when it is most wrong about locked doors.
   That is a UI honesty problem, not an engine problem.

---

## What I could not measure

- **No phone was tested.** Every number is from an AMD Ryzen 7 5800H. The phone
  projections in section 7 apply a standard 4-8x multiplier and are estimates.
- **The sample is 12 of 243 subjects.** 378 rooms of an estimated 1200-1800. Real
  rooms host classes from many departments, so per-room interval counts are a floor,
  not the truth. I compensated with a 3x density stress test, which changed nothing.
- **`facilityType` codes were undocumented when I benchmarked.** My `1B` call was
  inference from it being 63% of rooms. [facility-types.md](facility-types.md) has
  since decoded them properly, so use that, not my distribution argument.
- **`holidaySchedule` was not decoded.** The engine will report rooms as busy on
  Thanksgiving.
- **Building access hours do not exist in this data.** `DAY_END = 22:00` is a guess
  that one measured class (ending 22:15) already contradicts.
- **Term 1268 only.** Behaviour across term boundaries, and what the index should do
  between terms, is untested.

---

## 13. Reference implementation

The engine below is the exact code the benchmarks ran. It passed all 12 edge cases
and cross-checked to 0 mismatches against the packed-binary reader.

```js
// vacant/js/engine.js
export const WALK_MPM  = 78;    // metres per minute
export const DETOUR    = 1.30;  // fudge factor, see docs/research/query-engine.md
export const PACKUP    = 10;    // be out this long before the next class
export const MAX_WALK  = 12;    // default radius, minutes
export const LOOKAHEAD = 240;   // ignore gaps further out than this
export const DAY_START = 420;   // 07:00
export const DAY_END   = 1320;  // 22:00, a guess, see the access-hours hole
const R_EARTH = 6371008.8, RAD = Math.PI / 180;

/** One Uint8Array per day, reused by every query that day. */
export function activeMask(sessions, todayISO) {
  const m = new Uint8Array(sessions.length);
  for (let i = 0; i < sessions.length; i++)
    m[i] = sessions[i][0] <= todayISO && todayISO <= sessions[i][1] ? 1 : 0;
  return m;
}

/** Weekday-bucketed CSR. Build this off the main thread, after the first answer. */
export function buildIndex(idx) {
  const bCodes = Object.keys(idx.buildings);
  const bIdx = new Map(bCodes.map((c, i) => [c, i]));
  const bLat = new Float64Array(bCodes.length), bLon = new Float64Array(bCodes.length);
  bCodes.forEach((c, i) => { bLat[i] = idx.buildings[c].lat; bLon[i] = idx.buildings[c].lon; });

  const ids = Object.keys(idx.rooms), nR = ids.length;
  const rB = new Int32Array(nR), rCap = new Int32Array(nR);
  const off = [], st = [], en = [], ss = [], per = [];
  for (let d = 0; d < 7; d++) { off.push(new Int32Array(nR + 1)); per.push([]); }

  ids.forEach((id, r) => {
    const room = idx.rooms[id];
    rB[r] = bIdx.get(room.b); rCap[r] = room.cap ?? 0;
    const byDay = [[], [], [], [], [], [], []];
    for (const iv of room.busy) byDay[iv[0]].push(iv);
    for (let d = 0; d < 7; d++) {
      byDay[d].sort((a, z) => a[1] - z[1] || z[2] - a[2]);  // start asc, end desc
      for (const iv of byDay[d]) per[d].push(iv);
      off[d][r + 1] = per[d].length;
    }
  });
  for (let d = 0; d < 7; d++) {
    const m = per[d].length;
    const S = new Int16Array(m), E = new Int16Array(m), X = new Uint8Array(m);
    for (let k = 0; k < m; k++) { S[k] = per[d][k][1]; E[k] = per[d][k][2]; X[k] = per[d][k][3]; }
    st.push(S); en.push(E); ss.push(X);
  }
  return { ids, nR, rB, rCap, bLat, bLon, nB: bCodes.length, off, st, en, ss,
           walkBuf: new Int32Array(bCodes.length) };
}

/** Returns { hits, soon }. One sweep produces both. */
export function query(F, { now, weekday, lat, lon, need, active, maxWalk = MAX_WALK }) {
  const { rB, off, st, en, ss, bLat, bLon, nB, nR, rCap, walkBuf } = F;
  const OFF = off[weekday], S = st[weekday], E = en[weekday], X = ss[weekday];

  // equirectangular: 0.13 m max error over this campus, 10x cheaper than haversine
  const kx = Math.cos(lat * RAD) * RAD * R_EARTH, ky = RAD * R_EARTH;
  const f = DETOUR / WALK_MPM;
  for (let b = 0; b < nB; b++) {
    const dx = (bLon[b] - lon) * kx, dy = (bLat[b] - lat) * ky;
    walkBuf[b] = Math.ceil(Math.sqrt(dx * dx + dy * dy) * f);   // always round up
  }

  const hits = [], soon = [], horizon = now + LOOKAHEAD;
  for (let r = 0; r < nR; r++) {
    const walk = walkBuf[rB[r]];
    if (walk > maxWalk) continue;
    const arrival = now + walk;
    if (arrival > DAY_END) continue;

    let i = OFF[r], hi = OFF[r + 1], cursor = DAY_START, fit = null;
    while (i < hi) {
      if (!active[X[i]]) { i++; continue; }            // wrong half of the term
      let s = S[i], e = E[i], j = i + 1;
      while (j < hi) {                                  // merge dupes, overlaps, containment
        if (!active[X[j]]) { j++; continue; }
        if (S[j] > e) break;
        if (E[j] > e) e = E[j];
        j++;
      }
      if (s > cursor && s > arrival) {
        const su = arrival > cursor ? arrival : cursor;
        if ((s - PACKUP) - su >= need) { fit = [cursor, s]; break; }
      }
      if (cursor > horizon) break;
      if (e > cursor) cursor = e;
      i = j;
    }
    if (!fit && cursor < DAY_END && cursor <= horizon) {   // the open tail of the day
      const su = arrival > cursor ? arrival : cursor;
      if ((DAY_END - PACKUP) - su >= need) fit = [cursor, DAY_END];
    }
    if (!fit) continue;

    const su = arrival > fit[0] ? arrival : fit[0];
    const row = { r, id: F.ids[r], walk, usable: (fit[1] - PACKUP) - su,
                  gapStart: fit[0], gapEnd: fit[1], cap: rCap[r],
                  waitFor: fit[0] - arrival };
    (row.waitFor <= 0 ? hits : soon).push(row);
  }
  soon.sort((a, b) => a.waitFor - b.waitFor || a.walk - b.walk || b.usable - a.usable);
  return { hits: rank(hits, need).slice(0, 20), soon: soon.slice(0, 5) };
}

export const SURPLUS_WEIGHT = 0.1, SURPLUS_CAP = 60;
export function rank(list, need) {
  for (const c of list)
    c.score = c.walk - SURPLUS_WEIGHT * Math.min(c.usable - need, SURPLUS_CAP);
  list.sort((a, b) =>
    a.score - b.score ||
    b.usable - a.usable ||
    b.cap - a.cap ||
    a.id.localeCompare(b.id));      // deterministic, so the list does not reshuffle
  return list;
}
```

### Reproducing the measurements

Scripts live in the scratchpad at
`C:\Users\galax\AppData\Local\Temp\claude\C--Users-galax-Downloads-Projects\ff09d3ae-8ad6-40bb-942d-f7cf03ac4117\scratchpad\qe\`
and are throwaway. In order:

```
node harvest.mjs > sample.json    # 30 requests to content.osu.edu. Do not re-run casually.
node analyze.mjs                  # interval counts, dupes, overlaps, gap histogram
node dig.mjs                      # no-facilityId meetings, facilityType, overlap examples
node over.mjs > buildings-osm.json   # Overpass. Needs a User-Agent header.
node mkindex.mjs                  # synthesise rooms-1268.json at 1800 rooms
node pack.mjs                     # emit rooms-1268.bin
node edge.mjs                     # the 12 edge cases, both implementations
node bench.mjs                    # warm per-query timings
node cold.mjs                     # cold launch to first answer
node cold2.mjs typed | naive      # cold path comparison, fresh process
node coldbin.mjs                  # cold packed-binary path
node verify.mjs                   # cross-check + warm-by-standing-point
node ladder2.mjs                  # fallback ladder fire rate and cost
```

`sample.json` is 10.6 MB and is the only artifact worth keeping, since regenerating
it costs another 30 requests against a live university service.
