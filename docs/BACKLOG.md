# Backlog

Thirty issues, filed 2026-08-26. Issue numbers match backlog order, so [#1](https://github.com/EnesYilmazcode/Vacant/issues/1) is the first thing to do and [#30](https://github.com/EnesYilmazcode/Vacant/issues/30) is the last.

Thirty issues that take Vacant from a README to an installable, honest, offline classroom finder for Ohio State, front-loaded so a real ranked list is on his phone by issue four rather than issue nine, and representing roughly two to three months of evenings and weekends.

Every issue came out of the research in [`docs/research/`](research/), which measured the live API, Roomix's compiled bundle, OSU's GIS server and the Registrar's building schedule rather than reasoning from the README.

## Start here

1. [#1](https://github.com/EnesYilmazcode/Vacant/issues/1) Scaffold the repo, turn on Pages at /Vacant/, and land the MIT licence
1. [#2](https://github.com/EnesYilmazcode/Vacant/issues/2) Snapshot terms 1262 and 1264 before Spring 2026 leaves the API on August 31
1. [#3](https://github.com/EnesYilmazcode/Vacant/issues/3) Build data/buildings.json from Ohio State's own GIS building layer

The ordering puts a real ranked list of real rooms on your phone at [#4](https://github.com/EnesYilmazcode/Vacant/issues/4), before the data layer exists. [#2](https://github.com/EnesYilmazcode/Vacant/issues/2) is second only because it expires: Spring 2026 drops out of the API on August 31 and cannot be recovered afterwards.

## Critical path

```
#1   Scaffold the repo, turn on Pages at /Vacant/, and land the MIT licence
  |
#3   Build data/buildings.json from Ohio State's own GIS building layer
  |
#4   Walking skeleton: one catalog-number bucket to a ranked list of real rooms on a phone
  |
#6   Harvest a full term by walking the catalog-number buckets twice, as a polite client
  |
#7   Filter meetings to real Columbus rooms with a counted funnel, and strip instructors at the parse boundary
  |
#8   Invert sections into data/rooms-<term>.json, with intervals deduped, merged and propagated
  |
#9   Ship the room safety filter: facilityType allow list plus the Registrar general-assignment cross-check
  |
#10  Refuse a bad build on busy blocks and minutes, not room count, with a fatal PII scan
  |
#15  Harden the query engine: edge cases, the corrected usable formula, ranking and the fallback ladder
  |
#18  Build the result screen: shell, confidence-tiered rows, duration chips and the detail sheet
  |
#21  Ship manifest.webmanifest and the iOS icon set on absolute /Vacant/ paths
  |
#22  Write sw.js with two caches, a navigation fallback, build stamping and term eviction
  |
#23  Build the install hint and the cold-and-offline first-run journey
  |
#26  Walk to twenty rooms the app calls free and record what was actually true
  |
#27  Write the launch plan and the words that go with it
```

Everything not on this list can wait or run beside it.

## All thirty

### Phase 0: Setup

Repo, deploy target, licence, and one thin slice through every layer so a real ranked list is on a phone before the data layer exists.

| # | Issue | Size | Blocked by |
| --- | --- | --- | --- |
| [1](https://github.com/EnesYilmazcode/Vacant/issues/1) | Scaffold the repo, turn on Pages at /Vacant/, and land the MIT licence | M | nothing |
| [2](https://github.com/EnesYilmazcode/Vacant/issues/2) | Snapshot terms 1262 and 1264 before Spring 2026 leaves the API on August 31 | S | #1 |
| [3](https://github.com/EnesYilmazcode/Vacant/issues/3) | Build data/buildings.json from Ohio State's own GIS building layer | M | #1 |
| [4](https://github.com/EnesYilmazcode/Vacant/issues/4) | Walking skeleton: one catalog-number bucket to a ranked list of real rooms on a phone | M | #1, #3 |
| [5](https://github.com/EnesYilmazcode/Vacant/issues/5) | SPIKE: does geolocation work in an installed PWA on current iOS? | S | #4 |

### Phase 1: Data pipeline

Harvest a whole term, invert it into a room-keyed busy index, filter out rooms nobody should be sent to, and refuse to ship a bad build.

| # | Issue | Size | Blocked by |
| --- | --- | --- | --- |
| [6](https://github.com/EnesYilmazcode/Vacant/issues/6) | Harvest a full term by walking the catalog-number buckets twice, as a polite client | L | #1 |
| [7](https://github.com/EnesYilmazcode/Vacant/issues/7) | Filter meetings to real Columbus rooms with a counted funnel, and strip instructors at the parse boundary | S | #1 |
| [8](https://github.com/EnesYilmazcode/Vacant/issues/8) | Invert sections into data/rooms-<term>.json, with intervals deduped, merged and propagated | L | #6, #7 |
| [9](https://github.com/EnesYilmazcode/Vacant/issues/9) | Ship the room safety filter: facilityType allow list plus the Registrar general-assignment cross-check | M | #8, #2 |
| [10](https://github.com/EnesYilmazcode/Vacant/issues/10) | Refuse a bad build on busy blocks and minutes, not room count, with a fatal PII scan | M | #8, #3 |
| [11](https://github.com/EnesYilmazcode/Vacant/issues/11) | Emit closed days and the exam window into the room index | M | #8 |
| [12](https://github.com/EnesYilmazcode/Vacant/issues/12) | Ship rooms.yml on a Sunday cron, with a failure alerter and a dead-man's switch | M | #8, #10 |
| [13](https://github.com/EnesYilmazcode/Vacant/issues/13) | Add a weekly live rot detector behind VACANT_LIVE=1 | S | #6, #12 |

### Phase 2: Geo

Everything that turns a building code into a place: coordinates, distance, and the hours the door is actually open.

| # | Issue | Size | Blocked by |
| --- | --- | --- | --- |
| [14](https://github.com/EnesYilmazcode/Vacant/issues/14) | Scrape the Registrar classroom pool building schedule into data/buildings-hours.json | M | #3 |

### Phase 3: App

The screens: ranking, confidence tiers, the states where the schedule cannot answer, and the installable offline shell.

| # | Issue | Size | Blocked by |
| --- | --- | --- | --- |
| [15](https://github.com/EnesYilmazcode/Vacant/issues/15) | Harden the query engine: edge cases, the corrected usable formula, ranking and the fallback ladder | L | #8, #3, #4 |
| [16](https://github.com/EnesYilmazcode/Vacant/issues/16) | Wrap geolocation in a wall-clock watchdog, with distinct error paths and an off-campus gate | M | #5, #3 |
| [17](https://github.com/EnesYilmazcode/Vacant/issues/17) | Build the manual building picker as a first-class origin screen | M | #3 |
| [18](https://github.com/EnesYilmazcode/Vacant/issues/18) | Build the result screen: shell, confidence-tiered rows, duration chips and the detail sheet | L | #15, #9 |
| [19](https://github.com/EnesYilmazcode/Vacant/issues/19) | Ship the term, calendar and staleness states, including an explicit exam-week refusal | M | #18, #11 |
| [20](https://github.com/EnesYilmazcode/Vacant/issues/20) | Build the unscheduled-hours screen that ranks buildings, not rooms | M | #18, #14 |
| [21](https://github.com/EnesYilmazcode/Vacant/issues/21) | Ship manifest.webmanifest and the iOS icon set on absolute /Vacant/ paths | S | #1 |
| [22](https://github.com/EnesYilmazcode/Vacant/issues/22) | Write sw.js with two caches, a navigation fallback, build stamping and term eviction | M | #21, #18, #8 |
| [23](https://github.com/EnesYilmazcode/Vacant/issues/23) | Build the install hint and the cold-and-offline first-run journey | L | #22, #5 |
| [24](https://github.com/EnesYilmazcode/Vacant/issues/24) | Add a diagnostics panel and a report-a-problem path | S | #18, #22 |
| [25](https://github.com/EnesYilmazcode/Vacant/issues/25) | Ship the trust surfaces: attribution, docs/DATA.md, /privacy, the kill switch and the README corrections | M | #3, #7, #18 |
| [26](https://github.com/EnesYilmazcode/Vacant/issues/26) | Walk to twenty rooms the app calls free and record what was actually true | M | #18, #16 |
| [27](https://github.com/EnesYilmazcode/Vacant/issues/27) | Write the launch plan and the words that go with it | S | #26, #25 |

### Phase 4: Reports

The crowdsourced was-it-open layer, designed on paper before any backend exists.

| # | Issue | Size | Blocked by |
| --- | --- | --- | --- |
| [28](https://github.com/EnesYilmazcode/Vacant/issues/28) | Design the was-it-open report schema and its privacy model before any backend exists | M | #26 |

### Backlog

Real work with no scheduled slot: optimizations gated on a measurement, and questions the data has not answered yet.

| # | Issue | Size | Blocked by |
| --- | --- | --- | --- |
| [29](https://github.com/EnesYilmazcode/Vacant/issues/29) | SPIKE: measure cold launch on a real phone, then decide on the packed binary | S | #18 |
| [30](https://github.com/EnesYilmazcode/Vacant/issues/30) | SPIKE: does a genuinely never-scheduled room exist in our own data? | S | #2, #6, #9 |

## Decisions parked on you

These are real forks. Each carries a recommendation, but none should be settled by default.

**Custom domain, or stay on the case-sensitive /Vacant/ Pages subpath? This has to be answered before the first person installs, because changing the origin afterwards orphans every installed icon, cache, service worker registration and geolocation grant, and iOS has no mechanism to update an installed app's URL.**

> Buy the domain now if roughly $12 a year is in budget. It removes the /Vacant/ capital-V trap that a lowercase start_url turns into a hard 404 after install, it separates Vacant's storage and service worker scope from Finder's on the shared enesyilmazcode.github.io origin, and it gives you a URL someone can type. If the answer is no, write the no into DECISIONS.md as a commitment rather than a default, because a later yes is unrecoverable for existing installs.

**What happens to a room that passes the facilityType allow list but is absent from the Registrar's general-assignment list? That is 77 measured type-1B rooms, probably ordinary departmental classrooms, and the two filters disagree about roughly 47% of the inventory.**

> Show them, ranked below general-assignment rooms, with a one-word label on the row rather than a paragraph. They are almost certainly real classrooms and hiding them deletes a large share of the app's inventory, but they are also the rooms most likely to be departmentally controlled, so the ranking should reflect that rather than the filter. Ship the `ga: false` flag either way so the decision can be reversed without a rebuild.

**Roughly 60% of rooms sit in buildings with no published hours at all. After dark and at weekends, does Vacant show them labelled unknown, or hide them entirely?**

> Show them, labelled unknown, ranked below every building with published open hours, and never with an assumed or 'usually open' window. Hiding them loses real music, chemistry and art classroom space and makes the app useless at exactly the times it is most wanted. But the label has to be honest rather than hedged: 'hours not published' is a fact, 'usually open' is a guess dressed as one.

**Who at Ohio State do you contact, and about what? Three different asks are on the table: gismaps@osu.edu about the building layer's licence, the Registrar about the official room-type key, and OTDI about whether the weekly harvest is acceptable use.**

> Email gismaps@osu.edu and the Registrar; do not email anyone about the API. The first two convert inferences into facts and cost nothing if ignored. The API question is asymmetric: there is no numeric safe harbor to ask for, only a discretionary reasonableness standard, and a written no is far worse than no answer. Ship the polite client, publish docs/DATA.md, keep the kill switch one commit away, and stay reachable.

**Do you share the URL before building hours land, or hold it? The walking skeleton will be live and working from issue 4 onward, months before the hours scrape.**

> Hold it. Share the link with two or three people you can tell 'this is a prototype' in person, and do not post it anywhere public until building hours ship. Without them the app names free rooms in locked buildings, which is the precise failure the project's whole pitch is built on calling out, and a first user who walks to a locked door does not come back.

**Does Phase 4 get built at all, and if it does, may a crowd report override the published building-hours table?**

> Build it only after the usage counter shows real use; the README's own gate is right. If you do, let reports supplement but never override until a bucket has 3 or more distinct reporters, then let them override the hours table but never the class schedule. The May 2024 four-day campus-wide BuckID lockdown is the case that argues for override, and it is real, but a single report flipping a building to closed is an abuse vector a static site cannot police.

## Deliberately not filed

Ten items that survived drafting but not the critique. They are recorded so nobody rediscovers them as gaps.

- **Emit rooms-<term>.bin, the packed binary index.** The 88% cold-launch win is a desktop measurement scaled to a phone by an assumed 4-8x multiplier that nobody has tested. Gated behind spike-phone-cold-launch: if a real iPhone parses the JSON fast enough, this never needs to exist and the harvester keeps one output format instead of two that can drift.
- **Answer the first query off raw JSON and build the typed CSR index in an idle callback.** Same unverified desktop numbers, and it is a deferral of a structure nothing currently schedules. Folded into engine-and-ranking as performance.mark instrumentation so the decision can be made on real data instead of a projection.
- **Union room identities across three terms so zero-class rooms are discoverable.** The 190-zero-class-rooms figure comes from a competitor's CDN and the explanation is inferred, not measured. It would also add a carried-forward room concept that every guard floor has to model, and a room with an empty busy list wins every ranking tie-break. Gated behind spike-unscheduled-rooms; the raw snapshots are being captured anyway.
- **Cross-check building coordinates against OpenStreetMap as a standing audit script.** The OSU GIS join already resolves 88 of 88 codes and matches a live re-fetch within 0.068 m, so OSM is a second opinion rather than a source. The draft dataset already carries the osm_check_m column from a one-off pass, which is enough. A permanent audit is worth building only if the GIS join ever breaks.
- **Hunt for an OSU non-class event feed equivalent to UIUC's Tableau Daily Event Summary.** This is the last large honesty gap and it is knowable at other schools, so it deserves a timeboxed research pass eventually. Deferred because three obvious endpoint families already 404 and there is no evidence OSU publishes one, so it is a search with an unknown floor rather than a build.
- **Entrance overrides for buildings whose published centroid falls outside their own footprint.** Ohio Stadium's point is outside its 35-ring polygon and Hamilton Hall's is 27 m off centre, but the cost is at most 1 min 45 s of walk time in the pessimistic direction, and the ranking is unaffected. Noted here so nobody rediscovers it as a bug; wait for a complaint.
- **Deep-link each result to OSU's event space request form.** Freerooms turns the honesty problem into an action this way and it costs almost nothing, but Vacant's rooms are mostly not bookable by a student and a 'Booking Unavailable' label on most rows is noise. Revisit after ground-truth-walk shows what fraction of surfaced rooms are actually requestable.
- **A standalone accessibility audit pass at 320px, 200% zoom, AX5 and forced-colors.** Every criterion is written into result-screen's acceptance so the row is built correctly the first time rather than retrofitted. A separate audit is worth scheduling only once there are several screens to sweep, which is after unscheduled-hours and the term states land.
- **A dedicated term-watch.yml workflow.** It is one HTTP request and a list diff, so it was folded into the daily stale-watch job rather than paying for its own workflow file, cron slot and 60-day inactivity exposure.
- **A privacy-preserving usage counter as its own issue.** Folded into launch-and-share as an explicit decision, because the only reason to ship it is to judge the Phase 4 gate, and that judgement happens at launch. Building it earlier measures nobody.

## How this was built

A 53 agent fleet: 12 investigators verifying the blueprint against live data, 6 workstream agents drafting issues, 4 adversarial critics (completeness, duplication, ordering, and one whose only job was finding issues that would make the app lie to a student), a planner, and one writer per issue. It produced 96 corrections to the original blueprint; the load-bearing ones are already folded into the [README](../README.md).
