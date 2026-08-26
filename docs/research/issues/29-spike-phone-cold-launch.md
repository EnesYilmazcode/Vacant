---
title: SPIKE: measure cold launch on a real phone, then decide on the packed binary
labels: spike, pwa
milestone: Backlog
estimate: S
order: 29
depends_on: result-screen
---

The research recommends two cold-start optimizations and neither has been run on a handset. Both rest on desktop Node numbers scaled by an assumed 4x to 8x multiplier, and `docs/research/query-engine.md` marks the phone column unverified. If an iPhone gets to a ranked answer in 300 ms, both optimizations are dead and the harvester keeps one output file instead of two. Measure first.

### What to do

Ship the plain JSON path from `Build the result screen: shell, confidence-tiered rows, duration chips and the detail sheet`, instrumented with `performance.mark`, printing into the debug panel behind `/Vacant/?debug=1` that `SPIKE: does geolocation work in an installed PWA on current iOS?` already added.

```js
performance.mark('boot');
const raw = await (await fetch('data/rooms-1268.json')).text();
performance.mark('fetched');
const idx = JSON.parse(raw);
performance.mark('parsed');
const rows = query(idx, origin, needMinutes);
performance.mark('answered');
// report fetched-boot, parsed-fetched, answered-parsed, answered-boot
```

Five runs in each of three states, on Enes's own iPhone, Low Power Mode off:

| state | how to get it | what it isolates |
|---|---|---|
| warm | reopen from the app switcher | nothing cold |
| cold process | force-quit, relaunch | cold JIT, warm Cache API |
| cold everything | first launch after install | cold JIT and cold cache |

Decide on the median `answered-boot` in the cold-process state:

- Under 300 ms: do nothing. Close both optimizations.
- 300 to 800 ms: defer only the typed index build to `requestIdleCallback`. It costs 141 to 187 ms on desktop and does not pay back until roughly query 90, and a Vacant session is one query.
- Over 800 ms: file the packed binary as its own issue. Desktop measured 28.6 to 38.4 ms against 242 to 306 ms for cold JSON, at 170,400 bytes raw / 37,198 gzipped versus 414,192 / 53,951.

Record every run and the verdict in `docs/DECISIONS.md`.

### Done when

- [ ] `docs/DECISIONS.md` holds 15 rows (5 runs x 3 states) with fetch, parse, first-answer and total in ms
- [ ] Device model, iOS version, and "Low Power Mode off" are written down
- [ ] The room and interval count of the index that was measured is recorded, and the room count is at least 900 (real campus is 1,067; a one-bucket sample understates the parse cost)
- [ ] Exactly one of the three verdicts is written as a single line with the median number behind it
- [ ] If the verdict is the packed binary, a new issue exists carrying the cross-check bar already: identical top-20 ordering against the JSON path over at least 500 randomised queries, 0 mismatches
- [ ] Total time spent is one sitting

### Notes

Safari clamps `performance.now()` to 1 ms for Spectre mitigation. Fine at these magnitudes, useless for the warm query, which was 0.4 to 1.3 ms on desktop. Do not try to measure that here.

The desktop numbers came from V8 on Node 22. JavaScriptCore is a different `JSON.parse`, so the 4x to 8x multiplier could be wrong in either direction. That is the whole reason for this spike, so do not pre-commit to the projection.

The third state is not an edge case. On iOS every installed icon gets its own storage jar, so the first launch after install is always cold and network-bound, and it is what a real first user sees. Keep it in its own column rather than folding it into the cold-process median.
