# The was-it-open report layer, designed before anything is built

**Nothing here is built.** There is no Worker, no database, no Turnstile key and
no report button. This note exists so that the day somebody complains that a door
was locked, the design is already settled and nobody has to invent a schema under
pressure. Every shortcut available under pressure either lies to a student or
turns a study-room app into a movement trail.

Reports are the only thing that can catch a door the Registrar's table does not
know about. They are also the only feature in the whole plan that cannot be a
static file. Both of those are reasons to be slow about it.

Written 2026-08-27. Six calls, then the rejections.

---

## The rule this is designed to

From `BACKLOG.md`, parked and answered:

> Let reports supplement but never override until a bucket has 3 or more distinct
> reporters, then let them override the hours table but never the class schedule.

Everything below is an attempt to make that rule true in a database rather than
in a sentence.

---

## 1. Counters updated in place. There is no event log

The decay model needs `ageDays`, which looks like it needs a timestamp on every
report. It does not. Fold the decay into the counter on every write and once an
hour on a cron, and no report ever gets a row of its own.

```sql
CREATE TABLE conf (                 -- one row per bucket, updated in place
  scope      TEXT,                  -- 'b' + buildingCode, or 'r' + facilityId
  dtype      INTEGER,               -- 0 weekday, 1 Sat, 2 Sun
  slot       INTEGER,               -- hourOfDay at building scope, 30-min index at room scope
  term       TEXT,
  w_open     REAL,
  w_lock     REAL,
  w_occ      REAL,
  reporters  INTEGER,               -- a count. No identifiers, ever
  decayed_at INTEGER,               -- when decay was last folded in
  PRIMARY KEY (scope, dtype, slot, term)
);

CREATE TABLE seen (                 -- dedupe and rate limit. Two columns. That is the whole table
  d   TEXT PRIMARY KEY,             -- HMAC(clientKey + bucketId, saltForToday())
  exp INTEGER
);
```

**Why no per-report row:** a row is a record that a person was at a place at a
time, and rows join. There is nothing to leak, subpoena or accidentally dump in a
stats endpoint if the rows do not exist. Decay survives without them because
decay is a multiplication, and multiplying a running total by `2^(-elapsed/45d)`
gives the same answer as decaying each report separately and re-adding them. The
sum of the decayed parts equals the decayed sum. That identity is the entire
reason this design is possible.

`decayed_at` is the only clock in the table, it is per bucket rather than per
person, and it is a maintenance field.

```
decay(row):
  row.w_* *= 2 ** (-(now - row.decayed_at) / 45d)
  row.decayed_at = now
```

**Cardinality, on the shipped Autumn 2026 index:**

```
buildings                          96
rooms                             871

building buckets  96 x 3 x 24   6,912
room buckets     871 x 7 x 48 292,656   the ceiling, never populated
```

The `seen` table is the only thing that grows with traffic, and it is bounded by
a 32-day expiry.

## 2. The payload

Field by field. Everything else the server needs, it works out itself.

```jsonc
POST /r
{
  "r":   "DL0357",   // facilityId. Omitted entirely for a building-level report
  "b":   "279",      // buildingCode, denormalised so a building rollup needs no join
  "s":   1,          // 0 locked, 1 open, 2 open but occupied
  "tok": "kJ8vQ..."  // the HMAC the Worker issued with that result list
}
```

Measured, not estimated:

```
{"r":"DL0357","b":"279","s":1,"tok":"kJ8vQ2mR7wX1nB4tYc9pLa"}          61 bytes
{"b":"279","s":1,"tok":"kJ8vQ2mR7wX1nB4tYc9pLa"}                       48 bytes
{"r":"BO0405/415","b":"1064","s":2,"tok":"kJ8vQ2mR7wX1nB4tYc9pLa"}     66 bytes
```

The third is the worst case: `BO0405/415` is the longest `facilityId` in the
871-room index and `1064` the longest building code. So the payload is under 100
bytes at its largest, and there is no version of it that is not.

**What is not in it, and is rejected if it appears:**

| Not sent | Why |
| --- | --- |
| Any coordinate | The client already knows which room the user tapped. The server has no use for a position. If proximity is ever wanted, test it on the client and send a boolean |
| The client clock | Never trust it, and never need it. The server stamps the time |
| Weekday, hour, slot | All derived server-side from the server's own clock. Accepting them lets a client write into any bucket it likes |
| IP address | Not stored. It is hashed with a rotating salt, in a different table, and see the section on Finder's row below |
| User agent | Nothing needs it, and it is a fingerprint |
| Any account id | There are no accounts and there never will be |
| A term code | Derived server-side. The server knows what term it is |

