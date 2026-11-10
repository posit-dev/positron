#!/usr/bin/env bash
#---------------------------------------------------------------------------------------------
#  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
#  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#---------------------------------------------------------------------------------------------

# Waits for a positron-builds run to complete, for at most <seconds>.
# Usage: wait-run.sh <run id> <seconds>
# Exits 0 when the run completed, 124 when time ran out, 2 when the API refuses
# the request for good (a 4xx that is not a rate limit). Any other API error is
# retried: ending the wait early would report a live run as failed.

set -uo pipefail

RUN_ID=${1:?usage: wait-run.sh <run id> <seconds>}
LIMIT=${2:?usage: wait-run.sh <run id> <seconds>}
INTERVAL=${WAIT_INTERVAL:-60}
deadline=$((SECONDS + LIMIT))

while [ "$SECONDS" -lt "$deadline" ]; do
	err=$(mktemp)
	status=$(gh api "repos/posit-dev/positron-builds/actions/runs/$RUN_ID" --jq .status 2>"$err") || status=""
	msg=$(cat "$err"); rm -f "$err"
	if [ "$status" = "completed" ]; then
		exit 0
	fi
	if [[ "$msg" =~ \(HTTP\ 4[0-9][0-9]\) ]] && [[ ! "$msg" =~ HTTP\ 429 ]] && [[ ! "$msg" =~ [Rr]ate\ limit ]]; then
		echo "::error::Could not read explore run $RUN_ID: $msg"
		exit 2
	fi
	[ -z "$status" ] && echo "::warning::Could not read the explore run's status; trying again."
	sleep "$INTERVAL"
done
exit 124
