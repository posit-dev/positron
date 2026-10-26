#!/usr/bin/env bash
# Decide whether a pull request, or a push, changes only docs or tooling, and
# write docs_only=true|false to $GITHUB_OUTPUT. test-pull-request.yml and
# test-merge.yml skip their test jobs when it is true. See
# scripts/lib/pr-docs-only-lib.sh for the allowlist.
#
# With PR_NUMBER, the changed files come from the pull request. With
# BEFORE_SHA, they are the diff from BEFORE_SHA to the checked-out HEAD (a
# push). Each push is judged on its own changes: an earlier push's red run
# doesn't make a later docs-only push run the tests.
#
# CI_WORKFLOW is the workflow whose test jobs would be skipped; the workflows
# and actions it uses are never docs-only. Push mode requires it.
#
# Any error (no PR number or push range, API or git failure, truncated file
# list) yields false, so the tests run.
#
# Usage: bash scripts/pr-docs-only.sh
# Env: GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER or BEFORE_SHA, CI_WORKFLOW
#      (default .github/workflows/test-pull-request.yml), GITHUB_OUTPUT

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
	local repo="${GITHUB_REPOSITORY:?}" expected files actual
	if ! expected=$(gh api "repos/${repo}/pulls/${PR_NUMBER}" --jq '.changed_files'); then
		echo "Could not fetch the pull request; running the tests." >&2
		return 1
	fi

	# A rename lists only its new name in `filename`, so include the old name too:
	# moving a source file into docs/ is not a docs-only change.
	if ! files=$(gh api "repos/${repo}/pulls/${PR_NUMBER}/files" --paginate \
		--jq '.[] | [.filename, (.previous_filename // "")] | @tsv'); then
		echo "Could not fetch the changed files; running the tests." >&2
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
	if [[ -z "${CI_WORKFLOW:-}" ]]; then
		echo "CI_WORKFLOW is not set; running the tests." >&2
		return 1
	fi

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

CI_WORKFLOW="${CI_WORKFLOW:-.github/workflows/test-pull-request.yml}"
REACHABLE=$(ci_reachable_paths "$ROOT" "$CI_WORKFLOW")

echo "Workflows and actions $CI_WORKFLOW uses (never docs-only):"
printf '%s\n' "$REACHABLE" | sed 's/^/  /'
echo "Changed files:"
while IFS= read -r path; do
	[[ -z "$path" ]] && continue
	echo "  [docs-only=$(is_docs_only_path "$path" "$REACHABLE")] $path"
done <<< "$CHANGED"

emit "$(all_docs_only "$REACHABLE" <<< "$CHANGED")"
