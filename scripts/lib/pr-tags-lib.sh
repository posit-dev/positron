#!/usr/bin/env bash
# Pure helpers for deriving e2e tags from a PR's changed files.
# No `gh`, no $GITHUB_OUTPUT side effects: everything is string-in / string-out
# so it can be unit-tested without network or GitHub Actions context.
# Source this file; do not execute it.

# is_derivable_source <path>
# Echoes "true" iff a changed path should contribute to tag derivation. Test
# files (co-located unit/vitest tests under a test/ dir or named *.test.* /
# *.vitest.*) and lockfiles are excluded: a test-only or lockfile-only change
# should not auto-select a feature suite. This is derivation-only -- the map-rot
# guardrail excludes test/build dirs separately via positron_dir_of.
is_derivable_source() {
	local path="$1"
	case "$path" in
		*/test/*|*/tests/*) echo false; return 0 ;;
		*.test.*|*.vitest.*) echo false; return 0 ;;
		package-lock.json|*/package-lock.json) echo false; return 0 ;;
		uv.lock|*/uv.lock) echo false; return 0 ;;
	esac
	echo true
}

# derive_map_tags <changed_files> <map_file>
#   changed_files: newline-separated repo-relative paths
#   map_file: e2e-tag-paths-map.json -> { "<prefix>": ["@:tag", ...], ... }
# Echoes comma-separated, de-duplicated, order-stable matched tags (empty if
# none). For each file, the MOST SPECIFIC (longest) map prefix that matches wins;
# a deeper leaf entry overrides its broad parent rather than unioning with it, so
# a narrow entry can drop tags the parent would over-select. Tags are unioned
# across files. Non-source paths (tests, lockfiles) are skipped -- see
# is_derivable_source.
derive_map_tags() {
	local changed="$1" map_file="$2"
	local file prefix tag keys best
	local -a out=()
	keys="$(jq -r 'keys[]' "$map_file")"
	while IFS= read -r file; do
		[[ -z "$file" ]] && continue
		[[ "$(is_derivable_source "$file")" == "true" ]] || continue
		# Pick the single longest key that prefixes this file (most-specific-wins).
		best=""
		while IFS= read -r prefix; do
			[[ -z "$prefix" ]] && continue
			if [[ "$file" == "$prefix"* ]] && (( ${#prefix} > ${#best} )); then
				best="$prefix"
			fi
		done <<< "$keys"
		[[ -z "$best" ]] && continue
		while IFS= read -r tag; do
			[[ -n "$tag" ]] && out+=("$tag")
		done < <(jq -r --arg k "$best" '.[$k][]?' "$map_file")
	done <<< "$changed"
	[[ ${#out[@]} -eq 0 ]] && return 0
	printf '%s\n' "${out[@]}" | awk 'NF && !seen[$0]++' | paste -sd, -
}

# scan_added_platform_tags <patch_text>
#   patch_text: unified-diff text (concatenated patches of e2e test files)
# Echoes "<win> <web>" (each true/false), true iff the tag enum reference
# appears on an ADDED line. Test source uses `tags.WIN` / `tags.WEB`, not the
# literal `@:win` / `@:web`, so match the enum members.
scan_added_platform_tags() {
	local patch="$1" added win=false web=false
	added="$(printf '%s\n' "$patch" | grep '^+' | grep -v '^+++' || true)"
	printf '%s\n' "$added" | grep -q "tags\.WIN" && win=true
	printf '%s\n' "$added" | grep -q "tags\.WEB" && web=true
	echo "$win $web"
}

# is_infra_only <changed_files>
# Echoes "true" iff EVERY changed file is an infra/doc/lockfile path (no feature
# e2e coverage expected). Used only to suppress the no-match warning comment;
# never affects tag derivation. Empty input echoes "false" (be conservative).
is_infra_only() {
	local changed="$1" file any=false
	while IFS= read -r file; do
		[[ -z "$file" ]] && continue
		any=true
		case "$file" in
			.github/*|scripts/*|docs/*|*.md) ;;
			package-lock.json|*/package-lock.json) ;;
			*) echo false; return 0 ;;
		esac
	done <<< "$changed"
	$any && echo true || echo false
}

# union_csv_tags <csv_a> <csv_b>
# Merges two comma-separated tag lists into one de-duplicated, order-stable
# comma-separated list (a's order first, then new tags from b).
union_csv_tags() {
	local a="$1" b="$2"
	printf '%s\n%s\n' "${a//,/$'\n'}" "${b//,/$'\n'}" \
		| awk 'NF && !seen[$0]++' | paste -sd, -
}

# positron_dir_of <path>
# THE single source of truth for "which mappable Positron dir does a path belong
# to". Echoes the path truncated to its FIRST positron* segment with a trailing
# slash (e.g. src/vs/editor/contrib/positronHelp/browser/x.ts -> src/vs/editor/
# contrib/positronHelp/), or nothing if the path has no positron segment, isn't
# under src/ or extensions/, or lives in a non-feature location (test/build/
# vendor). Accepts a file path OR a bare dir path. Shared by both
# find_unmapped_positron_dirs (per changed file) and check-e2e-tag-map.sh (per
# enumerated dir), so the "what's a positron dir + what's excluded" rule lives
# in exactly one place.
positron_dir_of() {
	local path="$1" dir
	case "$path" in src/*|extensions/*) ;; *) return 0 ;; esac
	# Append a slash so a bare dir path (positron segment last) matches the same
	# way a file path (positron segment mid-path) does. sed matches leftmost.
	dir="$(printf '%s/' "$path" | sed -nE 's#(positron[^/]*)/.*#\1/#p')"
	[[ -z "$dir" ]] && return 0
	# Locations that are categorically infrastructure, never a feature suite, so
	# they need no map entry (and future dirs here are auto-excluded): the VS Code
	# base layer, the extension-API glue, and the extension API type declarations.
	case "$dir" in
		*/out/*|*/node_modules/*) return 0 ;;
		src/vs/base/*|src/vs/workbench/api/*|src/positron-dts/*) return 0 ;;
	esac
	printf '%s' "$dir" | grep -qiE '(^|/)(test|tests|[a-z-]*-tests?)(/|$)' && return 0
	printf '%s\n' "$dir"
}

# valid_enum_tags <enum_file>
# Echoes the newline-separated, unique set of tag strings declared in the
# TestTags enum (test-tags.ts). Single source of truth for "is this a real
# tag", shared by check-e2e-tag-map.sh (validating the map's tag values) and
# split_valid_invalid_tags below (validating author-typed PR tags), so the two
# can't disagree on what counts as valid. Missing file echoes nothing.
valid_enum_tags() {
	local enum_file="$1"
	[[ -f "$enum_file" ]] || return 0
	grep -oE "'@:[a-zA-Z0-9_-]+'" "$enum_file" | tr -d "'" | sort -u
}

# split_valid_invalid_tags <csv_tags> <enum_file>
# Splits a comma-separated tag list against the TestTags enum. Echoes
# "<valid_csv>|<invalid_csv>" (pipe-separated so an empty side is still a
# distinct field). Order-preserving within each side. Used to catch typo'd or
# removed author tags before they silently become a dead --grep alternative
# that matches nothing and gives no feedback.
split_valid_invalid_tags() {
	local csv="$1" enum_file="$2" tag valid_set
	local -a valid=() invalid=()
	valid_set="$(valid_enum_tags "$enum_file")"
	while IFS= read -r tag; do
		[[ -z "$tag" ]] && continue
		if printf '%s\n' "$valid_set" | grep -qxF "$tag"; then
			valid+=("$tag")
		else
			invalid+=("$tag")
		fi
	done < <(printf '%s\n' "${csv//,/$'\n'}")
	local valid_csv="" invalid_csv=""
	[[ ${#valid[@]} -gt 0 ]] && valid_csv="$(printf '%s\n' "${valid[@]}" | paste -sd, -)"
	[[ ${#invalid[@]} -gt 0 ]] && invalid_csv="$(printf '%s\n' "${invalid[@]}" | paste -sd, -)"
	echo "${valid_csv}|${invalid_csv}"
}

# find_unmapped_positron_dirs <changed_files> <map_file>
# Echoes (newline-separated, unique) the Positron source dirs this PR touches
# that have NO key in the map (even a [] value counts as mapped). Uses
# positron_dir_of for the dir rule, so it stays in lockstep with the guardrail.
find_unmapped_positron_dirs() {
	local changed="$1" map_file="$2"
	local file dir
	local -a out=()
	while IFS= read -r file; do
		[[ -z "$file" ]] && continue
		dir="$(positron_dir_of "$file")"
		[[ -z "$dir" ]] && continue
		if ! jq -e --arg k "$dir" 'has($k)' "$map_file" >/dev/null 2>&1; then
			out+=("$dir")
		fi
	done <<< "$changed"
	[[ ${#out[@]} -eq 0 ]] && return 0
	printf '%s\n' "${out[@]}" | awk 'NF && !seen[$0]++'
}