`s: 2`, open but occupied, is worth its own button. It is the only signal that
catches the club meeting and the review session, which is the half of the honest
hole that building hours cannot reach.

## 3. Building buckets first, rooms only when earned

At the measured 8.5 rooms per shipped building (871 over 96), a building bucket
fills roughly eight times faster than a room bucket. The door is mostly a
building-level fact anyway.

So every report writes its building bucket. It also writes its room bucket, which
stays invisible until that room's own weight beats its building's rate. Cunz
Hall, where floor 2 and up locks at 6pm while floor 1 stays open, is the case
that eventually earns room scope, and it will take real traffic to earn it.

## 4. Weighting, and the worked number

```
weight     = termFactor * 2 ** (-ageDays / 45)

termFactor = 1.00   same term
             0.30   the previous term      (hours are republished every term, so this is weak)
             0.00   more than two terms old, and the row is dropped at rebuild
```

Bucket first, then decay. The real question is not how old a report is, it is how
similar that moment was to this moment. A Tuesday 8pm report from week 3 says a
lot about Tuesday 8pm in week 12 and nothing at all about Sunday 8pm, however
fresh it is. The term factor is what stops a March report driving an August
answer, more cleanly than any half-life can, because the Registrar genuinely
republishes the table each term.

Computed at a 45-day half-life:

```
age  0 days   1.000
age  7 days   0.898
age 21 days   0.724
age 45 days   0.500
age 90 days   0.250
age 98 days   0.221
```

**A report filed in week 1 is worth 0.221 when it is read during finals**, taking
a 105-day term and reading at day 105 a report filed on day 7. That is the shape
wanted: still counted, no longer deciding.

## 5. A Wilson lower bound, never a percentage, and the research's numbers do not add up

Never show a raw percentage off a small sample. One lucky report must not render
as 100%.

**The three worked cases in the issue cannot come from one confidence level, and
this was checked rather than assumed.** The issue asks for 1 of 1, 9 of 10 at
about 0.76, and 90 of 100 at about 0.82. Computed:

```
                              1 of 1   9 of 10   90 of 100
z = 1.960  (95% two-sided)     0.207     0.596       0.826
z = 1.645  (95% one-sided)     0.270     0.652       0.840
z = 1.282  (90% one-sided)     0.378     0.718       0.855
z = 1.000                      0.500     0.766       0.866
```

The 0.76 is a `z = 1` figure and the 0.82 is a `z = 1.96` figure. They were
carried over from `research/building-access.md` section 9 and they came from
different calculations. Neither number should be pasted into anything.

**Decided: `z = 1.645`, the 95% one-sided lower bound.** One-sided is the correct
statistic, because the only thing that matters is how bad the truth could be.
Two-sided is the wrong tool and it is also unusable here: at `z = 1.96` the first
state a user can ever see, three people all saying open, scores 0.439 and would
render as "reported locked". Three people said open. Labelling that "locked" is
not caution, it is a different wrong answer.

Computed at `z = 1.645`, for all-open runs:

```
 3 of 3    0.526        10 of 10   0.787
 4 of 4    0.597        15 of 15   0.847
 5 of 5    0.649        20 of 20   0.881
 6 of 6    0.689        50 of 50   0.949
```

and for mixed evidence:

```
 2 of 3    0.254         9 of 10   0.652
 3 of 4    0.356        15 of 20   0.568
 4 of 5    0.435        18 of 20   0.738
 5 of 6    0.498        45 of 50   0.808
```

**The ladder.** The issue's version forces every bucket into a label. That is the
one thing this project is not allowed to do, so there is a fifth rung and it
renders nothing.

```
reporters < 3                                       render nothing at all
lb >= 0.75                                          "usually open"
lb >= 0.50                                          "seen open"
lb <  0.50 and the weighted majority says locked    "reported locked"
otherwise                                           render nothing at all
```

That last rung is the case where four people said open and one said locked: a
0.435 lower bound is not enough to claim "seen open", and calling it "reported
locked" would misreport what the crowd actually said. The honest render is
nothing, and the row falls back to the line it always carries: no class is
scheduled here, the door may still be locked.

Note that the counts are decayed weights, not integers, so this is Wilson on a
weighted proportion, which is an approximation. It is a fine one at these sample
sizes and it should be described that way rather than as an exact interval.

