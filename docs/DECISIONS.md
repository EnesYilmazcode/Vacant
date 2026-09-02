# Decisions

Append-only. New entries go at the bottom under a dated `##` heading, so two
people working in parallel never conflict on the same lines. Never edit or
delete an older entry; if a decision is reversed, write a new entry that says so
and link back.

Each entry records what was decided, what it was decided against, and what
measurement settled it. A decision with no measurement behind it should say that
out loud.

---

## 2026-08-26  Repo spine: layout, HTTP client, test runner

**Decided.** One shared HTTP client at `scripts/lib/fetch.mjs`, ported from
`EnesYilmazcode/Finder scripts/fetch-courses.mjs:84-149` and retuned. Every
script that touches the network imports it. Nothing else calls `fetch` directly.

Finder runs `CONCURRENCY 5` at `DELAY_MS 120` against a box that answers in
128 ms p50, which sustains about 15.6 req/s. That is the request shape that
looks like an attack in a log. Vacant sends at most about 1,100 requests a week
(see the 2026-08-26 harvest entry below; this line originally said 280, which
was the two-pass estimate before the drift was measured), so it runs at
`CONCURRENCY 2` / `DELAY_MS 500`, about 2.9 req/s, and the timeout goes from
Finder's 30 s to 60 s.

`MAX_REQUESTS` is a module-level cap that throws rather than fetches. It was
3000 on a two-pass estimate of 272 requests; the walk-until-stable harvester's
worst case is 8 buckets x 50 pages x 8 passes = **3,200**, so the old cap sat
UNDER its own worst case and would have fired mid-run. It is now 4000. A runaway
loop against a university API is the failure that gets the whole project
blocked, and it is worth a hard stop that cannot be tripped by normal operation.

Tests are `node --test` with a stub `fetchImpl` injected per call. `npm test`
makes zero network requests, which is checked by every test passing with the
machine offline.

**Decided against.** Writing a fresh client. Finder's retry ladder already
encodes two measured facts about this specific host: the API sits behind a
Citrix NetScaler WAF so a burst returns 403 rather than 429, which is why 403
gets exactly one bonus retry; and the API sends no rate-limit, `ETag`,
`Last-Modified` or `Cache-Control` header, so there is no conditional GET and
fewer, slower requests is the only lever available.

---

## 2026-08-26  Terms 1262 and 1264 snapshotted, and why there is no second chance

**Decided.** `data/raw/1262/` and `data/raw/1264/` are committed on `main`,
gzipped, one file per search page, written by `scripts/snapshot-term.mjs`.

**A term absent from `searchableTermsV2` cannot be re-fetched at any price.**
It is deleted from the search index, not hidden. Measured the same day:

```
term 1258  Autumn 2025   totalItems 0        already gone
term 1262  Spring 2026   totalItems 25274    leaves 2026-08-31
term 1264  Summer 2026   totalItems 15178    leaves 2027-01-01
term 1268  Autumn 2026   totalItems 26298    leaves 2027-01-31
```

The committed snapshot is therefore the only copy of those two terms that will
ever exist anywhere. Two things follow and both are load-bearing:

1. `data/raw/` is never regenerable. Deleting it is not a cleanup, it is a
   permanent loss. It must not be pruned to save repository size.
2. `FORCE_WRITE=1` over a collapsed harvest is unrecoverable for the same
   reason. Forcing a write when a term comes back short overwrites the only copy
   with a truncated one, and the refusal guard is the backup. Any workflow input
   that offers `FORCE_WRITE` has to say this in its description.

**The first run, verbatim.** Every bucket matched its facet count exactly.

```
term 1262   131 requests   130 pages   25274 / 25274 sections   3.2 MB
term 1264    81 requests    80 pages   15178 / 15178 sections   1.5 MB
```

### Three corrections to the issue as filed

