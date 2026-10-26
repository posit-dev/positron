#!/usr/bin/env bash
# Decide whether a pull request, or a push, changes only docs or tooling, and
# write docs_only=true|false to $GITHUB_OUTPUT. test-pull-request.yml and
# test-merge.yml skip their test jobs when it is true. See
# scripts/lib/pr-docs-only-lib.sh for the allowlist.
#
# With PR_NUMBER, the changed files come from the pull request. With
# PUSH_BRANCH, they are the diff from the last commit on that branch where
# CI_WORKFLOW succeeded to the checked-out HEAD. Diffing from the last success,
# not the previous push, means a docs-only push can't skip past code whose run
# failed or was cancelled.
#
# CI_WORKFLOW is the workflow whose test jobs would be skipped; the workflows
# and actions it uses are never docs-only. Push mode requires it.
#
# Any error (no PR number or branch, API or git failure, truncated file list)
# yields false, so the tests run.
#
# Usage: bash scripts/pr-docs-only.sh
# Env: GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER or PUSH_BRANCH, CI_WORKFLOW
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

# Echoes the files changed since the last successful CI_WORKFLOW run on
# PUSH_BRANCH, or fails.
push_changed_files() {
	local repo="${GITHUB_REPOSITORY:?}" base
	if [[ -z "${CI_WORKFLOW:-}" ]]; then
		echo "CI_WORKFLOW is not set; running the tests." >&2
		return 1
	fi

	if ! base=$(gh api "repos/${repo}/actions/workflows/${CI_WORKFLOW##*/}/runs?branch=${PUSH_BRANCH}&event=push&status=success&per_page=1" \
		--jq '.workflow_runs[0].head_sha // empty') || [[ -z "$base" ]]; then
		echo "Could not find a successful run on $PUSH_BRANCH; running the tests." >&2
		return 1
	fi
	echo "Last successful run on $PUSH_BRANCH: $base" >&2

	# The checkout is shallow. The diff needs only trees, so skip the blobs.
	if ! git -C "$ROOT" fetch --quiet --no-tags --depth=1 --filter=blob:none origin "$base"; then
		echo "Could not fetch $base; running the tests." >&2
		return 1
	fi

	# --no-renames lists a rename as a delete and an add, so the old name counts.
	git -C "$ROOT" diff --name-only --no-renames --no-color "$base" HEAD
}

if [[ -n "${PR_NUMBER:-}" ]]; then
	CHANGED=$(pr_changed_files) || emit false
elif [[ -n "${PUSH_BRANCH:-}" ]]; then
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
