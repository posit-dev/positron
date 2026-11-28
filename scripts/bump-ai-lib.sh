#!/usr/bin/env bash
# Bump the ai-lib submodule to the latest posit-dev/ai-lib main (or --target),
# refresh the lockfiles that depend on it, and stage the result. Optionally
# writes a JSON summary and a PR body. The weekly ai-lib bump workflow in
# posit-dev/positron-builds runs this; it also works by hand from a positron
# checkout.
#
# Usage:
#   scripts/bump-ai-lib.sh [--target <sha>] [--base <ref>] [--summary <file>] [--pr-body <file>]
#
#   --target <sha>     Bump to this ai-lib commit (full sha) instead of main.
#   --base <ref>       Positron ref whose ai-lib pointer the summary and PR body
#                      count from (default HEAD). The workflow passes origin/main
#                      so a reused PR lists every ai-lib PR it brings in.
#   --summary <file>   Write a JSON summary here.
#   --pr-body <file>   Write a PR body (Markdown) here.
#
# Exits 0 when the pointer was moved or was already at the target.
set -euo pipefail

SUBMODULE=ai-lib
AI_LIB_REPO=posit-dev/ai-lib
CONTRACT_FILE=packages/ai-provider-bridge/src/headless.ts

TARGET=""
BASE_REF=HEAD
SUMMARY_FILE=""
PR_BODY_FILE=""

die() {
	echo "Error: $*" >&2
	exit 1
}

while [ $# -gt 0 ]; do
	case "$1" in
		--target|--base|--summary|--pr-body)
			[ $# -ge 2 ] || die "$1 needs a value"
			case "$1" in
				--target) TARGET=$2 ;;
				--base) BASE_REF=$2 ;;
				--summary) SUMMARY_FILE=$2 ;;
				--pr-body) PR_BODY_FILE=$2 ;;
			esac
			shift 2 ;;
		-h|--help) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) die "unknown argument '$1' (see --help)" ;;
	esac
done

# Output paths are relative to where the script was run, not the repo root.
abspath() {
	case "$1" in
		/*) echo "$1" ;;
		*) echo "$PWD/$1" ;;
	esac
}
[ -z "$SUMMARY_FILE" ] || SUMMARY_FILE=$(abspath "$SUMMARY_FILE")
[ -z "$PR_BODY_FILE" ] || PR_BODY_FILE=$(abspath "$PR_BODY_FILE")

for cmd in git jq npm; do
	command -v "$cmd" >/dev/null 2>&1 || die "$cmd is required"
done
if [ -n "$TARGET" ] && ! [[ $TARGET =~ ^[0-9a-f]{40}$ ]]; then
	die "--target must be a full 40-character sha, got '$TARGET'"
fi

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

# The ai-lib pointer recorded at a positron ref.
pointer_at() {
	git ls-tree "$1" "$SUBMODULE" | awk '$2 == "commit" { print $3 }'
}

# HEADLESS_CONTRACT_VERSION at an ai-lib commit, or empty if not found.
contract_version_at() {
	git -C "$SUBMODULE" show "$1:$CONTRACT_FILE" 2>/dev/null \
		| sed -nE 's/^export const HEADLESS_CONTRACT_VERSION[^=]*=[[:space:]]*([0-9]+).*/\1/p' \
		| head -1
}

CURRENT=$(pointer_at HEAD)
BASE=$(pointer_at "$BASE_REF")
[ -n "$CURRENT" ] || die "no $SUBMODULE submodule at HEAD"
[ -n "$BASE" ] || die "no $SUBMODULE submodule at $BASE_REF"

if [ ! -e "$SUBMODULE/.git" ]; then
	echo "Checking out the $SUBMODULE submodule..." >&2
	git submodule update --init --quiet "$SUBMODULE"
fi
# Local edits would carry over the checkout and end up in the lockfiles.
if [ -n "$(git -C "$SUBMODULE" status --porcelain --untracked-files=no)" ]; then
	die "$SUBMODULE has uncommitted changes; commit or stash them first"
fi

