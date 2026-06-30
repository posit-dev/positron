#!/usr/bin/env bash
# Pure helpers for deriving e2e tags from a PR's changed files.
# No `gh`, no $GITHUB_OUTPUT side effects: everything is string-in / string-out
# so it can be unit-tested without network or GitHub Actions context.
# Source this file; do not execute it.

# derive_map_tags <changed_files> <map_file>
#   changed_files: newline-separated repo-relative paths
#   map_file: e2e-tag-paths-map.json -> { "<prefix>": ["@:tag", ...], ... }
# Echoes comma-separated, de-duplicated, order-stable matched tags (empty if
# none). A file matches a map entry when the path starts with the entry's key.
derive_map_tags() {
	local changed="$1" map_file="$2"
	local file prefix tag keys
	local -a out=()
	keys="$(jq -r 'keys[]' "$map_file")"
	while IFS= read -r file; do
		[[ -z "$file" ]] && continue
		while IFS= read -r prefix; do
			[[ -z "$prefix" ]] && continue
			if [[ "$file" == "$prefix"* ]]; then
				while IFS= read -r tag; do
					[[ -n "$tag" ]] && out+=("$tag")
				done < <(jq -r --arg k "$prefix" '.[$k][]?' "$map_file")
			fi
		done <<< "$keys"
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
