---
title: Design the was-it-open report schema and its privacy model before any backend exists
labels: documentation, question
milestone: Phase 4: Reports
estimate: M
order: 28
depends_on: ground-truth-walk
---

Reports are the only thing that can catch a door the Registrar table does not know about, and they are the piece most likely to get built in a hurry the week someone complains. Every shortcut available under pressure either lies to the user or turns a study-room app into a movement trail: an event log with timestamps, a raw percentage off one report, an IP column. Settle the shape now, while there is no deadline. Nothing is built in this issue.

### What to do

Write `docs/design/reports.md` and a `docs/DECISIONS.md` entry covering six calls.

**1. Counters updated in place, never an event log.** The decay model in `building-access.md` section 9 needs `ageDays`, which looks like it needs a per-report timestamp. It does not. Fold the decay into the counter on every write and on the hourly cron, and no report ever gets its own row.

```sql
CREATE TABLE conf (                 -- one row per bucket
  scope TEXT, key TEXT,             -- 'b' + buildingCode, or 'r' + facilityId
  dtype INTEGER,                    -- 0 weekday, 1 Sat, 2 Sun
  slot  INTEGER,                    -- hourOfDay at building scope, 30-min index at room scope
  term  TEXT,
  w_open REAL, w_lock REAL, w_occ REAL,
  reporters INTEGER,                -- count only, no identifiers
  decayed_at INTEGER                -- when decay was last folded in
);
CREATE TABLE seen (                 -- dedupe and rate limit. No room, no building, no scope.
  d TEXT PRIMARY KEY,               -- HMAC(clientKey + bucketId, dailySalt)
  exp INTEGER
);
```

```
POST /r  { r, b, s, tok }           -- s: 0 locked, 1 open, 2 open but occupied
  ck = HMAC(ip, saltForToday())     -- never written next to a room
  d  = HMAC(ck + bucketId, saltForToday())
  reject unless Turnstile passes and tok is the HMAC the Worker issued with that result list
  if seen.has(d) -> 204             -- one vote per key per bucket, later replaces earlier
  if count(ck, today) > 20 -> 429
  decay(row); row.w_<s> += 1; row.reporters += 1; seen.put(d, now + 32d)

decay(row):
  row.w_* *= 2 ** (-(now - row.decayed_at) / 45d)
  row.decayed_at = now
-- termFactor applied at rebuild: 1.00 same term, 0.30 prior term, 0.00 past two, row dropped
```

**2. Building buckets first.** At the measured 8 rooms per building, a building bucket fills roughly 8x faster. Promote to room scope only once that room's own weight beats its building's rate. Cunz Hall, where floor 2 and up locks at 6pm while floor 1 stays open, is what eventually earns room scope.

**3. Wilson lower bound and a label ladder, never a percentage.**

```
reporters < 3            render nothing at all
lb < 0.50                "reported locked"
0.50 <= lb < 0.75        "seen open"
lb >= 0.75               "usually open"
```

**4. Reject Finder's analytics row shape in writing.** `analytics/schema.sql` there stores `(ts, day, path, country, ref, visitor)`. A per-day visitor hash joined across timestamped room rows reconstructs everywhere one person walked that day. Name that row shape in the note so nobody reuses the worker because it already exists.

**5. Override the hours table downward only.** Table says open plus crowd says locked goes to the crowd, because that is the May 2024 case where OSU locked every academic building to BuckID for four days and the Registrar page never changed. Table says closed plus crowd says open never wins, because that is the direction worth attacking and its failure mode is a student walking to a locked building at 2am.

**6. Worker plus D1 plus hourly cron, reads stay static.** Writes POST to the Worker. An hourly cron rebuilds `data/confidence-<term>.json`, a few KB, which the service worker caches alongside `rooms-<term>.json`. The read path never touches the backend, so an outage degrades to yesterday's confidence instead of a spinner.

### Done when

- [ ] `docs/design/reports.md` exists and `docs/DECISIONS.md` links it with a one-line summary of each of the six calls
- [ ] The report payload is written out field by field, is under 100 bytes, and carries no coordinate, no IP, no user agent, no account id and no client clock. Timestamp, weekday and slot are all derived server-side
- [ ] The stored shape is counters keyed on `(buildingCode, dayType, hourOfDay)` and on `(facilityId, weekday, 30-min slot)`, updated in place. The note states in one sentence why no per-report row exists and how decay survives without one
- [ ] Weighting is specified as `termFactor * 2^(-ageDays/45)` with `termFactor` of 1.00, 0.30 and 0.00, and the note shows the worked figure that a week-1 report is worth about 0.2 by finals over a 105-day term
- [ ] A Wilson lower bound is specified with the three worked cases from `building-access.md`: 1 of 1 renders as "seen open once", 9 of 10 as about 0.76, 90 of 100 as about 0.82
- [ ] Display is suppressed below 3 distinct reporters, and the note explains how `reporters` is counted without storing who
- [ ] The abuse-control hash lives in a table with no room column, no building column and no scope column, and the note names its only two columns
- [ ] Finder's `(ts, day, path, country, ref, visitor)` row is named and rejected in writing, with the join that reconstructs a per-person trail spelled out
- [ ] The override direction is decided and written with both arguments named: May 2024 for, scripted false-open against
- [ ] Cloudflare free-tier numbers are re-checked on the day the note is written, and both the figures and the check date are recorded. The 2026-08-26 reading was Workers 100k requests/day, D1 5 GB and 100k row writes/day, Turnstile free with no published cap
- [ ] The four rejected hosting alternatives (KV, Supabase, Firebase, Apps Script) each carry a one-line reason
- [ ] A `/privacy` paragraph is drafted verbatim in the note, ready to paste the day reports ship, stating what a report contains, what the rate-limit hash is, how long it lives and that a single report is never visible to anyone
- [ ] No code is written. No Worker, no D1 database, no Turnstile key, no schema migration

### Notes

Getting anyone to report at all is the unproven part. Freerooms shipped ratings and still only rates cleanliness, location and quietness, with no access field, which suggests access is harder to collect than it looks. illiniSpots is the only project in the category that actually closes the locked-door gap, and it does it with four stacked data sources and a full backend (Supabase, Hono on Bun, Fly.io, Mapbox, Sentry, cron), not with a crowd. Design for reports staying sparse forever: sparse has to render as nothing, not as a shrug.

This is blocked by `Walk to twenty rooms the app calls free and record what was actually true` on purpose. That walk is the first real data on what the door actually does, and it should set the label thresholds rather than the other way round.

OSU's 2024 University Space Standards designates classrooms "closed for public use, unless otherwise specified". Whatever the crowd says, a result is never phrased as permission to enter. "Usually open" describes a door, not an entitlement, and the locked-door line stays on the row at every confidence level.

`s: 2`, open but occupied, is worth the extra button. It is the only signal that catches the club meeting and the review session, which is the half of the honest hole that building hours cannot reach.
