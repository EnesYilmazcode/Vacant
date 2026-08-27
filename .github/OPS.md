# Running Vacant with nobody watching

A stale course index looks stale. A stale room grid looks like good news, because
81% of campus reads free even on a healthy harvest, so nobody finds out until
someone walks into an occupied lecture hall.

That is the whole reason this directory exists. Four workflows and one alerter,
plus one gap that none of them can close and nobody has closed yet.

## What runs

| File | When (UTC) | What it does | Writes? |
|---|---|---|---|
| [`rooms.yml`](workflows/rooms.yml) | Sunday `25 7` | Harvests one term, rebuilds the index, commits what moved | yes, to `main` |
| [`stale-watch.yml`](workflows/stale-watch.yml) | daily `15 13` | Fails if `current.json` is over 10 days old, and if the searchable term list moved | no |
| [`live-rot.yml`](workflows/live-rot.yml) | Thursday `45 8` | Asks the live API four questions about its shape | no |
| [`test.yml`](workflows/test.yml) | push, pull request | `node --test` | no |

Scheduled runs on this account start 31 to 62 minutes late (n=10, median 48,
measured in [`docs/research/ops-freshness.md`](../docs/research/ops-freshness.md)),
so Sunday's build lands near 08:12 rather than 07:25. Do not try to tune the
minute. Minutes 10, 20, 30 and 40 all drew the same delay.

## How you find out something broke

[`alert.sh`](alert.sh) files one issue per failure mode, labelled `ops`, and
comments on it rather than filing a second. The tie is a marker in the body:

```
<!-- vacant-ops:room-index-build-failed -->
```

A weekly job broken for a month is then one issue with four comments. The daily
watch passes a second argument, `144`, which is a six day quiet window, so a
condition that persists until a human acts nags about weekly instead of daily.

GitHub's issue list is behind its own writes, so the marker alone is not enough.
Fired against the real API on 2026-08-27, three alerts 2 and 4 seconds apart all
read an empty list and all filed three separate issues, while a pair 15 seconds
apart deduplicated correctly. After filing, `alert.sh` now waits up to 25 seconds
for the list to show what it just wrote, and closes the higher-numbered twin if
one turns up. A twin that surfaces later than that is closed by the next alert.
The race cannot be prevented outright: the list is the only place to look and it
is late.

Seven titles exist, and each gets its own issue. The two watch scripts choose
their own rather than letting the workflow guess, because each of them can fail
in more than one way and the title becomes a claim in a place nobody goes back
to correct:

| Title | Raised when |
|---|---|
| Room index build failed | any step of `rooms.yml` went red |
| Room index has gone stale | `current.json` is over 10 days old |
| current.json cannot be read | it does not parse, or has no readable `generated` |
| Searchable term list changed | a term appeared in or left `searchableTermsV2` |
| Term list endpoint is not answering | that request failed, or came back empty or reshaped |
| Term list has no committed baseline | `data/terms.json` is missing |
| Live API shape has changed | one of the four rot checks failed |

The `ops` label already exists. `gh issue create` fails on an unknown label, so
if you ever recreate the repository, create it before the first failure.

## The monitor that is not on GitHub, and is not running

Every workflow above is a scheduled workflow, and GitHub disables scheduled
workflows in a repository with 60 days of no activity. That would silence the
build and its watchdog together.

The cheap half is covered. `rooms.yml` commits `current.json` every week, so the
repository is never quiet for 60 days. That is one of the reasons `generated`
lives in `current.json` and not inside `rooms-<term>.json`.

**The other half is not covered, and nothing in this repository can cover it.**
Every watch here reads the repository. A Pages deployment that stopped publishing
leaves the repository perfect and the site a week behind, and no workflow in this
directory would see it. Catching that needs a check that runs somewhere else, on
a schedule this repository does not own, against the deployed URL.

Nobody has set one up. The obvious host is the two-hourly Claude cloud agent Enes
already runs for the OSS issue window: it is already scheduled, already outside
GitHub, and this is one more line in its prompt. Until someone adds it there, a
site serving last week's data with every signal green goes unnoticed.

The check itself is written and it works. It is a snippet, not a service:

```bash
node -e 'const r = await fetch("https://enesyilmazcode.github.io/Vacant/data/current.json");
if (!r.ok) { console.log(`Vacant: the deployed current.json answered ${r.status}`); process.exit(1); }
const c = await r.json();
const days = (Date.now() - Date.parse(c.generated)) / 86400000;
console.log(`Vacant: the ${c.termName} index on the live site is ${days.toFixed(1)} days old`);
process.exit(days > 10 ? 1 : 0);'
```

