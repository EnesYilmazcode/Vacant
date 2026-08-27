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
looks like an attack in a log. Vacant needs roughly 280 requests a week, so it
runs at `CONCURRENCY 2` / `DELAY_MS 500`, about 2.9 req/s, and the timeout goes
from Finder's 30 s to 60 s.

`MAX_REQUESTS = 3000` is a module-level cap that throws rather than fetches. A
full two-pass term harvest is 272 requests, so that is an order of magnitude of
headroom and still nowhere near abusive. A runaway loop against a university API
is the failure that gets the whole project blocked, and it is worth a hard stop.

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
