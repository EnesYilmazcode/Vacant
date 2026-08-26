---
title: Snapshot terms 1262 and 1264 before Spring 2026 leaves the API on August 31
labels: data, ops
milestone: Phase 0: Setup
estimate: S
order: 2
depends_on: repo-scaffold-pages-licence
---

A term that drops out of `searchableTermsV2` is deleted from the search index, not hidden. `term=1258` (Autumn 2025) returns `totalItems: 0` today; `term=1262` returns 25,274 sections. Spring 2026 leaves the list on **2026-08-31**, Summer 2026 (`1264`) on 2027-01-01. After that nothing can re-fetch them at any price, so whatever is committed is the only copy that will ever exist. This is the one irreversible item in the backlog and it does not wait for `Harvest a full term by walking the catalog-number buckets twice, as a polite client`.

### What to do

`scripts/snapshot-term.mjs`, standalone and deliberately crude. No inversion, no guards, no schema, no dedupe. Read the bucket list off the `catalog-number` facet instead of hardcoding `1xxx..8xxx`, since a smaller term may not have all eight.

```
term = argv[2]
head = GET /v2/classes/search?q=&campus=col&term=<term>&p=1&sort=catalogNumber
assert head.data.totalItems > 0            # otherwise the term already expired
buckets = head.data.filters[slug=catalog-number].values

for bucket of buckets:
  p1 = GET ...&catalog-number=<bucket>&p=1   -> data/raw/<term>/<bucket>-p01.json
  for n in 2..p1.data.totalPages:            # totalPages == ceil(totalItems/200)
    GET ...&p=<n>                            -> data/raw/<term>/<bucket>-p<NN>.json
print requestCount, and per bucket: reported totalItems vs sections written
```

Sequential, 500 ms pause, 60 s timeout, three retries, User-Agent naming the project and repo. Term 1268 takes 136 requests over 8 buckets (14/13/10/32/12/12/15/28 pages). At 25,274 and 15,178 sections, expect roughly 130 and 80 pages, about 215 requests total, under five minutes at the measured 383 ms per request.

### Done when

- [ ] `scripts/snapshot-term.mjs` takes a term code, reads buckets off the `catalog-number` facet, writes one file per page under `data/raw/<term>/`
- [ ] Page numbers are zero padded, so `p02` sorts before `p10`
- [ ] Exits non-zero with a named error when `totalItems` is 0 for the term or any bucket
- [ ] Sequential with a 500 ms pause, `AbortSignal.timeout(60000)`, and a User-Agent containing `Vacant` and the repo URL
- [ ] The run prints its total request count, and per bucket the reported `totalItems` against sections written
- [ ] `data/raw/1262/` and `data/raw/1264/` committed on `main` before 2026-08-31
- [ ] `docs/DECISIONS.md` records that a term absent from `searchableTermsV2` cannot be re-fetched, that the committed snapshot is therefore the only copy, and that `FORCE_WRITE=1` over a collapsed harvest is unrecoverable

### Notes

**Size.** A search page is about 500 KB uncompressed (measured 524,595 bytes for 200 sections), so both terms are roughly 105 MB and git carries it forever. The same page gzips to 34,523 bytes, 15.2x smaller, putting the whole snapshot near 7 MB. Prefer that and name the files `<bucket>-p<NN>.json.gz`.

**Instructor PII.** Every meeting carries `instructors[].email` with real `osu.edu` addresses, 208 occurrences in one page of one subject. A raw dump of both terms puts tens of thousands in a public repo, and the PII guard in `Filter meetings to real Columbus rooms with a counted funnel...` covers the emitted room index, not these archives. Either `delete section.instructors` before writing, which is one line and leaves the rest verbatim, or keep `data/raw/` out of the published site and say so in `docs/DATA.md`.

Sorted paging is about 98% deterministic, so a snapshot can miss a section or two. Do not add a reconciliation loop. Printing reported `totalItems` against sections written says how close it got, and these dumps are also the input to the cross-term `facilityType` stability check and to `SPIKE: does a genuinely never-scheduled room exist in our own data?`.
