#!/usr/bin/env bash
#---------------------------------------------------------------------------------------------
#  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
#  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#---------------------------------------------------------------------------------------------

# Runs a short positron-builds workflow and downloads one of its artifacts: for
# the worthiness check (explore-gate.yml) and the suggest judge
# (explore-suggest.yml), which hold the Anthropic key there so this repo does not.
#
# Usage: run-builds.sh <workflow> <ref> <title> <wait seconds> <dest dir> <artifact> [-f key=value]...
#
# The title must end in " (<run_id>-<attempt>)": the dispatch API returns no run
# id, so the run is found by that suffix, among runs positron-bot started.
# Needs GH_TOKEN with actions: write on positron-builds. Writes run_id and
# conclusion to GITHUB_OUTPUT when set. Cancels a run that outlasts the wait.
# Exits 0 only when the run succeeded and the artifact is in <dest dir>.

set -uo pipefail

WORKFLOW=${1:?usage: run-builds.sh <workflow> <ref> <title> <wait seconds> <dest dir> <artifact> [-f key=value]...}
REF=${2:?}
TITLE=${3:?}
LIMIT=${4:?}
DEST=${5:?}
ARTIFACT=${6:?}
shift 6
REPO=posit-dev/positron-builds
HERE=$(cd "$(dirname "$0")" && pwd)
SUFFIX=" (${TITLE##* (}"

output() {
	if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "$1" >> "$GITHUB_OUTPUT"; fi
}

if ! gh workflow run "$WORKFLOW" -R "$REPO" --ref "$REF" -f "title=$TITLE" "$@"; then
	echo "::error::Could not dispatch $WORKFLOW in $REPO."
	exit 1
fi

id=""
for _ in $(seq 1 24); do
	id=$(gh api "repos/$REPO/actions/workflows/$WORKFLOW/runs?event=workflow_dispatch&branch=$REF" \
		--jq ".workflow_runs[] | select((.display_title | endswith(\"$SUFFIX\")) and .triggering_actor.login == \"positron-bot[bot]\") | .id" \
		| head -n 1) || id=""
	if [ -n "$id" ]; then break; fi
	sleep 5
done
if [ -z "$id" ]; then
	echo "::error::Dispatched $WORKFLOW but could not find its run within two minutes."
	exit 1
fi
url="https://github.com/$REPO/actions/runs/$id"
output "run_id=$id"
echo "Running at $url"

WAIT_INTERVAL=${WAIT_INTERVAL:-15} bash "$HERE/wait-run.sh" "$id" "$LIMIT"
code=$?
if [ "$code" -ne 0 ]; then
	if [ "$code" -eq 124 ]; then
		echo "::warning::$WORKFLOW did not finish in time; cancelling it."
		output "conclusion=timed_out"
	else
		echo "::warning::Could not read $WORKFLOW's run (code $code); cancelling it."
		output "conclusion=unknown"
	fi
	gh run cancel "$id" -R "$REPO" > /dev/null || echo "::warning::Could not cancel $url."
	exit 1
fi

conclusion=$(gh api "repos/$REPO/actions/runs/$id" --jq '.conclusion // ""') || conclusion=""
output "conclusion=$conclusion"
if [ "$conclusion" != "success" ]; then
	echo "::warning::$WORKFLOW ended ${conclusion:-unfinished}: $url"
	exit 1
fi

bash "$HERE/download-builds-artifacts.sh" "$id" "$DEST" "$ARTIFACT"
