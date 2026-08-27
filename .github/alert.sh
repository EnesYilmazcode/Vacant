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
# quiet-hours exists because stale-watch.yml runs daily. A term that left the
# searchable list stays gone until a human re-baselines data/terms.json, and
# with no quiet window that is one comment a day forever, which is exactly how
# an alert gets muted. Callers that run weekly or less pass nothing.
set -euo pipefail

title="${1:-}"
quiet_hours="${2:-0}"
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
# and matches issues that only share a word of it.
existing=$(MARKER="$marker" gh issue list --repo "$repo" --state open --label ops --limit 100 \
  --json number,body --jq 'map(select((.body // "") | contains(env.MARKER))) | .[0].number // empty')

if [ -z "$existing" ]; then
  gh issue create --repo "$repo" --title "$title" --label ops --body "$body"
  exit 0
fi

if [ "$quiet_hours" -gt 0 ]; then
  last=$(gh issue view "$existing" --repo "$repo" --json createdAt,comments \
    --jq '[.createdAt] + [.comments[].createdAt] | max')
  age_h=$(( ( $(date -u +%s) - $(date -u -d "$last" +%s) ) / 3600 ))
  if [ "$age_h" -lt "$quiet_hours" ]; then
    echo "Issue #${existing} was last touched ${age_h}h ago, inside the ${quiet_hours}h quiet window."
    echo "Still broken, still open, not commenting again yet."
    exit 0
  fi
fi

gh issue comment "$existing" --repo "$repo" --body "$body"