Run by hand 2026-08-27, all three branches:

```
Vacant: the Autumn 2026 index on the live site is 0.8 days old     exit 0
Vacant: the deployed current.json answered 404                     exit 1   (path forced to a missing file)
Vacant: the Autumn 2026 index on the live site is 0.8 days old     exit 1   (threshold forced to 0 days)
```

Ten days matches `check-freshness.mjs` on purpose. One skipped build plus an hour
of cron slop must not fire. Ten days is that missed Sunday plus three, so a week
of silence is caught four days before the next build is due. The alert counts the
missed runs from the age rather than assuming a number.

## Two settings that must not change

**Pages stays branch-source `main` at `/`.** Verified 2026-08-27:

```
GET /repos/EnesYilmazcode/Vacant/pages
-> {"build_type":"legacy","source":{"branch":"main","path":"/"},"status":"built"}
```

A push made with `GITHUB_TOKEN` does not fire `on: push` workflows, but it does
produce a `pages build and deployment` run with event `dynamic`. So branch-source
Pages picks up the weekly data commit and an Actions-source Pages setup would
not. That failure serves last week's data with the workflow green, the commit
landed, and nothing red anywhere, and neither the alerter nor the freshness watch
would see it, because both read the repository rather than the site. Only the
out-of-band check above catches that, and it is not hosted anywhere yet.

**`main` stays unprotected.** Verified 2026-08-27:

```
GET /repos/EnesYilmazcode/Vacant/branches/main/protection
-> 404 Branch not protected
```

`GITHUB_TOKEN` is not exempt from a required-pull-request or required-check rule.
Adding protection without putting `github-actions[bot]` on the bypass list turns
the weekly build red on the push step forever while the harvest itself was
perfect.

## Running any of it by hand

```bash
node scripts/check-freshness.mjs            # exits 1 past 10 days
node scripts/check-terms.mjs                # one request, exits 1 if the term list moved
node scripts/check-terms.mjs --write        # re-baseline data/terms.json after you decide

VACANT_LIVE=1 node --test scripts/test/live-rot.live.test.mjs   # 2 requests to Ohio State
node --test                                                    # zero requests, live file skips
```

`rooms.yml` also takes a `term` input if you need to rebuild something other than
the term `current.json` names. It only accepts a term whose
`data/buildings-<term>.json` is already committed, and refuses the rest before
it spends a request. That file is not something the workflow can produce:
`fetch-buildings.mjs` reads the term back out of `current.json` and needs the
room index to exist first, so adding a term is three local steps in order.

```bash
node scripts/fetch-rooms.mjs 1272 && node scripts/build-index.mjs 1272
node scripts/fetch-buildings.mjs        # reads the term from current.json
git add data/ && git commit
```

Skip the middle line and `current.json` names a file the site does not have.
That is not a missing map, it is a dead app: everything `current.json` names is
fetched in one `Promise.all`, so the 404 rejects the boot. Measured 2026-08-27 at
393x852 against a `current.json` naming `data/buildings-1272.json`, `#ask` never
reached `.ready` inside 15 seconds and all three duration buttons stayed
disabled.

It harvests one term a week on purpose: a whole term is about 680 requests
against a university's API, and only the term in session can change an answer.

## What has not been exercised

Honest list, because a workflow that parses is not a workflow that runs.

- No workflow in this directory has been executed by GitHub Actions. The YAML
  parses and every `run:` body was extracted from the file and run by hand, but
  the runner, the `GITHUB_TOKEN` permissions and the push have not been tested.
- `alert.sh` has filed real issues exactly once, on 2026-08-27, when a stand-in
  `gh` failed to resolve on Windows and the real one answered instead. Every
  issue that run created was deleted afterwards and no pre-existing issue was
  touched. That accident is where the list lag above was measured. It has never
  run inside Actions. Everything else is covered by a stand-in `gh` in
  `scripts/test/alert.test.mjs`: create, comment, the twin collapse, a list that
  never catches up, both quiet-window branches and both usage errors.
- The 60-day inactivity disable is untested. Nothing here has ever been quiet for
  60 days.
- The out-of-band check above is not scheduled anywhere. It has only ever been
  run by hand. Until it is hosted, a Pages deployment that stops publishing is
  invisible to everything in this directory.
- `FORCE_WRITE` and `ALLOW_TERM_DROP` are passed to the build, but no script
  reads them yet. That is issue #10. Until it lands, `rooms.yml` refuses a
  dispatch that sets `force` or `dropTerms` rather than running as if the flag
  had been honoured.