# Lockfiles next to a package.json with a file: dependency into ai-lib. They
# record ai-lib's dependencies, so a bump can change them.
LOCKFILES=()
while IFS= read -r manifest; do
	lockfile="$(dirname "$manifest")/package-lock.json"
	lockfile=${lockfile#./}
	[ -f "$lockfile" ] && LOCKFILES+=("$lockfile")
done < <(git grep -l -E '"file:[^"]*ai-lib/packages/' -- '*package.json' ':!ai-lib')

if [ -n "$TARGET" ]; then
	git -C "$SUBMODULE" fetch --quiet origin "$TARGET"
else
	git -C "$SUBMODULE" fetch --quiet origin main
	TARGET=$(git -C "$SUBMODULE" rev-parse FETCH_HEAD)
fi
# The base and current pointers may be missing from the clone (shallow, or not on main).
for sha in "$BASE" "$CURRENT"; do
	git -C "$SUBMODULE" cat-file -e "$sha^{commit}" 2>/dev/null \
		|| git -C "$SUBMODULE" fetch --quiet origin "$sha"
done

CHANGED=false
if [ "$CURRENT" = "$TARGET" ]; then
	echo "$SUBMODULE is already at ${TARGET:0:10}." >&2
else
	echo "Bumping $SUBMODULE ${CURRENT:0:10} -> ${TARGET:0:10}" >&2
	git -C "$SUBMODULE" checkout --quiet --detach "$TARGET"
	git add "$SUBMODULE"
	CHANGED=true

	# --package-lock-only resolves without installing anything or running scripts.
	for lockfile in ${LOCKFILES[@]+"${LOCKFILES[@]}"}; do
		echo "Refreshing $lockfile" >&2
		(cd "$(dirname "$lockfile")" && npm install --package-lock-only --ignore-scripts --no-audit --no-fund --loglevel=error >&2)
		git add "$lockfile"
	done
fi

# Of those lockfiles, the ones this branch changes (staged or committed). Count
# from where the branch left the base, so the base's own later changes don't
# show up; fall back to the base itself if history is too shallow to tell.
FORK_POINT=$(git merge-base "$BASE_REF" HEAD 2>/dev/null || echo "$BASE_REF")
LOCKFILES_JSON=$(
	if [ ${#LOCKFILES[@]} -gt 0 ]; then
		git diff --cached --name-only "$FORK_POINT" -- "${LOCKFILES[@]}"
	fi | jq -R . | jq -s .
)

# The ai-lib commits the base pointer doesn't have, newest first. ai-lib
# squash-merges, so each first-parent subject ends in "(#N)".
if git -C "$SUBMODULE" merge-base --is-ancestor "$BASE" "$TARGET" 2>/dev/null; then
	COMMITS_JSON=$(git -C "$SUBMODULE" log --first-parent --format='%H%x09%s' "$BASE..$TARGET" \
		| jq -R 'split("\t") | {sha: .[0], subject: .[1],
			pr: ((.[1] | capture("\\(#(?<n>[0-9]+)\\)$").n | tonumber)? // null)}' \
		| jq -s .)
	BASE_IS_ANCESTOR=true
else
	COMMITS_JSON='[]'
	BASE_IS_ANCESTOR=false
	echo "Warning: ${BASE:0:10} is not an ancestor of ${TARGET:0:10}; skipping the commit list." >&2
fi

SUMMARY=$(jq -n \
	--argjson changed "$CHANGED" \
	--arg base "$BASE" \
	--arg from "$CURRENT" \
	--arg to "$TARGET" \
	--argjson baseIsAncestor "$BASE_IS_ANCESTOR" \
	--argjson commits "$COMMITS_JSON" \
	--argjson lockfiles "$LOCKFILES_JSON" \
	--arg oldContract "$(contract_version_at "$BASE")" \
	--arg newContract "$(contract_version_at "$TARGET")" \
	'def orNull: if . == "" then null else tonumber end;
	{changed: $changed, base: $base, from: $from, to: $to,
		baseIsAncestor: $baseIsAncestor, commits: $commits, lockfiles: $lockfiles,
		contractVersion: {old: ($oldContract | orNull), new: ($newContract | orNull),
			changed: ($oldContract != $newContract)}}')

if [ -n "$SUMMARY_FILE" ]; then
	printf '%s\n' "$SUMMARY" > "$SUMMARY_FILE"
fi

if [ -n "$PR_BODY_FILE" ]; then
	jq -r --arg repo "$AI_LIB_REPO" --arg file "$CONTRACT_FILE" '
		# Code spans keep @mentions, #N links and closing keywords in ai-lib
		# subjects from acting on positron.
		def code: "`" + gsub("`"; "'"'"'") + "`";
		def line: if .pr then "- \($repo)#\(.pr) \(.subject | sub(" \\(#[0-9]+\\)$"; "") | code)"
			else "- \($repo)@\(.sha[0:10]) \(.subject | code)" end;
		"### Summary",
		"Bumps the ai-lib submodule to [`\(.to[0:10])`](https://github.com/\($repo)/commit/\(.to)):",
		"",
		(if .baseIsAncestor then (.commits[] | line)
			else "- The previous pointer `\(.base[0:10])` is not an ancestor of the new one, so the commit list is skipped." end),
		"",
		(if (.lockfiles | length) > 0 then "Lockfiles updated: \(.lockfiles | map("`\(.)`") | join(", "))."
			else "No lockfile changes." end),
		(if .contractVersion.changed then
			"",
			"> [!WARNING]",
			"> This bump changes the Posit Assistant headless contract version (`HEADLESS_CONTRACT_VERSION` in `\($file)`) from \(.contractVersion.old // "none") to \(.contractVersion.new // "none"). Update `SUPPORTED_CONTRACT_VERSION` in `src/vs/platform/positronHeadlessLanguageModel/node/headlessProviderModule.ts` (the type check fails until it matches). Positron only uses a Posit Assistant release with the same contract version, so Posit Assistant in `product.json` probably needs a bump too."
			else empty end),
		"",
		"### QA Notes",
		"@:assistant @:workbench"
	' <<<"$SUMMARY" > "$PR_BODY_FILE"
fi

jq -r '"Commits: \(.commits | length), lockfiles: \(.lockfiles | join(", ") | if . == "" then "none" else . end), contract version: \(.contractVersion.old // "none") -> \(.contractVersion.new // "none")"' <<<"$SUMMARY" >&2
