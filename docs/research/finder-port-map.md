# Porting Finder into Vacant

What to copy out of [Finder](https://github.com/EnesYilmazcode/Finder), what to change, and what
to leave behind. Written 2026-08-26 against Finder at commit `203d4d8`.

Everything numeric below was measured, not reasoned about. The commands are in
[Appendix A](#appendix-a-what-was-run). 41 HTTP requests total against
`content.osu.edu`, sequential, 800 ms apart.

---

## The one thing to read if you read nothing else

**A complete, healthy harvest already reports 81% of the campus as free.** Measured across
Mon-Fri 08:00 to 22:00 in 30 minute steps over 290 rooms, 81.0% of (room, minute) cells carry no
class. So "this room is free" is the default answer, and a harvest that silently loses busy blocks
does not look broken. It looks like good news.

A run that dropped 20% of its busy blocks would lose at most 18 rooms out of 290, because only 18
rooms have a single block all week. That is a 6.2% drop in room count, which sails under Finder's
10% `MAX_DROP` and ships.

**So Vacant's refusal guards must be keyed on busy blocks and busy minutes, not on room count.**
Room count is necessary and nowhere near sufficient. Finder's guard file is the right pattern and
the wrong metric.

```
   Finder's failure                  Vacant's failure
   ----------------                  ----------------
   rows go missing                   busy blocks go missing
        |                                 |
        v                                 v
   the picker is short                the grid says "free"
        |                                 |
        v                                 v
   student notices                   student walks to a locked
   a course is absent                room, or into a lecture
        |                                 |
        v                                 v
   ROOM COUNT catches it             ROOM COUNT DOES NOT CATCH IT
                                     block count does
```

---

## Port verdicts

| File | Verdict | Reason |
|---|---|---|
| [`scripts/guards.mjs`](../../../Finder/scripts/guards.mjs) | **COPY AS IS** | Pure functions, zero Finder-specific knowledge. Every threshold is passed in by the caller. Copy the file byte for byte and add Vacant's own guards beside it. |
| [`scripts/fetch-courses.mjs`](../../../Finder/scripts/fetch-courses.mjs) | **COPY AND MODIFY** | The harvest skeleton is exactly right and the projection is entirely wrong. Keep the walk, replace what it collects. See below. |
| [`js/api.js`](../../../Finder/js/api.js) | **DO NOT COPY** | It is a live search client for one student typing one query. Vacant never queries at runtime, it reads one static file. Two functions get lifted out; the other 200 lines are dead weight. |
| [`js/format.js`](../../../Finder/js/format.js) | **COPY AND MODIFY**, two functions only | `isOnlineMeeting` and its `buildingOf` helper port as is. `distinctMeetings` ports with a changed key. Everything else is course-search UI. |
| [`js/filters.js`](../../../Finder/js/filters.js) | **COPY AND MODIFY**, one function | `toMinutes` is the whole point of the file for Vacant. Verified against 1813 real meetings with zero parse failures. |
| [`package.json`](../../../Finder/package.json) | **COPY AS IS** (rename) | 10 lines, `node --test`, zero dependencies. Change `name` and `description`. |
| [`docs/osu-api.md`](../../../Finder/docs/osu-api.md) | **COPY AND MODIFY** | Half of it is load bearing for Vacant and half is about GE browsing and instructor search. Fork it, cut the irrelevant sections, add the meeting-level findings in this document. |
| [`.github/workflows/courses.yml`](../../../Finder/.github/workflows/courses.yml) | **COPY AND MODIFY** | The structure is correct and battle-tested. Change the cron, the script name, and the pathspec. Do not rewrite. |
| [`.github/workflows/test.yml`](../../../Finder/.github/workflows/test.yml) | **COPY AS IS** | 20 lines, no dependencies to install. |
| [`.github/workflows/gen-categories.yml`](../../../Finder/.github/workflows/gen-categories.yml) | **COPY AND MODIFY** | The *pattern* is what you want: a weekly, env-gated, live rot detector that never gates a pull request. Vacant's version watches a different string. |
| [`tests/helpers.js`](../../../Finder/tests/helpers.js) | **COPY AND MODIFY** | `stubFetch` and `byRoute` are the reusable half. The `withSeats` / `withRatings` loaders are Finder modules. |
| [`tests/contract.test.js`](../../../Finder/tests/contract.test.js) | **COPY THE IDEA, NOT THE FILE** | The single most valuable test in Finder. Rewrite from scratch against Vacant's shapes. |
| [`tests/workflows.test.js`](../../../Finder/tests/workflows.test.js) | **COPY AND MODIFY** | Pulls the `git add` lines out of the YAML and runs them against a real temp repo. Vacant has one workflow instead of three, so it shrinks. |
| [`tests/data.test.js`](../../../Finder/tests/data.test.js) | **COPY AND MODIFY** | Two tests, 40 lines, pins the one-line-JSON convention. Change the filename list. |
| `scripts/fetch-seats.mjs` | **DO NOT COPY** | Barrett fixed-width plaintext parsing. Vacant needs no seat counts and Barrett has no rooms. Read `termProblem()` for its structure and then close the file. |
| `scripts/fetch-ratings.mjs` | **DO NOT COPY** | RateMyProfessors. Nothing to do with rooms. |
| `js/app.js`, `render.js`, `rank.js`, `sort.js`, `detail.js`, `calendar.js`, `seats.js`, `ratings.js`, `trend.js`, `courses.js`, `deeplink.js`, `stats.js` | **DO NOT COPY** | Three-pane desktop course search. Vacant is one list on a phone. Sharing any of this is how you end up with the mode picker the README rules out. |
| `js/analytics.js`, `js/hit.js` | **DO NOT COPY** (decide separately) | 800 bytes of pageview counting. Independent of the port. |

---

## The files that need real work

### `scripts/guards.mjs` -> copy as is

This file has no Finder in it. `countRefusal(label, count, floor, previous)` takes its floor from
the caller, `refusalMessage(refusals, force)` takes its force flag from the caller, and
`residueRefusal` is a ratio. The only Finder-shaped thing is `MAX_DROP = 0.1` at the top, and
Vacant wants a different number for a different reason (see [Guards](#the-refusal-guard-pattern)).

Copy the file. Change `MAX_DROP` to `0.05`. Leave the four exported functions alone.

### `scripts/fetch-courses.mjs` -> copy and modify

Roughly 60% of this file is reusable and it is the 60% that took the longest to get right.

**Keep unchanged:**

| Function | Why |
|---|---|
| `retryAfterMs` | Handles both the seconds form and the HTTP-date form, and caps at 30 s. |
| `fetchWith` / `fetchJson` | 3 retries, exponential backoff, the one-shot 403 retry for a twitchy WAF, `fatal` on non-retryable 4xx. |
| `mapLimit` | Bounded concurrency with a per-item delay. |
| `searchUrl` / `searchPage` | Already emits `sort=catalogNumber`, `campus=col`, empty `q`. |
| `searchableTerms` | Same endpoint, same filter, same reason not to hardcode a term. |
| `barrettSubjects` + `discoverSubjects` | The three-source subject candidate list. Vacant needs the same full 243-subject sweep, and the same reasons apply. |
| `writeAtomic` | Temp file plus rename. |
| `EMPTY_PASSES = 2`, `MAX_PASSES = 8`, `STABLE_PASSES = 2` | The reconciliation loop is about paging non-determinism, which is a property of the API and not of what you collect. |

**Change these:**

| What | Change |
|---|---|
| `reconcileSubject` | Currently keys `byCatalog` on `catalogNumber` and stores `[catalog, title, minUnits, maxUnits]`. Rekey on **`facilityId`** and accumulate busy blocks. The union-across-passes logic is identical, only the identity function moves. |
| `subjectPass` | Currently does `for (const entry of data.courses) courses.push(entry.course)`. It has to descend one level further, into `entry.sections[].meetings[]`, because Vacant's unit of data is a meeting and Finder's is a course. |
| `catalogOrder` | Delete. Replace with a room sort on `facilityId`, then a block sort on `(weekday, start)`. |
| `unreadableUnits` | Replace with `unparseableTimes` (same shape, same purpose: rows whose numbers did not survive parsing must abort rather than serialize as null). |
| `lostSubjects` | Rename and rekey to `lostRooms`. Same three lines, same forceable verdict. This is the single most valuable idea in the file for Vacant. |
| `subjectsByTerm` | Becomes `roomsByTerm`, returning `{ rooms: Set, buildings: Set, blocks: number, minutes: number }` per term. All four counts are needed because all four get guarded. |
| `writeRefusals` | Rewrite entirely. See [Guards](#the-refusal-guard-pattern). |
| `MIN_SUBJECTS` / `MIN_COURSES` | Replace with `MIN_ROOMS` / `MIN_BUILDINGS` / `MIN_BLOCKS`. |
| Output shape | `{ terms: { 1268: {...} } }` becomes one file per term, `rooms-1268.json`, the way `fetch-seats.mjs` does it. The whole point of Vacant is that the phone downloads one small file, and it only ever wants the current term. Do not ship every term in one blob. |
| `USER_AGENT` | `Vacant-rooms/1.0 (+https://github.com/EnesYilmazcode/Vacant) weekly room index`. |

**One thing to add that Finder does not have:** the meeting funnel. Measured over 3216 meetings
from 6 fully-walked subjects:

```
3216 meetings pulled
  -1335  facilityId is blank        (41.5%, mostly Independent Study)
  -  68  facilityId === "ONLINE"    ( 2.1%)
  -   0  no weekday flag set
  -   0  no start or end time
= 1813 usable busy blocks           (56.4%)
  - 232  duplicates at room level   (12.8% of the survivors)
= 1581 distinct busy blocks
```

Two of those four filters found nothing, and that is worth knowing rather than trusting. **Every
single meeting carrying a real `facilityId` also carried both a weekday and a time.** Keep the
checks anyway, and count what they drop, because a stable observation is not a promise. That is the
same reasoning Finder uses to keep `MAX_PASSES` after sorting fixed the paging.

### `js/api.js` -> do not copy

Lift exactly two things and delete the rest:

- `termCodeFor(date)` and `defaultTerm(terms, date)`, about 12 lines. Vacant's app needs to pick
  which `rooms-<term>.json` to load without a term selector, and this is that logic.
- The comment at line 24 explaining that `q` must be sent as an empty string rather than omitted,
  because the upstream API 500s if the parameter is absent. Carry the comment into the harvester.

Everything else (`searchAllPages`, `subjectScope`, `pickedScope`, `GEN_CATEGORIES`, `ApiError`,
the five page budget) exists to serve one student typing one query into a box. Vacant has no box,
makes no runtime API call, and must answer with the network off. Copying `api.js` into Vacant would
put a live-search client into an offline app.

### `js/format.js` -> copy two functions

- `buildingOf(meeting)` and `isOnlineMeeting(meeting)`: copy verbatim. Verified below.
- `distinctMeetings(section)`: copy the shape, change the key and the level it runs at. See
  [Dedupe](#dedupe-moves-up-a-level).

Do not port `formatPlace`, `formatWhen`, `formatDays`, `busyLabel`, `sectionFlags`,
`attributesOf`, `courseBadges`, `sectionBadges`, `attributeLabel`, `formatUnits`, `trendLabel`,
`formatCoverage`, or `instructorsOf`. They describe a course to a student reading a search result.

**A trap in `buildingOf` that matters for Vacant.** The field names are inverted from what they
suggest:

| Field | Actually holds | Example |
|---|---|---|
| `facilityDescription` | the **building** name | `"Baker Systems Engineering"` |
| `facilityDescriptionShort` | the **building** name, short | `"Baker Sys"` |
| `buildingDescription` | the **room** label | `"Baker Systems 184"` |
| `buildingDescriptionShort` | the **room** label, short | `"BE 184"` |

`buildingOf()` reads `buildingDescriptionShort` first, so it returns `"DL 264"`, which is a room
label and not a building name. That is correct for Finder, which prints one line per meeting. It is
wrong for Vacant, which groups rooms under buildings. **Vacant must take its building name from
`facilityDescription` and its room number from `room`.** Use `buildingOf()` for the ONLINE check
and for nothing else.

It is also not consistent: `buildingDescriptionShort` came back as `"BE 120"` on one meeting and
`"Baker Syst"` on another in the same sample. One more reason not to build on it.

### `js/filters.js` -> copy one function

```js
/** "8:00 am" to minutes past midnight. Returns null when unparseable. */
export function toMinutes(text) {
  const match = /^(\d{1,2}):(\d{2})\s*([ap])m?$/i.exec(String(text ?? "").trim());
  if (!match) return null;
  let hour = Number(match[1]) % 12;
  if (match[3].toLowerCase() === "p") hour += 12;
  return hour * 60 + Number(match[2]);
}
```

Measured against all 1813 usable meetings in the sample: **zero parse failures, and zero blocks
where `end <= start`.** Earliest start 08:00, latest end 21:30. Copy it verbatim and guard on its
residue anyway.

`overlaps()` at line 66 is also worth stealing. It is half-open, so a class ending at 10:20 does
not collide with one starting at 10:20, which is exactly the semantics a free-gap calculation
needs.

Leave `keepSection`, `applyFilters`, `parseBusy`, `formatBusy` and `DEFAULTS`. They filter search
results by rating and seat count.

---

## The refusal-guard pattern

### What Finder actually implements

The comment at the top of [`guards.mjs`](../../../Finder/scripts/guards.mjs) states the whole idea
in five lines:

> An absolute floor only catches a total collapse. What actually goes wrong is a partial one:
> upstream rate limits half a run, the count still clears the floor, and the site quietly loses a
> third of its rows.

So every count is judged twice. Once against a fixed floor, which only ever covers the first run
when there is nothing to compare against. Once against **what is already committed in the repo**,
which is the check that does the real work from run two onward.

Three more pieces make it usable rather than merely strict:

1. **Two severities.** `forceable(reason)` and `fatal(reason)`. A shrink is forceable, because
   upstream really can shrink and someone has to be able to ship that. A broken parse is fatal,
   because forcing it would write the exact nulls being refused. `FORCE_WRITE=1` clears only the
   forceable ones, and `refusalMessage` re-checks after filtering so a run blocked by one fatal
   reason does not falsely suggest the flag.
2. **The refusal names the way past itself.** `refusalMessage` appends "Set FORCE_WRITE=1 to write
   this anyway" only when that would actually clear everything listed. A red weekly job with no
   stated escape hatch is a job people disable.
3. **Refusing means keeping.** The run exits non-zero and writes nothing, so last week's good file
   stays on disk and stays live. It never degrades to an empty file. `writeAtomic` (temp plus
   rename) covers the crash-mid-write case for the same reason.

There is a third flag, `ALLOW_TERM_DROP=1`, deliberately separate from `FORCE_WRITE=1`, because a
short answer from `searchableTermsV2` would delete files for terms the run never even fetched. That
is a different blast radius, so it gets a different switch. Vacant needs this one unchanged.

### Why Vacant needs a different metric

Finder ships a list. A missing row is a missing row, and the count catches it.

Vacant ships **the absence of data as a positive claim**. The app tells a student "Dreese 357 is
yours for two hours" on the strength of finding nothing in the busy list. Missing data and genuine
emptiness are the same bytes.

The measurement that settles the design:

| Measured over the 6 fully-walked subjects | Value |
|---|---|
| Rooms | 290 |
| Buildings | 43 |
| Deduped `(room, weekday, start, end)` busy blocks | 2744 |
| Total busy minutes across the week, overlaps merged | 220,545 |
| Mean weekly occupancy per room | 761 of 4200 minutes, 18.1% |
| (room, minute) cells reading FREE, Mon-Fri 08:00-22:00 | **81.0%** |
| Rooms with exactly 1 busy block all week | 18 (6.2%) |
| Rooms with 3 or fewer blocks all week | 71 (24.5%) |
| Busy blocks per room | p10=2, p50=8, p90=20, max=41 |

A room only vanishes from the room count when *every* one of its blocks is lost. At a median of 8
blocks per room, that essentially never happens on a partial failure. **Room count is close to
blind to the failure Vacant actually has.**

### Vacant's guards, with starting numbers

Copy `countRefusal`, `refusalMessage`, `fatal`, `forceable`, `residueRefusal` and `termListRefusal`
unchanged, then build this set on top. Every one runs per term, against `rooms-<term>.json` as
committed.

| # | Guard | Floor (first run) | Vs previous run | Severity |
|---|---|---|---|---|
| 1 | `busy blocks` | **1200** | `MAX_DROP = 0.05` | forceable |
| 2 | `busy minutes` | **90000** | `MAX_DROP = 0.05` | forceable |
| 3 | `rooms` | **400** | `MAX_DROP = 0.05` | forceable |
| 4 | `buildings` | **40** | `MAX_DROP = 0.05` | forceable |
| 5 | `lostRooms` (had blocks last run, none now) | n/a | any room at all | forceable |
| 6 | `roomsGutted` (kept over half its blocks) | n/a | more than **5 rooms** | forceable |
| 7 | `weekdayBalance` (lightest weekday vs busiest) | **0.40** | n/a | fatal |
| 8 | `timeResidue` (meetings with a room whose time will not parse) | **0.002** | n/a | fatal |
| 9 | `geoCoverage` (rooms whose building has no lat/lon) | **0.10** | n/a | fatal |
| 10 | `subjectsHarvested` | **150** | `MAX_DROP = 0.05` | forceable |
| 11 | `searchableTerms` | 1 | `ALLOW_TERM_DROP=1` | fatal unless flagged |

**Where each starting number comes from, and what to do with it.**

Guards 1 through 4 are floors in Finder's sense: they exist only to cover a first run and should sit
well under the smallest plausible complete harvest, so that the previous-run comparison is what
actually bites from week two.

- **Rooms, 400.** 14 subjects (6 walked fully, 8 truncated at 2 pages) already returned **422
  distinct rooms and 55 buildings**. A full 243-subject harvest cannot return fewer. 400 is a floor
  a first run clears trivially and a catastrophe does not. This mirrors Finder, whose
  `MIN_SUBJECTS = 100` sits against a smallest measured term of 197.
- **Buildings, 40.** Same logic against 55 measured.
- **Busy blocks, 1200.** 6 subjects gave 2744 deduped blocks. A full harvest will be several times
  that.
- **Busy minutes, 90000.** 6 subjects gave **220,545** busy minutes with overlaps merged. The floor
  sits well under even that partial figure, and the drop check does the real work.

**Run the first full harvest, write the four real numbers into the file as a comment, and then
raise every floor to about 60% of what it measured.** That is the ratio Finder settled on and the
reason it works: the floor is a backstop, not a target.

Guards 5 and 6 are the port of `lostSubjects`, and 6 is the new one that matters most. Guard 5
catches a room disappearing outright. Guard 6 catches the far commoner shape, where a room keeps one
of its eight blocks and therefore stays in the room count while reading as free for seven extra
hours a week. Start at 5 rooms because a genuine mid-term room change moves one or two, and a
half-failed harvest moves dozens.

Guard 7 has no Finder analogue. Measured weekday distribution across the sample:

```
mon=508  tue=601  wed=568  thu=635  fri=432  sat=0  sun=0
lightest / busiest = 0.68
```

Friday is genuinely the lightest day at 0.68 of Thursday, so a threshold of 0.40 leaves real
headroom while still catching a harvest that dropped a page and lost most of one weekday. It is
fatal rather than forceable because there is no legitimate upstream change that empties a Tuesday.
**Saturday and Sunday were zero across all 3216 meetings**, so the check must run over Mon-Fri only
or it fails every week.

Guard 8 is `residueRefusal` with a strict rate, because the measured rate is exactly zero out of
1813. If `toMinutes` starts returning null, the format changed and nothing about this run should
ship.

Guard 9 is Vacant-only and it is the one nobody will think of until it bites. A room in a building
with no coordinates cannot be ranked by distance, so it either silently disappears from every result
or sorts to the wrong end of the list. Neither is visible in any count above. See
[Building names are truncated](#building-names-are-truncated-at-30-characters) for why this will be
worse than expected.

Guard 10 is a stat Vacant does not ship but must still watch. The harvest walks 243 subjects, and
subjects going quiet is exactly the partial failure Finder built `lostSubjects` for.

**Why `MAX_DROP = 0.05` and not Finder's `0.1`.** Finder's course index tracks a catalog that drifts
as sections open and close. Vacant's room grid is **static within a term by construction**, which is
why the README picks a weekly cadence at all. Week over week inside a term the numbers should be
close to identical. A 10% tolerance on a dataset that should not move at all is most of a partial
failure. Start at 0.05, and after three or four clean weekly runs prove the file really is flat,
tighten to 0.02. Write that intention down in the file the way Finder does, so the next person knows
0.05 was a deliberate guess and not a measurement.

Term rollover does not need slack here, because one file per term means a new term is a new file
rather than a drop in an existing one. That is a second reason to follow `fetch-seats.mjs` on
per-term files rather than `fetch-courses.mjs` on one blob.

---

## Excluding ONLINE meetings

### What Finder does

[`js/format.js:48-59`](../../../Finder/js/format.js):

```js
export function buildingOf(meeting) {
  return meeting?.buildingDescriptionShort || meeting?.facilityDescriptionShort || meeting?.facilityDescription || "";
}

export function isOnlineMeeting(meeting) {
  return buildingOf(meeting).trim().toUpperCase() === "ONLINE";
}
```

The comment is right and worth carrying over: OSU never writes "online" in `instructionMode`, which
only ever reads "In Person", "Distance Learning", "Hybrid Delivery" or "Distance Enhanced". The
literal string `ONLINE` goes where the building name would be.

### Verified against real data

Across 3216 meetings from 6 subjects, every ONLINE meeting had **one identical signature**:

```json
{"facilityId":"ONLINE","facilityType":"6F","buildingCode":"ONLINE",
 "room":null,"facilityDescription":"ONLINE","buildingDescriptionShort":"ONLINE",
 "facilityCapacity":998}
```

| Check | Result |
|---|---|
| ONLINE meetings found | 68 of 3216 (2.1%) |
| Caught by Finder's `isOnlineMeeting()` | **68 of 68** |
| Physical rooms wrongly flagged as ONLINE | **0** |
| `facilityType === "6F"` meetings | 68, all of them ONLINE |
| ONLINE meetings carrying a real weekday and time | 29 of 68 |

That last row is the one that makes this matter. **29 online meetings carry a genuine day and time.**
Skip the exclusion and they become busy blocks in a room called ONLINE, with a phantom capacity of
998. Depending on how the index keys itself, that is either a fake room in the results or 29 blocks
smeared across a real one.

Filtering on `instructionMode` does not work: "Hybrid Delivery" appeared 16 times attached to
physical rooms.

### What Vacant should do

Exclude in the **harvester**, at `subjectPass`, so `rooms-<term>.json` never contains the string
ONLINE at all. Do not filter at query time. The phone should not be spending cycles or bytes on
rows that can never be an answer.

```js
// Reject a meeting for the room index. Order matters: the blank check has to
// come first because "" is not a room, and the ONLINE check has to come before
// the day and time checks because 39 of 68 ONLINE meetings have neither.
function busyBlockOf(meeting) {
  const facility = String(meeting?.facilityId ?? "").trim();
  if (!facility) return null;                          // 41.5% of meetings: no room at all
  if (facility.toUpperCase() === "ONLINE") return null; // 2.1%: not a place
  if (isOnlineMeeting(meeting)) return null;            // belt and braces, see below
  const days = DAY_KEYS.filter((key) => meeting[key]);
  if (!days.length) return null;
  const start = toMinutes(meeting.startTime);
  const end = toMinutes(meeting.endTime);
  if (start == null || end == null || end <= start) return null;
  return { facility, days, start, end };
}
```

Three checks for one condition is deliberate, and here is the reasoning to put in the comment:

- `facilityId === "ONLINE"` is the precise one and the one to key on, because Vacant keys its whole
  index on `facilityId`. If the value is ONLINE, the key is ONLINE, and no other check is looking at
  the field that actually becomes the key.
- Finder's `isOnlineMeeting()` stays as the second line of defence, because it reads three different
  fields and catches a variant like a lowercase `Online` in `facilityDescription` with a blank
  `facilityId`. Measured cost of keeping it: zero false positives out of 1813 physical rooms.
- The blank check must come first, because a meeting with no facility at all is 41.5% of the data
  and is a different thing from an online one. It is Independent Study, Field Experience, and
  arranged lectures. **Count these separately in the run log.** If that percentage moves sharply, it
  is the signal that something changed upstream, and it will not trip any other guard.

Do **not** exclude on `facilityType === "6F"`. It is 100% correlated with ONLINE in this sample, but
the type vocabulary is open (see below) and keying on it means a new online code ships as a room.

---

## Two more findings that change the build

### `facilityId` is the key, and it cannot be reconstructed

**331 of 1813 meetings (18.3%) have a `facilityId` that is not the building prefix plus the room
number.** The room number gets zero-padded to four digits, and a wing letter migrates from the room
into the prefix:

```
facilityId   buildingCode   room      what happened
----------   ------------   ------    -------------
HI0035       274            "035"     zero-padded
SON0048      148            "N048"    wing letter N moved into the prefix
SOE0125      148            "E125"    wing letter E moved into the prefix
```

Scott Lab is one `buildingCode` (148) with two `facilityId` prefixes (SON, SOE) for its north and
east wings. Across the sample: 44 prefixes, 43 building codes, no prefix maps to more than one code.

**So use `facilityId` verbatim as the room key and `buildingCode` verbatim as the building key.
Never build either from the parts.** The README's example index does this correctly already
(`"DL0357": { "b": "279", "n": "357" }`), so this is a confirmation rather than a correction, but it
is the kind of thing someone optimizes into a bug six weeks in.

Reassuring, from the same sample: zero rooms report two different capacities, zero building codes
report two different names, and zero rooms map to two building codes. The index build is safe to do
with last-write-wins.

### Building names are truncated at 30 characters

`facilityDescription` is capped at 30 characters and `facilityDescriptionShort` at 10. Four of 55
building names sit at exactly 30, visibly cut off:

```
Chem & Biomolecular Eng & Chem
Gerlach Graduate Programs Bldg
Timashev Family Music Building
Theatre, Film & Media Arts Bld
```

Others are abbreviated rather than truncated (`Phys Activ & Educ Srvs Bldg`, `Celeste Laboratory Of
Chem`, `Scott Lab`, `McPherson Chemical Lab`) and one is comma-inverted (`Fisher Hall, Max M`).

This is a PeopleSoft field width, so it will not change, and it directly attacks the README's plan
to fuzzy-match these against OpenStreetMap names. The README's "six of eight spot-checked matched
exactly" was almost certainly measured on short names. Expect the miss rate on the full set to be
much worse, expect the misses to cluster on exactly the newest and largest buildings, and budget the
hand-fixing accordingly. Guard 9 above is what stops a bad join from shipping.

### Dedupe moves up a level

Finder's `distinctMeetings(section)` dedupes within one section, keyed on
`formatWhen(meeting) + "|" + buildingOf(meeting)`.

Vacant has to dedupe across **all sections in the term**, because two different classes legitimately
report the same room at the same time (cross-listed sections, a lecture and its recitation sharing a
row). Measured: **232 of 1813 usable blocks, 12.8%, are exact `(room, days, time, dates)` duplicates
across different sections.** At room-day granularity it is 517 of 3261, 15.9%.

Key on `facilityId | weekday | start | end | startDate | endDate`. Do it while building the room
index, not per section. Skipping this inflates the file by about an eighth and changes no answers,
which is the sort of thing that survives to production.

---

## Test story

Finder's suite: **600 tests, 577 passing, 23 skipped, 8.5 seconds, zero dependencies.** The 23
skipped are exactly the live ones (22 GE categories plus one term-list test), gated behind
`FINDER_LIVE=1`. `node --test` with no environment set touches no network at all. That is the
model to copy.

### What must never touch the network

Everything except one file. Finder does this with `stubFetch` in
[`tests/helpers.js`](../../../Finder/tests/helpers.js), which swaps `globalThis.fetch` for a
URL-keyed router and returns a restore function. `tests/fetch-courses.test.js` shows the pattern for
a harvester specifically: a `serve(bodies)` helper that answers each request with the next canned
body and records the URLs, so a test can assert **how many requests were made and how far apart**.
That is how Finder proves its confirming pass is spaced and not fired back to back.

Copy `stubFetch`, `byRoute` and `answer` out of `helpers.js`. Leave `withSeats`, `withRatings`,
`withTrend` and `cssRules`.

### The suite Vacant should have

**Tier 1, offline, runs on every push. Non-negotiable.**

| Test file | What it pins |
|---|---|
| `guards.test.js` | Floor, drop, force, and the two-severity split. Port Finder's `contract.test.js` cases 149-310 nearly as is. |
| `harvest.test.js` | The meeting funnel, one case per rejection reason: blank `facilityId`, `facilityId === "ONLINE"`, lowercase `Online` in the description, no weekday, no time, `end <= start`. Each asserts the block is dropped **and** that the drop is counted. |
| `harvest-online.test.js` | The 29-online-meetings-with-real-times case, as an explicit regression. Feed a fixture holding the exact `{"facilityId":"ONLINE","facilityCapacity":998,...}` signature with `tuesday:true, 8:00 am - 8:55 am` and assert the room index contains no key matching `/ONLINE/i`. |
| `index-shape.test.js` | Vacant's `contract.test.js`. Key order, the `sessions` table, `busy` tuple arity, every `b` in `rooms` resolving to a key in `buildings`, every building having a lat and lon. |
| `dedupe.test.js` | Two sections reporting the same room at the same time produce one block. |
| `free-gaps.test.js` | **The query logic, and the most important tests in the repo.** No network, no clock, no GPS: pure functions over a fixture. Cases: gap before the first class, gap between two classes, gap after the last class, a room with no blocks at all, a block that ends exactly when the query starts (half-open, no collision), a session date range that excludes today, walking time exceeding the gap, and a gap that ends at a building's closing hour. |
| `retry.test.js` | Port `fetch-retry.test.js`. Backoff, `Retry-After` in both forms, the one-shot 403, `fatal` on a 404. |
| `data.test.js` | Port as is with the filename list changed. One line, trailing newline, `JSON.stringify(..., null, 0)`. |
| `workflows.test.js` | Port. Runs the workflow's `git add` lines against a real temp repo. Shrinks to one workflow. |
| `pwa.test.js` | No Finder analogue. Assert the service worker precache list names every file `index.html` references, and that `rooms-<term>.json` is in it. A PWA that ships a stale or incomplete precache list is offline-broken in a way nothing else catches. |

**Tier 2, live, weekly, `VACANT_LIVE=1`, never on a pull request.** One file, modelled exactly on
`gen-categories.live.test.js`, with the same `withRetry` wrapper so one bad morning is not a red
build. It watches the three upstream strings and shapes that can rot silently:

1. A known room still comes back with a `facilityId`, a `facilityType`, a `facilityCapacity`, a
   `buildingCode`, and `startTime`/`endTime` in the `"8:00 am"` format `toMinutes` parses.
2. `facilityId === "ONLINE"` still appears for at least one section in at least one searchable term.
   If OSU renames it, the exclusion silently stops working and phantom rooms appear. Nothing else
   would notice.
3. `facilityDescription` is still capped at 30 characters and still matches what `buildings.json`
   was joined on, for a hardcoded handful of buildings.

**Do not build:** a headless-browser test of the GPS flow, or anything that reads a real device
location. Keep geolocation behind an injectable function and test the ranking with fixed
coordinates. This box is Windows and a Playwright gate here is a gate nobody can run.

---

## CI

### What Finder runs

| Workflow | Schedule | What it does |
|---|---|---|
| `courses.yml` | `40 8 * * 1`, Mondays 08:40 UTC | Full catalog build, ~2500 requests, commits `data/courses.json` if changed. |
| `seats.yml` | `30 12 * * *`, daily | Barrett seat snapshot. |
| `ratings.yml` | `20 7 * * *`, daily | RateMyProfessors snapshot. |
| `gen-categories.yml` | `10 9 * * 2`, Tuesdays | Live rot detector, `FINDER_LIVE=1`, no commit. |
| `test.yml` | on push and pull request | `node --test`. |

### Verdict: adapt `courses.yml`, do not rewrite it

It is already the weekly-harvest-with-refusal-guards workflow Vacant needs, and it carries several
decisions that cost someone real debugging:

- **`permissions: contents: write`** and **`concurrency: { group, cancel-in-progress: false }`**, so
  a manual dispatch queues behind a scheduled run rather than killing it mid-harvest.
- **`git status --porcelain` rather than `git diff`**, with the comment explaining that a first run
  has an untracked file that `git diff` reports as unchanged. Copy the comment.
- **`git pull --rebase origin ${{ github.ref_name }}` before pushing.** Vacant has one committing
  workflow instead of three, so the collision risk is lower, but a manual dispatch can still overlap
  a scheduled run.
- **`workflow_dispatch` inputs wired to `FORCE_WRITE` and `ALLOW_TERM_DROP`.** Without these the
  refusal guards make the weekly job permanently red the first time upstream legitimately shrinks,
  and the only fix is buried in a source comment.
- **A cron off the top of the hour**, to stay out of GitHub's busiest scheduling window.

Changes for Vacant:

| What | From | To |
|---|---|---|
| `name` | `Course index` | `Room index` |
| cron | `40 8 * * 1` | `50 9 * * 1` (still Monday, still off the hour, and clear of Finder's 08:40 so the two harvests do not hit `content.osu.edu` together) |
| run | `node scripts/fetch-courses.mjs` | `node scripts/fetch-rooms.mjs` |
| pathspec | `data/courses.json` | `-A -- 'data/rooms-*.json' data/rooms.json`, following `seats.yml`, because per-term files mean a term can appear or disappear |
| commit message | `Update course index` | `Update room index` |
| `if:` on commit step | absent (defaults to `success()`) | **add `if: ${{ !cancelled() }}`** and write the harvester so terms clearing their guards are on disk before a later term fails. This is the lesson `workflows.test.js` exists to protect, and Vacant should be born with it rather than learning it. |

`test.yml` copies as is. `gen-categories.yml` copies as the template for the live rot detector.
`seats.yml` and `ratings.yml` do not come across, but read `seats.yml`'s commit step for the
per-term pathspec pattern and its comment about `git add` being fatal on a pathspec matching nothing.

**One thing to add that Finder does not have:** GitHub Pages deployment. Finder serves from a
branch. Vacant needs a service worker and a manifest, so it needs the site's own precache list to be
consistent with what actually shipped. Either add a `pages.yml` that runs the Tier 1 suite before
deploying, or make the deploy depend on `test.yml`. A PWA that caches a broken build serves that
broken build until someone clears their site data.

---

## License

**Finder is MIT**, `Copyright (c) 2026 Enes Yilmaz`, in
[`Finder/LICENSE`](../../../Finder/LICENSE). Same owner, same person, no CLA, no contributor
besides the owner and `github-actions[bot]`.

The copy is clean. MIT permits copying, modifying and sublicensing without restriction, and the one
condition is that the copyright notice and permission notice ride along with substantial portions.

Two things to actually do:

1. Vacant's `README.md` currently says **`## License` / `TBD.`** Ship a real `LICENSE` file. MIT
   under the same copyright line is the obvious choice and makes the condition self-satisfying,
   since the notice in Vacant's own LICENSE is the same notice.
2. Where a whole file comes across (`guards.mjs` above all), leave a one-line provenance comment:

   ```js
   // Copied from https://github.com/EnesYilmazcode/Finder (MIT, (c) 2026 Enes Yilmaz).
   ```

   Not a legal requirement when both licenses are the same MIT under the same holder. It is worth it
   because in six months the two files will have drifted and the next person needs to know which one
   is upstream.

No third-party code is involved anywhere in the ported set. Finder has zero runtime and zero
development dependencies. Nothing in the port map pulls in an npm package.

---

## Appendix A: what was run

All probes used `sort=catalogNumber`, `campus=col`, `term=1268`, sequential requests, 800 ms
between them, a 90 second timeout, 3 retries, and a self-identifying user agent. **41 requests
total.**

```bash
# Finder's suite, timed. 600 tests, 577 pass, 23 skip, 8.5s.
cd C:/Users/galax/Downloads/Projects/Finder && node --test

# Deep sample: 6 subjects walked completely. 18 requests, 3034 sections, 3216 meetings.
node scratchpad/harvest.mjs scratchpad/raw.json
#   cse: items=1064 pages=6      chem: items=768 pages=4
#   math: items=507 pages=3      art:  items=314 pages=2
#   psych: items=150 pages=1     dance: items=231 pages=2

# Breadth sample: 8 more subjects, capped at 2 pages each. 13 requests.
node scratchpad/widen.mjs scratchpad/wide.json scratchpad/raw.json
#   english history ece busmhr music biology econ philos

# All analysis ran offline against the cached JSON.
node scratchpad/analyze.mjs  scratchpad/raw.json   # funnel, ONLINE, facilityType, conflicts
node scratchpad/analyze2.mjs scratchpad/raw.json   # facilityId structure, building names
node scratchpad/analyze3.mjs scratchpad/raw.json   # occupancy, weekday balance, the 81% number
```

Scripts are in
`C:\Users\galax\AppData\Local\Temp\claude\C--Users-galax-Downloads-Projects\ff09d3ae-8ad6-40bb-942d-f7cf03ac4117\scratchpad\`.
`raw.json` is 3034 sections with full meeting arrays and is worth keeping as a test fixture source.

### `facilityType`, measured

The README lists this as a known unknown. Partial answer, from 1813 physical meetings:

| Type | Meetings | Rooms | Median cap | Range | Looks like |
|---|---|---|---|---|---|
| `1B` | 1033 | 178 | 35 | 14-160 | general classroom |
| `2A` | 298 | 35 | 28 | 10-83 | computer or teaching lab |
| `1C` | 208 | 37 | 120 | 50-727 | lecture hall |
| `2M` | 104 | 12 | 40 | 12-40 | studio (Hopkins, Sullivant) |
| `2P` | 72 | 3 | 44 | 44-97 | departmental lab |
| `2K` | 49 | 11 | 24 | 18-48 | teaching lab |
| `1A` | 22 | 8 | 27 | 11-34 | seminar room |
| `6C` | 11 | 1 | 0 | 0-0 | unknown, capacity 0 |
| `2Q` | 8 | 1 | 35 | 35-35 | unknown |
| `PERF` | 5 | 1 | 200 | 200-200 | performance space |
| `5K` | 2 | 2 | 15 | 0-15 | unknown |
| `LAB` | 1 | 1 | 15 | 15-15 | lab |
| `6F` | 68 | 0 | 998 | | ONLINE, not a place |

The `1x` family reads as classrooms and the `2x` family as labs and studios, which is the split the
README wants so it does not send someone into a wet lab.

**But the vocabulary is open.** `PERF` and `LAB` are not codes at all, they are words, and they
appear alongside the numeric ones. **Do not whitelist `facilityType`.** A whitelist fails closed on
every code it has not seen, which silently deletes rooms, and deleting rooms is invisible against an
81%-free baseline. Use it as a displayed label and as a soft ranking signal, and keep the room.
