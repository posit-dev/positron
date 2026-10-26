#!/usr/bin/env bash
# Decide whether a pull request changes only docs or tooling, and write
# docs_only=true|false to $GITHUB_OUTPUT. test-pull-request.yml skips its
# unit, ext-host, and e2e / electron jobs when it is true. See scripts/lib/pr-docs-only-lib.sh for the allowlist.
#
# Any error (no PR number, API failure, truncated file list) yields false, so
# the tests run.
#
# Usage: bash scripts/pr-docs-only.sh
# Env: GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, GITHUB_OUTPUT

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

if [[ -z "${PR_NUMBER:-}" ]]; then
	echo "Not a pull request; running the tests."
	emit false
fi

REPO="${GITHUB_REPOSITORY:?}"

if ! EXPECTED=$(gh api "repos/${REPO}/pulls/${PR_NUMBER}" --jq '.changed_files'); then
	echo "Could not fetch the pull request; running the tests."
	emit false
fi

# A rename lists only its new name in `filename`, so include the old name too:
# moving a source file into docs/ is not a docs-only change.
if ! FILES_TSV=$(gh api "repos/${REPO}/pulls/${PR_NUMBER}/files" --paginate \
	--jq '.[] | [.filename, (.previous_filename // "")] | @tsv'); then
	echo "Could not fetch the changed files; running the tests."
	emit false
fi

# The files API returns at most 3000 files. Treat a short list as unknown.
ACTUAL=$(printf '%s' "$FILES_TSV" | grep -c '' || true)
if [[ "$ACTUAL" != "$EXPECTED" ]]; then
	echo "Got $ACTUAL of $EXPECTED changed files; running the tests."
	emit false
fi

CHANGED=$(printf '%s\n' "$FILES_TSV" | tr '\t' '\n')
REACHABLE=$(ci_reachable_paths "$ROOT")

echo "Workflows and actions Test: PR uses (never docs-only):"
printf '%s\n' "$REACHABLE" | sed 's/^/  /'
echo "Changed files:"
while IFS= read -r path; do
	[[ -z "$path" ]] && continue
	echo "  [docs-only=$(is_docs_only_path "$path" "$REACHABLE")] $path"
done <<< "$CHANGED"

emit "$(all_docs_only "$REACHABLE" <<< "$CHANGED")"
