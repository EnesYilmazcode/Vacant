---
title: Harden the query engine: edge cases, the corrected usable formula, ranking and the fallback ladder
labels: enhancement
milestone: Phase 3: App
estimate: L
order: 15
depends_on: room-index-and-current-json, buildings-json-from-osu-gis, walking-skeleton
---

The walking skeleton sweeps intervals with the README's arithmetic, and two of those formulas are measurably wrong. `usable = gapEnd - now - walkTime` counts the minutes you spend standing in the corridor as study time, and the assumed 5-minute passing period is really 15 at Ohio State, which is 69.3% of every inter-class gap on campus. Pure distance ranking is also wrong: a 3-minute walk giving exactly the time asked for should not beat a 4-minute walk giving twice as much. This replaces the sweep with the engine in `docs/research/query-engine.md` section 13, which passed 12 edge cases and cross-checked to 0 mismatches against a second implementation.

### What to do

`js/engine.js` exports `query()`, `activeMask()` and one config block, each constant commented measured or guess:

```js
export const WALK_MPM  = 78;    // guess. ~1.34 m/s adult pace, deliberately slow
export const DETOUR    = 1.30;  // fudge factor. NOT measured on OSU sidewalks
export const PACKUP    = 10;    // policy, see below
export const MAX_WALK  = 12;    // minutes. Ladder never fires at this radius
export const LOOKAHEAD = 240;
export const SURPLUS_WEIGHT = 0.1, SURPLUS_CAP = 60;  // unmeasured judgement calls
export const DAY_START = 420;   // 07:00
export const DAY_END   = 1320;  // 22:00 guess, a measured class ends 22:15
```

The corrected window, with every rounding breaking pessimistic:

```
walkMinutes = Math.ceil(metres * DETOUR / WALK_MPM)
arrival     = now + walkMinutes
usable      = (gapEnd - PACKUP) - max(arrival, gapStart)
leaveBy     = max(now, gapStart - walkMinutes)
```

`PACKUP = 10` is doing real work. A 15-minute passing period yields 5 usable minutes, so the 1,879 corridor gaps self-eliminate by arithmetic. Do not implement it as a merge tolerance instead: that would swallow the 1.3% of genuine 10-to-14 minute gaps and would report `gapEnd` as the start of the second class, which is a lie about when the room is free.

One merge sweep per (room, weekday) slice handles duplicates, containment, partial overlap and back-to-back chaining, and returns the fitting gap and the immediate gap in the same pass, so the "frees soon" rung costs nothing. Skip intervals whose `sessionIndex` is not live using the `Uint8Array` mask from `activeMask()`, built by `<=` on `YYYY-MM-DD` strings. No `Date` objects in the hot path.

`rank()` scores `walk - SURPLUS_WEIGHT * min(usable - need, SURPLUS_CAP)` ascending, then `usable` desc, then `facilityType` (1B, then 1C, then 1A), then capacity desc weakly, then `facilityId` ascending as the deterministic key.

### Done when

- [ ] `js/engine.js` exports `query()`, `activeMask()` and the config block above, every constant carrying a measured-or-guess comment
- [ ] `usable = (gapEnd - PACKUP) - max(now + walkMinutes, gapStart)` with `walkMinutes` via `Math.ceil` and `PACKUP` 10
- [ ] `leaveBy = max(now, gapStart - walkMinutes)` is on every returned row
- [ ] One sweep returns both the fitting gap and the immediate gap; no second pass anywhere
- [ ] Session filtering is the `Uint8Array` mask, and `grep -c 'new Date\|Date\.' js/engine.js` returns 0
- [ ] Distance is equirectangular, and a test asserts agreement with a reference haversine within 1 m for every building in `data/buildings.json`
- [ ] All 12 edge cases from the note's section 4 table pass as offline `node --test` cases: no classes today, now inside a class, class already ended, now before the first class, now after the last class, 15-minute passing returning nothing at `need=1`, zero-gap back-to-back, exact duplicates, overlapping combined sections, a contained interval, an inactive session blocking nothing, unsorted input
- [ ] A test runs the same query twice against the same index and clock and asserts byte-identical row ordering
- [ ] The ladder stops at the first rung returning 3 or more rooms, every relaxed answer carries `relaxed: true` in the payload, and no near-miss row has `usable < 20`
- [ ] `DAY_END` is returned in the payload for the UI to name, and is re-derived from the first full harvest rather than from the 12-subject sample
- [ ] `performance.mark` wraps parse, first answer and any index build
- [ ] `SURPLUS_WEIGHT` and `SURPLUS_CAP` appear in `docs/DECISIONS.md` as an open question

### Notes

Do not build the typed CSR index or the packed binary here. The note recommends both, but every timing behind them is a Ryzen 7 5800H number scaled by an assumed 4-8x phone multiplier that nobody has measured, and building the typed index measured 326-382 ms cold against 242-306 ms for plain parsed JSON, so it is a pessimisation for the one-query session that actually happens. `spike-phone-cold-launch` settles it with a real handset. Ship the plain path with the marks in place.

Two known wrong answers this engine cannot fix on its own: it reports rooms busy on holidays until `calendar-closed-days-and-exams` lands, and it reports the whole campus free on weekends, where 0 of 4,679 sampled intervals exist. Both are honesty problems for `result-screen` and `unscheduled-hours-screen`, not bugs here.

Seats are kept as a weak tie-break because the README asks for it, but a 727-seat lecture hall is likelier to be locked or held for an event than a 34-seat classroom, so the signal may be inverted. That is why `facilityType` sorts above it.
