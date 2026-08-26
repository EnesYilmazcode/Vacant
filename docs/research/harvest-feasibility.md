# Harvest feasibility

Measured 2026-08-26 against the live `content.osu.edu/v2` API, term 1268 (Autumn
2026), campus `col`. Every number below has the command that produced it. I spent
**57 HTTP requests total** against Ohio State, sequentially, with a 250 ms pause
between them.

## The short version

The harvest is not just practical, it is cheap, and the blueprint is wrong about
its size in the expensive direction twice over.

**One sentence on the problem:** the README plans a 243-subject walk ported from
Finder, which costs roughly 1,100 requests per term.
**One sentence on the fix:** the same API paginates by `catalog-number` bucket,
and eight buckets cover every section in the term in **136 requests**, one pass,
with no reconciliation loop.

```
  Finder's subject walk (ported as-is)
  ├── searchableTermsV2                        1 req
  ├── Barrett subject list                     1 req
  ├── discoverSubjects (8 bucket sweeps)     145 req
  └── reconcileSubject x ~350 candidates     995 req
                                            =====
                                            ~1142 req   ~7 min sequential

  Vacant's bucket walk
  └── 8 catalog-number buckets, 1 pass        136 req    ~52 s sequential
```

Both cover the identical 26,298 sections. The bucket walk was verified lossless
against the subject walk on the one bucket where I have both (below).

Corrections to the README, with the measured replacement:

| README says | Measured | Off by |
|---|---|---|
| `rooms-<term>.json` is "~100 KB gzipped" | **27 to 33 KB gzipped**, 256 to 285 KB raw | 3x too high |
| "roughly 1,200 to 1,800 rooms" | **~625 rooms** (Chao1), 600 to 750 plausible | 2 to 3x too high |
| "about 100 to 150 buildings" | **~88 buildings** (Chao1), 78 already observed | mildly high |

---

## 1. How Finder's harvester actually works

`C:/Users/galax/Downloads/Projects/Finder/scripts/fetch-courses.mjs`, read end to end.

### Subject discovery: three sources unioned

The API has no subject endpoint and its own `subject` facet caps at ten entries,
so the list has to be manufactured. Finder unions three sources
(`fetch-courses.mjs:455-474`):

1. **Barrett fallback** (`barrettSubjects`, `fetch-courses.mjs:175-180`). One
   `fetchText` of `https://www.asc.ohio-state.edu/barrett.3/schedule/` and a
   regex over the anchor tags: `/<a href="([A-Z][A-Z0-9]*)">/g`. Costs one
   request, yields 337 codes. It is **incomplete**: the comment at
   `fetch-courses.mjs:183-187` records 18 live Autumn 2026 subjects it misses,
   CYBRSEC and ETHNSTD among them.
2. **The catalog-number facet sweep** (`discoverSubjects`,
   `fetch-courses.mjs:188-210`). Reads `filters[].slug === 'catalog-number'` off
   a bare page 1, then walks every page of every bucket and keeps
   `entry.course.subject` from each result. This is the expensive part and it is
   also the thing Vacant should reuse for a completely different purpose.
3. **The previous committed index** (`subjectsByTerm`,
   `fetch-courses.mjs:227-240`), keyed by `strm` so a subject one term dropped is
   not confused with one another term never had.

### Paging

`subjectPass` (`fetch-courses.mjs:290-306`) fetches `p=1`, reads `totalPages`,
clamps it to `MAX_PAGES = 50` (`fetch-courses.mjs:46`, the real ceiling given the
10,000-result cap at 200 per page), then walks pages 2..N sequentially with a
`DELAY_MS` sleep between each.

### Non-determinism

Two mechanisms, layered.

- **`SORT = 'catalogNumber'`** (`fetch-courses.mjs:53`, applied in `searchUrl` at
  `fetch-courses.mjs:151-154`). The default relevance order reshuffles ties
  between pulls, so a course drifts across a page boundary and the walk misses
  it. The comment records unsorted HISTORY returning 107 to 111 courses.
