---
title: Add a weekly live rot detector behind VACANT_LIVE=1
labels: ops, data
milestone: Phase 1: Data pipeline
estimate: S
order: 13
depends_on: bucket-harvester, weekly-build-and-alerting
---

Every guard in `Refuse a bad build on busy blocks and minutes, not room count, with a fatal PII scan` fires when the harvest fails. None of them fire when the harvest succeeds against changed data. If Ohio State renames the ONLINE pseudo-room, the funnel's exclusion stops matching, a 998-seat phantom room enters the index carrying real busy blocks, and every count stays inside its floor. The build goes green and the app gets quietly worse.

### What to do

One file, `tests/live-rot.live.test.js`, modelled on Finder's `tests/gen-categories.live.test.js`, which is the only networked file in a 600-test suite (23 skips = 22 GEN_CATEGORIES plus one term-list test, all behind `FINDER_LIVE=1`). Copy its `withRetry` wrapper (3 attempts, `500 * 2 ** attempt` backoff) so one bad morning is not a red build.

```js
const skip = process.env.VACANT_LIVE === "1" ? false : "set VACANT_LIVE=1 to call Ohio State";
```

Four checks, each its own `test()` so the failing test name says what moved, over at most five requests:

1. **Field shape.** Take the first meeting with a non-null `facilityId` and assert `facilityId`, `facilityType`, `facilityCapacity`, `buildingCode`, `room`, `startTime`, `endTime` and all seven weekday booleans are present, and that `startTime` matches `/^\d{1,2}:\d{2} (am|pm)$/`. That format is what `toMinutes` parses.
2. **ONLINE still exists.** At least one meeting comes back with `buildingCode === "ONLINE"`. The full row today is `{facilityId:'ONLINE', facilityType:'6F', facilityCapacity:998, buildingCode:'ONLINE', room:null}`.
3. **The building join still holds.** Every non-pseudo `buildingCode` seen resolves to a key in `data/buildings.json`.
4. **The harvest axis still exists.** `data.filters` still carries a `catalog-number` facet and it returns more than one bucket. The `bucket-harvester` walk is built on it.

Then `.github/workflows/live-rot.yml`, copied from Finder's `gen-categories.yml`: `schedule` plus `workflow_dispatch` only, `concurrency` with `cancel-in-progress: false`, `VACANT_LIVE: '1'`, no commit step, and `if: ${{ failure() }}` calling `bash .github/alert.sh "Live API shape has changed"`.

### Done when

- [ ] `node --test` with no environment set makes zero network requests and reports the live file as skipped
- [ ] `VACANT_LIVE=1 node --test tests/live-rot.live.test.js` passes against the live API in under 5 HTTP requests
- [ ] All four checks above exist as separate named tests, and each failure message prints the observed value, not just "assertion failed"
- [ ] `live-rot.yml` has no `push` and no `pull_request` trigger
- [ ] Deleting a field from a canned response makes exactly one test fail, and its name identifies the field
- [ ] A forced failure files or comments on one `ops`-labelled issue via `.github/alert.sh`

### Notes

An arbitrary page may hold zero ONLINE rows (850 of 8284 in the sampled harvest), so check 2 needs a request where they are dense. Narrow with the `instruction-mode` facet, and read its value strings off `data.filters` rather than hardcoding `"Distance Learning"`, or the test fails for the reason it exists to detect.

The backing note's third rot check was "facilityDescription still capped at 30 characters and still matching what `buildings.json` was joined on". That is superseded: the join is now `buildingCode` against Ohio State's own GIS layer, so assert on the key. The 30-character cap on `facilityDescription` and 10 on `facilityDescriptionShort` are display facts now, not join facts.

There is no cheap change detector. `X-Target-Hash` is a fingerprint of the request URL, not of the body, so it is identical across two responses whose contents differ. The test has to read the body.

`.github/alert.sh` and the `ops` label both come from `Ship rooms.yml on a Sunday cron, with a failure alerter and a dead-man's switch`. `gh issue create` fails on an unknown label, so the label has to exist before this workflow's first failure.