**`reporters` is counted without storing who.** The count increments only when
the write is not a duplicate, which is to say only when `seen` did not already
hold `d` for that person and that bucket. So `reporters` is the number of
distinct `d` values that have ever hit the bucket, and no `d` is ever stored next
to the bucket. The number survives; the identity was never written down.

**The research's "1 of 1 renders as seen open once" is overruled.** It
contradicts the k-of-3 suppression floor, which is a privacy rule and wins. One
report is one person. It renders nothing.

## 6. The override direction: downward only

**Table says open, crowd says locked: believe the crowd.**

That is the May 2024 case, when Ohio State locked every academic building to
BuckID for four days and the Registrar's page never changed. Every app in this
category, including this one without the override, would have sent students
across campus to locked doors for four days straight with no mechanism to learn
otherwise.

**Table says closed, crowd says open: the table wins, always.**

This is the direction worth attacking. Its failure mode is a student walking to a
building at 2am because a stranger clicked a button, and the abuse costs nothing:
three throwaway sessions on three networks is an afternoon's work for one person
and a scripted job for anyone with a grudge or a joke. The upside is convenience,
the downside is a walk across campus in the cold at night. Those are not
symmetric and the design should not pretend they are.

**The class schedule is never overridden in either direction.** A room with a
class in it is not free no matter how many people say the door was open. The
crowd answers a question about doors, not about occupancy, and `s: 2` exists
precisely so that "I got in and it was full" has somewhere to go that is not "it
was free".

**And no confidence level ever reads as permission.** Ohio State's 2024
University Space Standards designates classrooms "closed for public use, unless
otherwise specified". "Usually open" describes a door. It does not describe an
entitlement, and the locked-door line stays on the row at every confidence level,
including the highest one.

---

## Finder's analytics row is named here so nobody reuses it

`EnesYilmazcode/Finder`'s `analytics/schema.sql` stores:

```
(ts, day, path, country, ref, visitor)
```

where `visitor` is `SHA-256(salt + day + ip + userAgent)` truncated to 8 bytes,
with the day in the hash input so it rotates at midnight UTC. **For page counts
that design is good and it should be reused as is.** Its own README is right that
no IP reaches storage.

**For room reports it is a disaster, and the reason is the join.** Swap `path`
for a room and it becomes:

```sql
SELECT room, ts FROM reports WHERE visitor = ? AND day = ? ORDER BY ts;
```

One query. One person's day, room by room, in order, with timestamps: left
Dreese at 2:47pm, was in Baker at 3:20pm, in Thompson at 6pm. That is a movement
trail, reconstructed from a table whose author correctly believed it stored no
personal data, because for its actual purpose it does not. The `visitor` hash
does not have to be linkable to a name to be harmful. It only has to be linkable
to itself, and a per-day hash is linkable to itself all day.

Three properties break the join, and this design has all three:

1. There are no per-report rows, so there is no `ORDER BY ts`.
2. The rate-limit hash lives in `seen`, whose only two columns are `d` and `exp`.
   No room, no building, no scope, nothing to join a room onto.
3. `d` is `HMAC(clientKey + bucketId, dailySalt)`, so the same person in two
   different buckets produces two unrelated values. Even if `seen` were joined to
   something, the same person does not look like the same person twice.

The Worker computes `clientKey = HMAC(ip, saltForToday())` in memory and never
writes it anywhere. It exists for the length of one request.

---

## Abuse control, without accounts

The value of cheating here is near zero, so the goal is to stop casual nuisance
without a login that would kill the one-tap promise.

1. **Cloudflare Turnstile**, invisible, on submit.
2. **A signed query token.** When the app renders a result list, the Worker issues
   a short-lived HMAC keyed to the rooms it offered and the hour it offered them.
   A report then has to correspond to a room the app actually surfaced, at about
   the time it surfaced it. That removes scripted bulk submission, which is the
   only attack that scales.
3. **One vote per key per bucket.** `seen` holds it for 32 days. A later report
   from the same key in the same bucket replaces the earlier one rather than
   stacking.
4. **A cap of 20 reports a day per client key**, far more than an honest user
   produces and far less than an attack needs.
5. **No single bucket can flip a building on its own.**

Deliberately not doing: accounts, email verification, BuckID SSO, GPS proof. Each
costs more trust and friction than the abuse it prevents, and BuckID SSO would
put a university credential into a student project, which is never happening.

