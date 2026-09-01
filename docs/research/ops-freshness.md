# Ops and freshness: keeping Vacant correct with nobody watching

Research note, 2026-08-26. Every number below was measured. The commands are in
[Appendix A](#appendix-a-what-was-run). 54 HTTP requests against `content.osu.edu`,
1 against `registrar.osu.edu`, sequential, with a pause between them.

---

## The one thing to read if you read nothing else

**One sentence on the problem:** once a term drops out of `searchableTermsV2`, the API
returns zero sections for it forever, so a build that overwrites a good `rooms-*.json`
with a bad one has destroyed data that cannot be re-fetched from anywhere.

**One sentence on the fix:** the refusal guard is not tidiness, it is the only backup,
so the workflow must treat "write nothing and go red" as the normal safe outcome and
must be able to tell Enes it went red through a channel he actually reads.

Measured, today:

```
GET /classes/search?term=1262  (Spring 2026, still searchable)  ->  25,274 sections
GET /classes/search?term=1258  (Autumn 2025, left the list)     ->        0 sections
```

Spring 2026 leaves the searchable list on **2026-08-31, five days from now**. After
that its data is gone from the API. If Vacant had been running since January, the
committed `rooms-1262.json` would be the only copy of Spring 2026's room grid in
existence.

```
   THE FAILURE FINDER HAS            THE FAILURE VACANT HAS
   ----------------------            ----------------------
   the job goes red                  the job goes quiet
        |                                 |
        v                                 v
   a red X on the repo               nothing anywhere is red
        |                                 |
        v                                 v
   the site keeps serving            the site keeps serving
   last night's good data            a confident wrong answer
        |                                 |
        v                                 v
   noticed within a week             noticed when a student walks
   because seats look stale          into an occupied lecture hall
```

A stale course index looks stale. A stale room grid looks like good news, because
[the port note measured](finder-port-map.md) that 81% of campus reads free even on a
healthy day. So the alerting cannot depend on anyone noticing.

---

## 1. What Finder already has

`C:/Users/galax/Downloads/Projects/Finder/.github/workflows/` holds five files. All
five are currently green.

| File | Trigger | What it does | Verdict for Vacant |
|---|---|---|---|
| [`courses.yml`](../../../Finder/.github/workflows/courses.yml) | `40 8 * * 1` (Mon) plus dispatch with `force` and `dropTerms` | Rebuilds `data/courses.json`, commits if changed | **The template.** Copy the structure, change the cron, script and pathspec |
| [`seats.yml`](../../../Finder/.github/workflows/seats.yml) | `30 12 * * *` daily plus dispatch with `term`, `force`, `dropTerms` | Per-term seat files, commits under `if: !cancelled()` | Copy the `!cancelled()` reasoning and the per-term `git add` pathspec trick |
| [`ratings.yml`](../../../Finder/.github/workflows/ratings.yml) | `20 7 * * *` daily plus dispatch with `force` | RateMyProfessors snapshot | Nothing to port |
| [`gen-categories.yml`](../../../Finder/.github/workflows/gen-categories.yml) | `10 9 * * 2` (Tue) | Live rot detector, runs a `--test` file against the real API, writes nothing | **Copy the pattern.** This is the shape of Vacant's term watcher |
| [`test.yml`](../../../Finder/.github/workflows/test.yml) | push, pull_request | `node --test`, no install step | Copy as is |

Three details in there are load bearing and easy to miss:

1. **Every writer runs `concurrency: { group: <name>, cancel-in-progress: false }`.**
   A scheduled run and a manual dispatch can overlap, and cancelling the in-flight one
   is how you get a half-written file.
2. **Every writer ends with `git pull --rebase origin ${{ github.ref_name }}` before
   pushing**, because three jobs commit to the same branch on different schedules.
3. **`git add` is fatal on a pathspec that matches nothing**, which is why `seats.yml`
   writes `$(git ls-files -co -- 'data/trend-*.json')` instead of a bare glob. Vacant
   will hit this the first time a term rolls over and a file does not exist yet.

### What Finder does not have, and Vacant needs

- No failure notification of any kind. If `seats.yml` starts failing, the only signal
  is a red X on a repo page nobody opens.
- No check that the job ran at all. A red job alerts. A job that never fires cannot.
- No staleness contract in the app. Finder's site will happily serve a month-old
  `seats.json` with no indication.

### The measured cron delay, which changes the scheduling advice

Finder's workflow comments reason about landing "off the top of the hour so the run
does not sit in GitHub's busiest scheduling window". Measured against ten real
scheduled runs on this account:

```
Seats snapshot     2026-08-26T13:32  cron+62.2 min
Ratings snapshot   2026-08-26T08:04  cron+44.0 min
Seats snapshot     2026-08-25T13:27  cron+57.1 min
GE categories      2026-08-25T09:47  cron+37.7 min
Ratings snapshot   2026-08-25T08:03  cron+43.0 min
Seats snapshot     2026-08-24T13:29  cron+59.3 min
Course index       2026-08-24T09:28  cron+48.4 min
Ratings snapshot   2026-08-24T08:07  cron+47.7 min
Seats snapshot     2026-08-23T13:09  cron+39.6 min
Ratings snapshot   2026-08-23T07:51  cron+31.4 min

n=10  min=31  median=48  mean=47.0  max=62 minutes late
```

**Every single run was more than half an hour late, and the off-the-hour minutes did
not help.** `20`, `30`, `40` and `10` past the hour all drew 31 to 62 minutes. So do
not tune the minute field. Budget an hour of slack and pick a time where an hour of
slop costs nothing.

---

## 2. The workflow design

Four files. One writes, three watch.

### 2.1 `rooms.yml`, the weekly build

**Schedule: `cron: '25 7 * * 0'`, Sunday 07:25 UTC.** That is Sunday 3:25am Eastern in
summer, 2:25am in winter, and with the measured ~47 minute delay it actually lands
around 4:10am Sunday.

Justifying the day and the hour:

- **Sunday, not Monday.** The room grid's job is to be right for the teaching week that
  starts the next morning. A Sunday build is at most a few hours old when the week
  begins and at most 7 days old when it ends. A Monday build is already stale for
  Monday itself if it lands after 9am, which at a 62 minute worst case it can.
- **Not Friday or Saturday**, because a build that fails on Friday sits broken through
  the weekend and a manual re-run cannot happen until Enes looks.
- **The hour is chosen so an hour of GitHub slop is free.** Anywhere between 2am and
  6am Eastern is equally fine. `25` past is arbitrary and, per the measurement above,
  makes no difference.
- **This does not need to catch OSU's publication window, because OSU does not have
  one that matters here.** Room assignments inside a live term barely move, which is
  the entire reason the README picked weekly. The discontinuous event is a new term
  appearing, and that gets its own watcher below.

What is genuinely known about OSU's publishing rhythm, measured:

```
strm   term         searchable from  weekday    searchable until  weekday
1262   Spring 2026  2025-09-08       Monday     2026-08-31        Monday
1264   Summer 2026  2026-01-26       Monday     2027-01-01        Friday
1268   Autumn 2026  2026-02-09       Monday     2027-01-31        Sunday
```

**All three visibility windows open on a Monday.** The `searchableTermsV2` document
itself carries `"updated": "2026-02-09T09:56:13.199Z"` and `"_rev": "91-..."`, and that
update timestamp is exactly Autumn 2026's opening Monday. So new terms land on Mondays,
which is what the Tuesday term watcher is for. A Sunday room build finding out about a
Monday term six days late costs nothing, because a term that has just become searchable
has no usable room assignments yet anyway.

**Structure**, deliberately close to `courses.yml`:

```yaml
name: Room index

# Sunday rather than Monday: the grid has to be right for the week that starts
# the next morning, and GitHub runs scheduled jobs 31 to 62 minutes late on this
# account (measured over 10 runs, median 48), so a Monday morning slot can land
# after the first class of the week has already started.
on:
  schedule:
    - cron: '25 7 * * 0'
  workflow_dispatch:
    inputs:
      force:
        description: 'Write even when a term comes back far short of what is committed'
        type: boolean
        default: false
      dropTerms:
        description: 'Accept a term that has left the searchable list'
        type: boolean
        default: false

permissions:
  contents: write
  issues: write        # the failure step opens one tracking issue

concurrency:
  group: rooms
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Build the room index
        env:
          FORCE_WRITE: ${{ inputs.force && '1' || '' }}
          ALLOW_TERM_DROP: ${{ inputs.dropTerms && '1' || '' }}
        run: node scripts/fetch-rooms.mjs

      # The harvester writes a term's file the moment that term clears its own
      # guards, and exits non-zero if any other term refused. !cancelled() is
      # success or failure, so the terms that were fine still land while the job
      # goes red for the one that was not. writeAtomic means there is no
      # half-written file to pick up after a crash.
      - name: Commit if changed
        if: ${{ !cancelled() }}
        run: |
          git add -A -- data/current.json 'data/rooms-*.json' data/terms.json
          if git diff --cached --quiet; then
            echo "No room file changed, nothing to commit."
            exit 0
          fi
          git diff --cached --name-status
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git commit -m "Update the room index"
          git pull --rebase origin ${{ github.ref_name }}
          git push origin HEAD:${{ github.ref_name }}

      - name: Say so, loudly
        if: ${{ failure() }}
        env:
          GH_TOKEN: ${{ github.token }}
        run: bash .github/alert.sh "Room index build failed"
```

### 2.2 How Enes finds out, given he is not watching

This is the part Finder gets wrong, so it needs its own answer. Four channels, in
increasing order of how likely they are to work.

| Channel | Catches | Reaches him? |
|---|---|---|
| GitHub's own failed-workflow email | a red run | Only the first failure in a streak, and only if scheduled-run notifications are on. Weak |
| A README status badge | a red run | Only when he opens the repo. Useless for this |
| **An auto-filed GitHub issue** | a red run | **Yes.** It is a notification he already gets, and unlike an email it persists until closed |
| **The app's own staleness banner** | a red run *and* a job that never ran | **Yes, and it is the honest one.** He is a user of his own app |

Recommended: the issue plus the banner, and skip the badge.

`.github/alert.sh`, so both watchers share one implementation and neither spams:

```bash
#!/usr/bin/env bash
# One open issue per failure mode, reused rather than re-filed, because a weekly
# job that has been broken for a month should be one issue with four comments,
# not four issues.
set -euo pipefail
title="$1"
marker="<!-- vacant-ops:$(echo "$title" | tr ' A-Z' '-a-z') -->"
body="$marker
\`$title\` on $(date -u +%Y-%m-%dT%H:%MZ).

Run: $GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID

Nothing was committed, so the site is still serving the last good data.
It will keep getting older until this is fixed."

existing=$(gh issue list --state open --label ops --search "$marker" --json number --jq '.[0].number' || true)
if [ -n "$existing" ]; then
  gh issue comment "$existing" --body "$body"
else
  gh issue create --title "$title" --label ops --body "$body"
fi
```

The `ops` label has to exist first (`gh label create ops`), because `gh issue create`
fails on an unknown label and you do not want the alerter to be the thing that breaks.

### 2.3 `stale-watch.yml`, the dead man's switch

The alerter above cannot fire if the job never runs. Three ways that happens: GitHub
disables scheduled workflows after 60 days of repository inactivity, a bad YAML edit
silently stops the trigger, or the cron is deleted by accident.

```yaml
name: Freshness watch
on:
  schedule:
    - cron: '15 13 * * *'      # daily, cheap, no network beyond the repo
  workflow_dispatch:
permissions:
  contents: read
  issues: write
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Is the committed index still fresh?
        run: node scripts/check-freshness.mjs      # exits 1 past 10 days
      - if: ${{ failure() }}
        env:
          GH_TOKEN: ${{ github.token }}
        run: bash .github/alert.sh "Room index has gone stale"
```

Ten days, not seven, so one skipped weekly build plus GitHub's hour of slop does not
cry wolf. Two missed builds does.

**Be honest about the limit of this.** `stale-watch.yml` is itself a scheduled
workflow, so the 60-day inactivity disable would silence both at once. The only truly
out-of-band monitor is something that is not GitHub Actions. Enes already runs a
scheduled Claude cloud agent every two hours for the OSS issue window. Adding one line
to it, a fetch of `https://enesyilmazcode.github.io/Vacant/data/current.json` and a
check on `generated`, is the real watchdog and costs nothing new.

**On the 60-day disable specifically.** I could not test it: the Finder repo's first
commit is 2026-08-18, eight days ago, so it has never been quiet for 60 days. What I
did confirm is that bot pushes update `pushed_at` (`2026-08-26T13:32:51Z`, set by a
`github-actions[bot]` push), which is the field the inactivity check is generally
understood to read. Treat that as likely rather than verified. The cheap insurance is
in section 4: put the `generated` timestamp in a file that is committed every single
week, so the repo is never quiet.

### 2.4 `term-watch.yml`, the rollover notifier

One request per week. Copies the shape of Finder's `gen-categories.yml`: it watches for
an upstream change and writes nothing.

```yaml
name: Term watch
# Tuesday, because all three observed term visibility windows opened on a Monday.
on:
  schedule:
    - cron: '35 8 * * 2'
  workflow_dispatch:
permissions:
  contents: read
  issues: write
```

It fetches `searchableTermsV2`, diffs it against the committed `data/terms.json`, and
opens an issue titled "Term list changed" naming what appeared and what left. It does
**not** commit, and it does **not** trigger a harvest. A human decides whether a newly
searchable term is ready, because on the day a term appears it is not.

Based on the +364 day pattern from Spring 2026's 2025-09-08 opening, **Spring 2027
(`1272`) should appear on or about Monday 2026-09-07**, which is inside two weeks of
this being written. That is the first real test of this file.

### 2.5 `test.yml`

Copy Finder's verbatim. `node --test` on push and pull_request, no install step.

---

## 3. Term rollover

### 3.1 Two terms live is not a window, it is the permanent state

The brief asks how to handle "the window where two terms are both live". There is no
such window. Measured right now:

```json
[{"strm":"1262","descr":"Spring 2026","startDate":"2025-09-08","endDate":"2026-08-31"},
 {"strm":"1268","descr":"Autumn 2026","startDate":"2026-02-09","endDate":"2027-01-31"},
 {"strm":"1264","descr":"Summer 2026","startDate":"2026-01-26","endDate":"2027-01-01"}]
```

**Two or three terms are searchable at a time.** Each visibility window is about eleven
months long, so they overlap. Registration season is not special. This said "three, all
year, every year" until 2026-09-01, when Spring 2026 left on its published `endDate` and
the list held two for the first time. Three is the common case, not the floor.

And as [`schedule-edge-cases.md`](schedule-edge-cases.md) already recorded, those
`startDate` and `endDate` fields are search visibility, not academic dates. Autumn 2026
"starts" on 2026-02-09 by that field and its first class is 2026-08-25. **Never use
them to pick a term.**

### 3.2 The real calendar, from the registrar

Pulled from
[registrar.osu.edu 5-year view](https://registrar.osu.edu/academic-calendar/academic-calendar-5-year-view-2023-2028/),
whose `<table>` markup is in the raw HTML even though the rendered page needs
JavaScript:

| strm | Term | First class | Last regularly scheduled class | Instruction days |
|---|---|---|---|---|
| 1262 | Spring 2026 | 2026-01-12 | 2026-04-27 | 106 |
| 1264 | Summer 2026 | 2026-05-11 | 2026-07-30 | 81 |
| 1268 | Autumn 2026 | 2026-08-25 | 2026-12-09 | 107 |
| 1272 | Spring 2027 | 2027-01-11 | 2027-04-26 | 106 |
| 1274 | Summer 2027 | 2027-05-10 | 2027-07-29 | 81 |

The gaps between them, where no regularly scheduled instruction exists anywhere on
campus:

```
2026-04-28 .. 2026-05-10    13 days   after Spring 2026
2026-07-31 .. 2026-08-24    25 days   after Summer 2026
2026-12-10 .. 2027-01-10    32 days   after Autumn 2026
2027-04-27 .. 2027-05-09    13 days   after Spring 2027
                            --------
                            83 of 365 days = 22.7% of the year
```

**Vacant is between terms for nearly a quarter of the year.** That is not an edge case,
it is a season, and it needs a designed answer rather than a fallthrough.

### 3.3 The term selection rule

Four inputs, in this order. The app never hardcodes a term and the build never derives
one from the month alone.

```
  searchableTermsV2  --> which terms the API will still serve
           |
           v
  the harvest        --> which terms actually have a passing rooms-<strm>.json
           |
           v
  min/max meeting    --> each term's real instruction window, taken from the
  dates in that file     harvested data, not from any published field
           |
           v
  today              --> pick the term whose instruction window contains today;
                         if none does, the app is BETWEEN TERMS
```

The build writes the decision into `data/current.json` so the phone does not redo it:

```json
{
  "term": "1268",
  "termName": "Autumn 2026",
  "generated": "2026-08-26T07:41:00Z",
  "rooms": "data/rooms-1268.json",
  "instruction": ["2026-08-25", "2026-12-09"],
  "next": { "term": "1272", "termName": "Spring 2027", "firstClass": "2027-01-11" }
}
```

`next` is what makes the between-terms state answerable instead of blank. It is filled
in from the registrar calendar table, which publishes five years ahead, so the app
always knows what it is waiting for.

For the record, Finder's `termCodeFor(date)` in
[`js/api.js:91`](../../../Finder/js/api.js) is **more correct than it looks**. Checked
against all 365 days of 2026, it never names the wrong term on a day when a term is
actually in session:

```
0 of 365 days in 2026 where the formula names the wrong LIVE term
```

Its failure is narrower and different: on the 83 gap days it confidently names a term
that has no classes, and on 2027-01-02 it names `1272`, which **returns zero sections
today**. So keep it, but only as a tiebreak when two harvested instruction windows
somehow both contain today. Never as the primary.

### 3.4 The four rollover states, and what the app does

| State | When | `current.json` points at | The app shows |
|---|---|---|---|
| **In session** | 282 days a year | the live term | Normal ranked list |
| **Between terms** | 83 days a year | the term that just ended, plus `next` | The list, plus a line saying classes are out |
| **New term searchable, rooms not assigned** | Weeks after a Monday appearance | still the old term | Unchanged. Nothing about the new term is user visible until its harvest passes |
| **New term ready** | First passing harvest of the new term | the new term | Normal, from the first day of class |

The third row is the one the brief singles out, and the guard design in section 5
handles it with one rule:

> A term that is below floor **and has no previously committed file** is not broken, it
> is not ready. Log it, skip it, do not fail the run, do not make it current.
>
> A term that is below floor **and does have a committed file** is a collapse. Refuse,
> keep the old file, go red.

That single distinction covers both "Spring 2027 just appeared with 40 rooms assigned"
and "Autumn 2026 came back with 40 rooms because the harvest broke", which look
identical to any count-based check.

### 3.5 What the app shows on June 15

June 15, 2026 is a Monday. Working the rule:

1. `searchableTermsV2` lists Spring 2026, Summer 2026, Autumn 2026.
2. Summer 2026's instruction window is 2026-05-11 to 2026-07-30. June 15 is inside it.
   Spring ended April 27, Autumn starts August 25.
3. So `current.json` says `1264` and the app loads `rooms-1264.json`.
4. Active sessions that day: full Summer Term, 8-week Session 2, 6-week Session 1
   (which ends June 18), 4-week Session 2. 6-week Session 2 has not started yet, it
   begins June 22. The session date ranges in the file handle this without special
   casing.

**And the answer is thin, correctly.** A near-complete census of Summer 2026's
classroom usage (every page of `component=lec`, `lab`, `sem` and `rec`, 2,293 sections,
14 requests) found:

```
Summer 2026:  198 distinct rooms   52 buildings   804 busy blocks
              505 of 2,471 meetings had a real room  (20.4%)
```

Against a comparable-size Autumn 2026 sample (2,343 sections, 13 requests):

```
Autumn 2026:  467 distinct rooms   80 buildings   2,487 busy blocks
              1,587 of 2,533 meetings had a real room  (62.7%)
```

Summer's room-bearing rate is **a third** of Autumn's, and the reason is not a harvest
problem. On page one of Summer's lectures, 158 of 204 meetings are Distance Learning
and 32 are In Person. **OSU's summer is mostly online.** Against a campus of roughly
1,067 rooms (the figure the README now takes from Roomix's own index), Summer 2026 has
a class in about 200 of them.

So on June 15 the app shows a mostly empty campus and it is telling the truth. The
class schedule barely constrains anything. The thing that actually decides where a
student can go is whether the building is unlocked, which makes June 15 the day
[`building-access.md`](building-access.md) does all the work and the room grid does
almost none. Design the summer experience around the access data, not around the
busy list.

---

## 4. The staleness contract

### 4.1 What ships in the file

`data/current.json` carries `generated` as a full ISO-8601 UTC instant, and
`instruction` as the term's real first and last class day. Both come from the build.

Put `generated` in `current.json` and **not** inside `rooms-<term>.json`. Three reasons,
and they all matter:

1. `rooms-<term>.json` should be byte-identical from week to week within a term, so
   `git status --porcelain` on it is a meaningful signal that something actually moved.
   A timestamp inside it destroys that signal permanently.
2. `current.json` is a few hundred bytes, so committing it weekly costs nothing.
3. That weekly commit is what keeps the repository from going quiet for 60 days and
   getting its scheduled workflows disabled. See section 2.3. The timestamp file is
   doing two jobs at once and both are load bearing.

The service worker must fetch `current.json` network-first with a cached fallback,
which [`pwa-ios.md`](pwa-ios.md) already specifies, and must fetch it **after** first
paint so freshness never delays the answer.

### 4.2 Thresholds

| Age of `generated` | Term still in session? | Behaviour |
|---|---|---|
| 0 to 13 days | yes | Nothing. No banner |
| 14 to 34 days | yes | One quiet line above the list. Results normal |
| 35 days or more | yes | Persistent banner. Results still shown, still usable |
| any | **no**, today is past the term's last class day | Hard gate. Results behind a second tap |

**Why 14.** It matches the soft threshold [`ux-states.md`](ux-states.md) already picked,
and there is no reason to disagree: two missed weekly builds is the first point where
something is more likely wrong than not.

**Why 35 and not 30 or 60.** Thirty-five days is five missed builds. One missed build is
GitHub having a bad night, two is bad luck, five is a dead job. It also sits deliberately
below the 60-day scheduled-workflow disable, so the app starts complaining before the
platform silently turns the job off rather than after.

**Why the term's own end date is the only hard gate.** It is the one threshold that is
not a guess. Past 2026-12-09 the Autumn grid is not stale, it is fiction, and no amount
of "probably still right" applies. This is [`ux-states.md`](ux-states.md)'s C3 state and
it is right.

### 4.3 The exact wording

Fourteen days, one line, grey, above the list, no icon, no colour:

> Schedule last refreshed 18 days ago. Rooms rarely move mid-term, so this is
> probably still right.

Thirty-five days, a bordered banner, still above the list, results untouched below it:

> Schedule last refreshed 41 days ago. It should refresh every week, so something is
> broken. Treat these as guesses until it updates.

Past the term's last class day, results hidden behind a tap:

> This schedule is for Autumn 2026, which ended on December 9.
>
> Nothing below is trustworthy. Connect once to refresh.
>
> [ Try to refresh now ]   [ Show the old data anyway ]

Between terms, which is a different thing from stale and must not borrow its wording,
because the data is perfectly fresh and the campus is genuinely empty:

> Classes are out until January 11. Nothing is scheduled anywhere, so every room below
> is free. Whether the building is unlocked is the only question left.

Notes on the wording, since it is the user-visible half of this whole document:

- **Say "refreshed", not "generated" or "updated".** Refreshed is what a person calls it.
- **Give a day count, never a raw date.** "18 days ago" is instantly judgable,
  "2026-08-08" is arithmetic.
- **The 14-day line ends by reassuring, the 35-day line ends by warning.** Same fact,
  opposite conclusion, because at 14 days it probably is fine and at 35 days it probably
  is not. A banner that says the same thing at both ages teaches people to ignore it.
- **Never write "may be out of date" anywhere.** It is true of every state including the
  healthy one, so it carries no information and it is the exact phrasing users have been
  trained to scroll past.
- **The between-terms line names the date classes resume.** That is the whole value of
  carrying `next` in `current.json`. "Classes are out" alone invites a reload.

---

## 5. The refusal guards, and one correction to the port note

[`finder-port-map.md`](finder-port-map.md) works out the guard set and it is right about
the important thing: **key the guards on busy blocks, not on room count**, because room
count is nearly blind to a partial harvest failure. Copy
[`guards.mjs`](../../../Finder/scripts/guards.mjs) unchanged, keep `FORCE_WRITE=1` and
`ALLOW_TERM_DROP=1` as separate flags, keep the forceable-versus-fatal split.

Two corrections from measurement, and one addition.

### Correction 1: a single set of floors refuses every summer build

The port note proposes floors of 400 rooms, 40 buildings and 1,200 busy blocks. Against
a near-complete summer census:

| Floor proposed | Summer 2026 measured | Verdict |
|---|---|---|
| rooms >= 400 | **198** | **refuses** |
| buildings >= 40 | 52 | passes |
| busy blocks >= 1200 | **804** | **refuses** |

A weekly job that goes red every week from May to August is a job that gets muted, and a
muted job is worse than no job because it also mutes the real failure in September.

Because Vacant writes **one file per term**, the previous-run comparison already compares
Summer to Summer and needs no change. The floor is the only term-blind piece, and it only
ever fires on a term's first run, which is exactly when it matters. So make the floor a
lookup on the term digit:

| Term digit | Terms | rooms | buildings | busy blocks | Basis |
|---|---|---|---|---|---|
| `2`, `8` | Spring, Autumn | 400 | 40 | 1200 | 467 rooms and 2,487 blocks came out of a 13-page slice, so a full harvest is several times this |
| `4` | Summer | **120** | **30** | **450** | 60% of the measured 198 rooms, 52 buildings and 804 blocks |

Same rule the port note gives for the others: run the first full harvest of each term
type, write the real number into a comment, and set the floor near 60% of it.

### Correction 2: the weekday-balance guard is tighter than it looks, and it is fatal

The port note sets `weekdayBalance` (lightest weekday over busiest, Mon-Fri) to a
**fatal** floor of 0.40, on a 6-subject Autumn sample that measured 0.68. Measured over
broader samples:

```
Autumn 2026  mon=294 tue=383 wed=348 thu=371 fri=219   lightest/busiest = 0.57
Summer 2026  mon=137 tue=155 wed=137 thu=135 fri=72    lightest/busiest = 0.46
```

Summer sits at 0.46 against a fatal gate of 0.40. That is 15% of headroom on a check with
no escape hatch, on a term whose Friday is genuinely thin. **Move it to 0.30 and make it
forceable, not fatal.** A fatal guard should only cover things no legitimate upstream
change can produce, and a light Friday in a light term is not that.

Also confirmed: weekend blocks exist in both terms (Summer sat=8 sun=2, Autumn sat=1
sun=1), so the ratio must be computed over Mon-Fri only or it divides by a near-zero
Saturday every week.

### Addition: not-ready is not the same as broken

The guard set has no way to express "this term is new". Add one rule, stated in section
3.4 and repeated here because it is the whole term-rollover story:

```
below floor  AND  no committed file for this term   ->  NOT READY.  skip, log, exit 0
below floor  AND  a committed file exists           ->  COLLAPSE.   refuse, keep, exit 1
```

Without it, the first Tuesday after Spring 2027 appears turns the weekly build red and
keeps it red for a month while the registrar assigns rooms, which is exactly the way to
train someone to ignore a red build.

### The full failure list

The workflow fails rather than committing when any of these hold:

1. Any harvested term's rooms, buildings or busy blocks fall below its floor, when that
   term already has a committed file. Forceable.
2. Any of those counts drop more than `MAX_DROP` from the committed run. Forceable.
   The port note argues for 0.05 rather than Finder's 0.1 and that is right, because the
   grid is static within a term by construction.
3. A room that had blocks last run has none now (`lostRooms`), or more than 5 rooms lost
   over half their blocks (`roomsGutted`). Forceable.
4. More than 0.2% of meetings carrying a real `facilityId` have a time `toMinutes` cannot
   parse. **Fatal.** Measured residue is 0 of 1,813.
5. Mon-Fri weekday balance below 0.30. Forceable, per correction 2.
6. More than 10% of harvested rooms sit in a building with no coordinates. **Fatal.**
   Nothing else in the list can see this, and the consequence is rooms silently vanishing
   from a distance-sorted list.
7. `searchableTermsV2` returns fewer terms than are committed, without
   `ALLOW_TERM_DROP=1`. **Fatal unless flagged**, and this one is about to fire for real:
   Spring 2026 leaves the list on 2026-08-31.
8. `searchableTermsV2` itself fails or returns an empty list. **Fatal**, no flag. Every
   downstream decision reads from it.
9. The build cannot determine a current term, meaning no harvested instruction window
   contains today **and** today is not inside a known between-terms gap. **Fatal.** An
   unexplained gap means the calendar assumptions are wrong.

Rules 8 and 9 are Vacant-only and neither has a Finder analogue.

---

## 6. Repo hygiene, and the git bloat question answered with numbers

### 6.1 The bloat worry is measured and it is not real

The brief calls the weekly 500 KB JSON churn "a real point". It is not, and the number is
worth having because it removes a whole category of premature engineering.

I generated a synthetic `rooms-1268.json` at realistic scale (1,067 rooms, about 9,000
day-expanded busy blocks, one-line JSON): **191,202 bytes raw, 32,922 gzipped**, which
lines up with the 256 to 285 KB raw and 27 to 33 KB gzipped that
[`harvest-feasibility.md`](harvest-feasibility.md) measured. Then I committed it weekly
into throwaway repositories and ran `git gc --prune=now`:

| Scenario | Commits | `.git` after gc | Per weekly build |
|---|---|---|---|
| Sorted, deterministic output, 2 years | 104 | **125,841 bytes (0.12 MB)** | **1.2 KB** |
| Same, plus realistic room churn | 104 | 131,316 bytes (0.13 MB) | 1.3 KB |
| Sorted, deterministic, **10 years** | 520 | **382,341 bytes (0.36 MB)** | 0.7 KB |
| Room keys serialised in random order each week | 104 | 581,419 bytes (0.55 MB) | 5.5 KB |

**Ten years of weekly commits costs 0.36 MB of git history.** Git's delta compression
handles near-identical large blobs almost for free. Do nothing: no `git lfs`, no orphan
data branch, no squash job, no history rewriting. All of those cost more in complexity
than 0.36 MB is worth.

The one thing worth doing, because it is free: **sort the room keys before serialising.**
Non-deterministic key order costs 4.6x more history and, far more importantly, turns
every weekly diff into a full-file rewrite so `git status --porcelain` can never tell you
whether anything actually changed. Sort for the diff, not for the bytes.

For contrast, and to show where the worry does belong: Finder's `data/ratings.json` is
1,440,899 bytes and is rebuilt **daily**. Eight revisions of it already account for
11,060,129 raw bytes, and Finder's `.git` is 36 MB against a 3.5 MB working tree after
eight days. Large times daily is a real problem. Small times weekly is not.

### 6.2 Data on main, not a data branch

Commit `rooms-*.json`, `current.json`, `terms.json` and `buildings.json` to `main`.

- Pages serves from `main` (see section 7), so a data branch needs a second deployment
  step that buys nothing.
- The measured cost is 1.2 KB a week. There is no size argument for splitting.
- The shell and the data have to agree on a format. One branch means one commit can
  change both together and one revert undoes both.

### 6.3 Check the JSON in, do not build it at deploy

Three reasons, and the first is the one that settles it.

1. **The committed file is the guard's baseline.** Every meaningful check in
   `guards.mjs` compares this run against the last committed run. Build-at-deploy has
   nothing to compare against and the entire refusal design evaporates.
2. **The committed file is the only backup.** Term 1258 returns zero sections. Once a
   term leaves the list its room grid exists in git and nowhere else.
3. **A deploy must not require Ohio State to be up.** Building at deploy means every
   Pages publish is 136 requests against a university API, and a CSS fix at 2am fails
   because `content.osu.edu` is doing maintenance.

### 6.4 Branch protection

**Leave `main` unprotected.** Finder's main is unprotected today
(`GET /repos/EnesYilmazcode/Finder/branches/main/protection` returns
`404 Branch not protected`) and that is the right call here for a specific mechanical
reason: a protection rule that requires pull requests or status checks **rejects the
workflow's own push**, because `GITHUB_TOKEN` is not exempt unless it is explicitly on
the bypass list. The failure mode is a weekly job that goes red on the push step forever
while the harvest itself was perfect.

If protection is wanted later, then either add `github-actions[bot]` to the bypass
allowances, or push data through a PR with auto-merge, which is a lot of machinery for a
solo repo. What is worth having instead, and costs nothing:

- `test.yml` on pull_request, so the check exists when a PR does.
- Auto-delete head branches on merge.
- The `ops` label created up front, so the alerter cannot fail on it.

---

## 7. GitHub Pages deployment

### 7.1 Use branch-source Pages, and this is not a style preference

Configure Pages as **source: branch `main`, folder `/` (root)**, which is what
`build_type: legacy` means in the API. Finder is set up exactly this way:

```json
{"status":"built","build_type":"legacy","source":{"branch":"main","path":"/"},
 "html_url":"https://enesyilmazcode.github.io/Finder/","https_enforced":true}
```

The reason this matters is a measured asymmetry that will silently break an
Actions-based Pages setup:

**A push made with `GITHUB_TOKEN` does not trigger `on: push` workflows.** Confirmed on
Finder. Bot pushes landed on 08-24, 08-25 and 08-26. The last `Tests` run
(`on: push, pull_request`) was 2026-08-23T05:24, from a human push. Zero test runs fired
for any of the three bot pushes.

**But branch-source Pages does deploy on those same pushes.** Every bot push produced a
`pages build and deployment` run with event `dynamic`, at 08-24T08:08, 08-24T09:31,
08-24T13:30, 08-25T08:03, 08-25T13:27, 08-26T08:04 and 08-26T13:32.

So:

```
  branch-source Pages (legacy)          Actions-based Pages (on: push)
  ----------------------------          ------------------------------
  bot commits data                      bot commits data
       |                                     |
       v                                     v
  'dynamic' pages build fires           on: push does NOT fire
       |                                     |
       v                                     v
  site updates. correct.                site keeps serving last week's
                                        data while git looks perfectly
                                        healthy and nothing is red
```

That second column is the worst bug in this entire document, because every signal says
green: the workflow succeeded, the commit landed, the data in git is current, and the
live site is stale. Neither the failure issue nor the freshness watch would catch it,
since both read the repo rather than the site.

If Actions-based Pages is ever wanted anyway (for a build step, or to drop `/docs`
juggling), there are exactly three ways to make it correct, and picking none of them is
the trap above:

1. Deploy in the **same job** that commits, right after the push. Simplest and
   recommended if you go this route.
2. Push with a **deploy key or a PAT** instead of `GITHUB_TOKEN`, which does trigger
   workflows.
3. Fire `repository_dispatch` explicitly from the build job.

### 7.2 Permissions

| Workflow | `permissions:` block | Why |
|---|---|---|
| `rooms.yml` | `contents: write`, `issues: write` | Commit the data, open the failure issue |
| `stale-watch.yml` | `contents: read`, `issues: write` | Reads the committed file, alerts |
| `term-watch.yml` | `contents: read`, `issues: write` | Reads one API endpoint, alerts |
| `test.yml` | `contents: read` | Nothing else |
| Pages | none needed | Branch-source Pages is not an Actions workflow |

`permissions` must be declared per workflow. The default token scope is read-only on
newly created repositories, so an omitted block means the push fails with a 403 that
reads like an auth problem rather than a settings problem. Vacant was created
2026-08-26T17:46:05Z, so this applies to it.

`pages: write` and `id-token: write` are needed **only** for the Actions-based
deployment. Do not add them to a branch-source setup, where they do nothing.

### 7.3 The Pages caching behaviour, verified

```
$ curl -sSI https://enesyilmazcode.github.io/Finder/data/seats-1268.json
Last-Modified: Wed, 26 Aug 2026 13:33:58 GMT
ETag: "6a8eeb46-52587"
Cache-Control: max-age=600
Age: 0
```

Confirms what [`pwa-ios.md`](pwa-ios.md) measured. Ten minutes, not configurable,
applied to everything including `sw.js`. Two consequences for ops:

- **A deploy is not visible for up to 10 minutes.** When testing a fix by hand, a stale
  answer for ten minutes is the cache, not a bug. Do not chase it.
- **Register the service worker with `updateViaCache: 'none'`**, per
  [`pwa-ios.md`](pwa-ios.md). This is an ops concern, not just a PWA one: without it a
  frequent user can sit on an old worker indefinitely, which means the freshness banner
  in section 4 never reaches the person who most needs it.

`ETag` and `Last-Modified` are both present, so the service worker's
stale-while-revalidate revalidation is a conditional request and costs almost nothing on
a phone.

---

## 8. The whole thing on one page

```
  Sunday 07:25 UTC (lands ~08:12, measured +47 min)
        |
        v
  rooms.yml
        |
        +-- searchableTermsV2 --------> 3 terms, always
        |
        +-- harvest each term (136 req/term, 8 catalog buckets)
        |
        +-- guards, per term, floors by term digit
        |     |
        |     +-- below floor, no committed file --> NOT READY, skip, exit 0
        |     +-- below floor, file exists -------> REFUSE, keep old, exit 1
        |     +-- passes ------------------------> writeAtomic
        |
        +-- pick current term by instruction window, write current.json
        |
        +-- commit (if: !cancelled(), so good terms land even on a red run)
        |     |
        |     v
        |   push to main --> 'dynamic' Pages build --> live in <=10 min
        |
        +-- on failure --> one reused GitHub issue, label 'ops'

  Tuesday 08:35 UTC   term-watch.yml   1 request, diffs the term list, issue on change
  Daily   13:15 UTC   stale-watch.yml  fails if current.json is over 10 days old
  On push             test.yml         node --test

  Out of band: Enes's existing 2-hourly cloud agent fetches
  enesyilmazcode.github.io/Vacant/data/current.json and checks `generated`.
  This is the only monitor that survives GitHub disabling the schedules.
```

---

## Appendix A: what was run

All against live services on 2026-08-26. 54 requests to `content.osu.edu`, 1 to
`registrar.osu.edu`, sequential, 250 to 350 ms apart, 90 s timeouts, 3 retries with
exponential backoff, `User-Agent: Vacant-research/1.0 (+https://github.com/EnesYilmazcode/Vacant)`.

```bash
# 1  the term list
curl -sS 'https://content.osu.edu/v2/classes/searchableTermsV2'

# 2-6  section counts per term, from the campus facet not totalItems
#      (totalItems caps at 10000 on a bare query)
for t in 1262 1264 1268 1272 1274; do
  curl -sS "https://content.osu.edu/v2/classes/search?q=&campus=col&term=$t&p=1&sort=catalogNumber"
done
# -> 1262: 25,274   1264: 15,178   1268: 26,298   1272: 0   1274: 0

# 7  does a term that LEFT the list still serve? (the finding that drives section 6.3)
curl -sS 'https://content.osu.edu/v2/classes/search?q=&campus=col&term=1258&p=1&sort=catalogNumber'
# -> totalItems 0, no campus facet. Autumn 2025 is gone.

# 8-21   Summer 2026 room census, every page of lec/lab/sem/rec   (14 requests)
# 22-34  Autumn 2026 comparison slice, spread pages of lec/lab    (13 requests)
#        scratchpad harvest.py, counts distinct facilityId, buildingCode and
#        (room, weekday, start, end, startDate, endDate) tuples
python -X utf8 harvest.py summer
python -X utf8 harvest.py autumn

# 35     why summer is thin: instructionMode on one page of summer lectures
curl -sS 'https://content.osu.edu/v2/classes/search?q=&campus=col&term=1264&p=1&sort=catalogNumber&component=lec'
# -> 204 meetings: Distance Learning 158, In Person 32, Hybrid 14

# 36-53  weekday distribution, both terms   (scratchpad wd.py)
python -X utf8 wd.py

# 54     registrar 5-year academic calendar, tables are in the raw HTML
curl -sS 'https://registrar.osu.edu/academic-calendar/academic-calendar-5-year-view-2023-2028/'
```

GitHub side, no cost to anyone:

```bash
gh run list --repo EnesYilmazcode/Finder --limit 60 --json name,createdAt,event,conclusion
gh run list --repo EnesYilmazcode/Finder --workflow test.yml --limit 10 --json createdAt,event,headSha
gh api repos/EnesYilmazcode/Finder/pages
gh api repos/EnesYilmazcode/Finder/branches/main/protection   # 404 Branch not protected
gh api repos/EnesYilmazcode/Vacant --jq '{default_branch,has_pages,created_at}'
```

The git bloat simulation is `scratchpad/bloat/sim.py` and `sim2.py`: synthesise a
1,067-room index, commit it N times into a throwaway repo, `git gc --prune=now`, measure
`.git`.

## Appendix B: the numbers, collected

| Thing | Value |
|---|---|
| Terms searchable simultaneously | 3, permanently |
| Term visibility window length | about 11 months, always opens on a Monday |
| Sections, Autumn 2026 / Spring 2026 / Summer 2026 | 26,298 / 25,274 / 15,178 |
| Term 1272, 1274, 1258 | 0 sections each |
| Days per year with no instruction anywhere | 83 of 365, 22.7% |
| Summer 2026 rooms / buildings / blocks | 198 / 52 / 804 |
| Autumn 2026, comparable slice | 467 / 80 / 2,487 |
| Meetings with a real room, Summer vs Autumn | 20.4% vs 62.7% |
| Weekday balance Mon-Fri, Summer vs Autumn | 0.46 vs 0.57 |
| GitHub Actions scheduled delay, n=10 | 31 to 62 min, median 48, mean 47 |
| Synthetic room index, raw / gzipped | 191,202 / 32,922 bytes |
| Git cost, 104 weekly commits, sorted output | 125,841 bytes total, 1.2 KB per build |
| Git cost, 520 weekly commits (10 years) | 382,341 bytes total, 0.7 KB per build |
| Git cost, non-deterministic key order | 5.5 KB per build, 4.6x worse |
| Finder `.git` after 8 days of daily 1.4 MB churn | 36 MB against a 3.5 MB tree |
| GitHub Pages Cache-Control | `max-age=600`, with ETag and Last-Modified |
| Spring 2026 leaves the searchable list | 2026-08-31 |
| Spring 2027 expected to appear | on or about 2026-09-07, a Monday |