**The instructor PII is on `meeting.instructors`, not `section.instructors`.**
[#2](https://github.com/EnesYilmazcode/Vacant/issues/2) called the strip "one
line" against `section.instructors`. That path is empty on every page measured,
so that line removes nothing. The records hang off each meeting, and one page of
one bucket carried 164 distinct real `@osu.edu` addresses. Following the issue
literally would have committed **44,865 instructor records** across the two
terms to a public repository. The script strips both paths and then runs a fatal
`@osu.edu` scan over the serialised page before writing, so a path the API adds
later stops the run instead of leaking. Verified after the fact by decompressing
all 210 committed pages: zero addresses, zero surviving `instructors` keys.

**The unfiltered head request reports `totalItems: 10000`, which is the paging
cap, not a total.** So the head cannot be used to check how much was captured.
The `catalog-number` facet's per-bucket `count` is the ground truth and sums to
the real figure: 25,274 for 1262 against a head that says 10000. The head's
`totalItems` is still the right expiry check, because an expired term returns 0.

**A bucket at or past 10000 is fatal, not a warning.** Nothing observed comes
close (the largest is 4xxx at 6,272), but a bucket that hit the cap would be
silently truncated, and silently missing sections in an archive that can never
be refetched is worse than no archive.

### Smaller choices

- Filenames are `<bucket>-p<NN>.json.gz`, zero padded so `p02` sorts before
  `p10`, gzipped at level 9. The whole archive is 4.7 MB, under the 7 MB
  estimate, because stripping instructors took the bulk out.
- A page already on disk is not refetched, so an interrupted run resumes. This
  matters when the window to capture a term is measured in days.
- No reconciliation loop. Sorted paging is about 98% deterministic, so a
  snapshot can miss a section or two. Printing reported `totalItems` against
  sections written says how close it got, which is the honest answer. Both terms
  came back exact on the first pass.
- Each term directory carries a `manifest.json` with per-bucket expected against
  written, the request count, and how many instructor records were removed.

**Still open.** `data/raw/` sits inside the published Pages site. It contains no
PII, but it is 4.7 MB of files no visitor needs. Either exclude it from the
publish or say so in `docs/DATA.md`, and record the answer here.

---

## 2026-08-26  buildings.json, and why the distance cap moved from 10 km to 20

**Decided.** `data/buildings.json` is built by one request to OSU's own ArcGIS
server, `Data/FacilitiesStreets_RO/MapServer/11`. 612 buildings, 159 KB. The
join is exact string equality between the class API's `meetings[].buildingCode`
and the GIS layer's `buildingNumber`. No normalising, no padding, no fuzzy name
match.

Verified against every meeting in the two committed term snapshots rather than
against a sample: **97 distinct building codes host classes, and all 91 that sit
in the Columbus area resolve.** The 6 that do not are the five Wooster buildings
and Stone Laboratory, which the cap removes on purpose.

Every number in the research's Part II reproduces exactly against a live pull:
1347 features, 1334 with a building number, 1331 distinct, `246` duplicated
twice and `1243` three times with identical attributes, 14 features with no
coordinate of which only `1072` has a building number.

**The cap moved to 20 km, and the reasoning in the research is wrong.**

The research recommends 10 km on the grounds that it "drops exactly the three
Wooster buildings and nothing else" and is therefore "a stable choice rather
than a tuned one". That holds only for the 88 buildings its sample saw hosting
classes. Across the full layer there is no gap at 10 km at all:

```
   9.94 km  1019  Knowlton Executive Terminal      <- furthest SCHEDULED building
   9.95 km   236  Hangar 1-3
   9.99 km  1049  Aerospace Research Center Storage 3
  10.01 km  1047  Aerospace Research Center Storage 1   <- cap fell here
  10.03 km   199  Aerospace Research Center
  10.17 km   982  Sheep Barn Annex
```

A 10 km cap splits two storage buildings in the same complex, and it clears the
furthest building that actually hosts classes by **60 metres**. One class
scheduled at the airport or on the agricultural campus and a real building
disappears from the app with no error anywhere.

Among buildings that host classes the gap is real, and it is enormous:

```
   furthest scheduled Columbus-area building     9.94 km   Knowlton Exec Terminal
   nearest scheduled satellite building        126.40 km   Wooster Science Building
```

20 km sits inside that 116 km gap with about 10 km of headroom on both sides.
It is still a chosen bound rather than a natural one, and the file says so.

**Section `campus` does not tell you where a room is.** Wooster Science
Building, Selby Hall, Gourley Hall and Stone Laboratory all carry sections whose
`campus` is `Columbus`, while the buildings sit 126 km and 185 km away. A
`campus=col` harvest pulls them in. The coordinate join is the only thing that
catches this, which makes the cap load-bearing rather than cosmetic, and it is
direct evidence for the funnel in
[#7](https://github.com/EnesYilmazcode/Vacant/issues/7).

**`Latitude` and `Longitude` arrive as strings.** `"39.995985"`, not
`39.995985`. Undocumented in the research. A naive arithmetic read yields `NaN`,
every distance becomes `NaN`, every comparison is false and the output is an
empty or silently wrong map rather than an error. Parsed through a checked
`Number()` and rejected if not finite.

**Duplicate keys are deduped explicitly, not incidentally.** Both duplicate sets
carry identical coordinates, so `index[code] = row` in a loop is harmless, and
that is precisely why it is dangerous: it works silently until a
`features.length === index.size` guard fails for a reason nobody can reproduce.
The build also fails loudly if two rows sharing a code ever disagree about
position.

**Not used as filters.** `Campus` and `InstType` are administrative, not
geographic. `InstType = "Academic"` includes Refuse Vehicle Storage. Nothing in
the GIS layer identifies a classroom, and the only filter that works is the
harvest itself, which lands in
[#9](https://github.com/EnesYilmazcode/Vacant/issues/9).

---

## 2026-08-26  Code review of the spine, and eight defects it caught

A `/code-review` pass over the spine found twelve issues. Four were already
fixed while building
[#3](https://github.com/EnesYilmazcode/Vacant/issues/3) (a red test fixture, the
10 km justification, a stale building count, the unresolved satellite codes).
Eight were real and live. All eight are fixed, each behind a regression test.

**The three that mattered, all in `snapshot-term.mjs`, all on the archive that
cannot be rebuilt.**

*A rerun rewrote the manifest with zeros.* Every page hit the `existsSync` skip,
so `written` was 0 for every bucket, and the manifest of an unrepeatable archive
was overwritten with `sectionsWritten: 0`. The provenance record was destroyed
by the act of checking it.

*A resumed run reported SHORT and exited 1 on a complete archive.* `written`
counted only newly fetched sections but was compared against the bucket's full
facet count. Interrupt during `4xxx` and the resume reports 618 against 6272 and
dies.

*A cached bucket could mask a failed one.* `skipped` was a run-wide counter, so
once any bucket was cached, a later bucket that came back empty was labelled
`cached` rather than `SHORT`, and the run exited 0 with an entire bucket
missing. That is precisely the failure the check exists to catch.

All three have the same root cause and the same fix: count what is **on disk**
by reading the cached pages back, per bucket, instead of counting only what this
run happened to fetch. Verified by stashing three pages of `4xxx` and rerunning:
3 pages refetched, 4 requests, every bucket `ok`, exit 0, 25,274 sections intact.

**Writes are now atomic.** `writeFile` straight to the destination plus an
`existsSync` resume key means a crash or a full disk leaves a truncated
`.json.gz` that the next run skips forever and never refetches. Temp file then
rename. This is the same failure that destroyed a 170 KB report on this machine
once already.

**A cached rerun no longer refetches page 1 of every bucket.** It cost 9
requests to do nothing. Now 1.

**In `fetch.mjs`:** the 403 bonus retry was scoped inside `fetchWith`, so it
reset on every call, and its own comment says a repeat across a run is a block
rather than a twitchy WAF. Under a real NetScaler block a 272 request harvest
would have issued 544 against a server already refusing it. The flag is now per
run. Separately, `err.fatal` was set and then thrown away when the loop rewrapped
into a plain `Error`, so no caller could tell "stop the run" from "skip this
item"; it now survives. And `mapLimit` let the surviving runners keep firing
after one failed, burning requests with no way to stop them.

**In `fetch-buildings.mjs`:** the dedupe ran before the distance cap, so the
first of two rows sharing a code was dropped before it was stored, the second
found nothing to compare against, a genuine position conflict outside the cap
went undetected, and `beyondCap` counted one building twice. The cap now runs
first. `name` used `??`, which keeps an empty string, so a blank `BLDG_NAME`
would ship as `""` rather than falling back to `FormalName`. And `generated` was
a UTC date, stamping the file a day ahead of the local one.

**The lesson worth keeping.** Every one of the three serious bugs was in the
resume and rerun path, which the happy-path first run never touches. The script
header claimed "re-running is safe and cheap" and it was neither. On a dataset
that cannot be refetched, the second run deserves more scrutiny than the first.

---

## 2026-08-26  Building hours, and the parser trap that would have shipped wrong hours for 19% of the pool

**Decided.** `data/buildings-hours.json`, scraped from the Registrar's classroom
pool building schedule. Both published terms, 47 buildings for Autumn 2026 and
46 for Summer 2026, 39 KB, 3 requests.

Measured from the shipped file, Autumn 2026, against the flat 7am-10pm
assumption every other app in this category makes:

```
day   buildings open   real open-minutes   flat 7am-10pm   overstated by
Mon        47/47              37050            42300             14%
Fri        47/47              33450            42300             26%
Sun        11/47               5820            42300            627%
Sat         5/47               3600            42300           1075%

Mon-Fri  overstated by 16%      Sat-Sun  overstated by 798%
```

That is the entire premise of the project, now backed by shipped data rather
than a claim in the README.

**The trap the research would have walked into.** It recommends parsing with a
regex for each day name run across the whole panel body. **A panel can hold more
than one full week**, and 9 of the 47 Autumn 2026 buildings do: Ag. Admin.,
Arps, Biological Sciences, Caldwell, Derby, Journalism, Knowlton, Orton and
Sullivant all publish a second week for a library or a lab. A last-match-wins
regex ships Ag. Admin.'s **library** hours, 8am-6pm, as the building's, when the
building is open 7am-8pm.

Orton Hall is worse than wrong hours. It publishes three blocks and its Lab
block runs Monday to Friday only, so a last-wins parse splices lab weekdays onto
the building's own weekend and produces a week that appears nowhere on the page.

The fix is to take the **first** list after the DAY HOURS heading. Sullivant
puts a note paragraph between the two, which is why paragraphs are skipped.
46 of 47 panels have all seven days in that first list; Sullivant is the
exception and the paragraph skip covers it.

**The 47-row hand-maintained join table is not needed.** The issue asks for one,
with five rows (AE, AS, BK, KH, TFM) hand-checked before shipping. The GIS
layer already carries `SchedulingAbbreviation`, and **all 47 registrar
abbreviations resolve through it with zero ambiguous and zero missing**.
Verified against real meeting objects: AE resolves to 298 with rooms AE0100,
AS to 156 with AS0210, KH to 340 with KH0333C, TFM to **1025** with TFM0290,
confirming that nothing may assume three digits. Only BK (Bricker Hall, 001)
has no scheduled rooms in either archive and so cannot be confirmed that way.
A derived join cannot go stale; a committed table can.

**The four malformed Caldwell cells, and why the override is evidence and not a
guess.** Autumn publishes Caldwell Mon-Thu as `7am-10`, with no am/pm. The
research says Summer shows Caldwell as 7am-5pm and infers 10pm. Summer is
**also malformed**: it publishes `7am-5` for the same four days. What resolves
it is the Friday cell in each panel, which is well formed and uses the pm
suffix: Summer's Friday is `7am-5pm` against its `7am-5`, proving the missing
token is the suffix rather than a different hour. Autumn's Friday is `7am-9pm`
and its Sunday `12pm-10pm`, so a 10pm close is the building's own evening
pattern. Both are recorded in `data/registrar-hours-overrides.json` with that
reasoning, and the emitted record's `hoursSource` becomes `override`.

An unparseable cell with no override **stops the build** and names the building
and the raw text. A parser that quietly picks a meaning is how an app starts
lying.

**Classes that run past the published close are warned about, never used to
rewrite the hours.** 17 overruns in Summer 2026, 4 of them Hopkins Hall, which
is on a documented allowlist because its own Registrar comment explains that art
students have swipe card access outside building hours. A late class proves
badge access, not an open door. Hitchcock closes 5pm and runs classes to 7:15pm.

**565 of 612 buildings have no published hours at all** and are listed
explicitly in `unknownHours`. That is the majority path and it must be shown as
"hours not published", never as assumed or "usually open".

---

## 2026-08-26  Known honesty gap: 9 timed bookings we cannot place

Nine meetings across the two archives carry a real room and real start and end
times but **no weekday flag, a null `standingMeetingPattern`, and no
`meetingDays`**. Dreese Lab 280 has four distinct Summer 2026 lab slots this way
(9:10-10:05, 10:20-11:15, 11:30-12:25, 12:40-1:35) and Derby 368 a Spring
seminar at 12:15-3:00.

The day is not recoverable from anything in the payload, so the funnel drops
them. **Dreese 280 will therefore read free during those lab hours.** That is a
real wrong answer, it is small, and it is written down here rather than hidden
in a counter. If the day ever becomes derivable, this is the first thing to fix.

---

## 2026-08-26  The harvest walks until stable, because two passes are not enough

**Decided.** `scripts/fetch-rooms.mjs` repeats the bucket walk until two
consecutive passes add no new meeting **in a real room**.

**The research's drift budget is wrong by about seven times.** It says sorted
paging is "about 98% deterministic" and specifies a fixed two-pass union with a
0.5% gate. Measured over the whole of term 1268:

```
pass 1 read 26,298 section rows but only 25,270 DISTINCT classNumbers.
1,028 rows were the same section served twice on different pages while
others were dropped. pass 2 then found 937 sections pass 1 never saw at
all, 3.6%, and pass 1 in turn caught 612 that pass 2 missed.
```

Neither pass is a superset of the other, so a fixed two-pass union is still
incomplete. Walking until stable took **7 passes and 953 requests**:

```
pass   meetings seen   new   new IN A ROOM   union
  1          26707   26707           11443   26707
  2          26530     294               7   27001
  3          26089      35               4   27036
  4          26413      27               0   27063
  5          26338      11               0   27074
  6          26408       0               0   27074
  7          26302       0               0   27074
```

A single pass would have missed 367 meetings, 1.36%, **11 of them in a real
room**. Eleven rooms that would have read free with a class in them.

**Convergence is on rooms, not on meetings, and "a room" is not
`facilityId != null`.** ONLINE and OFFCAMPUS carry a facilityId of their own, so
a null check calls them rooms. On term 1268 they are **2,975 of the 11,454 rows
that pass that check, 26%**, and the genuine figure is 8,479. Counting them let
one drifted ONLINE row reset stability and buy two more passes, 272 requests,
for a meeting `build-index.mjs` discards before it reaches the grid. The
criterion now uses the funnel's own `hasRealRoom`.

Re-measured with the corrected test, the walk converges in **4 passes and 545
requests** rather than 7 and 953:

```
pass   meetings seen   new   new IN A ROOM   union
  1          26465   26465            8466   26465
  2          26248     471              13   26936
  3          26158      61               0   26997   [1 of 2 clean]
  4          26220      77               0   27074   [2 of 2 clean]
```

The union is identical at 27,074, so nothing was lost by stopping earlier. A
single pass would have missed 609 meetings, 2.25%, **13 of them in a real
room**: thirteen rooms that would have read free with a class in them. A
`MIN_PASSES` floor of 3 stops a lucky first pass from claiming stability, since
pass 2 is where those 13 appear.

**The User-Agent has to advertise the CEILING, not the typical run.** It said
`~280 requests/week`, the two-pass estimate. Corrected to `~700` on the measured
7-pass cost, which was still wrong: `MAX_PASSES` allows 8 passes over 8 buckets
of 17 pages, which is 1,089. It now says `<=1100`, and the test asserts against
`MAX_PASSES x buckets` rather than a hand-entered number. The previous test
asserted `>= 680` and would have passed on exactly the 953-request run it was
written to catch. That string is a promise to the people running the server.

**`MAX_REQUESTS` sat under its own worst case.** 8 buckets x `MAX_PAGES` 50 x
`MAX_PASSES` 8 is 3,200 against a cap of 3,000, so the guard meant to prevent a
runaway would instead have fired mid-run and discarded a fifteen minute walk.
Raised to 4,000.

**A transient `totalItems: 0` no longer kills the run.** Nothing is written
until the end, so one blip in a late pass discarded every request and restarted
from zero. Since the entire premise of this script is that the API is
nondeterministic under paging, treating a single zero as fatal was the brittle
reading of its own evidence. It asks twice.

**Output.** `data/harvest-<term>.json.gz`, the union, 0.50 MB gzipped for 27,074
meetings. Writing any single pass's pages would reintroduce exactly the gaps the
extra passes exist to close. It is **not committed**: unlike `data/raw/1262` and
`data/raw/1264`, a live term can always be refetched, and 0.5 MB rewritten
weekly is repository bloat. The manifest beside it is committed for provenance.

That claim was false when first written. The blob had already been committed to
`main` through a careless `git add -A`, and `.gitignore` never applies to a
tracked path, so both the rule and this entry asserted something untrue. Removed
with `git rm --cached`. `*.tmp` is ignored too, since `writeAtomic` leaves one
behind on a crash and the harvest pattern did not match it.

**Coverage, measured on the full term rather than a sample.** 871 distinct rooms
across 96 buildings for Autumn 2026. **72% of those rooms sit in a building with
published hours**, not the 88.8% the research estimated from 12 subjects, and 46
of the 96 buildings are in the classroom pool. So the unknown-hours path is
larger than the research suggests and matters more than it looks.
## 2026-08-26  The room index, and a divisible-room shape the spec misses

**Decided.** `data/rooms-1268.json`, 871 rooms, **234 KB raw and 26.8 KB
gzipped**, which lands inside the research's 27 to 33 KB estimate. Built by
`scripts/build-index.mjs` from the committed harvest.

**Split from `fetch-rooms.mjs`, against the issue's "fetch-rooms writes two
files".** A full harvest costs about 680 requests against a university's API,
and every schema change to the index would otherwise mean paying that again just
to see the result. Reading the harvest instead makes the inversion free to
iterate on, and the input is identical either way.

**A divisible-room shape the issue's spec cannot see.** It says to copy a
`facilityGroup` parent's intervals onto "every room whose `facilityId` extends
the parent's". That covers `MALC0100` to `MALC0100N` and `MALC0100S`. It does
not cover the other shape:

```
MALC0100      -> MALC0100N, MALC0100S     a suffix EXTENDS the parent id
BO0410/420    -> BO0410, BO0420           a slash NAMES both halves
```

`'BO0410'.startsWith('BO0410/420')` is false. Measured on term 1268,
`BO0410/420` is a `facilityGroup` parent and **both `BO0410` (7 blocks) and
`BO0420` (4 blocks) exist as separate rooms in the index**, so a combined
booking left both halves reading FREE. That is precisely the failure this
propagation exists to prevent. The digits after the slash replace the last N of
the base number, which is how the Registrar writes them.

Three of the five group parents on 1268 carry slash names. Only `BO0410/420`
currently has both halves present, so the live impact today is two rooms, but
the shape is not rare and a prefix test will never catch it.

**Propagation runs both ways, decided rather than omitted.** The issue flags the
upward direction as an open question. If `MALC0100N` has a class in it, then
`MALC0100` is not available as a whole room either, and sending someone to it is
the same wrong answer in the other direction. A sibling is NOT made busy by its
twin; only the parent is.

**The prefix trap is still respected.** `KH0333`/`KH0333C` and
`HC0346`/`HC0346D` are both `facilityGroup: false` and genuinely separate rooms.
Gating on `facilityGroup` rather than on a bare prefix scan is what keeps a real
free room from being marked busy.

**Verified on the built file.** 12,150 busy tuples, 0 malformed, 0 unmerged
overlaps in any room, every room's `b` resolves in `buildings.json`, room keys
sorted, and two consecutive builds produce a **byte-identical** file. 1,876
exact duplicates dropped and 37 intervals merged out of 14,059 in.

**`generated` appears only in `current.json`.** Inside the index it would make
every weekly rebuild differ even when no schedule changed, so nothing could tell
you whether the data actually moved. A guard fails the build if it appears.

**`instruction` is the min and max of observed meeting dates**, never
`searchableTermsV2`, whose dates are eleven-month search visibility windows:
Autumn 2026 "starts" 2026-02-09 by that field. Measured: 2026-08-03 to
2026-12-11 across 12 sessions.

---

## 2026-08-26  Session filtering, and six defects the room-index review caught

**The biggest one was in already-merged code.** `freeGaps` filtered busy blocks
by weekday and never looked at `sessionIndex`, so a block belonging to a session
that has not started, or has already ended, still read as occupied.

A term is not one continuous block. Autumn 2026 has 10 sessions and the
seven-week ones do not overlap: the second-half sessions start 2026-10-19.
Measured on the shipped index:

```
on 2026-08-25   324 of 12,168 busy tuples belong to a session not running
on 2026-11-15   287 of 12,168, and 3 rooms have their ENTIRE busy list
                drawn from a session that is not running
```

Those three rooms read fully booked while they are free all day. The engine now
takes the index's `sessions` array plus today's date, builds an active mask, and
skips blocks whose session is not running. Without both it falls back to
counting every block, which is only correct for a single-session index.

**`propagateGroups` was not idempotent with two halves, and the test I wrote
certified a property the code did not have.** Snapshotting `busy` at the top of
the call is not enough: on a second call the parent has already absorbed both
halves, so each half's blocks flow down into the other and `MALC0100S` ends up
busy purely because `MALC0100N` is, which the module comment says must never
happen. The old idempotence test used a **single** half, exactly the shape that
hides it. Propagation now reads from an `own` snapshot taken before any
mutation, which is idempotent by construction, and `own` is stripped before the
index is written.

**Sessions were built from rows the funnel throws away.** Running
`buildSessions` over all 27,074 harvested meetings emitted 12 sessions of which
only 10 were referenced by any busy tuple; the other two came from online and
room-less sections. Since `instruction` is min/max over sessions,
`current.json` claimed the term started **2026-08-03** when the earliest real
classroom booking is **2026-08-10**: a week of "in term" during which no room in
the index holds a single block. Sessions are now built from the rows that
survive `isRealRoom`.

**Rebuilding an archived term silently repointed the live app at it.** The whole
reason this script was split from `fetch-rooms.mjs` is that re-inverting is
cheap, which makes it an easy accident: `build-index.mjs 1262` would have
overwritten `current.json` with Spring 2026. It now refuses to move the pointer
when today falls outside the term's own instruction window, with `--pointer` to
override and `--no-pointer` to skip it entirely.

**`cap: 0` is the index's sentinel for unknown, and the engine shipped it as a
seat count.** `room.cap ?? null` passes `0` straight through, so 44 of 871 rooms
would have rendered a confident "0 seats". Checked explicitly now.

**One silent drop got a counter.** A meeting that passed the funnel and then
matched no session was dropped with nothing recorded, in an otherwise fully
instrumented pipeline. Zero occurrences today, but a partial upstream drift
would empty whole rooms while the funnel still printed a healthy usable count.

---

## 2026-08-26  The origin is enesyilmazcode.github.io/Vacant/, and that is final

**Decided by Enes, 2026-08-26: stay on GitHub Pages. No custom domain.**

Written down as a commitment rather than left as a default, because reversing it
is unrecoverable. iOS has no mechanism to update an installed web app's URL, so
moving the origin after the first person adds Vacant to their home screen
orphans their icon, their cached index, their service worker registration and
their geolocation grant, with no way to tell them.

Free, live today, and it costs nothing to keep. Three consequences follow and
every one of them is now a rule rather than a preference.

**The capital V is load bearing.** `enesyilmazcode.github.io/Vacant/` is case
sensitive and `/vacant/` returns a hard 404. That is survivable in a link, and
fatal in a `start_url`: it 404s only AFTER install, on a device where the user
cannot see the address bar to work out why. So:

- every path in `manifest.webmanifest` is absolute and capital-V
- every asset path in `index.html` and `sw.js` is absolute and capital-V
- a test greps the built site for `/vacant/` and fails on any match

**Storage is shared with Finder.** Both sites live on
`enesyilmazcode.github.io`, so they share an origin, which means they share
`localStorage`, IndexedDB, cache storage and service worker scope. Nothing here
is a security problem, since both are the same person's public static sites, but
a key collision would be a real bug. So:

- every `localStorage` and cache key is prefixed `vacant:`
- the service worker registers with an explicit `{ scope: '/Vacant/' }` and its
  cache names carry the same prefix
- the service worker file itself lives at `/Vacant/sw.js`, never at the domain
  root, so it cannot claim Finder's pages

**Nobody will type it from memory.** That is accepted. Vacant is built to be
installed, not visited, so the URL is something shared once and then replaced by
an icon. It does mean the launch plan in
[#27](https://github.com/EnesYilmazcode/Vacant/issues/27) has to lean on a link
rather than on a memorable name.

**If this is ever revisited**, the only safe moment is before the first install.
After that, the honest options are to keep both origins alive forever or to
accept losing every installed user, and there is no third one.

Unblocks [#21](https://github.com/EnesYilmazcode/Vacant/issues/21),
[#22](https://github.com/EnesYilmazcode/Vacant/issues/22) and
[#23](https://github.com/EnesYilmazcode/Vacant/issues/23).

---

## 2026-08-26  The map is vector, drawn from OSU's own GIS, with no tiles

**Decided.** `data/campus.json`, **50.1 KB gzipped**, drawn from the same GIS
server `data/buildings.json` already uses. No Mapbox, no Google, no tiles, no
API key, no account.

A tile map puts network requests on the critical path. That breaks the one
promise Vacant makes that nobody else does, which is that it answers with no
signal, in a stairwell. It also needs an account, which the deployment decision
in [#39](https://github.com/EnesYilmazcode/Vacant/issues/39) rules out. Ohio
State publishes the campus as polygons, so the map is drawn from data we already
ship, and it looks like this project rather than like everyone else's map.

```
layer      features   points
building        302    4,293     the only load-bearing layer
street          836    6,254
landscape       398    2,554
water             8      157
                      -------
                     50.1 KB gzipped, against a 140 KB budget
```

**The map covers 2 km from the Oval, not the whole schedule.** Measured against
the room index:

```
1.5 km   85 buildings   96.9% of rooms   2.2 km span
2.0 km   86 buildings   97.1% of rooms   2.4 km span
2.5 km   90 buildings   98.6% of rooms   3.8 km span
```

2.5 km triples the area for 1.5% more rooms, nearly all of it empty. Rooms
outside the map still appear in the list; they have no pin, and a room 5 km away
was never a walk-to-it answer.

**Simplification is tuned to what is visible, not to what is available.** The
map is 2.68 km across on a ~390 px phone, so **one pixel is about 6.9 metres**. The first pass used `maxAllowableOffset` values ten times finer than
that and came back at **263 KB gzipped**, four times the final size, almost
entirely street and landscape vertices nobody can resolve. The budget guard
caught it, which is what it is for.

**Coordinates are delta-encoded grid steps, not floats.** Quantised across the
bounding box, first pair absolute and the rest steps from the last, so most
numbers are one or two digits and gzip does the rest.

**Grid values are not bounded to 0..grid in EITHER direction.** The query asks
for shapes that INTERSECT the box, so a road or the river crossing the edge
comes back whole: measured range is x **-19205..65000** and y **3313..102550**
against a grid of 65535, so the maximum EXCEEDS the grid. A renderer packing
these into a `Uint16Array` wraps 102550 to 37014 and teleports the north edge
into the middle of the map. Clamping would tear shapes at the boundary, so the
renderer clips instead.

Two earlier versions of this note were wrong. The first claimed a 16-bit range.
The second quoted `-11080 to 61621`, which took the minimum from the x axis and
the maximum from the same axis while y ran to 68750, so it read as though
overshoot was low-side only, which is exactly the reading that makes a
`Uint16Array` look safe.

**Rings are grouped per feature, not flattened.** ArcGIS marks a hole only by
winding order, and that is gone once a ring is delta-encoded. **19 buildings on
the shipped map have a courtyard**, and a flat list of rings draws every one of
them as a solid block. Grouped, the renderer draws one path per feature and
even-odd fill handles it.

**The bounding box is anchored on buildings that HOST CLASSES.** Anchoring it on
every building in the radius selected 320 rather than 86 and produced a
**3.96 x 4.59 km** rectangle, roughly twice the linear extent of the region that
actually has classes. That also made the pixel budget the simplification was
tuned against wrong by about 2x: 11.8 m per pixel rather than the 6 m the tuning
assumed. Anchored correctly the map is **2.68 x 2.22 km** and 6.9 m per pixel,
which is what the table below describes. Buildings with no classes are still
drawn, because they are context; they simply do not stretch the map to reach
them.

**Verified by drawing it, not by trusting the byte count.** Rendered as text at
104 columns: the Olentangy runs north to south, Dreese and Caldwell sit adjacent
on the engineering side, Bricker is south-east on the Oval. A coordinate
round-trips with zero error. A test asserts every on-map building that hosts
classes has a footprint within 250 m, so no room can be surfaced with nothing to
point at.

**Not in the Sunday cron.** Campus geometry does not change weekly. This is a
one-off fetch, 13 requests.

---

## 2026-08-27  Open question: SURPLUS_WEIGHT and SURPLUS_CAP are guesses

`js/engine.js` ranks a row by `walk - SURPLUS_WEIGHT * min(usable - need,
SURPLUS_CAP)`, ascending. Both constants are **unmeasured judgement calls** and
this entry is here so nobody reads them as settled.

`SURPLUS_WEIGHT = 0.1` says an hour of extra window is worth six minutes of
extra walking. `SURPLUS_CAP = 60` says surplus past an hour is worth nothing,
because the student already said how long they needed. Neither number came from
a person choosing between two rooms. They came from the query-engine note, which
picked them so distance stays primary and "closer but shorter" only loses to
"further but much longer".

**What they actually change.** Measured on the committed index against the same
engine with `SURPLUS_WEIGHT = 0`, 980 queries over 7 weekdays x 7 clocks x 4
durations x 5 radii: the surplus term changes which room is FIRST in 14 of them
(1.4%) and reorders the top five in 110 (11.2%). When it does move the first
row, the room it promotes is at most 3 walking minutes further away, because the
cap bounds the whole term at 6 minutes.

**What would settle it.** The phase 4 "was it open?" reports, or a walk in which
somebody is offered both rooms and says which one they wanted. Until then, do
not tune these against a feeling. Changing either one changes which room is
first on a screen, and the only evidence for the current values is that they are
conservative: with `SURPLUS_WEIGHT = 0` the ranking is pure distance, which is
the behaviour the note argued against, and it is one line away.

`PACKUP`, `WALK_MPM` and `DETOUR` are not in this entry. They carry their own
measured-or-guess comments in the config block and are not open in the same way:
`PACKUP` is a policy backed by the 69.3% passing-period measurement, and the
other two are labelled guesses that shift every row equally rather than
reordering them.
## 2026-08-27  The nine unplaceable bookings: refuse, do not recover ([#33](https://github.com/EnesYilmazcode/Vacant/issues/33))

**Decided.** The weekday is not recoverable and we will not guess it. A booking
that names a real room and a real clock window with no weekday now has that
window blocked on **all seven days** of its session, and is listed separately in
the index as `unplaceable` so a screen can say what it is. This reverses the
"Known honesty gap" entry of 2026-08-26 above: Dreese Lab 280 no longer reads
free during its own Summer labs.

**Decided against three recovery paths, each killed by a measurement over all
68,600 meetings in the three committed archives.**

```
standingMeetingPattern   non-null on 0 of the 47,490 no-weekday rows.
                         Where it does exist it is not even a second opinion:
                         it disagrees with the day flags on 135 of the 3,741
                         rows carrying both. MTOF on a row flagged MTWRF,
                         TR on a row flagged T.
section.meetingDays      the empty string on all 40,452 sections in 1262 and
                         1264, and absent from the 1268 harvest shape. One
                         distinct value per term, and it is "".
a sibling meeting        the strongest looking one, and the most wrong. The
                         Denney 368 row has a sibling in the SAME section at
                         the identical time and the identical dates carrying
                         Friday, so the pair reads like one booking in two
                         rooms. It is not. Of 161 same-section same-time
                         same-dates multi-room groups in 1262, 60 put the two
                         rooms on DIFFERENT days. Engineering 1182.01 is
                         HI0308 on Monday and HI0224 on Thursday. Borrowing
                         the sibling's day would be right about 63% of the
                         time.
```

**Nine rows, four distinct bookings, two rooms.** Dreese Lab 280 carries four
Summer 2026 CSE lab slots (9:10-10:05, 10:20-11:15, 11:30-12:25, 12:40-1:35),
each appearing twice because CSE 2221/2231 are cross-listed with CSE 5022/5023.
Denney 368 carries one Spring 2026 English 6768.01 seminar at 12:15-3:00. Autumn
2026 has none: `noWeekdayTimed` is 0 across the whole 1268 harvest.

**Seven days rather than Monday to Friday.** Nothing in these rows says the
booking is on a weekday, and "weekend classes are rare" is a fact about the
archive, not about this row. Measured weekend share of day-expanded blocks:
0.12% in 1268, 0.22% in 1262, 3.31% in 1264. Blocking the weekend costs Dreese
280 two days it was probably free; not blocking it risks the one answer this
project promises never to give.

**Over-blocking is the acceptable error and under-blocking is not.** Blocking
Monday costs a student a room that was free. Leaving Wednesday open walks them
into a CSE lab. Only one of those is the failure the README is built on calling
out in other apps.

**The index says which blocks these are.** A room carrying them ships
`unplaceable: [[start, end, session], ...]` beside its `busy` list. A screen that
reads it can say "a class meets here at this time, the day is not published". A
screen that ignores it still shows the room as busy, which is the safe fallback.
Nothing about this needs an app change to stop being a lie.

**Bounded.** `MAX_UNPLACEABLE = 20` in `build-index.mjs` refuses the build
outright above twenty such bookings, because at that scale seven-day blocking
would delete the index rather than protect it. Measured today: 0 in 1268, 4 in
1264, 1 in 1262. `noWeekdayTimed` is now printed on the funnel line as the
canary; a jump means the upstream shape moved and the day may have become
recoverable, which is when #33 gets reopened.

**Cost, measured.** Rebuilding 1268 changes nothing but the schema string: 871
rooms, 12,168 busy blocks and 1,026,283 busy minutes, identical before and
after. Rebuilding Summer 1264 from the archive turns DL0280 from 0 busy blocks
into 28, four slots on seven days, and touches no other room.

---

## 2026-08-27  The room safety filter, and what `ga: false` means ([#9](https://github.com/EnesYilmazcode/Vacant/issues/9))

**Decided.** Two sources, one filter and one flag. The room's own `facilityType`
decides whether the room ships at all, from an allow list in
`scripts/lib/room-safety.mjs`. The Registrar's general assignment list decides
nothing; it rides along as `ga: true|false` so the ranking can prefer a centrally
scheduled room without hiding a departmental one.

**Measured on the full Autumn 2026 harvest.** The research sampled 633 rooms; the
harvest has 871, so every number below is larger than the issue's estimate and
these are the real ones.

```
                   rooms  buildings  busy minutes
before the filter    871         96     1,026,283
shown                486         70       651,663
secondary             95         45        57,185
dropped by type      250         58       280,129   27.3% of the term's busy time
dropped, restricted   40          8
shipped              581         78       708,848
```

**The three Wooster rooms cost nothing to name and are named anyway.** `WSB300`,
`WAB0130` and `SY0203` report campus Columbus and location CS-COLMBUS while
sitting 126 km away. All three resolve to buildings 8002, 549 and 410, none of
which is in `data/buildings.json`, so the funnel's building join already dropped
them before the filter ran and `OFF_CAMPUS` catches zero rooms today. It stays,
because the join that saves us is a side effect of a geocoding radius and this is
the statement of intent.

**The parked decision in BACKLOG.md is implemented as written.** A room that
passes the type filter and is absent from the Registrar list ships, ranked below
general assignment rooms, carrying `ga: false`. **255 of the 581 shipped rooms are
in that state, 43.9%.** Hiding them would delete nearly half the inventory,
including most of Enarson and Hamilton. They are also the rooms most likely to be
departmentally controlled, which is what the flag is for. The app ranks on it; it
never filters on it. Reversing this needs a ranking change, not a rebuild.

**What the app does with the flag, so it is written down before the result screen
renders it.** `ga: true` ranks above `ga: false` at equal walking distance and
equal free time. `ga: false` gets a one-word label on the row, not a paragraph,
and never a hedge like "usually open". Neither value is ever a reason to drop a
room or to claim anything about the door.

**All 327 general assignment rooms appear in the harvest.** The research's "69 of
them never appeared in any sample" was an artifact of sampling 40 subjects. In
the full harvest the number is 0. That kills one of the two arguments for the
multi-term union in #30 before the spike starts.

**The room type words ship in the index, and the app keeps no copy.** 486 rooms
are `vis: "shown"` and 95 are `vis: "secondary"`. The app had its own five-entry
type table covering exactly the shown codes, so all 95 secondary rooms rendered
with no type word at all: a conference room, a computer lab and a lecture hall
looked like the same row. The vocabulary now lives beside the allow list in
`scripts/lib/room-safety.mjs` and ships as `types` in the index, so one file
decides both what a room is and what it may be called.

Ten of the eleven visible codes have a word. Everything past `SMNR` comes from
Roomix's compiled bundle, which carries the Registrar's own decode table for 23
of the 28 codes in the harvest; `docs/research/peer-check-ui.md` has the two
greps that recovered it. `5C` is not in that table, nothing else decodes it, and
its two rooms ship with no word rather than an invented one.

**One room where the two sources point opposite ways.** `CM0100`, Campbell Hall
100, is on the Registrar's Autumn 2026 general assignment list and reports
`facilityType: 5L`, which the allow list hides. It stays hidden this term. Ranking
GA membership over the type table would open the whole hidden set to any room the
Registrar happens to list, and 5L's other room is Fisher Hall 700 at 9 seats. The
build prints the conflict on every run so it cannot go quiet, and it is the
concrete case in `docs/registrar-room-type-key-email.md`.

**The allow list does not need a per-term refresh, and this was measured rather
than assumed.** Diffing `facilityType`, `facilityCapacity`, `buildingCode` and
`facilityGroup` across 1262, 1264 and 1268 for the 798 `facilityId` values present
in two or more terms:

```
type changed across terms:  0
cap changed across terms:   0
buildingCode changed:       0
facilityGroup changed:      0
```

Zero, on every field, over three terms and 16 months. The facility record is
stable and a room re-typed after a renovation has not happened yet. Re-run the
diff when a fourth term lands; do not schedule it.

**One new code the research never saw.** `6E`, one room, Hagerty Hall 335. It is
hidden, like everything undecoded, and it is listed in `KNOWN_HIDDEN` so the
build's "new facilityType" line stays silent until something genuinely new turns
up.

**Dropping a room can strand a session.** Autumn 2026's 7W1 window 2026-08-24 to
2026-10-09 belongs entirely to nine LAW sections in Drinko Hall, which is a
restricted building, so after the filter no busy tuple pointed at it. Sessions
with no tuple are now pruned and the rest renumbered: 10 sessions became 7. This
matters because `instruction` is min and max over the session list, so a stranded
session stretches the term the app thinks it is in.

**The map keeps buildings the index no longer ships.** 15 of `campus.json`'s 86
keyed footprints now host classes only in rooms the filter refuses: the Adventure
Recreation Center's classes are all in a climbing wall, Ohio Stadium's in a
meeting room, Drinko's in the law school. They stay drawn, because the map is
context and re-anchoring its bounding box on 78 buildings instead of 96 would move
every coordinate in a file the app already renders. `buildings.test.mjs` was
changed to assert what actually matters: a keyed code is a real building, and a
shipped room inside the map has a footprint to point at.

**Decided against dropping a room for `facilityCapacity === 0`.** The field has no
null: 0 means unknown and 998 means online. 32 real rooms report 0, seven of them
ordinary Campbell Hall classrooms that would silently vanish.

---

## 2026-08-27  The vendored ICS is wrong outside Autumn, so the Registrar ships ([#11](https://github.com/EnesYilmazcode/Vacant/issues/11))

**Decided against the plan in the issue.** #11 says vendor
`mcmanning.github.io/ohio-state-ics/academic.ics`, match `SUMMARY` on `offices
closed` and `offices open`, and cross-check against the Registrar's five-year
view. The ICS is vendored and it is still the cross-check, but **the Registrar's
five-year table is what ships**, because the ICS is wrong.

**Measured 2026-08-27 by diffing both sources across three terms.**

```
term          in-window disagreements
AUTUMN 2026            0     all seven closed days identical
SPRING 2026            2     ICS puts MLK Day on Sun Jan 18; Registrar Mon Jan 19
SUMMER 2026            6     every holiday wrong:
                             Memorial Day    ICS Sun May 31   Registrar Mon May 25
                             Juneteenth      ICS Thu Jun 18   Registrar Fri Jun 19
                             Independence    ICS Sun Jul 5    Registrar Fri Jul 3
```

Look at the weekdays. The ICS lands Spring and Summer holidays on Sundays and
Saturdays, year after year, back to 2021. A university does not close its offices
for Memorial Day on a Sunday. The generator is mangling the Spring and Summer
half of every academic year and getting Autumn right.

**The worst one is the Summer exam window.** The ICS says finals run 2026-08-02
to 2026-08-04. The Registrar says August 3 to 5. August 2 is a Sunday. Trusting
the ICS would have marked the real last exam day, Wednesday August 5, as an
ordinary teaching day, which is the precise failure #11 exists to prevent.

The issue anticipated one disagreement, the missing Dec 28-31 block outside the
term, and concluded the diff should refuse rather than merge. That conclusion was
right for a much bigger reason than the one it was written for.

**Corrected the same day. A veto held by a source measured wrong is not a check,
it is a wall.** The first cut let the ICS refuse the whole build on any
disagreement, which meant Spring and Summer exited 1 before writing anything.
Two of the three seasons had no path to a shipped index, on the strength of a
file this document had already called wrong.

The measurement that fixes it, run against all fifteen columns of the five-year
view rather than the three terms on disk:

```
season   columns  in-window disagreements  exam window
AUTUMN   2023-27  0, every year            identical, every year
SPRING   2024-28  2, every year            1 to 6 days off, every year
SUMMER   2024-28  2, 4, 6, 6, 2            1 to 6 days off, every year
```

Every one of those 30 Spring and Summer lines is a **pair**. The ICS names the
right holiday and dates it wrong, by one to six days: Memorial Day on Sunday May
31, Juneteenth on Thursday June 18, MLK Day on Sunday January 18. Nothing is left
over on any column.

So a slid holiday is the known defect. It is printed, the Registrar's date ships,
and the build carries on. A disagreement the slide does not explain still kills
the build, in every season, and so does two sources putting the same day into two
different states. Autumn's tolerance is 0 because it has never needed one. The
table is `ICS_SHIFT_DAYS` in `build-index.mjs` and `calendar.test.mjs` walks all
fifteen columns, so the day the ICS invents a holiday instead of moving one, the
test says so before the build does.

**Three sources for the exam window, and all three must agree.** The finals page
ships because it is the only one carrying the time-of-day matrix. The five-year
view and the ICS each get a veto. Autumn 2026: all three say 2026-12-11 to
2026-12-17.

**The teaching window is the Registrar's, not the harvest's.** `termWindow` reads
"classes begin" and "Last day of regularly scheduled" out of the five-year table
and gets 2026-08-25 to 2026-12-09. Taking the min and max of harvested meeting
dates gives 2026-08-10 to 2026-12-11 instead, because Anatomy 6511 in the medical
school runs August 10 to December 11 and Pharmacy 7110 to December 10. The
professional colleges keep their own calendars. Using their dates would stretch
Autumn 2026 straight through the exam window it is supposed to end before, and
`exams.start > last day of instruction` would fail on a true statement.

Those sessions still exist and the build prints a warning naming them, because
their rooms really are busy during finals week while everyone else's are not.

**Spring Break does not ship, and that is a refusal rather than an oversight.**
The five-year view labels those five rows "Spring Break" and nothing else. No
"no classes", no "offices". Every other break row says which. So Spring 2026
parses to exactly ONE closed day, Martin Luther King Jr. Day, and March 16 to 20
will read busy in a term where nothing meets.

That is wrong in the safe direction: the app hides rooms that were free rather
than offering rooms that were not. Calling an unlabelled row `no-classes` would
free every room on campus for a week on the strength of two words in a table
cell, which is the guess-dressed-as-a-fact this project refuses to make. Fixing
it properly means a second source for Spring Break, not a looser matcher.
`CLOSED_DAY_BOUNDS[2]` is `[1, 3]` because of this and will move when it is
fixed.

**Closed-day bounds, both sides, by season digit.** A parser that quietly returns
nothing looks exactly like a term with no holidays, so the count is bounded above
as well as below. Digit 8 is `[5, 9]` against a measured 7. Digit 4 is `[1, 5]`
against a measured 3. Digit 2 is `[1, 3]` against a measured 1. An unknown digit
refuses.

**What ships in `rooms-1268.json`.**

```json
"teaching": ["2026-08-25", "2026-12-09"],
"closed": {
  "2026-09-07": {"state":"offices-closed","name":"Labor Day"},
  "2026-10-15": {"state":"no-classes","name":"Autumn Break"},
  "2026-10-16": {"state":"no-classes","name":"Autumn Break"},
  "2026-11-11": {"state":"offices-closed","name":"Veterans Day observed"},
  "2026-11-25": {"state":"no-classes","name":"Thanksgiving Break begins"},
  "2026-11-26": {"state":"offices-closed","name":"Thanksgiving Day"},
  "2026-11-27": {"state":"offices-closed","name":"Indigenous Peoples' Day/Columbus Day observed"}
},
"exams": {"start":"2026-12-11","end":"2026-12-17"},
"lowConfidence": [{"start":"2026-10-13","end":"2026-10-14","reason":"session-1-finals"}]
```

`offices-closed` and `no-classes` are not shades of one thing and the app must
not render them as one. October 15 is Autumn Break with the doors open: no
classes, free rooms, the best day of the term for this app. September 7 is Labor
Day: the same rooms behind locked doors.

**`lowConfidence` is October 13 to 14, not the 13 to 16 the issue sketched.**
October 15 and 16 are already in `closed` as `no-classes`, which says everything
there is to say about them. Repeating them under a `session-1-finals` label would
name them wrongly. The two days that need the flag are the ones where the grid
UNDERSTATES: full-term classes meet normally on the 13th and 14th while the
seven-week rooms hold exams that appear in no busy list.

**Nothing fetches at runtime.** `scripts/fetch-calendar.mjs` vendors the ICS to
`data/vendor/academic.ics` with `academic.meta.json` beside it, and caches the
five-year view and the finals pages under `data/cache/registrar/`. The build
reads files.

**And it names no term.** The first cut hardcoded `AUTUMN 2026` and a two-name
list of finals pages, in the one script whose header says to run it when a term
rolls over. It would have refused a healthy five-year view the moment that column
scrolled off the page, with a wrong reason. Both now come off the page: the
column headers give all fifteen terms, and the finals index gives every page
whose slug carries a season and a year.

That fixed a live gap rather than a future one. `summer-2026-finals-schedule` was
on the Registrar's index for the whole term and was never cached, so the Summer
build fell back to the five-year view with no third source to check it. Fetching
it needed one more thing: the Summer page writes its dates as "Monday, August 3"
and "Monday August 3, 2026" where the Autumn page writes "Monday Dec 14" and
"Monday 12/14", so it parsed to zero days, and a finals page that parses to
nothing kills the build. `parseFinalsWindow` reads all four spellings now. All
three Summer sources agree on 2026-08-03 to 2026-08-05.

**`instruction` in `current.json` is the Registrar's teaching window.** This is
the field `js/app.js` reads to decide whether it may answer at all, and it was
the min and max of harvested meeting dates: 2026-08-10 to 2026-12-11. December 11
is exactly `exams.start`. So on the morning of the first final the app passed its
own staleness gate and offered Independence Hall 100, 727 seats, as free until
10:50 pm. It now reads 2026-08-25 to 2026-12-09, the same pair as the index's
`teaching`, and the build prints the harvested span beside it so the divergence
stays visible.

**`closed` ships keyed by date, and each day carries its name.** A list makes a
reader that forgot it was a list return `undefined`, and `undefined` here renders
as an ordinary day with rooms in it. A map cannot fail that way. The name is the
publisher's own row label, so a refusal can say "Thanksgiving Day, campus is
closed", which is a fact a student can check, rather than "campus is closed
today", which is the app asking to be believed.

---

## 2026-08-27  Refuse on busy blocks and minutes, and delete the room-count floor ([#10](https://github.com/EnesYilmazcode/Vacant/issues/10))

**Decided.** `scripts/guards.mjs` is Finder's file verbatim with two changes:
`MAX_DROP` is 0.05 rather than 0.1, and a four-line provenance comment naming
`EnesYilmazcode/Finder` (MIT) sits on top. Nothing else. Vacant's own thresholds
live in `scripts/lib/index-guards.mjs` and are keyed on **busy blocks and busy
minutes**.

**The room-count floor is gone.** `MIN_ROOMS = 150` was deleted rather than
retuned. It was the wrong metric and it fired first, which meant it pre-empted
the guards that do work. Proved by damaging a real harvest: dropping every
fourth roomed meeting from the Autumn 1268 harvest moves

```
busy blocks    9,561 -> 7,437     down 22.2%   REFUSED
busy minutes 708,848 -> 551,903   down 22.1%   REFUSED
rooms            581 -> 564       down  2.9%   would have shipped
buildings         78 -> 77        down  1.3%   would have shipped
```

A 2.9% room drop clears Finder's 10% and clears the new 5% too. The grid it would
have shipped invents 156,945 minutes of free time. That is the failure this
project has and no room count catches it.

**First full harvest, per term, measured 2026-08-27 on the committed archives,
after the safety filter.**

```
term  season  rooms  buildings  blocks  busy minutes  weekday balance
1262  Spring    607         75   9,342       718,466             0.67
1264  Summer    142         39     668        93,025             0.82
1268  Autumn    581         78   9,561       708,848             0.59
```

Floors are set to about 60% of those and are marked PROVISIONAL in the file.
Autumn `{349, 47, 5700, 425000}`, Spring `{364, 45, 5600, 431000}`, Summer
`{85, 23, 400, 55000}`. Summer needs its own row: it is a seventh of Autumn by
busy time, so one floor for both is either useless in Autumn or impossible in
Summer. Floors only bite on a term's first run; from run two the
previous-committed comparison is far sharper.

**The true campus room count is 871, and none of the six candidates was right.**
The full 1268 harvest holds 877 distinct real `facilityId` values; 871 sit in a
building `data/buildings.json` can place; 581 survive the safety filter and 486
of those are ordinary classrooms. The research's candidates were 422, 486, 562,
625, 633 and Roomix's 1,067. 486 matches the shown count by coincidence, not by
agreement: it was an estimate of show-by-default rooms in a 633-room sample and
lands on the same number for a different population. Roomix's 1,067 is roughly
871 plus the 250 we deliberately refuse plus satellite rooms.

**`weekdayBalance` is Monday to Friday over busy MINUTES.** Measured 0.59 for
1268, 0.67 for 1262, 0.82 for 1264, all clear of the 0.30 refusal. Seven-day
would divide by a near-zero weekend every week: Autumn 1268 has 1,800 Saturday
minutes against 166,895 on Tuesday.

**`timeResidue` is 0.002 against a measured 0.** Zero of 34,244 clock strings
across the three archives fail `toMinutes`. The denominator counts only rows that
carry a clock STRING; a meeting with no time is a meeting with no time, not a
parse failure, and folding those in would have put Summer at 0.0075 and refused a
healthy build. Rewriting 200 start times to `08h00` on a real harvest fires it at
0.93% and stops the run.

**The unresolved-building-code guard needs its allow list or it is noise.** Six
codes are named the harvest names and `data/buildings.json` will never hold: 118
Stone Laboratory on Lake Erie at 185 km, and 404, 405, 410, 414, 549 and 8002 at
the OARDC Wooster campus 126 km out. Gerlaugh Hall and Williams Hall are real
teaching buildings with real classrooms and they are correctly dropped on
distance. Without the list this fires on every build, which trains you to ignore
it. A code NOT in the list means the geo layer went stale and real Columbus rooms
are vanishing, and that is fatal.

**The PII guard runs on the serialized string and `FORCE_WRITE=1` cannot clear
it.** Verified by putting `buckeye.1@osu.edu` into `meeting.room`, which really
does ship as `room.n`: `FORCE_WRITE=1` exits 1 and writes nothing. The refusal
names the character offset and never reprints the address.

Worth recording that the first attempt at this proof failed in a good way. Adding
`instructors` back onto a harvested meeting did NOT trip the guard, because
`invert` builds each room record from named fields and never copies the array.
The strip at the parse boundary is not the only thing standing between an address
and the index; the inversion is a second wall.

**NOT READY versus COLLAPSE, both demonstrated on real data.** A term with no
committed file that falls short of its floors prints the reason, writes nothing
and exits 0, so a workflow building several terms carries on. A term that IS
committed and now falls short exits 1 and leaves the committed file byte for byte
unchanged, which was checked by md5.

**`FORCE_WRITE=1` over a collapsed harvest is unrecoverable and the refusal says
so in full.** A term deleted from `searchableTermsV2` returns zero sections
forever. 1258 already does. The committed file is the only copy of that term's
grid that will ever exist, so the guard is the backup.

**Not done here: the `workflow_dispatch` input description.** `.github/` does not
exist on this branch; the workflow is #12 and belongs to whoever writes it. The
wording it needs, so it does not have to be reinvented:

> `force_write`: Ship a harvest the guards refused. Only clears the forceable
> refusals, never a lost room and never the PII scan. A forced write over a
> collapsed harvest is UNRECOVERABLE: a term that has left searchableTermsV2
> returns zero sections forever, so the committed file is the only copy of that
> grid anywhere. Read the refusal in full before you set this.

---

## 2026-08-27  Multi-term room union: DROP ([#30](https://github.com/EnesYilmazcode/Vacant/issues/30))

**DROP.** One word, as the issue asked for.

**Zero strong positives out of 95 carried-forward rooms.** Running the funnel over
all three committed terms and diffing room identity:

```
1262  884 rooms through the funnel
1264  206
1268  871

carried forward (in 1262 or 1264, absent from 1268)   95
  strong  shown type AND on the GA list                0
  weak    shown type, off the GA list                 49
  noise   everything else                             46
```

Beside Roomix's 190 of 1,067 (17.8%), ours is 95 of 966 (9.8%) from two extra
terms rather than a whole index. Their number reads as cross-term residue in
their own file, which was the reading this spike existed to test.

**The cheaper half answers outright: all 327 Registrar general assignment rooms
appear in all three terms.** Not one is missing from 1268, let alone from all
three. There is no such thing as an unscheduled general assignment room, so the
union has nothing to reach that one term plus the Registrar list does not already
have. The research's "69 never appeared in any sample" was a 40-subject sampling
artifact.

**The 49 weak positives are not study rooms.** 33 of them are Knowlton Hall
studio bays, `KN0310A` through `KN0390C`, the architecture desk clusters, typed
`1B` because they are rooms and absent from Autumn because studio sections are
scheduled term by term. The other 16 are ones and twos across thirteen buildings,
including Drinko Hall, which is already restricted.

**No rooms were visited, because the spike's own gate is "walk to three strong
positives" and there are none.** If this is ever reopened the visit list starts
at Knowlton 310A.

**`searchableTermsV2` on the day, 2026-08-27.** 1262 Spring 2026 endDate
2026-08-31, 1264 Summer 2026 endDate 2027-01-01, 1268 Autumn 2026 endDate
2027-01-31. Three terms searchable, and 1262 leaves in four days. The lookback
ceiling is whatever is already archived, permanently.

**Why the cost of a false positive is not symmetric.** A carried room ships with
an empty busy list, reads free at every minute of every day forever, and wins
every ranking tie-break, so it sits at the top of the list until somebody
notices. A room can be missing from a term because it was renovated, repurposed
or demolished, and nothing in the data separates that from a quiet classroom.

Measurement in `docs/research/spike-unscheduled-rooms.md`, reproducible offline
with `node scripts/spike-carried-rooms.mjs`. The union line is deleted from
BACKLOG.md rather than left open.
## 2026-08-27  The installable shell: manifest, two caches, and the cold launch

**Decided.** Every path in the PWA layer is absolute under `/Vacant/`, including
the module script tag in `index.html`. GitHub Pages is case sensitive and the
origin decision above settled on Pages with no custom domain, so a lowercase
`start_url` is an icon that opens a 404 after install, and iOS gives no way to
change an installed app's start URL. `scripts/test/manifest.test.mjs` fails if
`start_url` or `scope` drifts from `/Vacant/`, and it fails on `/vacant/`
specifically, checked by mutating the file and rerunning: 10 pass became 9 pass
1 fail, and back again.

The absolute script src is load-bearing beyond tidiness. The worker answers a
failed navigation with the cached `index.html`, so the document can render at
`/Vacant/anything`; a relative `js/app.js` would resolve against that path and
404.

**Manifest colours are `#0b0d10`, not the `#1a1a1a` the issue drafted.** That
value predates the palette the app actually paints, and a manifest colour that
disagrees with the `theme-color` meta tag flashes the wrong shade behind the
status bar on launch.

**The icons are generated, not drawn.** `scripts/make-icons.mjs` writes PNG and
ICO bytes through `node:zlib` and `node:crypto`, so the repo keeps its zero
dependencies, runtime and dev alike. The mark is the period in the wordmark: one
`#ff4d3d` disc on the `#0b0d10` ground, 44% of the canvas for the plain icons and
34% for the maskable pair, which clears Android's 80% safe zone even after a
squircle crop. `apple-touch-icon.png` is 180x180 colour type 2 with no alpha, no
padding and no rounding, because iOS masks the square itself and composites any
alpha onto black. The test regenerates all six files in memory and fails if the
committed bytes drift.

**The `favicon.ico` 404 was not a missing file.** A page with no icon link asks
the *origin* root, and `enesyilmazcode.github.io/favicon.ico` belongs to the
portfolio repo, not this one. The fix is the `<link rel="icon">`; the file is
only what it points at. Measured after: a cold headless load of `/Vacant/` logs
zero non-200 responses, where before it logged one.

**Two caches, split by how often the bytes change.** Sizes are the committed
blobs, `git show HEAD:<file> | gzip -9 -c | wc -c`, which is the copy Pages
serves. The same command over a Windows working tree answers differently,
because git checks the text files out with CRLF.

```
shell   index.html 5.8  js/app.js 12.8  js/map.js 7.8  js/engine.js 4.3
        js/campus.js 1.6  js/pwa.js 2.2  js/install.js 3.9  js/firstrun.js 3.0
        manifest and the three icons 2.9              total 45,415 bytes
data    rooms-1268.json 26.7  buildings-1268.json 2.5
        buildings-hours.json 3.5  campus.json 38.1
        current.json 0.2                              total 72,744 bytes
```

`SHELL_CACHE` carries the commit SHA and is therefore replaced on every deploy;
`DATA_CACHE` is `vacant-data-v1` and is not. That is why `campus.json` and
`buildings-hours.json` live in the data cache and not the shell, against the
issue's draft list: `campus.json` alone is 38.1 KB gzipped and does not change when
Enes deploys. The draft list also named `app.css`, which does not exist because
the styles are inline, and `data/buildings.json`, which nothing fetches any more.

**Found by running it, not by reading it.** Three defects that no amount of
review had caught:

1. `evictOldTerms` matched `buildings-(\w+)\.json`, which matches
   `buildings-hours.json`, captured `"hours"`, compared that to `"1268"` and
   deleted the Registrar's building hours on the very first `activate`. Offline
   then booted from cache and never reached ready. The capture is `\d+` now and a
   test runs the shipped pattern over eight filenames.
2. The page decided whether to skip the waiting worker from a snapshot of
   `navigator.serviceWorker.controller` taken at page load. On the visit where a
   deploy actually arrives that snapshot is stale, so the second worker waited
   forever and the old shell cache was never collected. Measured before: caches
   were `vacant-shell-3736861 vacant-data-v1 vacant-shell-deadbee`. After:
   `vacant-data-v1 vacant-shell-deadbee`.
3. Messages from the worker never arrived. Delivery to `navigator.serviceWorker`
   stays suspended until the page sets `onmessage` or calls `startMessages()`,
   and this page uses `addEventListener`. The "schedule updated" bar had never
   once appeared.

**Found by a second pass over the same code.** Four more, none of them visible
in a browser until something was deliberately broken:

1. `pickTier()` called a cache holding the pointer and the rooms file tier 1, but
   `boot()` also awaits the buildings file and the Registrar's hours in the same
   `Promise.all`. The worker's warm skips any file that came back non-ok, so one
   503 on `buildings-hours.json` left three disabled duration buttons, a line of
   grey text and no Try again anywhere. The tier now tests every file the answer
   is built from, and `campus.json` deliberately is not one of them.
2. The probe that decides whether there is a network asks for the term pointer
   with `cache: 'no-store'`, and `networkFirst` was answering it out of the data
   cache. Measured with the server killed: 200 back, and `reachable()` reported a
   working network. The offline card had only ever rendered on a cache with no
   pointer in it at all.
3. The install hint and the refresh notice were both `position: fixed; bottom: 0;
   z-index: 4`. With both up the refresh bar covered all but 12px of the hint and
   `document.elementFromPoint` at the centre of the hint's own 44px dismiss X
   returned an element inside the refresh bar. `--bar-h` carried the newest bar
   only, so the list padding shrank from 96px to 84px while 146px of it was
   covered. They share one fixed rail now and stack: hint at y 706, refresh at y
   785, both dismiss buttons answering taps.
4. `activate` deleted every CacheStorage cache on the origin that was not one of
   Vacant's two. CacheStorage is per origin, not per path, and
   `enesyilmazcode.github.io` also hosts Finder and the portfolio. Measured: one
   Vacant deploy took `finder-shell-v3` and `portfolio-v1` with it. The
   localStorage keys had been namespaced for this; the cache names had not.

**Geolocation stays in `js/app.js`.** Issue #23 asked the cold start to call
`getPosition()` in the same tick as the data fetch. `boot()` already does, ahead
of every `await` and collected in the same `Promise.all`, so a second caller in
`js/firstrun.js` would only prompt twice on the one visit the card exists for.
Measured on a cold load at 393x852: geolocation at 60 ms, the first fetch at
60 ms, the first response back at 71 ms. A test holds the order, which is what
the criterion was really asking for.

**`navigator.onLine` decides which tier to start in and is never allowed to
decide that the network works.** Measured on this box: with Chrome emulating an
offline page, `navigator.onLine` stayed `true` while every request refused. It
reports the same lie on a captive portal and on a cell with no backhaul. So the
first-run tier is picked from CacheStorage alone, and when nothing is cached the
only thing that settles it is a request that came back. The retry button runs
that request rather than reading the flag, and says "Still no connection" when it
refuses.

**Decided against.** A KB figure in the cold-start copy. The honest number is the
gzipped size of the committed rooms file, which changes weekly, so it would have
to be stamped at build time into the shell. On the one path where that card
actually renders, a first standalone launch on iOS with no signal, the shell is
not in that jar either, so the stamp would be absent exactly when it was needed.
A number that is never there is worse than no number, and an estimate would be a
guess printed as a fact.

Also decided against splash screens, for the reason the issue gives: iOS ignores
manifest `background_color`, so owning the splash means roughly fifteen
`apple-touch-startup-image` PNGs that go stale on every new iPhone screen. A
comment in `index.html` records it so nobody adds them back.

**What could not be verified here.** Chrome's page-level offline emulation does
not reach the service worker target, so every offline claim in this entry was
measured by killing the web server instead. And the shared HTTP cache that makes
the iOS install-hint prefetch worthwhile is per browser context in Chrome, so the
"installed icon inherits the Safari tab's HTTP cache" step is reasoned from the
platform behaviour, not measured. A real iPhone is still owed one check: airplane
mode on the first launch after install.
## 2026-08-27  ODbL is not triggered, and the credit that is owed is FITS

**Decided.** No `LICENSE-ODbL.txt`, no OpenStreetMap credit, and no ODbL notice
anywhere in the app. Written down because the research note in
`research/legal-privacy.md` section 6 says the opposite in strong language ("this
is not a judgment call"), and anyone reading it in March will re-derive the wrong
answer unless this entry is here.

The research was written when the plan was still an Overpass extraction. It is
not. Every coordinate that ships comes from OSU's own ArcGIS server, and
OpenStreetMap produced exactly one thing: `osm_check_m`, the distance in metres
between the GIS point and the OSM point, on 73 of the 631 buildings in the draft
table. That is an audit column, not a source.

Checked rather than reasoned, on the committed files:

```
grep -c osm_check_m data/buildings.json          0
grep -c osm_check_m data/buildings-1268.json     0
grep -c osm_check_m data/campus.json             0
grep -c osm_check_m data/buildings.draft.json   73
```

Every record in `buildings.draft.json` carries `source: "osu-gis:FacilitiesStreets_RO/11"`
and no OSM coordinate is stored anywhere, only the delta. So there is no
Derivative Database and no attribution obligation. 73 scalar distances are not a
substantial extraction of anything.

**Decided against** dropping the column to make the question go away. The audit is
the evidence that the GIS join is right, and deleting evidence to tidy a licence
question that does not exist is the wrong trade. It stays in the draft file, which
the app does not fetch.

**The credit that IS owed** is to Ohio State FITS, whose Hub item grants "use by
anyone interested in OSU data" with `Copyright 2025. OSU GIS` beside it and a
Terms of Service link that is `href="#"` and goes nowhere. So it is an explicit
grant of public use with an asserted copyright, not an open licence:

> Building locations (c) 2025 The Ohio State University, Facilities Information
> and Technology Services.

`FacilitiesStreets_RO` is not one of the 13 items the OSU GIS account publishes
to ArcGIS Online, so that Hub statement is the closest applicable statement rather
than a statement about this exact layer. `docs/outreach/gismaps-email.md` is
drafted and **not sent**. It goes out before the URL is shared publicly, and
**silence is not permission**: if no reply arrives, the entry recording that has
to use those words, so a later reader does not find "sent, no objection" and
mistake it for a grant.

Per-file provenance now lives in `data/README.md`.

---

## 2026-08-27  data/raw/ stays published, and exclusion was rejected on the numbers

**Decided.** `data/raw/` is served by Pages, deliberately, and `docs/DATA.md` says
so with the measurements. This closes the "Still open" line at the end of the
2026-08-26 snapshot entry.

Verified live before deciding:

```
GET /Vacant/data/raw/1262/1xxx-p01.json.gz    200    33,293 bytes
```

**First, the thing that had to be checked before anything else: there is no PII in
it.** All 210 committed pages decompressed and every object in them walked.

```
files                            210
decompressed bytes        93,528,295
courses / sections / meetings   11,717 / 40,452 / 41,534
email addresses                    0
"instructors" keys                 0
lastName / firstName / emplid      0
```

The only key named `name` anywhere belongs to course attribute codes (`CCP`,
`CRSF`, `GE`, `HON`, `TAG` and thirteen others). The two manifests record 29,282
and 16,201 instructor records removed, 45,483 in total, and none survived. The
parse boundary works.

**Why publishing rather than excluding.** Three reasons, in order of weight.

1. **Exclusion buys no privacy at all.** The repository is public. Excluding
   `data/raw/` from Pages moves one public URL to a different public URL on
   `raw.githubusercontent.com`. It hides nothing from anyone.
2. **The named harm is not fixed by it.** The stated reason to exclude was a
   service worker caching 4.1 MB onto a phone. Measured, the published tree is
   7,030,232 bytes over 311 files, of which `data/raw/` is 4,278,214 and `docs/`
   is another 1,411,520. A cache rule loose enough to pull the archive is loose
   enough to pull the research notes. The fix is an explicit precache list, which
   the service worker needs anyway, and that fix works whatever is on the origin.
3. **The deploy stays "push to main".** Both exclusion mechanisms cost something
   real. Moving to a `site/` publish root is a tree-wide move that breaks every
   script path and has to land before the service worker registers. A Pages
   Actions build inserts a step that can fail between a push and the live site,
   in a project whose whole deployment story is that there is no build.

**Decided against** a `_config.yml` with `exclude:`, specifically. It requires
deleting `.nojekyll` and letting Jekyll process the site, which is a build step
plus a set of filename rules, to hide files that are public anyway.

**And it cannot be hidden from crawlers either, which was also checked.** A
`robots.txt` was written and then deleted, because it would have done nothing:
robots.txt is origin-scoped, a crawler reads
`https://enesyilmazcode.github.io/robots.txt`, and that URL is a **404** that this
repository cannot create. Pages sets no response headers, so `X-Robots-Tag` is
out, and a meta tag cannot go on a `.json.gz`. At 4.1 MB against a 100 GB monthly
soft limit, a crawler walking the whole archive would need about 24,000 passes to
matter. Shipping an inert file and then citing it in `DATA.md` would have been a
control that does not exist, which is the one thing this project is not allowed
to do.

**Unchanged and load-bearing:** the archive stays in the repository. Terms 1262
and 1264 cannot be refetched at any price and the committed copy is the only one
that will ever exist. This was never a delete.

---

## 2026-08-27  GitHub Pages is the deployment target and no backend is to be added

**Decided.** No hosting account, no Firebase project, no Vercel project, no
Cloudflare project, no build step. This entry exists so that nobody creates one,
and so the answer to "where should we deploy this" is a link rather than a
conversation.

It is already deployed. Verified live today:

```
GET /Vacant/                      200   12,383 bytes
GET /Vacant/data/buildings.json   200  163,277 bytes
GET /Vacant/data/current.json     200      215 bytes
GET /vacant/   (lowercase)        404            <- the case trap, still real
```

The `/Vacant/` 404 recorded in the issue is gone: `index.html` has landed.

**Why there is no backend, stated as design rather than as thrift.** Every byte
the app needs is a static file small enough for a service worker to hold, which
is what makes answering with no signal reachable at all, and nothing else in this
category could copy it without a rewrite. Reachable, not reached: there is no
`sw.js` yet and the app needs the network on every open. Measured on the shipped
files:

```
first launch, gzipped        104,830 bytes   102.4 KB
first launch, uncompressed   481,460 bytes   470.2 KB
Roomix's first launch          ~3.3 MB       measured endpoint by endpoint
```

One backend call on the critical path costs a cold start, a DNS lookup, a TLS
handshake and a dependency that can be down, in exchange for nothing the app
needs. The room grid does not change while a student walks to a room.

The only moving part is a cron that rewrites a JSON file. Free on a public
repository, and when it fails the app serves last week's data instead of going
down.

**The one case that would ever justify a backend** is the was-it-open reports, and
even that design keeps the read path static. See the entry below.

`docs/DEPLOY.md` carries how it publishes, how to roll back, and the five things
to check when the site looks broken. Two constraints from it are worth repeating
here because they are not obvious: the capital V in `/Vacant/` is case sensitive
and `/vacant/` is a hard 404, and `.nojekyll` means there is no extensionless
routing, so the privacy page is `privacy.html` and every link to it has to say so.
Verified locally: `/Vacant/privacy.html` is 200, `/Vacant/privacy` is 404.

---

## 2026-08-27  The was-it-open report schema, settled on paper with nothing built

**Decided.** `docs/design/reports.md`. No Worker, no D1 database, no Turnstile
key, no migration, no code. Six calls:

1. **Counters updated in place, never an event log.** Two tables: `conf`, one row
   per bucket, and `seen`, whose only two columns are `d` and `exp`. Decay folds
   into the counter because the sum of decayed parts equals the decayed sum, so
   no report needs a timestamp of its own.
2. **Building buckets first.** 8.5 rooms per building measured on the shipped
   index, so a building bucket fills about eight times faster. Room scope is
   promoted only when a room earns it.
3. **A Wilson lower bound at `z = 1.645`, never a percentage**, with a label
   ladder that has a rung which renders nothing.
4. **Finder's `(ts, day, path, country, ref, visitor)` row is rejected in
   writing**, with the one-line join that reconstructs a person's day spelled out.
   It stays the right design for page counts and is wrong for rooms.
5. **The override is downward only.** Table open plus crowd locked goes to the
   crowd, which is the May 2024 BuckID lockdown. Table closed plus crowd open
   never wins, because its failure mode is a student walking to a locked building
   at 2am and the attack is trivial. The class schedule is never overridden.
6. **Worker plus D1 plus an hourly cron, reads stay static.** An outage degrades
   to yesterday's confidence rather than a spinner.

**Two things in the issue did not survive being computed, and both changed the
design.**

**The three Wilson cases cannot come from one confidence level.** The issue asks
for 9 of 10 at about 0.76 and 90 of 100 at about 0.82. Computed, 0.76 is a `z = 1`
figure and 0.82 is a `z = 1.96` figure:

```
                            1 of 1   9 of 10   90 of 100
z = 1.960 (95% two-sided)    0.207     0.596       0.826
z = 1.645 (95% one-sided)    0.270     0.652       0.840
z = 1.000                    0.500     0.766       0.866
```

Settled on `z = 1.645`, the one-sided bound, because one-sided is the right
statistic when only the bad side matters, and because at `z = 1.96` the very first
state a user could ever see, three people all reporting open, scores 0.439 and
would render as "reported locked". That is not caution, it is a different wrong
answer.

**The ladder needed a fifth rung that renders nothing.** Four people open and one
locked scores 0.435: not enough to say "seen open", and calling it "reported
locked" misreports what the crowd actually said. The honest render is silence and
the row falls back to the line it always carries. The research's "1 of 1 renders
as seen open once" is overruled by the k-of-3 suppression floor, which is a
privacy rule and wins.

**Cloudflare free tier, re-read from their docs today.** 100k Worker requests a
day, 100k D1 row writes and 5M reads a day, Turnstile free with unlimited
challenges. Two corrections to the 2026-08-26 reading: a D1 database is capped at
**500 MB** (the 5 GB is the account total), and a free Worker gets **50 D1 queries
per invocation**, which the hourly rebuild has to be written around or it dies at
bucket 51.

**Still blocked, deliberately.** The ground-truth walk should set the label
thresholds. 0.50 and 0.75 are defensible arithmetic on zero observations and they
are placeholders until somebody has stood in front of twenty doors.

---

## 2026-08-27  Launch: 15 September, both Roomix questions yes, and no usage counter

**Decided: Tuesday 15 September 2026.** The parked "hold the URL until building
hours ship" is discharged, because they shipped. `docs/LAUNCH.md` holds the posts.

Week 4 of a term running 25 August to 9 December, on a calendar the Registrar page
header, the academic ICS and the live meeting objects all agree on. Clear of every
no-class weekday (Sep 7, Oct 15, Oct 16, Nov 11, Nov 25 to 27) and of finals
(Dec 11 to 17). Nineteen days out, which is the time the ground-truth walk needs.
**Explicitly not a hard date**: if the walk is not done, it moves.

**Does Roomix's author hear about the comparison first? Yes.** A short message
before anything posts. The comparison quotes numbers pulled out of his own
bundle, and a maintainer who reads that in a Reddit thread answers defensively
while one who got a heads-up usually does not. It costs one message and there is
no downside to it.

**Is Roomix credited in the README? Yes, one line.** It has been live since
November 2023 across web, iOS and Android and it does the building-browser job
well. The README was wrong about it until the research corrected it, which is
exactly the history that makes an uncredited comparison read as a hit piece.

**Related and decided at the same time: the comparison does not go in the r/OSU
post at all.** It goes in a reply if somebody asks. The same words read as an
answer in a reply and as an attack in a post.

**Does the usage counter ship? No.**

This one is close and it is decided against the issue's instinct. The only reason
to ship it is to judge the phase 4 gate, "only if it gets real use". The cost is
that `privacy.html` currently says, truthfully, "no analytics, no tracking pixels,
and no third-party scripts of any kind. The page loads nothing from any other
company." Verified: zero off-origin URLs in `index.html` and `js/`. A beacon adds
a second origin to a page whose strongest claim is that it has one, and it does it
to answer a question nobody is asking yet.

The gate can be judged without it. If nobody ever asks for a report button, that
is the answer. If people do, that is also the answer, and it is better evidence
than a page-view count.

**If this is reversed**, the honest version is Finder's `analytics/src/index.js`
beacon for page counts only, and `privacy.html` has to say what is stored
**before** the beacon ships, not in the same commit. Never the room-level row: see
the reports entry above for the join that makes it a movement trail.

---

## 2026-08-29  A room needs a week of evidence, not one booking

**The complaint, in Enes's words.** "There are some classrooms that are marked
as classrooms even though it's not actually a class and it's just a room, and
like that can result in our data being off." And: "some classes they're like
locked behind a door."

**What was actually wrong.** Everything in `data/rooms-<term>.json` got there by
being named in at least one class booking, so "hosts a class" was never a filter.
It was a floor of one, and a floor of one lets in a department's own conference
room. `scripts/lib/room-safety.mjs` decided which rooms were SAFE, from the
room's `facilityType` and the building it sits in. Nothing decided which rooms
were REAL.

Measured on the committed Autumn 2026 index, over 504 ranked queries from four
origins x seven days x six times of day x three durations:

```
                                       share of the top ten rows
  rooms hosting <=2 meetings a week
  and not on the Registrar's GA list         15.9%
  of which exactly one meeting a week        10.0%
  5K conference rooms                        14.4%
```

`TO0038`, a 40 seat conference room in Townshend Hall with exactly one booking a
week, appeared in the top ten **60 times** and was the single best answer the app
had **9 times**. `RH0102` in Rightmire Hall is a "conference room" with a
capacity of **1**. `OCE03081` is in Outpatient Care East, an actual hospital
clinic five kilometres from the Oval. `KT0255` and `AARL100` are at Don Scott
airfield, **9.9 km** out.

**Decided.** Three rules, in `scripts/lib/room-safety.mjs`, applied at build
time so an unusable room is ABSENT from the shipped file rather than ranked low
in a file anyone can read. That is the same reasoning the type filter already
used.

1. `MAX_CAMPUS_M = 3000`. A room in a building further than that from the Oval
   is dropped. Cuts 3 rooms.
2. `MIN_WEEKLY_MEETINGS = 3`, applied only to rooms the Registrar does not list
   as general assignment. Cuts 63 rooms.
3. The `ga` flag stays on every kept room, because a non-GA room with a full
   teaching week is a good answer and the ranking should be able to see the
   difference.

**Why general assignment is the exemption and not a second filter.** A GA room
is already certified by the Registrar as central pool space that any department
can book, which is as close to "you can walk in" as a public source gets. Its
booking count says nothing extra about it: 321 of the 326 GA rooms host ten or
more meetings a week, and the five that do not are still GA rooms. Outside that
list, the booking count is the only evidence there is.

**Where the thresholds came from.** 3,000 m is not tuned to a building. The
furthest thing it keeps is Waterman at 2,599 m and the nearest thing it drops is
Outpatient Care East at 4,995 m, so it sits in a 2.4 km gap and moving it 20%
either way changes nothing. The engine's own `MAX_WALK` is 12 minutes, about
720 m, so the ranking could never have offered any of the three anyway.

`MIN_WEEKLY_MEETINGS` was measured at 2, 3 and 4. At 3 it drops 65 rooms and
**leaves every one of the 504 queries with an answer**; the best answer moved
further away in 4 of them, by one minute. At 2 the two-a-week departmental
conference rooms survive. At 4 it drops 98 and starts eating real classrooms.

**What it cost and what it bought.**

```
                                        before   after
  rooms in the shipped index               581     515   -11.4%
  buildings                                 78      68
  busy blocks                            9,561   9,462
  top-ten rows from a <=2/week non-GA room 15.9%    0.0%
  top-ten rows from a general assignment room 59.1%  65.8%
  top-ten rows from a 5K conference room   14.4%    3.8%
  queries with no answer at all                0       0
  index over the wire, gzipped         20.5 KB  18.9 KB
```

Every remaining room kept **every one** of its busy blocks: 9,462 against 9,462
once the deliberately dropped rooms are held out of both sides. So this is a
pure filter change and nothing else moved.

**The locked-door half of the complaint answered itself.** No hand-written list
of clinical buildings was added. The evidence rule alone removed Prior Hall
(College of Medicine), McCampbell Hall, Biomedical Research Tower and Outpatient
Care East, because a badge-controlled room does not host a teaching week. What
survives is six rooms in Davis Heart and Lung, Graves Hall, Veterinary Medicine
Academic, Waterman and the Edison Joining Technology Center, and every one of
them is in a building the Registrar publishes no hours for, which `tierOf`
already ranks below every room with real hours. Measured: **0 of 5,040** top-ten
rows came from an unknown-hours building.

**Decided against.** Adding those buildings to `data/restricted-buildings.json`.
That file's own header says it holds a judgement about access, not a measurement,
and it should stay small enough to read. A rule that removes the same rooms for a
reason that can be measured is worth more than eight more hand-written lines.

**The build guard had to learn the difference between a filter and a collapse.**
`scripts/lib/index-guards.mjs` refuses any build that loses busy blocks against
the committed file, because a harvest that silently drops a fifth of campus looks
like good news. Tightening the filter reads as exactly that failure: 66 rooms
losing all their blocks at once. `measure()` now takes an `exclude` set, and the
build holds the rooms its own filter named out of BOTH sides of the comparison.
Every other room stays under the full strength of the guard, so a harvest that
collapses in the same run still trips it.

---

## 2026-08-29  Two giant ovals, a sentence one word wide, and a dev mode

**What was reported.** A screenshot of the question screen with the wordmark
missing, "You are off campus, showing from the Oval" rendered one word per line
inside a pill, and two enormous rounded shapes where two buttons should be.

**Reproduced at 393x852 with the root font at 16px**, which is to say on an
ordinary phone with no accessibility setting touched. Off-campus, Saturday 03:00:

```
  button#ask-pick   229 x 371 px    border-radius 999px
  button#gate-go    208 x  96 px    border-radius 999px
  span#note-text     47 x 111 px    "You are off campus, showing from the Oval"
```

**Two causes, and the second one hid the first.**

`.opt` carried `flex: 1 1 6rem`. That is correct for `.opts`, the four-button
row, and wrong everywhere else: `#ask-pick` and `#gate-go` are `.opt` buttons
that are direct children of `#ask`, which is a **column** flex container. On a
column the main axis is vertical, so the `6rem` was a height and the grow factor
ate the rest of the column. `#cold .opt` in the same stylesheet already carried
`flex: none` for exactly this reason, so the shape of the bug was known and the
question screen was simply missed. Fixed by moving the flex to `.opts .opt` and
giving a standalone `.opt` `flex: none`.

`#note` is a fixed pill holding a sentence and a button. The button was
`flex: none` and the sentence was a bare `<span>`, so once the pair wanted more
than the pill's `max-width: 92vw`, every pixel of the shrink landed on the
sentence and it collapsed to its minimum content width. That made the pill 231 px
tall, and since it is `position: fixed; z-index: 3` over an `#ask` with no
`z-index` at all, it then covered the wordmark, the question, and the **1 hour**
button, which could not be tapped. Verified: a synthetic tap on
`.opt[data-min="60"]` did not reach it before the fix and does after.

**Decided.** The pill wraps (`flex-wrap`, `#note-text { flex: 1 1 12rem }`) so
the button drops to its own line instead of squeezing the sentence, and the
question screen carries the same sentence in its own column as `#ask-where`
rather than under a floating pill. `body.asking` hides the pill on the question
screen, with `#note.fatal` exempted, because the "could not load the schedule"
message has nowhere else to go.

---

**Dev mode, and why the clock had to move first.**

The three answers this project is proudest of are a refusal on Thanksgiving, a
refusal in exam week, and the buildings screen at 3am on a Saturday. None of them
could be looked at without waiting for the date. `js/state.js` was written so
every function takes its `now` as an argument, for exactly this reason, and
`js/app.js` was the hole: it called `new Date()` in **eleven** places.

**Decided.** One clock in `js/state.js`. `now()` returns the real date until
`pinClock(ms)` freezes it. All eleven call sites read it. It is imported into
`js/app.js` as `clockNow`, not as `now`, because six functions there already hold
a `const now` and importing it under that name is a temporal dead zone error at
the line that reads it: the app does not boot at all. That was found by making
the mistake.

Pinned, not offset. An offset keeps ticking, and a screen someone is reading
should not move under them.

`js/dev.js` is a panel with a datetime control, a time-of-day slider, ten one-tap
jumps and a dropdown of every building in the index. It moves the same clock the
app reads and sets the same origin the ranking measures from, then calls the same
`refresh()` a duration chip calls. It does not stub the ranking, inject rows or
carry a fixture, so what the panel shows is what the app does.

It is loaded with `import()` from `js/app.js` only when armed, and is absent from
the service worker's shell list, so a student who never types `?dev=1` never
downloads it. Checked by `scripts/test/dev.test.mjs`, which also fails if
`new Date()` reappears in `js/app.js`.

---

## 2026-08-29  Less is more: the day as a calendar, and 90 rooms nobody could get into

Six things, and four of them are one thing: the app was explaining itself
instead of answering.

**A door nobody documents is not offered at all.** The instruction was one line:
"if the hours of a place isn't published, don't include it, it's that simple."
It was not obviously simple. Those 90 rooms in 22 buildings were shipped on
purpose, in their own ranking tier, labelled `hours not published`, and the
honesty of that label was a thing this project was proud of.

The measurement settled it. Over 5,040 ranked rows from four origins across a
week, **zero** unknown-hours rooms ever reached a top ten, because `tierOf` puts
every published-hours room above every unknown one and there are 425 of those.
They could not be reached by ranking, and they cost four separate blocks of
prose across three screens to explain. So they are a build-time filter now,
beside the type filter and for the same stated reason: an unusable room should
be absent from the file rather than ranked low in a file anyone can read.

```
                                     before   after
  rooms                                 515     425
  buildings                              68      46
  rooms with no published hours          90       0
  ranked tiers the UI has to explain      5       3
```

The near screen was the reason to check twice. Deleting the unknown group only
from that screen would have left a dead band roughly 40 hours a week, between
midnight and 5am when `groups.open` is empty, showing a heading over a collapsed
row and silently dropping 22 buildings. Filtering at the source instead means
the screen is complete: everything it does not show is closed, and it says so.

**The buildings screen, by subtraction.** Gone: the "Nothing is scheduled right
now" heading and its paragraph, the `Open now` group label, `Registrar hours,
read Aug 26`, the classroom count on every row, `· open every day`, and
`open till 11:00pm`. What is left is a title, one sentence, and rows of name and
walk. The closed rows keep their door phrase, because inside a group already
labelled closed that phrase is the payload rather than a decoration.

One sentence survived on purpose. `An open building is not an unlocked room.` is
the only place on that screen that says so: `paintNear` renders no caveat, and
`#ask`, which carries the other one, is hidden behind it.

**The room screen is a calendar.** It used to be a list of rows that read
"7:00am free 7h00 / 2:00pm in use / 4:45pm free 3h45". Accurate, and nobody could
see the shape of a day in it. An empty-room app whose answer is the EMPTY parts
should draw the empty parts as empty space, and every word spent writing "free"
on a gap is a word spent describing white space.

The grid needed a fact the index did not carry, so the index carries it: each
busy tuple gained a fifth integer pointing into a new `courses` table, and the
room screen prints `PSYCH 6650  2:00pm - 4:45pm` on the block. Subject code and
catalog number, no section, no title, no instructor.

Getting the code took a re-harvest. `data/harvest-1268.json.gz` was built before
`collectMeetings` was fixed, so it carried `section.subject`, the display name,
where the Registrar and every student say `MATH`. 545 requests, converged in 4
passes, and 243 of 243 subjects now come back as codes.

```
  index, gzipped     19.4 KB -> 39.1 KB
  courses                    2,024 labels, 3.3 blocks per label
  blocks with no single course  547 of 8,329 (6.6%), drawn without a name
```

That is the largest single cost in this repo's history and it is the one the app
gets the most back from. `MIXED_COURSE = -1` is what a block gets when two
classes merged into it: naming either one would be a fact about a class that is
not the only class in that window.

**The sheet no longer resizes the map.** `viewport().band` tracked the sheet's
live height, and `band` feeds both the vertical centring and the zoom through
`Math.min(width, band)` in js/map.js, so pulling the sheet up zoomed the map out
and slid it upward under the thumb. It is pinned to the resting layout now, so
the sheet slides OVER a map that stays where it was. Verified: the map canvas is
byte identical with the sheet at 324px and at 700px.

**Setting your location by hand is a dev affordance.** The `from <building>` bar
cost a full row at the top of the most-used screen and existed to let you say
you were somewhere you were not. It renders only in dev mode. The one case a
real user needs it, a geolocation fix that never arrived, is still covered by
`Pick your building` on the question screen, which is where they already are
when it happens.

**`/dev` is a page, not a panel.** `dev/index.html` asks the two questions first:
what minute, and where are you standing. Tap the campus map to drop a pin
anywhere, or pick a building, or take one of seven jumps, then hand off to the
real app. It writes three sessionStorage keys and navigates; the app pins the
same clock every screen reads and the same origin the ranking measures from. The
in-app panel is still there for changing your mind without leaving.

Verified end to end in a real browser: drop a pin on the Oval, jump to
Thanksgiving, and the app comes up with `refuses to rank — Thanksgiving Day,
campus is closed  from a dropped pin`.

**What was NOT cut, and why.** Every `aria-label`, the `say()` live region and
the per-row spoken name stay at full length. The visible row is glyphs; the
spoken name is the only place it states its own caveat in words, and shrinking
the visible layer is exactly the reason the spoken one must not shrink with it.
`docs/a11y-contract.md` specifies the order.

## 2026-09-01  The ordinary night gets a sentence back, and it names the first door

Partly reverses **2026-08-29 Less is more** for the question screen only. That
entry cut the "Nothing is scheduled right now" heading and its paragraph and was
right to: both said the same thing and neither was what the reader wanted. But
the cut left `paintGate` borrowing the buildings screen's pair, so at 11:40pm on
a Monday the whole app was one card reading `Nearest buildings` over an empty
paragraph, above a button reading `Show nearest buildings`, inside an orange
border. Three ways of saying nothing.

The gate now says the minute in its heading and one line under it. Everything
that entry deleted from the *buildings* screen stays deleted, and the
per-building classroom count does not come back on either screen.

```
                 before                        after
  heading        Nearest buildings             Monday, 11:40pm
  paragraph      (empty)                       Classes are done for the day.
                                               Vacant ranks rooms again on
                                               Tuesday at 8:00am.
  button         Show nearest buildings        Show nearest buildings
  border         --warn (orange)               --line
```

**The line carries up to three facts, and every one of them is conditional on
something the app can check.** What the clock is doing, which door opens first,
and when the ranked list comes back. The last two are separate promises: on a
Saturday they are 49 hours apart, because the first door is 7:00am that morning
and the first ranked room is 8:00am on Monday.

**The day the list comes back is walked as a date, not looked up in a weekly
mask.** `busyDay.weekdays` is Mon-Fri counted off block totals with no calendar
in it, so reading it alone named days the app is already committed to refusing
on: 3,780 of the 94,665 gate minutes of Autumn 2026, 3.99%. 3,105 of those were
one weekend, every gate minute from Friday 20:15 to Sunday midnight promising
rooms on Labor Day; the rest were Veterans Day, Thanksgiving, and 2026-12-10, the
day after the last class of the term. `nextScheduled` now steps real dates and
asks `scheduleCoversDate`, which is the day half of `inScheduledHours` lifted out
of it: in term, not a day university offices are shut, not inside the exam
window, a weekday the schedule covers, and the schedule not gone dark. Seven days
and no further, so the weekday it names can only mean one date, and when there is
no such day it drops the clause rather than guessing. That is what the last day
of term now does. The test holds the answer against `resolveState`, which is a
different function reading a different thing, so the sweep is not the sentence
checking its own homework.

**No door clause while a door is open.** The buildings screen only ever printed
this sentence when `groups.open` was empty. The gate had no such guard, and named
the first door on 3,885 of the 6,405 gate minutes of a week with campus open
behind it, including 7:30am on a Tuesday with all 46 buildings unlocked, under a
button leading straight to a list of them. `openDoorCount` answers that without
an origin, because whether campus is shut is not a fact about where the reader is
standing, and a test holds it against `rankBuildings` over every minute of a week.

**A weekly hours table cannot see a holiday, so the calendar lives at the call
site.** `data/buildings-hours.json` carries seven `[open, close]` pairs per
building and `hoursFor` indexes it by weekday. On Thanksgiving that made the
buildings screen print `PAES opens at 5:00am` directly under its own heading
saying campus is locked, and on the Sunday before Labor Day it said the same
about the Monday. `firstDoor` in js/app.js drops the door when the day it lands
on is one the university closes, and both screens go back to
`Everything is closed right now.`

**A no-classes day is not an ordinary day whose classes are pending.** The
registrar publishes three of them in Autumn 2026, all weekdays the mask says yes
to, and `resolveState` already flags them and names them on the ranked screen.
The gate said the opposite on both sides of the day: "Classes have not started
yet" at 3am on Autumn Break, "Classes are done for the day" at 11pm. It now says
`Autumn Break. No classes are meeting today.`, the same words the ranked screen
uses on the same date. 705 gate minutes on each of the three, 2,115 a term.

**The heading is a live minute, so the screen has to be repainted like one.** The
old heading was the constant string `Nearest buildings` and could not go stale.
`visibilitychange` refreshed the list and the buildings screens only, and the gate
lives inside `#ask`: booted at 11:40pm on a Monday and brought back at 10:00am on
the Tuesday, the card was byte identical, still naming Monday night on a minute
the app was willing to rank. `paintGate` is idempotent and re-reads the clock, so
the fix is `'ask'` on that list.

**The day word is load-bearing.** Two adjacent sentences are read as one thought,
so a bare "and Vacant ranks rooms again at 8:00am" sitting behind "On Wednesday"
reads as Wednesday. The clause carries `today` when the door clause has named a
later day, and joins into one sentence when both land on the same date. On the
shipped table the `today` case is now unreachable, because a door is always open
in the window that used to produce it, so the test drives it from a door handed
in rather than looked up.

**Orange means a refusal, not a clock.** `#gate` wore `--warn` on every state it
can reach. Three of those are only the time of day: over the 6,405 gate minutes
of a week the screen produces `No classes are scheduled today.` on 2,880,
`Classes have not started yet.` on 2,400 and `Classes are done for the day.` on
1,125. `--warn` is what a missing fact looks like on every other screen.
`paintGate` now adds `.refusal` for the six branches `refusedState` dresses and
leaves it off for the night. The colours were read off the running app rather
than asserted: Labor Day at 2:00pm comes out `rgb(255, 176, 46)`, Monday at
11:40pm comes out `rgb(29, 35, 44)`. What the test holds is the rule that
produces them, that `#gate` itself is `var(--line)` and only `#gate.refusal`
reaches `var(--warn)`.

**The buildings screen says the door it already knew about.** Between midnight
and 5am `groups.open` is empty and the screen printed `Everything is closed right
now.` while holding all 46 opening times. It now reads
`Everything is closed. Independence Hall and 2 more open at 7:00am.` The bare
sentence is kept for an hours table with no doors in it at all.

`nextOpening` is location-free on purpose: three buildings open together at
7:00am on both weekend days and nothing in `js/state.js` knows where the reader
is standing, so it names the first the index reaches and the count carries the
other two. The buildings screen does know, and it is holding the closed list
sorted by walk, so it swaps in the nearest of the tied doors before it prints.
From the Thompson Library steps that is Independence Hall at 120 m rather than
Hitchcock Hall at 460 m, which was sitting 28 rows further down the same list.

**A sort key that never moves a row is decoration, so it was measured.** The
closed group breaks a walk tie on the next door to open. The key is the next one
and not `opensAt`, because an `after` row's `opensAt` is the minute it opened this
morning and then locked, so keying on that sorted a building shut for the rest of
the day above one still to open. Over a 12x12 grid on the campus box at every
quarter hour of every day, 2,984 of 96,768 closed lists (3.08%) come out in a
different order and no row moves more than one place. The commonest case is Hayes
Hall over Derby Hall, 240 of them, 120 at each of the two grid points where the
walk ties: at 2,492 m from the middle of the box both are a 42 minute walk, and
Hayes opens 6:00am against Derby at 7:00am. The figures are asserted in
`scripts/test/screens.test.mjs`, not left in a comment to rot.

**A heading is not a control.** `focusHeading` moves focus to an `h2` so the
reader lands on the new screen. A script focus is scored with the modality of the
last real input, so a heading reached from the keyboard matched `:focus-visible`
and wore the 3px ring meant for buttons. Measured headless on main: the buildings
heading reached by mouse comes out `outline: none`, the same heading reached by
Tab comes out `outline: solid 3px`, and the Sources heading behaves the same way.
`focus({ focusVisible: false })` is `none` on both routes. The `h2[tabindex="-1"]`
rule in index.html is the same answer for an engine that has not implemented the
option and drops it in silence.
---

## 2026-09-01  The ranked list gets a walk bound and a per-building cap

**The walk bound never ran.** `MAX_WALK` is 12 minutes and `query()` applies it,
but the app calls `rank()`, which is documented as having no ladder and no
radius. So from a downtown origin, 4.42 km out, the list came back with Pomerene
Hall on row one at a **71 minute walk** and the last of the 40 rows at 77. That
is issue #60. The bound now lives in one new pure export, `shape()` in
`js/engine.js`, and `answer()` is the only caller.

`rank()` was deliberately NOT given a radius. `state.soonest`, the room that
names the first building to open, is read off the unfiltered rows, and a bound
applied upstream would have let the app print "nothing is open" over rooms that
are free further out.

The two changes here meet: at 4.42 km the downtown origin is now past the gate,
so it falls back to the Oval and gets a walkable list rather than an empty one.
The empty screen is what an origin **inside** the gate with nothing walkable
gets, and there is one: 39.98319, -82.99864 is 2.18 km out, and at the same
minute it holds 301 rooms free with the nearest a 34 minute walk. Driven in a
real browser, it reads `Nothing close enough. Nothing within a 12 minute walk is
free. 301 rooms are free further out, the nearest a 34 minute walk to Sullivant
Hall.` Before this it read 40 rows starting at a 34 minute walk with no note at
all.

**One building was eating the fold.** Walk is cached per building, so every room
in one building carries the same walk and `compareRows` hands them back
consecutively. Measured from the Oval every half hour Mon to Fri 2026-09-14 to
18 at a 30 and a 60 minute ask, over the 406 samples that had any rows: 37.1
rows across 9.2 buildings, longest same-building run 11.5 rows, and at 20:00 on
the Friday 28 consecutive rows were Enarson. That is issue #62.

**The cap adapts, and a flat one was rejected on the numbers.** A bare one room
per building leaves under ten rows in **22.2%** of those 406 samples, which is
the thin hours, exactly when a student most needs a second option. So the cap is
1 while ten or more buildings clear the walk bound, 2 from five to nine, and off
below five. That brings the under-ten share to **1.5%**. The floor is a night
guard rather than a general one: all 54 samples holding fewer than five
buildings fall between 11pm and 6am.

```
  From the Oval, 12 weekday samples, 30 minute ask   before   after
  rows shown                                          40.00   37.83
  distinct buildings in the top ten                    2.42   10.00
  longest same-building run                           10.00    1.00
  share of the shown list repeating a building        70.2%    0.0%
  mean walk of a shown row, minutes                    4.55    6.15
  usable minutes across the top ten                  2472.4  2858.9
  row one identical to the ranking                     12/12
```

Row one never moves. `shape()` reorders nothing and rescores nothing; it removes
rows and hands the rest back in the order they arrived.

**`OFF_CAMPUS_KM` is 2.2, and it stopped claiming to know where campus ends.**
The old 8 km was not a measurement of anything. The farthest building holding a
ranked classroom is Animal Science at 1.410 km from the Oval, `MAX_WALK` reaches
0.720 km of straight line, so nothing on campus is walkable past 2.130 km;
sweeping 360 bearings out of the Oval in 10 m steps lands on the same figure.

The sentence changed with it. `You are off campus, showing from the Oval` is a
claim about geography the shipped building table disagrees with: seven of the 96
buildings in `data/buildings-1268.json` sit outside 2.2 km and all seven are OSU
property, the four farthest being Waterman at 2.75 km, Outpatient Care East at
4.84 km, Knowlton Executive Terminal at 9.93 km and Aerospace Research Center at
10.01 km. A student standing on OSU property was being told they were not. It
reads `Nothing on campus is walkable from here, showing from the Oval` now.

**The footer stopped lying.** `N more further away` described rows that were, in
the main, the same building at the same walk as a row already on screen: 70.2%
of the 40 shown repeated a building. `shape()` returns the two counts apart and
the footer spends both.

---

## 2026-09-01  Corrections to the walk bound, and the empty screen stops saying free

Four numbers in the entry above do not survive re-measurement, and two screens
the bound created were wrong in ways the entry did not see. The entry stands as
written, because this file is append only. This is what replaced it.

**The empty screen called a busy room free.** `shape()` built `beyond` out of
rows that had cleared a 90 minute wait, so a room in it could be one that does
not open for another hour and a half, and `nearest` was picked on walk alone.
Driven in a real browser at 2026-09-15 09:00 from 40.0175, -83.013, 1.998 km
out: `148 rooms are free further out, the nearest a 25 minute walk to Schoenbaum
Hall`. Schoenbaum Hall opened at 10:55am, and 51 of the 148 were not free. The
example quoted in the entry above does it too: 301 rooms at 39.98319, -82.99864,
and 121 of the 301 have a wait. At scale, over 399 origins inside the gate x Mon
to Fri 2026-09-14 to 18 x 30 minute steps inside 08:00 to 20:15 x asks of 30, 60
and 120, 94,748 of these screens appear and **94,469 of them, 99.7%, printed a
count holding rooms that were not free**.

`shape()` now splits the rows past the bound on `wait === 0`, the same word the
list rows and `settle()` already use, and the screen spends the two apart:
`beyond.count` and `beyond.nearest` are free right now, `beyond.waiting` is the
rest and the sentence for it says when the room opens. Re-run over the same
94,748 screens: **0 print a count holding a room that is not free, and 0 name
one**. The live region moved with it. It read `297 rooms free, 0 shown` under a
heading that said `Nothing close enough.`; a screen with no rows now says its
own sentence, and a screen with rows counts only the rooms that are free. That
is the 141 in the README becoming 117.

**Inside the gate, nothing walkable was a dead end.** `locate()` decided the
Oval fallback on distance from the Oval, but the question that matters is
whether anything is walkable from here, which `shape()` answers exactly. Wed
2026-09-02 14:10, 30 minute ask, two origins 20 m apart on one bearing: at 2.190
km the screen had no rows and its only controls were Check again, What Vacant
knows and the four duration chips, none of which can change a walk; at 2.210 km
the same situation crossed the gate, fell back to the Oval and got 40 tappable
rows. Over 17,905 origins on a 0.0003 lattice inside the gate at Wed 2026-09-16
14:10, **11,234 of them, 62.7%, got a screen with no rows and no way to act**,
0% at 0.00 km rising to 96% at 2.00 to 2.25 km, the closest 0.878 km out. Three
classroom-pool buildings sat in it all day: Rightmire Hall, Pressey Hall and
Sherman Studio Art Center.

`answer()` now asks the predicate rather than the circle. A located origin with
nothing walkable falls back to the Oval and says so, which is what the origin
20 m further out already did. `OFF_CAMPUS_KM` stays as the cheap first cut. A
building picked by hand keeps its coordinates, because moving off it answers a
question the student did not ask; it gets the note instead, and the note is what
carries `Pick a building` onto the screen. Driven through the real app, the same
17,905 origins now give **0 screens with no rows and 0 dead ends**, and standing
on Rightmire, Pressey and Sherman at 9:10, 14:10 and 19:10 gives a list at all
nine.

**The note stopped claiming to know where campus is.** `Nothing on campus is
walkable from here` is a claim the building table disagrees with: up to three
other buildings in the term slice sit within a 12 minute walk of one of the
seven outside the gate. What the 2.130 km derivation supports is the narrower
claim, that not one of them holds a room the ranking can offer, and
`scripts/test/screens.test.mjs` recomputes that rather than trusting the
sentence. Both screens read `No classroom close enough to walk to` now, with
`, showing from the Oval` on the end when the app moved you. Measured at
393x852: pill 197x126, sentence 167x56 over three lines, nothing over the
wordmark.

**The cap's numbers were taken in hours the app refuses to answer.** The 22.2%
and the 13.3% above reproduce exactly, and both are measured over 24 hours a
day. `inScheduledHours` only lets the list paint Mon to Fri between 08:00 and
20:15, so 156 of those 406 samples, 38%, are minutes nobody is ever shown, and
they carried the whole argument. Restricted to the 250 the app paints, a flat one
room per building leaves under ten rows **0.0%** of the time and **0.0%** of
those lists hold fewer than five buildings. The sentence calling the floor `a
night guard rather than a general one` is backwards twice over: it never fires
at night because the app does not rank at night, and over 36,594 in-gate lists
inside scheduled hours the old floor fires on 59.2%.

Choosing the cap off the building count also made the list non-monotone. Fri
2026-09-18 from the Oval at a 30 minute ask: 20:13 showed 10 rows over 116
walkable rooms in 10 buildings, and 20:14 showed 17 rows over 100 rooms in 9.
Sixteen fewer rooms free and the list grew 70%. So the rows are chosen by the
list they make rather than by a number: pass one is every building's best room,
later passes top the list up to `SCREEN_ROWS` and stop the moment it gets there.
That is monotone by construction and it removes both thresholds. Minute by
minute from the Oval over Mon to Fri 2026-09-14 to 18 at asks of 30 and 60,
7,350 minutes each: the fold grew the screen as campus emptied **twice before
and never after**, and the six remaining minutes where the screen grows are a
building entering the bound, which is a real answer arriving.

`SCREEN_ROWS` is 10, and it is measured rather than picked: at 393x852, the
device the screenshots are taken on, the sheet dragged to its tallest holds 9
rows at once, so ten is the first count that leaves something under the fold.

**The 12-sample table could not be re-run.** It named no dates, no clock times
and no grid, and no natural set of twelve reproduces it. Here it is on a grid
named to the day. From the Oval, every half hour from 08:00 to 20:00 on the 22
September 2026 weekdays, at a 30 minute ask, 525 samples:

```
  From the Oval, 525 weekday samples, 30 minute ask   before   after
  rows shown                                           40.00   36.48
  distinct buildings in the top ten                     2.99   10.00
  longest same-building run                             9.38    1.00
  share of the shown list repeating a building         69.5%    0.0%
  mean walk of a shown row, minutes                     4.53    6.24
  usable minutes across the top ten                   2480.3  2778.2
  row one identical to the ranking                   525/525
```

The 70.2% in `js/app.js` and in the entry above is that 69.5%, on a grid that
replays.

**The walk spike was measuring the old app.** `spikes/walk.html` labelled a row
shown by `appRank <= 40`, which was exact while `js/app.js` did
`usable.slice(0, 40)` and stopped being exact the moment `shape()` landed.
Measured over the same 406 samples: of the 15,078 rows in `rank()`'s first 40
only 4,768 reach the screen, and of the 12,759 rows that do reach it 7,991 rank
past 40. The spike now builds its shown set from `shape(usable).rows`, and over
69,552 pool rows it disagrees with the app **0 times**, against 16,454 before.

**Two smaller corrections.** The 360 bearing sweep does not land on 2.130 km at
10 m resolution; it agrees to within one step, with the last walkable point
2.130 km out at bearing 288 along the bearing and 2.123 km by the gate's own
crude conversion. And `distanceMetres` is equirectangular, not haversine;
haversine is only the reference the tests check it against.
## 2026-09-01  A start that cannot finish says so, and a picked origin can be undone

**The `from <building>` bar comes back, for two origins out of three.** The
2026-08-29 entry above cut it to dev mode because it cost a full row at the top
of the most-used screen. That still holds for a phone that answered with a real
position, and that phone still never sees the bar: measured at the shoot's
pinned minute on a 393x852 screen, the first row of the ranked list sits at
y 555 with 40 rows on both branches. It renders for the two origins the app
chose FOR the student. A picked building was permanent and invisible: it
survived every visit in `vacant.origin`, and `origin-clear` was already wired to
a working handler inside a row nothing ever showed. Tapping the X now re-ranks
with no reload: at the shoot's pinned clock and position, with McCampbell Hall
picked and the 2 hour ask, the first row stays `Psychology Building 115` and its
walk goes 11 min to 3 min. Focus follows whichever control survives the tap,
because the X always goes and the row it sits in only goes when a real position
came back: measured with geolocation working the row leaves and focus lands on
Back, and with it denied the row stays reading `from the Oval` and focus lands on
the row's own button. Guarding on the row instead put focus on `document.body`
on the second of those, which is the branch a picked-origin user is most likely
to be on, since the reason to pick a building is that the phone had no fix.

**A boot that cannot finish gets the refusal card, not a floating note.** The
old catch wrote one sentence into `#note` and left four dimmed duration buttons
under a spinner that never stopped. Measured against a server answering 503 for
the room index: the app reached `ready` and blamed its own weekly build, because
`fetch` resolves on a 5xx and the body `503` is valid JSON, so `state.rooms`
became the number 503. Non-ok responses now throw, and the catch refuses in
`#gate`, the card every other refusal already uses, with `Try again`. Decided
against a second `boot()` behind that button: boot starts a render loop and a
position request, and running it twice on one page is not a state this app has.
`js/firstrun.js` raises its own card for the same dead network, and which of the
two gets there first changes run to run: measured 3 of 5 runs on a refused server
and 2 of 3 on a stalled one. Two refusals stacked put the buried one under an
`aria-modal` card, with its button still in the tab order, so each stands down
for the other. The first-run card wins the tie, because its `Try again` re-probes
where `#gate`'s reloads.

**One measured deadline on everything the first answer waits on.** A network
that stalls instead of failing never rejects, so the app sat on it for the
length of the visit: measured at 3, 8, 15 and 25 seconds against a server that
accepted every request and answered none, the screen still said `finding
campus...` over four disabled buttons. `NETWORK_TIMEOUT_MS` is 20 s, and it is
measured, not picked. Over CDP `Network.emulateNetworkConditions` with the
service worker out of the way, the 379,144 bytes `boot()` reads uncompressed off
a local server took 9.59 s at Chrome's Slow 3G preset (51,200 B/s, 2,000 ms
latency) and 2.69 s at Fast 3G, worst of five runs each. Pages gzips those same
five files to 85,151 bytes, so the deployed load has more room than that figure,
not less; the local one is the pessimistic side and that is the side to be on. Decided against 8 s, which would have cut that
Slow 3G load off with 1.6 s of its download still to come. A deadline shorter
than a load that is working turns a slow connection into a false "no
connection", which is this app's own lie pointed the other way.
## 2026-09-01  The sheet stops covering the question, and the room screen frames its own band

**The install rail carries the sheet, it is not paid for out of it.**
`body.has-bar` padded `#list` and `#room`. Those are panes INSIDE `#sheet`, and
the duration chips are the pane's sibling below it, so they moved nowhere: with
a bar up, `elementFromPoint` at the centre of all four chips returned an element
inside `#bars` in all 36 rail cases measured, six sizes from 320x568 to 430x932
plus landscape 667x375, at root 16, 20 and 32, with one bar and with two.

Padding `#sheet` instead moves the chips but spends the answer on them. `#sheet`
is border-box with a pixel height from `setSheet`, so the padding comes out of
the pane rather than raising anything: at 375x667 with both bars `#list` went
165 px to 18 px with no whole room left on it, and on Thanksgiving it cut the
refusal sentence to 35.5 of its 101.3 px. `bottom: var(--bar-h)` stands the sheet
on the rail. Over the same 36 cases the chips are hittable in 33, the readable
strip of the ranked list is never smaller than main's and is larger in 32 of
them, and the sheet's rendered height matches the height `setSheet` gave it in
all 54 cells rather than outgrowing it by up to 546 px.

The `padding-bottom` goes with it, because `#bars` already carries
`padding-bottom: var(--safe-b)`. With `--safe-b` forced to 34 px at 393x852 the
old rule counted the home indicator twice and left a 34.9 px dead gap above the
rail. It is 0.9 px now.

The 3 of 36 that stay unhittable are the ones the sheet cannot reach: at root 32
the install hint alone is 529 px on a 568 px screen, 612 on 640, and 761 on 568
with both bars, so the rail's own top edge lands at y 39.4, 28.5 and -192.1 and a
97 px row of chips has nowhere above it to be. The rail is what is too tall
there, and main is 0 of 4 in those cells as well.

**Only the grip can throw the answer away.** The dismiss was 44 px below peek and
every pointerdown on the sheet could reach it. 44 px does not fire it, measured
on main at 393x852 where the sheet went 324 to 324; 60 px does, and a 60 px pull
on a row at the top of the list, where the pane has nothing left to scroll so the
gesture turns into a sheet drag, ended on the question screen with the list, the
selection and the scroll position gone. A drag that starts on a pane now bottoms
out at peek, and the grip has to be pulled through the whole 88 px below peek
before a release means anything. Driven at 393x852 on the fix: 60 px on the grip
keeps the answer, 100 px throws it away, and a pull from a row leaves the sheet
at 324 whatever the distance.

`showAsk()` was NOT touched. js/app.js documents that dismiss as the same action
the back arrow fires, so teaching it to keep `state.listScroll` would have
redefined the back arrow with it. Only the trigger narrowed.

**The map's band belongs to the screen, not to the sheet.** `viewport()` held a
second copy of the resting height that said peek on every screen, so the room
screen composed the walk line for a 324 px sheet and then drew it under a 613 px
one. Measured off the canvas at 393x852, 164 of the 206 px of target ink came out
under the panel and 0 of 122 does now; 77.8% at 375x667 and 80.7% at 430x932 both
go to 0 as well. `REST` is where each screen's resting height is written down and
`bandFor` is the only thing that turns it into a band.

`bandFor` takes the rail off as well, because the rail now stands the sheet up
and the map has that much less. Left out, the room screen with both bars up put
112 of its 122 px of walk line straight back under the panel, which is the
defect this whole section exists to delete. It costs a live re-compose: mounting
one bar at 393x852 moved the list frame from y 197..402.5 to y 157..362.5, and
the second bar to y 126..325, each while a bar was animating up under it.

**A height belongs to a screen too.** `sheetHeight()` kept whatever height was on
the sheet, so leaving a room held its 613 px while `viewport()` had already moved
to the list's 528 px band. That is the same second copy one screen over, and it
shipped a camera jump: the band flipped 239 to 528 with `state.view` untouched
and the walk line stretched 1.69x under the Back tap. `openAt` hands a screen its
own rest whenever the height came from somewhere else, and `showPane` re-composes
on arrival. Driven at 393x852, the list frame after Back is now the frame the
list had before the room was opened, walk line at y 197..402.5 either side with
none of it behind the panel, and the same holds at 375x667 and 430x932.

**js/sheet.js.** `PEEK`, `FULL`, `ROOM_SHEET`, `REST` and the 88 px live in their
own module now, with the five derivations over them, so the suite can check the
numbers instead of the spelling. Fifteen mutations were applied one at a time to
a copy: `ROOM_SHEET = 0.50`, `room: PEEK`, a flat `restFor`, a band with no rail
in it, `viewport()` deciding the band itself, `DISMISS_PX = 44`, the drag floor
back to main's, the per-gesture floor dropped, the release comparison back to
`<`, the gesture no longer asking js/sheet.js, three ways of paying for the rail
out of the sheet, a height carried between screens, and no re-compose on a screen
change. Every one of them turned the suite red. `FIT_PAD` 0.18 to 0.14 was run
as a control and stays green, which is right: it is a fit constant, not a band.

The cost, taken deliberately: the band is keyed to where the screen RESTS and not
to the sheet's live height, so a room sheet dragged back down to peek uncovers
528 px of map with the target still composed for the 239 the screen rests at,
framed high rather than centred. Keying it to the live height is the bug the
entry above fixed, where the map zoomed out and slid upward under the thumb every
time the sheet moved. scripts/test/map.test.mjs builds its two fixtures out of
`bandFor`, so moving where a screen rests moves that assertion with it.
## 2026-09-01  The maps hand-off stays, stops being a `geo:` URI, and #52's line is struck

**Decided.** The room screen keeps its one control that leaves the app, and that
control now opens walking directions instead of dropping a pin.
[#52](https://github.com/EnesYilmazcode/Vacant/issues/52) said the opposite, in
writing, with a done-when of `grep -c 'Open in Maps' js/` returns 0. This entry
reverses that line for this one button. The rest of #52 stands: no calendar
button, no share, no favourite, no second row of controls.

The reason is [#44](https://github.com/EnesYilmazcode/Vacant/issues/44). Vacant
draws a straight dashed line to the building and refuses to call it a route,
because there is no offline routing engine here and there will not be one. That
refusal reads as honesty only while there is a visible way out to something that
does route. Take the button away and "we will not route you" quietly becomes "we
cannot route you and we will not tell you where to go either", which is a
smaller app wearing a principle. The line itself is untouched and #44 stands.

**The button did nothing on an iPhone, for its whole life.** That is the fact
that settles it rather than the argument.
[#18](https://github.com/EnesYilmazcode/Vacant/issues/18)'s spec asked for a
`geo:` URI and `js/app.js` shipped one. Apple has never registered a handler for
`geo:`, on any iOS version; Apple's own Map Links reference documents
`maps.apple.com` and lists no `geo:` anywhere. An anchor pointing at a scheme
nobody claims raises no error and performs no navigation, so the failure is
completely silent, which is why it survived a screenshot, a review and a
release. On the one platform `js/install.js` exists to serve, the button was
furniture.

Driving the real app headlessly at Wed 2026-09-16 10:20 from the Thompson
Library steps, four user agents, reading the anchor back out of the room screen:

```
before, every platform, iOS included
  geo:39.99852017,-83.01626613?q=39.99852017,-83.01626613(Psychology%20Building)

after
  iPhone, iPad, Chrome-on-iOS, an iOS webview
    https://maps.apple.com/?saddr=39.99944,-83.01502&daddr=39.99852017,-83.01626613&dirflg=w
  Android, Mac, Windows
    https://www.google.com/maps/dir/?api=1&origin=39.99944,-83.01502&destination=39.99852017,-83.01626613&travelmode=walking
```

**The chain is decided when the screen renders, not when the button is tapped.**
[#86](https://github.com/EnesYilmazcode/Vacant/issues/86) asks for a ranked chain
that falls through on failure. An anchor carries one `href`, and a scheme with no
handler fires no event to fall through on, so there is nothing to catch and
nothing to retry. The ranking therefore happens in `mapsHref` in `js/install.js`,
beside `isIOS`, because the whole question is which platform is asking.

Both branches are `https`, so neither can land nowhere. On iOS and Android the
OS claims the URL and opens the app without a request going out; a browser with
no map app gets a working web route instead. Checked against the live hosts on
2026-09-01: `maps.apple.com` answers the `saddr`/`daddr`/`dirflg=w` form with a
redirect to `/directions?mode=walking&source=...&destination=...` and a page
titled "Get Directions: Driving & Walking", which is how we know Apple still
parses those parameters rather than ignoring them, and
`google.com/maps/dir/?api=1` answers 200 with and without an origin.

**`geo:` is gone entirely, including on Android.** #86 ranked keeping it there as
option 3, since it is the correct Android intent and respects whichever map app
the student already chose. It is dropped anyway, because `geo:` has no notion of
a destination or a travel mode: `geo:lat,lon?q=lat,lon(Name)` is a pin, and a pin
is the thing the in-app highlight already does, offline, better. A button whose
whole justification is "there is an exit to something that routes" cannot hand
over something that does not route. Android link handling is per app in Settings,
so the student can still take the Google link somewhere else.

**The route starts from the student only on a real GPS fix.** `state.origin`
carries three shapes: a `gps` fix, the Oval fallback when the fix fails or the
student is off campus, and a building they picked by hand. Only the first goes in
as `saddr` or `origin`. A route from the Oval to a building 200 m away, handed to
someone standing in Baker, opens with a first instruction that is wrong, and a
wrong first instruction is worse than letting the maps app start from wherever it
thinks you are. Verified by pinning the location to Cleveland, which trips the
off-campus branch: the anchor comes back as
`https://maps.apple.com/?daddr=40.00052277,-83.01443196&dirflg=w`, with no
`saddr`.

**The label changed with it.** "Maps" is a place; "Directions" is what happens
when you press it. The accessible name says the rest, since this is the one
control on the screen that leaves: "Walking directions to University Hall, in
your maps app". `docs/research/icons-and-a11y.md` already asked for that.

**#52's done-when is struck and replaced with two tests.** `grep -c 'Open in
Maps' js/` returned 0 at ccd4db5 while the button was still on screen, because
that commit shortened the visible label to "Maps". The check reported the feature
gone and the feature was not gone, which is what
[#78](https://github.com/EnesYilmazcode/Vacant/issues/78) is about: a checklist
that greps wording measures the wording. `scripts/test/install.test.mjs` now
greps the capability instead. One test fails if any `geo:` URI comes back into
`js/`, one fails if the room screen builds a maps URL by hand rather than through
`mapsHref`, and four more pin which host, which walking flag and which origin
each platform gets.

**Cost.** 1,082 bytes gzipped on the shell, measured per file: `js/install.js`
3,937 to 4,820, `js/app.js` 27,950 to 28,149. No new file, no new module in the
worker's asset list, nothing added to the boot path.

**What is not measured, and it is the important one.** No real iPhone was
involved in any of this. The `geo:` failure is read off Apple's documentation and
the absence of any handler, and the replacement is read off the live hosts and a
headless Chrome wearing an iOS user agent. Two things still need a phone:

- whether `https://maps.apple.com/...` opens Maps from a home-screen window
  rather than navigating the standalone window away from the app, since a
  standalone window has no address bar to come back with. `geo:` could not fail
  this way because it never navigated at all, so this risk is new
- whether Android hands the Google link to the installed app rather than the
  browser, on a phone where Google Maps is not the default

**What would reverse this back.** A phone showing that the hand-off traps a
student in a standalone window, or lands them on a web page instead of an app.
Then #86's option 4 wins, the button goes, and #78 closes as "removed" with #52
restored intact rather than struck. Nothing else reopens it: the in-app line
answering "where is it" offline was always true and was never the argument.
---

## 2026-09-02  The position is followed while you walk, and the list is gated so it cannot re-sort under a thumb

**Decided.** `navigator.geolocation.watchPosition` starts once the boot fix has
landed, and every position it delivers goes through the same `useOrigin` and
`refresh()` path the app already had. [#87](https://github.com/EnesYilmazcode/Vacant/issues/87)
option 1. Before this the app asked the phone where it was exactly once, at
launch, and ranked every answer for the rest of the session from that point: the
product is one number, `usable = window - walk - packup`, and the walk was
measured from a place the student leaves the moment they set off toward the room.

**What the walk is gated by.** Two thresholds, both in `js/state.js`:

- `FOLLOW_M = 40`. A position nearer than this to the last one acted on is
  dropped. 40 m is 0.51 minutes at the engine's `WALK_MPM` of 78, so no figure on
  screen can be a whole minute stale inside it, and it sits under the `COARSE_M`
  of 75 at which the app already stops quoting a plain number and starts printing
  "~4 min". Above that line it would be re-ranking on the difference between two
  readings of one spot.
- `FOLLOW_MS = 15000`. A floor on how often a re-rank may happen at all, for the
  stationary phone whose readings wander. Somebody actually walking covers 40 m
  every 31 seconds at that pace, so it costs a walker at most one fix. **This
  number is not measured.** It is the one that would move if the battery run
  below were ever done.

**What the repaint is gated by, and this is the part that took the work.**
`refresh()` carries its own rule — *a list that re-sorts under a thumb loses the
row somebody was reaching for* — and a watch is exactly the thing that breaks it.
`followAction()` in `js/state.js` is the whole gate, and the order of its tests
is the rule:

| on screen | what a fix does |
| --- | --- |
| a building picked by hand | nothing. The watch closes. A deliberate choice is not a sensor reading and does not expire |
| a finger down on the sheet | the dot and the line move. The order stands |
| a room open | the walk minutes and the claim's "yours for" duration are redrawn in place. The ranking behind it is not touched |
| a row selected | the dot and the line move. The order stands |
| the list scrolled below the top | the dot and the line move. The order stands |
| the picker or the about pane | the dot moves. `answer()` would reframe the camera and repaint a list nobody can see |
| an idle, untouched list, the buildings screen, or the question | re-ranked |

The dot and the line cost nothing to move: the render loop reads `state.origin`
every frame, so a held fix has already moved both by the time the gate is
consulted. What is gated is only who may re-order.

**Decided against.** #87's option 2, a fresh `getCurrentPosition` on foreground
return only. It is most of the value for a fraction of the risk and it remains
the fallback if a phone says the watch costs too much, but it does not fix the
case the app is actually used in: open in your hand, walking. Option 3, marking
the walk times as approximate instead of fixing them, was ranked below both in
the issue and makes the student do the work.

**Three things that did not change, deliberately.** `enableHighAccuracy` stays
`false` on both the boot fix and the watch: high accuracy is what holds the GPS
chip awake, and ranking by walk minutes across a campus 2.2 km wide has never
needed 5 m. `pickedOrigin()` still short-circuits before geolocation is asked at
all. And `refresh()` is still never on a timer — the watch is driven by the
phone's position, not by a clock, and `scripts/test/follow.test.mjs` fails if a
`setInterval` or a `setTimeout(refresh)` appears in `js/app.js`.

**One thing that did.** `maximumAge` is 0 on the watch where the boot fix keeps
60 s. A cached minute-old position is worth having on the path to the first
answer, where the student has not walked anywhere yet; on the watch it is 78 m of
walking, nearly two `FOLLOW_M`, which is the exact staleness being removed.

**The off-campus circle moved.** `OFF_CAMPUS_KM` ran inside `locate()` and
therefore only on the first fix, so a student who walked out of it with the app
open kept a ranking measured from the last point inside and never saw the note.
It is now `offCampus()`, called from the boot fix and from every accepted
position.

**Cost.** `js/app.js` 32,495 to 35,735 bytes gzipped, +3,240 on the shell, which
is mostly comment: the logic is about twenty lines. The whole shell is 87,588
bytes gzipped and `sw.js`'s header figure was re-measured with it (gzip 1.12,
same `-9`). No new module,
nothing added to the worker's asset list, and nothing added to the boot path —
the watch starts after the first fix rather than beside it, because two position
callbacks racing to be the first origin is two answers to the question the app
opens with.

**What is not measured, and it is the done-when this entry cannot close.** The
issue asks for the battery cost of a 15 minute walk with the app open, measured
on a real phone, written down here. **No phone was involved in any of this and no
battery measurement exists.** Nothing below has been observed:

- what a coarse watch actually costs over a quarter of an hour of walking
- whether an installed iOS PWA holds the watch at all, which is
  [#5](https://github.com/EnesYilmazcode/Vacant/issues/5), and whether it
  survives the standalone window being backgrounded and returned to
- how often a phone standing still crosses the 40 m line in practice, which is
  the number `FOLLOW_MS` was guessed against
- whether the room screen's repaint is invisible to a reader, or whether the
  scroll and focus restoration in `repaintRoom` shows

`scripts/test/follow.test.mjs` is the evidence that exists instead: 25 tests, one
per gate, each checked to go red when its gate is deleted.

**What would reverse this.** A phone showing the watch is expensive, or an
installed iOS window that cannot hold one. Then the watch goes, #87 closes on
option 2 — a fresh fix folded into the foreground-return `refresh()` — and this
entry gets a successor saying so. `followAction()` survives either way: option 2
lands on the same gates.
