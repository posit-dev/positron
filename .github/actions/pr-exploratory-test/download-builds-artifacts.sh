#!/usr/bin/env bash
# Downloads a positron-builds run's artifacts whose names match a glob into one
# directory, retrying each. actions/download-artifact does not retry, and a
# transient "Server Error" there dropped a published report's URL.
#
# Usage: download-builds-artifacts.sh <run-id> <dest-dir> <name-glob>
# Needs GH_TOKEN with actions:read on positron-builds. Exits non-zero when any
# matched artifact could not be downloaded; no match is not an error.
set -uo pipefail

RUN_ID="$1"
DEST="$2"
GLOB="$3"
REPO="posit-dev/positron-builds"
ATTEMPTS=4

names=$(gh api --paginate "repos/$REPO/actions/runs/$RUN_ID/artifacts?per_page=100" \
	--jq '.artifacts[] | select(.expired | not) | .name') || {
	echo "::warning::Could not list the artifacts of $REPO run $RUN_ID."
	exit 1
}

mkdir -p "$DEST"
status=0
while IFS= read -r name; do
	# shellcheck disable=SC2053 # GLOB is a pattern on purpose.
	[[ -n "$name" && "$name" == $GLOB ]] || continue
	ok=false
	for attempt in $(seq 1 "$ATTEMPTS"); do
		# A fresh directory per attempt, so a partial extract never blocks the next one.
		tmp=$(mktemp -d)
		if gh run download "$RUN_ID" -R "$REPO" -n "$name" -D "$tmp"; then
			cp -R "$tmp/." "$DEST/"
			rm -rf "$tmp"
			ok=true
			break
		fi
		rm -rf "$tmp"
		echo "Download of $name failed (attempt $attempt of $ATTEMPTS)."
		[ "$attempt" -lt "$ATTEMPTS" ] && sleep $((attempt * 10))
	done
	if [ "$ok" = true ]; then
		echo "Downloaded $name"
	else
		echo "::warning::Could not download $name from $REPO run $RUN_ID after $ATTEMPTS attempts."
		status=1
	fi
done <<<"$names"
exit "$status"
