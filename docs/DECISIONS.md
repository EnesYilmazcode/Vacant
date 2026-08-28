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