- **Repeated reconciliation passes** (`reconcileSubject`,
  `fetch-courses.mjs:311-366`). A stable order is treated as an observation, not
  a promise, so passes repeat until `STABLE_PASSES = 2` in a row add nothing new
  (`fetch-courses.mjs:59-60`), capped at `MAX_PASSES = 8`. Single-page subjects
  get `SINGLE_PAGE_STABLE_PASSES = 1` (`fetch-courses.mjs:65`) because
  single-page results never varied. A subject that comes back empty is retried
  `EMPTY_PASSES = 2` times (`fetch-courses.mjs:72`) because "not offered" and "the
  API dropped a pass" are the same HTTP 200 with `totalPages: 0`.

### Concurrency

`CONCURRENCY = 5` (`fetch-courses.mjs:32`), `DELAY_MS = 120`
(`fetch-courses.mjs:33`), driven by `mapLimit` (`fetch-courses.mjs:137-149`),
which runs five workers that each sleep 120 ms after finishing an item. Effective
ceiling is `5 / (latency + 0.120)` requests per second.

### Retry and backoff

`fetchWith` (`fetch-courses.mjs:92-132`), `RETRIES = 3`:

- 30 s `AbortSignal.timeout` per attempt (`fetch-courses.mjs:102`). **Too short
  for Vacant's brief, which asks for 60 to 90 s.**
- Backoff is `500 * 2 ** (attempt - 1)` ms, so 500 / 1000 / 2000
  (`fetch-courses.mjs:97`).
- `RETRY_STATUS = {408, 425, 429}` (`fetch-courses.mjs:37`). Every other 4xx is
  marked `err.fatal = true` and breaks the loop immediately
  (`fetch-courses.mjs:112-116, 128`), except a **403, which gets exactly one
  extra try** on the theory that it is a twitchy WAF
  (`fetch-courses.mjs:108-111`).
- `Retry-After` is honored, parsed as either a second count or an HTTP date, and
  clamped to `MAX_RETRY_AFTER_MS = 30000` (`fetch-courses.mjs:39, 84-90`).
- A custom `USER_AGENT` naming the project and a contact URL
  (`fetch-courses.mjs:40-41`). Copy this.

### Write gate

`writeRefusals` (`fetch-courses.mjs:265-285`) plus `guards.mjs`. Two floors
(`MIN_SUBJECTS = 100`, `MIN_COURSES = 1200`) and a `MAX_DROP = 0.1` comparison
against the last committed run (`guards.mjs:16`). A drop is *forceable* via
`FORCE_WRITE=1`; a shape change (units that will not `Number()`) is *fatal* and
is not. `writeAtomic` (`fetch-courses.mjs:426-431`) writes a `.tmp` and renames.
Vacant should copy `guards.mjs` verbatim and key it on room count and interval
count.

---

## 2. Timing, measured

Script: `harvest.mjs` in the scratchpad. Parameters identical to a real harvest:
`q=&campus=col&term=1268&sort=catalogNumber&subject=<lower>&p=<n>`, sequential,
250 ms pause, 90 s timeout, 3 retries with exponential backoff.

Ten subjects, fully paged:

```
subject   pages  totalItems  courses  sections  meetings  w/facility   rawBytes   secs
cse           6        1064      134      1064      1073         406    2393371    2.0
math          3         507      101       507       508         505    1311258    0.9
english       2         242       93       242       249         242     675888    0.5
psych         1         150       86       150       152         146     424789    0.1
history       4         687      113       687       687         102    1563388    1.2
physics       4         611       50       611       612         333    1513345    1.3
chem          4         768       61       768       926         613    2005127    1.3
econ          1         102       64       102       102          86     298093    0.1
spanish       2         206       59       206       210         135     559925    0.4
dance         2         231      103       231       237         113     572184    0.4
```

- **29 requests, 11.1 s wall**, sequential with a 250 ms pause. That is
  **383 ms per request** end to end.
- Latency over all 37 requests in that run: min 43 ms, p50 **128 ms**, p90 243 ms,
  max 1458 ms (the first request, cold TLS), mean 169 ms.
- `totalItems` on a subject-filtered query equals the section count exactly. It
  is **not** a course count. Verified on all ten rows above.
- Cross-validated against Finder's own recorded page counts: CSE 6, MATH 3,
  CHEM 4, HISTORY 4, PSYCH 1. Identical. The API has not shifted since Finder
  measured it.

### Extrapolation to 243 subjects

Method: request count first, then multiply by the measured 383 ms.