None of this survives a determined attacker with a botnet. It is not meant to.
The override direction above is what makes that acceptable: the attack worth
mounting, forging "this locked building is open", cannot win no matter how many
reports it produces.

---

## Where it would run, re-checked today

**Cloudflare Workers, one D1 database, one hourly cron, Turnstile on submit.**
Reads stay static:

```
   phone --POST /r--> Worker --> D1
                        |
                   cron, hourly
                        |
                        v
             data/confidence-<term>.json   (a few KB)
                        |
   phone <---- GET, cached by the service worker, exactly like rooms-<term>.json
```

The read path never touches the backend, so the app still answers with the
network off and an outage degrades to yesterday's confidence instead of a
spinner. That is not a nice-to-have. It is the property the whole product rests
on, and no report feature is allowed to break it.

**Free-tier figures, read from Cloudflare's own docs on 2026-08-27:**

| | Free tier | Source page |
| --- | --- | --- |
| Workers requests | 100,000 / day | Workers pricing, page updated 2026-07-28 |
| Workers CPU | 10 ms per invocation | Workers pricing |
| D1 rows read | 5,000,000 / day | D1 pricing |
| D1 rows written | **100,000 / day** | D1 pricing |
| D1 storage | 5 GB per account, 500 MB per database | D1 limits, page updated 2026-04-21 |
| D1 queries per Worker invocation | **50** | D1 limits |
| Turnstile | Free, **unlimited challenges**, up to 20 widgets, 10 hostnames per widget | Turnstile plans |

Two of these corrected the 2026-08-26 reading and both matter:

- **500 MB per database**, not 5 GB. The 5 GB is the account total. Irrelevant at
  6,912 building buckets, and worth not being surprised by.
- **50 D1 queries per Worker invocation on the free plan.** The hourly rebuild
  cannot walk buckets one query at a time. It has to read the whole `conf` table
  in a handful of statements and do the arithmetic in the Worker. Writing that
  loop the obvious way would hit the cap at bucket 51.

100,000 row writes a day against 6,912 building buckets is roughly a hundred
times more headroom than this will ever need. Vendors move these numbers, so
re-check on the day anything gets built and write the new date here.

### The four alternatives, each with its reason

| Rejected | Reason |
| --- | --- |
| Workers + **KV** instead of D1 | 1,000 writes a day, and KV cannot aggregate. The write cap alone kills it |
| **Supabase** | Pauses free projects after inactivity, which is fatal for something used in bursts between classes and then not at all over a break |
| **Firebase** | A heavier client SDK than a 61-byte POST deserves, and it pushes abuse control toward client-side rules, which is the wrong place for it |
| **Google Apps Script + Sheets** | Zero infrastructure and readable in a spreadsheet, but hundreds of milliseconds per call, awkward CORS, and it will not survive real traffic. A two-week experiment at most |

---

## The privacy paragraph, ready to paste

This is already live on `privacy.html`, inside a block that says the feature has
not shipped. On the day it does, the block loses its wrapper and this text stands
unchanged:

> **When you report a room.** Tapping "it was open" or "it was locked" sends the
> room and the half-hour block, and nothing else. Not your location, not the exact
> time, not who you are. We add one to a counter. There is no row anywhere
> recording that a particular person reported anything, because there are no
> per-report rows at all. To stop one person voting a thousand times we keep a
> scrambled, one-way number worked out from your connection for about a month, in
> a separate list that has no room in it, no building in it, and no way to be
> joined back to any room. A room's "usually open" label only appears once at
> least three different people have reported it, so a single report is never
> visible to anyone.

---

## What has to happen before any of this is built

**The ground-truth walk comes first.** Walking to twenty rooms the app calls free
and writing down what was actually true is the only real data anyone has on what
the door does. It should set the label thresholds, not the other way round. The
0.50 and 0.75 cut points above are defensible arithmetic on no observations at
all, and they are placeholders until somebody has stood in front of twenty doors.

**Getting anyone to report at all is the unproven part.** Freerooms shipped
ratings and still only collects cleanliness, location and quietness, with no
access field, which suggests access is harder to collect than it looks.
illiniSpots is the only project in the category that actually closes the
locked-door gap, and it does it with four stacked data sources and a full
backend, not with a crowd.

So design for reports staying sparse forever. Sparse has to render as nothing,
not as a shrug. Every rung of the ladder above falls back to silence, and the app
has to be exactly as good with an empty `conf` table as it is today.
