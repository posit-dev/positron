#!/usr/bin/env bash
set -euo pipefail
#
# wait-for-runs.sh <interval_seconds> <run_id> [run_id...]
#
# Blocks until AT LEAST ONE of the given runs reaches status=completed, then
# prints one line per *completed* run as:
#
#     <run_id> <conclusion>
#
# (conclusion is success | failure | cancelled | timed_out | ...). Runs still
# in progress are not printed. Exits 0 as soon as anything has completed.
#
# Designed to be launched in the BACKGROUND so the long wait doesn't block the
# session: when it exits, the harness re-invokes the agent with this output.
# Re-run it with the still-in-flight ids to keep waiting for the rest.
#
INTERVAL="${1:?usage: wait-for-runs.sh <interval_seconds> <run_id> [run_id...]}"
shift
[[ "$#" -ge 1 ]] || { echo "ERROR: no run ids given" >&2; exit 1; }
IDS=("$@")

while true; do
  done_lines=""
  for id in "${IDS[@]}"; do
    line="$(gh run view "$id" --json status,conclusion \
              -q '.status + " " + (.conclusion // "")' 2>/dev/null || echo "unknown ")"
    status="${line%% *}"
    conclusion="${line#* }"
    if [[ "$status" == "completed" ]]; then
      done_lines+="${id} ${conclusion:-unknown}"$'\n'
    fi
  done
  if [[ -n "$done_lines" ]]; then
    printf '%s' "$done_lines"
    exit 0
  fi
  sleep "$INTERVAL"
done