Finder's docs record that only 36 of 243 subjects need a second page and the
widest was 7 pages. My eight multi-page subjects averaged 3.4 pages. So one
clean single pass over all subjects is `207 x 1 + 36 x 3.4` = **~330 requests**
(call it 300 to 370), which is **126 s sequential** or **19 s at Finder's
concurrency of 5**.

Finder does not do one clean pass. Its real cost for term 1268:

| Stage | Requests | How |
|---|---|---|
| `searchableTerms` | 1 | |
| `barrettSubjects` | 1 | |
| `discoverSubjects` | 145 | 1 head + 8 bucket heads + 136 bucket pages (measured, section 5) |
| 207 single-page offered subjects | 414 | 2 passes each (pass 1 adds, pass 2 is clean) |
| 36 multi-page offered subjects | ~367 | 3 passes x 3.4 pages |
| ~107 candidates not offered | 214 | `EMPTY_PASSES = 2` |
| **Total** | **~1,142** | **~7.3 min sequential, ~66 s at concurrency 5** |

That is the number to beat, and it is why section 5 recommends not porting it.

---

## 3. Scale and real bytes

### What I built

I inverted the sample into exactly the schema in README section 4:
`{term, generated, sessions[], buildings{}, rooms{facilityId: {b, n, cap, type,
busy: [[weekday, startMin, endMin, sessionIdx]]}}}`, weekday 1 = Monday, minutes
since midnight, intervals deduped on `facilityId|weekday|start|end|session` and
sorted.

To get a campus-wide cross-section without a campus-wide harvest, I also pulled
the **entire `catalog-number=3xxx` bucket** (1,847 sections spanning **131
distinct subjects**, 10 pages). The union below is 10 subjects plus that bucket:
6,015 distinct sections, roughly 23% of the term.

### Measured index sizes, real gzip

```
                                  rooms  bldgs  intervals    raw B   gzip-9 B  brotli B
10 subjects                         363     47       3884    79913       9625      7453
10 subjects + full 3xxx bucket      562     78       5438   115923      15270     11837
```

Nested subsamples of the union, to get a size model rather than two points:

```
frac  sections  rooms  bldgs  intervals    raw B  gzip B   br B   gz/interval
0.10       602    231     54        606    25608    5044   3853      8.32
0.20      1203    344     61       1160    40769    7274   5653      6.27
0.30      1805    420     68       1782    54674    9265   7200      5.20
0.45      2707    478     71       2607    70110   11307   8759      4.34
0.60      3609    512     73       3363    83092   12685   9888      3.77
0.75      4511    534     74       4155    95737   13811  10726      3.32
0.90      5414    551     77       4928   107966   14785  11462      3.00
1.00      6015    562     78       5438   115925   15286  11837      2.81
```

Least squares over those eight points:

```
raw  = 71.5 * rooms + 13.89 * intervals   bytes
gzip = 18.5 * rooms +  0.92 * intervals   bytes
```

Gzip cost per interval is still falling at the largest sample I have (8.32 down
to 2.81 bytes), which is the whole reason a naive linear scale-up of the sample
overshoots.

### Campus totals

**Rooms.** Chao1 on the union (562 observed, 96 singletons, 73 doubletons) gives
**625**. The rarefaction curve is clearly saturating:

```
  5% of pool (n=171)  -> 136 rooms
 10% (n=341)          -> 227
 20% (n=682)          -> 341
 35% (n=1194)         -> 433
 50% (n=1706)         -> 482
 75% (n=2558)         -> 533
100% (n=3411)         -> 562
```

The last doubling of sample size added 29 rooms. Chao1 is a lower bound, so the
honest range is **600 to 750, call it 650**. The README's 1,200 to 1,800 comes
from scaling 272 rooms by 243/6 subjects, which ignores that departments share
buildings. It is wrong by 2 to 3x.

**Busy intervals.** Stratified by catalog-number bucket, using the real campus
bucket sizes and the per-stratum interval rate from my sample (3xxx is exact
because I pulled the whole bucket):

```
1xxx: 2623 sections x 1.747 = 4582   (sample n=1003)
2xxx: 2420 x 1.446          = 3499   (sample n=619)
3xxx: 1847 x 1.148          = 2120   (EXACT, whole bucket)
4xxx: 6321 x 0.296          = 1872   (sample n=1030)
5xxx: 2269 x 1.966          = 4461   (sample n=324)
6xxx: 2304 x 0.368          =  847   (sample n=419)
7xxx: 2979 x 0.249          =  742   (sample n=321)
8xxx: 5535 x 0.221          = 1225   (sample n=452)
                              -----
                              19347 before dedupe
       x 90.0% measured dedupe survival = 17,410 deduped intervals
```

