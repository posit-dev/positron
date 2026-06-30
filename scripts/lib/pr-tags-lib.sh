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

# derive_test_file_tags <changed_files> <repo_root> <enum_file>
#   changed_files: newline-separated repo-relative paths
#   repo_root: absolute path to the repo (to read the changed test files)
#   enum_file: path to test/e2e/infra/test-runner/test-tags.ts
# For each changed file under test/e2e/tests/ that exists on disk, reads its
# `tags.XXX` enum references, resolves each to its @:value from enum_file, and
# unions the FEATURE tags. Excludes platform/env/special/build-variant tags
# (governed by other mechanisms). Echoes comma-separated, de-duplicated tags.
derive_test_file_tags() {
	local changed="$1" repo_root="$2" enum_file="$3"
	local file name val enum_content
	local -a out=()

	# Build NAME -> @:value lookup from the enum (lines like: CONSOLE = '@:console',).
	# Cache the enum file to avoid repeated reads.
	enum_content="$(grep -E "=[[:space:]]*'@:" "$enum_file")"

	# Helper to look up a tag name in the enum
	_lookup_tag() {
		local tag_name="$1"
		printf '%s' "$enum_content" | grep "^[[:space:]]*${tag_name}[[:space:]]*=" | \
			sed -n "s/.*'\(@:[a-zA-Z0-9_-]*\)'.*/\1/p" | head -1
	}

	# Resolved values to exclude: platform / env / special / build-variant tags
	# are governed by dedicated PR-body greps and the platform-added-line scan.
	local exclude_re='^@:(critical|soft-fail|performance|cross-browser|win|web|web-only|jupyter|pyrefly|publisher|remote-ssh|remote-wsl|workbench.*|rhel-.*|suse-.*|sles-.*|debian-.*)$'

	while IFS= read -r file; do
		[[ -z "$file" ]] && continue
		[[ "$file" == test/e2e/tests/* ]] || continue
		[[ -f "$repo_root/$file" ]] || continue
		while IFS= read -r name; do
			val="$(_lookup_tag "$name")"
			[[ -z "$val" ]] && continue
			[[ "$val" =~ $exclude_re ]] && continue
			out+=("$val")
		done < <(grep -oE 'tags\.[A-Z0-9_]+' "$repo_root/$file" | sed 's/^tags\.//' | sort -u)
	done <<< "$changed"

	[[ ${#out[@]} -eq 0 ]] && return 0
	printf '%s\n' "${out[@]}" | awk 'NF && !seen[$0]++' | paste -sd, -
}
