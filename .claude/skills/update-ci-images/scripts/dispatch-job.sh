#!/usr/bin/env bash
set -euo pipefail
#
# dispatch-job.sh <branch> <tag> [os]
#
# Dispatches one build via workflow_dispatch on <branch> and prints the
# databaseId of the newly-created run to stdout (everything else goes to
# stderr, so callers can capture the id cleanly).
#
#   - With an <os> arg  -> build-images.yml          (run-name: <tag>-<os>)
#   - Without an <os>   -> build-postgres-image.yml  (run-name: postgres-<tag>)
#
# Each workflow builds BOTH architectures (amd64 + arm64) as a matrix and then
# merges them into a multi-arch manifest list, so there is one run (and one
# dispatch) per image, not per architecture.
#
# Each job has a unique run-name (displayTitle), which is how we match the run
# we just triggered. To distinguish a retry from the previous attempt of the
# same job, we only accept a run whose databaseId is greater than the newest
# pre-existing run with the same title.
#
BRANCH="${1:?usage: dispatch-job.sh <branch> <tag> [os]}"
TAG="${2:?missing tag}"
OS="${3:-}"

if [[ -n "$OS" ]]; then
  WF="ci-images-build-os.yml"
  TITLE="${TAG}-${OS}"
else
  WF="ci-images-build-postgres.yml"
  TITLE="postgres-${TAG}"
fi

prev="$(gh run list --workflow "$WF" --branch "$BRANCH" --limit 100 \
          --json databaseId,displayTitle \
          -q "[.[] | select(.displayTitle==\"$TITLE\")] | (max_by(.databaseId).databaseId) // 0")"
prev="${prev:-0}"

dispatch_once() {
  if [[ -n "$OS" ]]; then
    gh workflow run "$WF" --ref "$BRANCH" -f tag="$TAG" -f os="$OS"
  else
    gh workflow run "$WF" --ref "$BRANCH" -f tag="$TAG"
  fi
}

find_new_run() {
  gh run list --workflow "$WF" --branch "$BRANCH" --limit 100 \
    --json databaseId,displayTitle \
    -q "[.[] | select(.displayTitle==\"$TITLE\" and .databaseId > $prev)] | (max_by(.databaseId).databaseId) // empty"
}

# Up to 3 dispatch attempts to ride out transient `gh` errors (e.g. connection
# reset). After each attempt we poll for the new run BEFORE re-issuing, so a
# dispatch that landed despite a command error is not duplicated.
echo "Dispatching $WF on $BRANCH (title: $TITLE)..." >&2
for attempt in 1 2 3; do
  dispatch_once >&2 || echo "dispatch command failed (attempt $attempt) -- will check for the run before retrying" >&2
  for _ in $(seq 1 20); do
    id="$(find_new_run)"
    if [[ -n "${id:-}" ]]; then
      echo "$id"
      exit 0
    fi
    sleep 3
  done
  echo "no new run appeared after attempt $attempt; retrying dispatch..." >&2
done

echo "ERROR: could not dispatch/locate run for '$TITLE' on '$BRANCH'" >&2
exit 1