**Buildings.** 78 observed, Chao1 **88**.

### The size answer

Two independent methods on 625 rooms and 17,410 intervals:

- Least squares model: **279.8 KiB raw, 27.0 KiB gzipped**.
- A synthetic index at 625 rooms and 15,376 intervals, built by cloning real room
  records and drawing intervals from the real observed distribution, then
  actually gzipped: **255.4 KiB raw, 32.9 KiB gzip, 26.3 KiB brotli**. The
  synthetic control at the real union's shape produced 3.45 gz-bytes per interval
  against the real 2.81, so synthetic inflates gzip by about 23%; corrected, it
  lands on 27 KiB and agrees with the model.

> **`rooms-1268.json` will be roughly 270 KB raw, 27 to 33 KB gzipped, 22 to 27 KB
> brotli.** The README's "~100 KB gzipped" is about 3x too pessimistic. There is
> plenty of headroom to add fields (a `name` per room, an access-hours block, a
> confidence score from phase 4) without threatening the offline story.

---

## 4. Determinism

**Subject axis, `sort=catalogNumber`, three back-to-back full pulls of `math`
(3 pages, 507 sections):**

```
pull 1: sections=507 meetings=508
pull 2: sections=507 meetings=508
pull 3: sections=507 meetings=508
meeting-key intersection=508  union=508  identical=true
keys not in all 3: 0
```

The meeting key was `classNumber|meetingNumber|facilityId|startTime|endTime|
standingMeetingPattern|startDate`, so this compares the exact rows the room index
is built from, not just section IDs. **Zero drift.**

**Bucket axis, `catalog-number=3xxx` (10 pages, 1,847 sections):** the walk
returned exactly the 1,847 sections `totalItems` promised. Re-pulling pages 1, 5
and 10 and comparing the per-page `classNumber` sets against the first walk:

```
page  1: pull1=200 pull2=200 identical=true
page  5: pull1=200 pull2=200 identical=true
page 10: pull1= 47 pull2= 47 identical=true
```

Page pinning holds on the bucket axis too, which was the open worry: inside a
`catalog-number` bucket, sorting by `catalogNumber` produces enormous tie groups
(every 3000-level course across 131 subjects), and ties are exactly what breaks
relevance ordering. It did not break here.

**Cross-axis completeness, the test that matters most for Vacant.** Of the 400
3xxx sections my subject walk found across ten subjects, **400 of 400 were also
present in the bucket walk. Zero missing.** Two different query axes, run at
different times, returning the identical section set is much stronger evidence
than repeating one query.

Caveat to keep: Finder's docs record 2 sections out of 674 still moving across
eight sorted pulls of `q=Smith`. Sorting makes paging ~98% better, not perfect.
Since a dropped section makes a room falsely read *empty*, Vacant should keep
Finder's union-of-passes idea but apply it cheaply: run the bucket walk **twice**
and union the results (272 requests, still a quarter of the subject walk), and
refuse to write if pass 2 adds more than a handful of intervals.

---

## 5. Recommended harvest shape

### Do not iterate subjects. Iterate `catalog-number` buckets.

Measured, one head request per bucket:

```
bucket   totalItems  totalPages
1xxx           2623          14
2xxx           2420          13
3xxx           1847          10
4xxx           6321          32
5xxx           2269          12
6xxx           2304          12
7xxx           2979          15
8xxx           5535          28
                =====        ===
                26298        136
```

`ceil(totalItems / 200)` equals `totalPages` for all eight, so page 1 of each
bucket *is* the head request. **136 requests covers the whole term.**

Completeness argument, all of it measured:

- The eight buckets partition catalog numbers with no leftovers. Leading digit
  across all 4,568 sections in my subject sample:
  `{1:1003, 2:619, 3:400, 4:1030, 5:324, 6:419, 7:321, 8:452}`. No zero, no nine,
  no letter-leading catalog number. Nothing falls outside a bucket.
