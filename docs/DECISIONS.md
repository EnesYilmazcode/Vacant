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
