---
title: Harvest a full term by walking the catalog-number buckets twice, as a polite client
labels: data, enhancement
milestone: Phase 1: Data pipeline
estimate: L
order: 6
depends_on: repo-scaffold-pages-licence
---

Vacant needs every section in a term, not a subject index. Finder walks 243 subjects because it is building one, and pays about 1,142 requests to do it, roughly 1,000 of which are the reconciliation loop and the Barrett scrape. The `catalog-number` facet covers the same 26,298 sections in 136 requests, and Finder already sweeps that facet inside `discoverSubjects` before doing anything else. This issue takes the bucket walk and stops there.

### What to do

Pull Finder's fetch plumbing into `scripts/lib/fetch.mjs` (`fetchWith`, `fetchJson`, `retryAfterMs`, `mapLimit`, from `Finder/scripts/fetch-courses.mjs:84-149`) with a provenance comment naming the upstream file. Then retune, because Finder's `CONCURRENCY = 5` / `DELAY_MS = 120` against a box that answers in 128 ms p50 sustains about 15.6 req/s, which is the request shape that looks like an attack in a log.

Then `scripts/fetch-rooms.mjs`:

```
buckets = filters.find(f => f.slug === 'catalog-number').items.map(i => i.term)
if (!buckets.length) throw            // never hardcode 1xxx..8xxx
for bucket in buckets:
  head  = GET p=1&catalog-number=bucket
  pages = min(ceil(head.totalItems/200), head.totalPages, MAX_PAGES)
  walk p=1..pages
run the whole walk twice, union on:
  classNumber|meetingNumber|facilityId|startTime|endTime|standingMeetingPattern|startDate
```

Measured page counts for 1268, for the log to be checked against: `1xxx=14 2xxx=13 3xxx=10 4xxx=32 5xxx=12 6xxx=12 7xxx=15 8xxx=28`, 26,298 sections.

### Done when

- [ ] `scripts/lib/fetch.mjs` exports `fetchWith`, `fetchJson`, `retryAfterMs`, `mapLimit`, with a comment naming `EnesYilmazcode/Finder scripts/fetch-courses.mjs` as upstream
- [ ] Timeout is 60000 ms (was `AbortSignal.timeout(30000)` at `fetch-courses.mjs:102`); `CONCURRENCY = 2`, `DELAY_MS = 500`, for about 2.9 req/s
- [ ] `RETRIES = 3`, backoff `500 * 2 ** (attempt - 1)`, `RETRY_STATUS = {408, 425, 429}`, one bonus retry on 403, `Retry-After` honoured and clamped to 30000 ms, otherwise unchanged from Finder
- [ ] A module-level request counter throws past `MAX_REQUESTS = 3000`, and the final count prints on both the success and the failure path
- [ ] The user agent names the project, the repo URL, a reachable contact, the purpose and the weekly volume. No `Accept-Encoding` header is set by hand
- [ ] `scripts/fetch-rooms.mjs` reads buckets off the `catalog-number` facet and throws if the facet is absent or empty
- [ ] Pages per bucket come from `ceil(totalItems / 200)` and the run logs a warning if that disagrees with `totalPages`
- [ ] The walk runs twice and unions on the seven-field meeting key; if pass 2 adds more than 0.5% new meetings the run exits non-zero and prints the count and a sample of five added keys
- [ ] The 0.5% gate is advisory (warn, exit 0) for the first three runs; the observed drift for each is written into `docs/research/harvest-feasibility.md` before it is made fatal
- [ ] Bucket 1xxx is confirmed lossless against a subject walk of two 1000-level-heavy subjects, and the result is appended to `docs/research/harvest-feasibility.md`
- [ ] Per-bucket page count, section count and cumulative request count print for each bucket
- [ ] Offline tests with a stub fetch cover: retry on 429, the 403 bonus retry, `Retry-After` clamping to 30 s, and the `MAX_REQUESTS` abort. `node --test` with no env set makes zero network calls

### Notes

The losslessness proof today rests on 3xxx alone (400 of 400 sections from a ten-subject walk were present in the bucket walk). 1xxx is the classroom-dense bucket Vacant actually depends on, and confirming it is about 20 requests, so it belongs in this issue and not in the open-questions list.

The two passes are not paranoia about a repeat measurement. Three back-to-back pulls of `subject=math` with `sort=catalogNumber` gave meeting-key intersection 508 = union 508, but Finder separately measured 2 of 674 sections still moving across eight sorted pulls of `q=Smith`. Sorting makes paging about 98% deterministic. A dropped section is a room that falsely reads empty, which is a wrong answer rather than a missing one, so the second pass is cheap insurance at 136 extra requests.

The API sends no rate-limit, `ETag`, `Last-Modified` or `Cache-Control` header, so there is no conditional GET to fall back on and fewer, slower requests is the only lever. It sits behind a Citrix NetScaler WAF, so a burst comes back as 403 rather than 429. That is why the 403 bonus retry exists, and it also means a genuinely blocked harvester looks twitchy rather than throttled. If 403s start repeating across a run rather than clearing on the retry, stop and treat it as a block.