- No bucket approaches the 10,000-result cap. The largest is 6,321.
- The bucket walk was lossless against the subject walk on 3xxx (400/400).
- The subject axis needs subject *discovery* first, which Finder implements as a
  full sweep of these same eight buckets. **You are already paying for the bucket
  walk inside the subject walk.** Taking the bucket walk's own results and
  stopping there removes ~1,000 requests and the entire subject-discovery
  problem, Barrett scrape included.

### There is no building or facility axis

I dumped the full `filters` array from a live response. Every facet the API
exposes:

```
campus  term  class-session  academic-career  gen-categories  subject
academic-program  instruction-mode  class-attribute  class-attribute-value
component  catalog-number  evening
```

No `building`, no `facility`, no `room`. Sort options are only `""` (relevance),
`subject`, `-subject`, `catalogNumber`, `-catalogNumber`. Paging by building is
not available, so inverting the schedule really is the only path.

`instruction-mode` and `component` were tempting as a way to skip roomless
sections, but they do not work: Independent Study is 2,091 sections in my union
with **4** real rooms, yet those sections are still `instructionMode: "In
Person"`. Filtering on either facet risks dropping a real booking, and a dropped
booking is a room that falsely reads empty. Not worth saving 40 requests.

### Suggested pipeline

```
1  GET searchableTermsV2                                       1 req
2  for each of 8 catalog-number buckets: walk every page     136 req
3  repeat step 2 once and union                              136 req   (drift guard)
4  project meetings -> rooms-<term>.json
5  guards.mjs refusal on rooms, buildings, intervals vs the committed file
6  writeAtomic
                                                            =======
                                                             273 req   ~1.7 min sequential
```

Weekly, per the README's cadence. Keep Finder's `USER_AGENT`, its `Retry-After`
handling and its 403-retry, but raise the 30 s timeout to 90 s.

---

## 6. Things that surprised me, and will bite the implementer

**`facilityId` is not always a room.** `"ONLINE"` appears 465 times in my union,
with `buildingCode: "ONLINE"` and `facilityCapacity: 998`. 360 of those have
`startTime: null`, but **105 carry a real clock time**, so filtering on a null
time alone does not catch it. There is also an `"OFFCAMPUS"` pseudo-facility.
Filter explicitly. The full list of facility IDs that do not match
`^[A-Z]{2,4}\d{3,5}$` in my union was: `ONLINE`, `OFFCAMPUS`, `FL2125/35` (a
combined room), and a long tail of legitimate sub-room suffixes like `SM1077A`,
`SM1077B`, `SM1077C` (Smith Lab breaks one room into three). Those suffixed ones
are real and must be kept.

**415 meetings have a `facilityId` and `startTime: null`.** Every one of those
was `ONLINE`. Only **2** room-bearing meetings in the whole union had a valid
time but no day flag set, and **0** rooms exist only because of an unusable
meeting, so the drop is safe.

**Sections outside Columbus come back under `campus=col`.** `location` values in
my union: `CS-COLMBUS` 5996, `CS-MARION` 12, `CS-OFFCAMP` 4, `CS-INTRNTL` 3.
Filter on `location === 'CS-COLMBUS'` or Vacant will eventually offer somebody a
room in Marion. In this sample it only cost the `OFFCAMPUS` pseudo-room, but the
failure mode is a wrong answer, not a missing one.

**Busy intervals overlap and the complement math must merge them.** 607
overlapping interval pairs in the same room, day and session. 559 of them share a
`combinedSection` id (cross-listed courses, expected). The remaining 48 are
genuine duplicate bookings, mostly identical rows for the same course. Merge
overlapping intervals before computing the free-gap complement; do not assume the
`busy` array is disjoint.

**The `sessions` table really is tiny.** Only **3** distinct meeting date ranges
across 6,015 sections: `2026-08-25..2026-12-09` (3,964 intervals),
`2026-10-19..2026-12-09` (133), `2026-08-25..2026-10-12` (74). `sessionCode` is
`1` / `7W1` / `7W2`. The README's dedupe-by-date-range design is correct and
costs almost nothing.

**Room attributes are clean.** Across 562 rooms: 0 disagree on
`facilityCapacity`, 0 disagree on `facilityType`, 0 map to more than one
`buildingCode`, and 0 `buildingCode` values carry more than one
`facilityDescription`. You can key buildings on `buildingCode` with no
reconciliation. **17 of 562 rooms have a missing or zero capacity**, so the UI
needs a fallback for the seat count.

