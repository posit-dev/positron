#!/usr/bin/env bash
# Downloads a positron-builds run's artifacts whose names match any of the given
# globs into one directory, retrying each request. actions/download-artifact does
# not retry, and a transient "Server Error" there dropped a published report's URL.
#
# Usage: download-builds-artifacts.sh <run-id> <dest-dir> <name-glob>...
# Needs GH_TOKEN with actions:read on positron-builds. Exits non-zero when the
# listing or any matched download failed, or a glob matched nothing.
set -uo pipefail

RUN_ID="$1"
DEST="$2"
shift 2
REPO="posit-dev/positron-builds"
ATTEMPTS=4

# Runs a command up to ATTEMPTS times, backing off between tries.
retry() {
	local attempt
	for attempt in $(seq 1 "$ATTEMPTS"); do
		"$@" && return 0
		echo "Attempt $attempt of $ATTEMPTS failed: $*"
		[ "$attempt" -lt "$ATTEMPTS" ] && sleep $((attempt * 10))
	done
	return 1
}

# shellcheck disable=SC2329 # called through retry.
list_artifacts() {
	gh api --paginate "repos/$REPO/actions/runs/$RUN_ID/artifacts?per_page=100" \
		--jq '.artifacts[] | select(.expired | not) | "\(.id) \(.name)"' >"$listing"
}

# A fresh directory per attempt, so a partial extract never blocks the next one.
# shellcheck disable=SC2329 # called through retry.
download_one() {
	local id="$1" tmp
	tmp=$(mktemp -d)
	gh api "repos/$REPO/actions/artifacts/$id/zip" >"$tmp/a.zip" \
		&& unzip -q "$tmp/a.zip" -d "$tmp/x" \
		&& cp -R "$tmp/x/." "$DEST/"
	local status=$?
	rm -rf "$tmp"
	return "$status"
}

listing=$(mktemp)
trap 'rm -f "$listing"' EXIT
if ! retry list_artifacts; then
	echo "::warning::Could not list the artifacts of $REPO run $RUN_ID."
	exit 1
fi

mkdir -p "$DEST"
status=0
for glob in "$@"; do
	matched=false
	# Newest first, so a re-run's artifact wins when a name repeats.
	while read -r id name; do
		# shellcheck disable=SC2053 # glob is a pattern on purpose.
		[[ "$name" == $glob ]] || continue
		matched=true
		if retry download_one "$id"; then
			echo "Downloaded $name ($id)"
		else
			echo "::warning::Could not download $name from $REPO run $RUN_ID."
			status=1
		fi
	done < <(sort -k1,1nr "$listing" | sort -u -k2,2 -s)
	if [ "$matched" = false ]; then
		echo "::warning::No artifact matching $glob in $REPO run $RUN_ID."
		status=1
	fi
done
exit "$status"
