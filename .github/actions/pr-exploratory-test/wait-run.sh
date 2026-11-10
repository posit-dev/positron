#!/usr/bin/env bash
#---------------------------------------------------------------------------------------------
#  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
#  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#---------------------------------------------------------------------------------------------

# Waits for a positron-builds run to complete, for at most <seconds>.
# Usage: wait-run.sh <run id> <seconds>
# Exits 0 when the run completed, 124 when time ran out. An API error is
# retried, never fatal: ending the wait early would report a live run as failed.

set -uo pipefail

RUN_ID=${1:?usage: wait-run.sh <run id> <seconds>}
LIMIT=${2:?usage: wait-run.sh <run id> <seconds>}
INTERVAL=${WAIT_INTERVAL:-60}
deadline=$((SECONDS + LIMIT))

while [ "$SECONDS" -lt "$deadline" ]; do
	status=$(gh api "repos/posit-dev/positron-builds/actions/runs/$RUN_ID" --jq .status 2>/dev/null) || status=""
	if [ "$status" = "completed" ]; then
		exit 0
	fi
	[ -z "$status" ] && echo "::warning::Could not read the explore run's status; trying again."
	sleep "$INTERVAL"
done
exit 124