**`facilityType` histogram, by distinct rooms** (the README flags this as a known
unknown, so here is the actual distribution):

```
1B  328    2A   75    1C   60    2M   22    2K   13    1A   12
2P   12    5K   10    PERF  8    2Q    4    2D    4    6C    3
LCTR  2    6F    2    5G    2    5J    1    5C    1    3A    1
5L    1    6L    1
```

`1B` is 58% of all rooms and is almost certainly the general-purpose classroom
code. `1A`, `1C` and `LCTR` look like the other teaching-room families. Starting
Vacant with `1B` + `1C` + `1A` + `LCTR` covers 402 of 562 rooms and avoids
sending anyone into a wet lab, which is the cautious default until someone
confirms the code meanings.

**Nobody teaches on weekends.** Intervals per weekday, Monday to Sunday:
`[1049, 1315, 1327, 1314, 1036, 1, 1]`. On Saturday and Sunday the complement is
"everything is free", which is exactly when the "the door may still be locked"
disclaimer is carrying the entire product. Consider suppressing or heavily
caveating weekend results in v1.

**Class day bounds:** earliest start 345 minutes (5:45 am), latest end 1350
(10:30 pm). Interval durations: min 25 min, p50 80, p90 165, max 510.

**The API reports 26,298 sections for term 1268. Barrett reports 17,711.** The
8,587 difference is concentrated in the 4xxx and 8xxx buckets (11,856 sections
between them, mostly Independent Study with no room). If anyone tries to
cross-check Vacant's harvest against Finder's `seats-1268.json` section count,
these two numbers are measuring different populations and the gap is not a bug.

**Component vs room-bearing sections**, union of 6,015:

```
Lecture            2130   1635  77%
Independent Study  2091      4   0%
Laboratory          829    766  92%
Recitation          671    661  99%
Seminar             114     90  79%
Field Experience    108      6   6%
Workshop             58     52  90%
Clinical             14      4  29%
```

---

## 7. Reproducing this

Scratchpad (ephemeral, session
`ff09d3ae-8ad6-40bb-942d-f7cf03ac4117`): `probe.mjs` (facet dump), `harvest.mjs`
(bucket heads + 10-subject sample), `determinism.mjs`, `build-index.mjs`,
`analyze.mjs`, `final.mjs`, `size.mjs`.

The only request shape any of them uses:

```
GET https://content.osu.edu/v2/classes/search
    ?q=&campus=col&term=1268&sort=catalogNumber&p=<n>
    [&subject=<lowercase>]  or  [&catalog-number=<1xxx..8xxx>]
Headers: user-agent: Vacant-research/0.1 (+https://github.com/EnesYilmazcode/Vacant) ...
         accept: application/json
Timeout: 90 s, 3 retries, backoff 1s/2s/4s, 250 ms pause between requests
```

Request budget spent: `probe.mjs` 1, `harvest.mjs` 37, `determinism.mjs` 19.
Total **57**.

Room-index projection, the exact predicate that decides whether a meeting becomes
a busy interval:

```js
const isRealRoom = (m) =>
  !!m.facilityId &&
  m.facilityId !== 'ONLINE' &&
  m.facilityId !== 'OFFCAMPUS' &&
  !!m.buildingCode &&
  toMin(m.startTime) !== null &&
  toMin(m.endTime) !== null &&
  DAYS.some((d) => m[d]);
// plus, at section level: section.location === 'CS-COLMBUS'
```

## 8. Open questions

- I never measured a second `catalog-number` bucket end to end, so the
  cross-axis completeness proof rests on 3xxx alone (400/400). Confirm on 1xxx
  before trusting the bucket walk in production.
- The 625-room Chao1 estimate assumes my sample is representative of building
  usage. It is subject-clustered, which biases *against* finding buildings only
  used by departments I did not pull. The full 3xxx bucket (131 subjects)
  mitigates this but does not remove it. Expect the real number nearer 700 than
  600.
- `facilityType` code meanings are still undocumented. The histogram above is a
  starting point, not an answer.
- Whether `catalog-number` buckets stay at eight across terms. Summer 2026 is
  much smaller; check the facet rather than hardcoding `1xxx..8xxx`. Finder
  already reads it dynamically at `fetch-courses.mjs:190-192` and throws if the
  facet is missing. Copy that.
