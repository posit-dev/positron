#!/usr/bin/env bash
# Decide whether a pull request, or a push, changes only docs or tooling, and
# write docs_only=true|false to $GITHUB_OUTPUT. pr-dispatch.yml and
# main-dispatch.yml skip tests in positron-builds when it is true. See
# scripts/lib/pr-docs-only-lib.sh for the allowlist.
#
# With PR_NUMBER, the changed files come from the pull request. With
# BEFORE_SHA, they are the diff from BEFORE_SHA to the checked-out HEAD (a
# push). Each push is judged on its own changes: an earlier push's red run
# doesn't make a later docs-only push run the tests.
#
# Any error (no PR number or push range, API or git failure, truncated file
# list) yields false, so the tests run.
#
# Usage: bash scripts/pr-docs-only.sh
# Env: GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER (optionally HEAD_SHA) or
#      BEFORE_SHA, GITHUB_OUTPUT

set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
source "$HERE/lib/pr-docs-only-lib.sh"

emit() {
	echo "docs_only=$1"
	if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
		echo "docs_only=$1" >> "$GITHUB_OUTPUT"
	fi
	exit 0
}

# Echoes the PR's changed files, including a rename's previous name, or fails.
pr_changed_files() {
	local repo="${GITHUB_REPOSITORY:?}" pr expected head files actual
	# A rename lists only its new name in `filename`, so include the old name too:
	# moving a source file into docs/ is not a docs-only change.
	if ! files=$(gh api "repos/${repo}/pulls/${PR_NUMBER}/files" --paginate \
		--jq '.[] | [.filename, (.previous_filename // "")] | @tsv'); then
		echo "Could not fetch the changed files; running the tests." >&2
		return 1
	fi

	# Read the head after the file list: if the head moved while the list was
	# fetched, it no longer matches HEAD_SHA here.
	if ! pr=$(gh api "repos/${repo}/pulls/${PR_NUMBER}" --jq '"\(.changed_files) \(.head.sha)"'); then
		echo "Could not fetch the pull request; running the tests." >&2
		return 1
	fi
	read -r expected head <<< "$pr"

	# The file list is for the PR's current head; if that moved past the commit
	# being judged, the list doesn't describe it.
	if [[ -n "${HEAD_SHA:-}" && "$head" != "$HEAD_SHA" ]]; then
		echo "The PR head is $head, not $HEAD_SHA; running the tests." >&2
		return 1
	fi

	# The files API returns at most 3000 files. Treat a short list as unknown.
	actual=$(printf '%s' "$files" | grep -c '' || true)
	if [[ "$actual" != "$expected" ]]; then
		echo "Got $actual of $expected changed files; running the tests." >&2
		return 1
	fi

	printf '%s\n' "$files" | tr '\t' '\n'
}

# Echoes the files changed between BEFORE_SHA and HEAD, or fails.
push_changed_files() {
	# All zeros: the push created the branch, so there is nothing to diff against.
	if [[ "$BEFORE_SHA" =~ ^0+$ ]]; then
		echo "The push created the branch; running the tests." >&2
		return 1
	fi

	# The checkout is shallow. The diff needs only trees, so skip the blobs. This
	# fails if a force-push dropped BEFORE_SHA.
	if ! git -C "$ROOT" fetch --quiet --no-tags --depth=1 --filter=blob:none origin "$BEFORE_SHA"; then
		echo "Could not fetch $BEFORE_SHA; running the tests." >&2
		return 1
	fi

	# --no-renames lists a rename as a delete and an add, so the old name counts.
	git -C "$ROOT" diff --name-only --no-renames --no-color "$BEFORE_SHA" HEAD
}

if [[ -n "${PR_NUMBER:-}" ]]; then
	CHANGED=$(pr_changed_files) || emit false
elif [[ -n "${BEFORE_SHA:-}" ]]; then
	CHANGED=$(push_changed_files) || emit false
else
	echo "Not a pull request or a push; running the tests."
	emit false
fi

echo "Changed files:"
while IFS= read -r path; do
	[[ -z "$path" ]] && continue
	echo "  [docs-only=$(is_docs_only_path "$path")] $path"
done <<< "$CHANGED"

emit "$(all_docs_only <<< "$CHANGED")"
