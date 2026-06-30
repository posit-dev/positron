#!/usr/bin/env bash
# Upsert a sticky advisory comment about auto-tagging. Two advisories may apply:
#   - NO_MATCHES=true        -> no feature suites were auto-selected (only @:critical runs).
#   - UNMAPPED_DIRS non-empty -> the PR touches Positron dirs absent from the map.
# When neither applies, resolve any prior warning (so a stale one never lingers).
# Suppressed for infra-only PRs. Non-fatal: fork PRs get a read-only token, so a
# failed write must not break the tags job (caller appends `|| echo`).
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
source "$REPO_ROOT/lib/pr-tags-lib.sh"

REPO="${GITHUB_REPOSITORY}"
PR_NUMBER="${PR_NUMBER}"
NO_MATCHES="${NO_MATCHES:-false}"
UNMAPPED_DIRS="${UNMAPPED_DIRS:-}"
MARKER="<!-- e2e-auto-tags -->"

CHANGED_FILES="$(gh api "repos/${REPO}/pulls/${PR_NUMBER}/files" --paginate --jq '.[].filename' || true)"
if [[ "$(is_infra_only "$CHANGED_FILES")" == "true" ]]; then
	echo "Infra-only PR; skipping auto-tag advisory comment."
	exit 0
fi

EXISTING_ID="$(gh api "repos/${REPO}/issues/${PR_NUMBER}/comments" --paginate \
	--jq ".[] | select(.body | contains(\"${MARKER}\")) | .id" | head -n1 || true)"

# Assemble whichever advisory sections currently apply.
SECTIONS=""
if [[ "$NO_MATCHES" == "true" ]]; then
	SECTIONS="${SECTIONS}
**No e2e feature tags were auto-selected for this PR.** Only \`@:critical\` will run. If this PR changes a feature with e2e coverage, add the tag(s) to the PR body (see \`test/e2e/infra/test-runner/test-tags.ts\`).
"
fi
if [[ -n "$UNMAPPED_DIRS" ]]; then
	DIR_BULLETS="$(printf '%s' "$UNMAPPED_DIRS" | tr ',' '\n' | sed 's/^/- /')"
	SECTIONS="${SECTIONS}
**This PR touches Positron dir(s) with no entry in \`.github/workflows/e2e-tag-paths-map.json\`:**
${DIR_BULLETS}

Add each to the map (a feature tag list, or \`[]\` if it has no e2e coverage) so future changes there auto-select the right suite.
"
fi

if [[ -z "$SECTIONS" ]]; then
	# Nothing to warn about: resolve any prior warning, else do nothing.
	[[ -z "$EXISTING_ID" ]] && { echo "No advisories and no prior comment; nothing to do."; exit 0; }
	BODY="${MARKER}
e2e auto-tagging looks good for this PR. No action needed."
else
	BODY="${MARKER}${SECTIONS}
To skip auto-tagging entirely, add \`@:no-auto-tags\` to the PR body."
fi

if [[ -n "$EXISTING_ID" ]]; then
	gh api --method PATCH "repos/${REPO}/issues/comments/${EXISTING_ID}" -f body="$BODY"
else
	gh api --method POST "repos/${REPO}/issues/${PR_NUMBER}/comments" -f body="$BODY"
fi
