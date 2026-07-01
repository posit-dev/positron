#!/usr/bin/env bash
# Weekly e2e tag audit: compare each merged PR's author-tagged feature tags with
# what the path map auto-derives, and report divergences. Read-only -- never
# edits the map, PRs, or issues.
# Usage:
#   audit-e2e-tags.sh [N] [SKIP]        # last N merged PRs to main, skipping SKIP (default 50 0)
#   audit-e2e-tags.sh --since <date>    # PRs merged on/after ISO date (weekly job)
set -uo pipefail

REPO="${GITHUB_REPOSITORY:-posit-dev/positron}"
SERVER="${GITHUB_SERVER_URL:-https://github.com}"
HERE="$(cd "$(dirname "$0")" && pwd)"
MAP="${MAP_FILE:-$HERE/../.github/workflows/e2e-tag-paths-map.json}"
# shellcheck source=/dev/null
source "$HERE/lib/pr-tags-lib.sh"

# --- args ---
MODE="count"; N=50; SKIP=0; SINCE=""
if [[ "${1:-}" == "--since" ]]; then
	MODE="since"; SINCE="${2:?--since needs a YYYY-MM-DD date}"
else
	N="${1:-50}"; SKIP="${2:-0}"
fi

# Feature-tag vocabulary = every tag the map can produce; author tags are
# restricted to these so platform/build-variant tags (@:win, @:workbench-*, ...)
# don't count as divergences.
UNIVERSE="$(jq -r '[.[][]] | unique | .[]' "$MAP" | sort -u)"
is_feature_tag() { grep -qxF "$1" <<< "$UNIVERSE"; }

# --- fetch PRs (newest first) as: number \t title \t base64(body) ---
if [[ "$MODE" == "since" ]]; then
	PRS="$(gh pr list --repo "$REPO" --state merged --base main --limit 500 \
		--search "merged:>=$SINCE" \
		--json number,title,body \
		--jq '.[] | [(.number|tostring),(.title|gsub("\t";" ")|gsub("[|]";"\\|")),(.body // ""|@base64)] | @tsv')"
	WEEK="Week of $(date -u -d "$SINCE" +'%b %-d' 2>/dev/null || echo "$SINCE")"
else
	PRS="$(gh pr list --repo "$REPO" --state merged --base main --limit "$((N + SKIP))" \
		--json number,title,body \
		--jq '.[] | [(.number|tostring),(.title|gsub("\t";" ")|gsub("[|]";"\\|")),(.body // ""|@base64)] | @tsv' \
		| tail -n +"$((SKIP + 1))")"
	WEEK="recent $N PRs"
fi

examined=0; clean=0; under=0; over=0; rows=""
while IFS=$'\t' read -r num title b64; do
	[[ -z "$num" ]] && continue
	examined=$((examined + 1))
	body="$(printf '%s' "$b64" | base64 -d 2>/dev/null || true)"

	# Author feature tags (map vocabulary only), in author order.
	author="$(printf '%s' "$body" | grep -oE '@:[a-zA-Z0-9_-]+' | awk '!s[$0]++' \
		| while IFS= read -r t; do is_feature_tag "$t" && echo "$t"; done | paste -sd, -)"

	files="$(gh api "repos/$REPO/pulls/$num/files" --paginate --jq '.[].filename' 2>/dev/null || true)"
	auto="$(derive_map_tags "$files" "$MAP" 2>/dev/null || true)"

	# Distinct winning map entries over derivable changed files.
	entry="$(while IFS= read -r f; do
		[[ -z "$f" ]] && continue
		[[ "$(is_derivable_source "$f")" == "true" ]] || continue
		lp="$(longest_map_prefix "$f" "$MAP")"; [[ -n "$lp" ]] && echo "$lp"
	done <<< "$files" | awk 'NF && !s[$0]++' | paste -sd', ' -)"

	gaps="$(csv_minus "$author" "$auto")"
	extras="$(csv_minus "$auto" "$author")"
	# Suppress gaps on non-source PRs (no derivable source changed -> empty entry).
	[[ -z "$entry" ]] && gaps=""

	if [[ -z "$gaps" && -z "$extras" ]]; then clean=$((clean + 1)); continue; fi

	# Delta cell: an "under:" line and/or an "over:" line, stacked with <br> so
	# the two directions read on separate rows in the table cell. Labels match the
	# summary's Under-tagged/Over-tagged counts, so no +/- sign to decode.
	under_list=""; over_list=""
	IFS=',' read -ra G <<< "$gaps"
	for g in "${G[@]-}"; do
		[[ -z "$g" ]] && continue
		under=$((under + 1))
		if tag_ancestor_explained "$g" "$files" "$MAP"; then
			under_list+="$g (review), "
		else
			under_list+="$g, "
		fi
	done
	IFS=',' read -ra E <<< "$extras"
	for e in "${E[@]-}"; do
		[[ -z "$e" ]] && continue
		over=$((over + 1))
		over_list+="$e, "
	done
	under_list="${under_list%, }"; over_list="${over_list%, }"
	delta=""
	[[ -n "$under_list" ]] && delta="under: $under_list"
	if [[ -n "$over_list" ]]; then
		[[ -n "$delta" ]] && delta="$delta<br>"
		delta="${delta}over: $over_list"
	fi

	rows+="| [#$num]($SERVER/$REPO/pull/$num) | $title | ${author:--} | ${auto:--} | $delta | \`${entry:--}\` |"$'\n'
done <<< "$PRS"

# --- render report (stdout -> job summary) ---
printf '## :label: Test Tag Audit - %s\n\n' "$WEEK"
printf 'Examined %d merged PRs:\n' "$examined"
printf -- '- Clean: %d\n' "$clean"
printf -- '- Under-tagged: %d\n' "$under"
printf -- '- Over-tagged: %d\n\n' "$over"
if [[ -n "$rows" ]]; then
	printf '| PR | Title | Author | Derived | Delta | Entry |\n'
	printf '|----|-------|--------|---------|-------|-------|\n'
	printf '%s\n' "${rows%$'\n'}"
	printf '\n**Legend:** `under:` map missed a tag the author set (candidate to add at Entry)  -  `over:` map produced a tag the author did not set (review)  -  `(review)` a leaf intentionally narrowed the tag away\n'
fi

# --- machine-readable counts for the workflow (Slack) ---
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
	{
		echo "examined=$examined"
		echo "clean=$clean"
		echo "under=$under"
		echo "over=$over"
		echo "week=$WEEK"
	} >> "$GITHUB_OUTPUT"
fi
