---
title: Ship rooms.yml on a Sunday cron, with a failure alerter and a dead-man's switch
labels: ops, enhancement
milestone: Phase 1: Data pipeline
estimate: M
order: 12
depends_on: room-index-and-current-json, build-guards
---

A stale course index looks stale. A stale room grid looks like good news, because 81% of campus reads free even on a healthy harvest, so nobody finds out until someone walks into an occupied lecture hall. Finder has five workflows and zero alerting: no `if: failure()` step, no issue creation, no watchdog, and 25 consecutive green runs, so none of it has ever been exercised. Build the scheduled rebuild and the three ways of learning it stopped working.

### What to do

Modeled on `Finder/.github/workflows/courses.yml` and `seats.yml`.

**`.github/workflows/rooms.yml`.** Sunday, not Monday: the grid has to be right for the teaching week starting the next morning, and scheduled runs here land 31 to 62 minutes late (n=10, median 48), so a Monday slot can land after the first class. Finder's course index runs Mondays at 08:40 UTC and is about 2,500 requests, so do not sit on top of it.

```yaml
on:
  schedule:
    - cron: '25 7 * * 0'          # ~08:12 actual, measured +47 min
  workflow_dispatch:
    inputs: { force: ..., dropTerms: ... }   # -> FORCE_WRITE, ALLOW_TERM_DROP
permissions: { contents: write, issues: write }
concurrency: { group: rooms, cancel-in-progress: false }
```

The commit step runs under `if: ${{ !cancelled() }}` so terms that cleared their guards still land when another term refuses. Stage by pathspec (`git add -A -- data/current.json 'data/rooms-*.json' data/terms.json`), exit 0 on `git diff --cached --quiet`, print `--name-status`, `git pull --rebase` before pushing.

**`.github/alert.sh`.** Takes a title, derives `<!-- vacant-ops:<slug> -->`, searches open `ops` issues for that marker, and comments on the existing one rather than filing a second. Body links `$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID` and says nothing was committed, so the site is serving the last good data and it will keep getting older.

**`.github/workflows/stale-watch.yml`.** Daily. Runs `scripts/check-freshness.mjs`, which exits 1 when `current.json`'s `generated` is over 10 days old. Ten, not seven, so one skipped build plus an hour of cron slop does not cry wolf. Two missed builds does. The same job makes one `searchableTermsV2` request and diffs `strm` values against committed `data/terms.json`. It never commits and never dispatches a harvest, because on the day a term becomes searchable its rooms are not assigned yet. Spring 2026 leaves the list 2026-08-31 and Spring 2027 is expected around 2026-09-07, so this fires for real within weeks.

### Done when

- [ ] `rooms.yml` has `cron: '25 7 * * 0'`, `workflow_dispatch` with `force` and `dropTerms` wired to `FORCE_WRITE` and `ALLOW_TERM_DROP`, `permissions: contents: write` and `issues: write`, and `concurrency: { group: rooms, cancel-in-progress: false }`
- [ ] The commit step is guarded by `if: ${{ !cancelled() }}`, stages by pathspec, exits 0 when `git diff --cached --quiet`, prints `git diff --cached --name-status`, and pushes after `git pull --rebase origin ${{ github.ref_name }}`
- [ ] `.github/alert.sh` derives the `vacant-ops:` marker from the title and comments on the matching open issue rather than creating a new one
- [ ] `rooms.yml` calls `alert.sh` under `if: ${{ failure() }}` with `GH_TOKEN: ${{ github.token }}`
- [ ] `gh label create ops` has been run and the label exists before the first workflow run
- [ ] `scripts/check-freshness.mjs` exits 1 at `generated` older than 10 days and 0 at 10 days or younger, with an offline unit test covering both sides of the boundary
- [ ] `stale-watch.yml` runs daily, runs the freshness check, diffs `searchableTermsV2` `strm` values against `data/terms.json`, and alerts on failure. An empty term list or a failed request exits non-zero
- [ ] Each alert path has been fired once by a deliberate failure, and a second deliberate failure comments on the first issue instead of opening a second
- [ ] The existing 2-hourly cloud agent fetches `https://enesyilmazcode.github.io/Vacant/data/current.json` and checks `generated`, and that check is written down in the repo
- [ ] `GET /repos/EnesYilmazcode/Vacant/branches/main/protection` returns 404, with a comment in `rooms.yml` recording that `GITHUB_TOKEN` is not exempt from required-PR or required-check rules
- [ ] One hand-run `workflow_dispatch` that changes a data file is followed within 10 minutes by a `pages build and deployment` run with event `dynamic`

### Notes

Pages must stay branch-source `main` at `/`. Measured on Finder: three `github-actions[bot]` pushes triggered zero `on: push` workflow runs, but every one of them produced a `pages build and deployment` run with event `dynamic`. An Actions-based Pages setup would serve last week's data while the workflow is green, the commit landed, and nothing is red, and neither the failure issue nor the freshness watch would catch it because both read the repo rather than the deployed site. That is what the last checklist item verifies.

`stale-watch.yml` is itself a scheduled workflow, so GitHub's 60-day inactivity disable would silence the build and its watchdog together. The weekly `current.json` commit keeps the repo from going quiet; the cloud-agent fetch is the only monitor that survives it either way. The 60-day rule is untested here, since Finder is eight days old.

Do not tune the cron minute. Minutes 10, 20, 30 and 40 all drew 31 to 62 minutes of delay.
