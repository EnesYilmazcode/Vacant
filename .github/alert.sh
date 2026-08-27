#!/usr/bin/env bash
#
# Tell Enes a scheduled job went wrong, through the one channel he actually
# reads. GitHub's own failed-workflow email only arrives for the first failure
# in a streak, and a red X on a repo page is only a signal to someone who opens
# the repo. An issue is a notification that persists until it is closed.
#
#   bash .github/alert.sh "<title>" [quiet-hours]
#
# One open issue per failure mode, commented on rather than re-filed. A weekly
# job that has been broken for a month should be one issue with four comments,
# not four issues. The tie is a marker in the body, because searching by title
# matches too loosely to key on.
#
# GitHub's issue list is behind its own writes, so two alerts raised within about
# 15 seconds of each other can both read an empty list and both file. This waits
# for the list to catch up after filing and closes the twin. One that shows up
# later than that is closed by the next alert instead.
#
# quiet-hours exists because stale-watch.yml runs daily. A term that left the
# searchable list stays gone until a human re-baselines data/terms.json, and
# with no quiet window that is one comment a day forever, which is exactly how
# an alert gets muted. Callers that run weekly or less pass nothing.
set -euo pipefail

title="${1:-}"
quiet_hours="${2:-0}"
# Seconds between checks while waiting for a new issue to appear in the list.
# Only the tests change this, and they set it to 0.
poll_seconds="${ALERT_POLL_SECONDS:-5}"
if [ -z "$title" ]; then
  echo "usage: alert.sh <title> [quiet-hours]" >&2
  exit 2
fi

# "Room index has gone stale" -> room-index-has-gone-stale. printf rather than
# echo so the trailing newline does not become a trailing dash.
slug=$(printf '%s' "$title" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-*//; s/-*$//')
marker="<!-- vacant-ops:${slug} -->"

repo="${GITHUB_REPOSITORY:-}"
if [ -z "$repo" ]; then
  echo "GITHUB_REPOSITORY is not set. This script only runs inside Actions." >&2
  exit 2
fi

if [ -n "${GITHUB_RUN_ID:-}" ]; then
  run_line="Run: ${GITHUB_SERVER_URL:-https://github.com}/${repo}/actions/runs/${GITHUB_RUN_ID}"
else
  run_line="Run: not available, this alert was raised outside a workflow run."
fi

body="${marker}
\`${title}\` on $(date -u +%Y-%m-%dT%H:%MZ).

${run_line}

Nothing was committed, so the site is still serving the last good data. It will
keep getting older until this is fixed."

# Filtered here rather than through gh's --search, which tokenises the marker
# and matches issues that only share a word of it. Sorted, so every caller keeps
# the same one without having to agree on anything else.
marked() {
  MARKER="$marker" gh issue list --repo "$repo" --state open --label ops --limit 100 \
    --json number,body --jq 'map(select((.body // "") | contains(env.MARKER))) | map(.number) | sort | .[]'
}

open_issues=$(marked)
created=0

if [ -z "$open_issues" ]; then
  gh issue create --repo "$repo" --title "$title" --label ops --body "$body"
  created=1
  # The list is behind its own writes. Measured against the real API on
  # 2026-08-27: three alerts fired 2 and 4 seconds apart all read an empty list
  # and all filed, while a pair 15 seconds apart deduplicated correctly. Waiting
  # until the list can see what we just wrote is the only chance to notice a twin
  # filed in the same window.
  for _ in 1 2 3 4 5 6; do
    open_issues=$(marked)
    [ -n "$open_issues" ] && break
    sleep "$poll_seconds"
  done
fi

# Collapse a twin. Whichever run gets here with both in view closes the higher
# number, so a month of failures stays one issue with comments. The race cannot
# be prevented outright, because the list is the only place to look and it is
# late. One that appears after this run is collapsed by the next alert.
keep=$(printf '%s\n' "$open_issues" | head -n 1)
for extra in $(printf '%s\n' "$open_issues" | tail -n +2); do
  gh issue comment "$extra" --repo "$repo" --body "Duplicate of #${keep}. Two runs hit this failure inside GitHub's issue list lag and both filed. Closing this one. #${keep} stays open until the failure is fixed."
  gh issue close "$extra" --repo "$repo" --reason "not planned"
done

# Just filed. Commenting on an issue whose body already says all of this is how
# an alert gets muted.
if [ "$created" -eq 1 ]; then
  exit 0
fi

if [ "$quiet_hours" -gt 0 ]; then
  last=$(gh issue view "$keep" --repo "$repo" --json createdAt,comments \
    --jq '[.createdAt] + [.comments[].createdAt] | max')
  age_h=$(( ( $(date -u +%s) - $(date -u -d "$last" +%s) ) / 3600 ))
  if [ "$age_h" -lt "$quiet_hours" ]; then
    echo "Issue #${keep} was last touched ${age_h}h ago, inside the ${quiet_hours}h quiet window."
    echo "Still broken, still open, not commenting again yet."
    exit 0
  fi
fi

gh issue comment "$keep" --repo "$repo" --body "$body"
