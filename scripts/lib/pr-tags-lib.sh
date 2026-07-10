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
#   map_file: test-tag-paths-map.json -> { "<prefix>": ["@:tag", ...], ... }
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

# scan_added_platform_tags <patch_text for ONE file>
# Echoes "<win> <web>" (true/false): true only if a hunk has tags.WIN/tags.WEB
# on an added line but not on a removed line IN THAT SAME HUNK -- so a same-line
# edit that reprints an already-present tag (#14731) doesn't count, but an
# unrelated hunk elsewhere in the file can't mask a real addition either.
# Multiple files? Use scan_added_platform_tags_across_files, don't concatenate.
scan_added_platform_tags() {
	local patch="$1"
	printf '%s\n' "$patch" | awk '
		function flush() {
			if (a_win && !r_win) win = 1
			if (a_web && !r_web) web = 1
			a_win = 0; r_win = 0; a_web = 0; r_web = 0
		}
		/^@@/ { flush() }
		/^\+\+\+/ || /^---/ { next }
		/^\+/ { if ($0 ~ /tags\.WIN/) a_win = 1; if ($0 ~ /tags\.WEB/) a_web = 1 }
		/^-/ { if ($0 ~ /tags\.WIN/) r_win = 1; if ($0 ~ /tags\.WEB/) r_web = 1 }
		END { flush(); print (win ? "true" : "false"), (web ? "true" : "false") }
	'
}

# scan_added_platform_tags_across_files <patch1> [<patch2> ...]
# Runs scan_added_platform_tags per file and ORs the results. Keep files
# separate here, don't concatenate them first: one file's stale tag mention
# could otherwise mask a genuinely new tag added in a different file.
scan_added_platform_tags_across_files() {
	local patch file_win file_web win=false web=false
	for patch in "$@"; do
		read -r file_win file_web <<< "$(scan_added_platform_tags "$patch")"
		[[ "$file_win" == "true" ]] && win=true
		[[ "$file_web" == "true" ]] && web=true
	done
	echo "$win $web"
}

# patch_is_comment_or_whitespace_only <patch_text for ONE file>
# Echoes "true" iff every added/removed line in the patch is blank,
# whitespace-only, or a comment -- meaning the file's runtime behavior is
# unchanged and a touched e2e test file does NOT need an auto-derived tag
# (see #14798: a reworded comment shouldn't spin up that test's lane).
#
# Bias is deliberately toward "false" (keep tagging): the dangerous mistake is
# skipping a real code change, so any changed line we can't prove is a comment
# counts as code. An empty patch (gh omits .patch for pure renames) echoes
# "false" for the same reason -- we can't see the change, so don't skip it.
#
# Comment forms recognized (after stripping leading whitespace): "//" line
# comments, "/*" openers, and "*"-led block-comment continuations/closers
# ("* detail", "*/"). Known boundary: a code line that begins with "*" after
# indentation (e.g. a wrapped "* b" multiplication) would be misread as a
# comment; this is vanishingly rare in e2e specs, and the author can always tag
# the PR body manually if it ever bites.
patch_is_comment_or_whitespace_only() {
	local patch="$1"
	# No patch text at all -> can't prove it's a no-op, so treat as code.
	[[ -z "$patch" ]] && { echo false; return 0; }
	printf '%s\n' "$patch" | awk '
		/^\+\+\+/ || /^---/ { next }   # file headers, not content
		/^@@/ { next }                 # hunk headers
		/^[+-]/ {
			line = substr($0, 2)               # drop the +/- marker
			sub(/^[ \t]+/, "", line)           # strip leading whitespace
			if (line == "") { next }           # blank / whitespace-only
			if (line ~ /^\/\//) { next }       # // line comment
			if (line ~ /^\/\*/) { next }       # /* block opener
			if (line ~ /^\*/) { next }         # * continuation or */ closer
			has_code = 1
		}
		END { print (has_code ? "false" : "true") }
	'
}

# patch_is_tag_change_only <patch_text for ONE file>
# Echoes "true" iff the change only edits tag metadata -- adding OR removing tags
# in an array, or inserting/removing a simple `{ tag: [<literal array>] }`
# options object -- while every non-tag token stays identical. Recategorizing a
# test (e.g. #14731 consolidating @:posit-assistant, or #14681 backfilling
# missing feature tags) doesn't change what the test does, so a touched test
# needs no auto-derived feature tag. tags.WIN/WEB adds still enable their lanes
# via scan_added_platform_tags, which runs separately.
#
# How it decides: it joins the removed (-) lines into one fragment and the added
# (+) lines into another (comments/whitespace ignored), strips tag metadata from
# each -- literal `tag: [ ... ]` clauses, `tags.X` tokens, and the empty braces
# they leave behind -- plus whitespace and commas, then compares. Equal residual
# means only tags moved.
#
# Deliberately conservative (bias toward "false" / keep tagging):
#   - Only a LITERAL `tag: [ ... ]` array is stripped. A ternary
#     (`tag: cond ? [...] : []`) or data-driven (`tags?: string[]`) pattern isn't
#     tag-shaped to the matcher, so its residual differs and the file derives.
#   - Any real code edited alongside the tags (a reworded describe title, a
#     changed body line) changes the residual, so it won't be skipped.
#   - At least one tag token must be involved, so a pure comment/whitespace change
#     stays with patch_is_comment_or_whitespace_only (the predicates don't overlap).
# An empty patch echoes "false" for the same reason as the comment helper.
patch_is_tag_change_only() {
	local patch="$1"
	[[ -z "$patch" ]] && { echo false; return 0; }
	printf '%s\n' "$patch" | awk '
		function norm(x) {
			gsub(/tag:[ \t]*\[[^]]*\]/, "", x)  # literal tag: [ ... ] clause
			gsub(/tags\.[A-Za-z0-9_]+/, "", x)   # stray tag tokens (e.g. data rows)
			gsub(/[ \t]/, "", x)
			gsub(/,/, "", x)
			gsub(/\{\}/, "", x)                  # empty options object left behind
			gsub(/\[\]/, "", x)                  # empty array left behind
			return x
		}
		/^\+\+\+/ || /^---/ { next }
		/^@@/ { next }
		/^[+-]/ {
			marker = substr($0, 1, 1)
			line = substr($0, 2)
			s = line; sub(/^[ \t]+/, "", s)
			if (s == "") { next }              # blank / whitespace-only
			if (s ~ /^\/\//) { next }          # // line comment
			if (s ~ /^\/\*/) { next }          # /* block opener
			if (s ~ /^\*/) { next }            # * continuation or */ closer
			real_lines++
			if (line ~ /tags\./ || line ~ /tag:[ \t]*\[/) { tag_involved = 1 }
			if (marker == "+") { added = added " " line } else { removed = removed " " line }
		}
		END {
			ok = 1
			if (real_lines == 0) { ok = 0 }        # nothing but comments/whitespace
			if (!tag_involved) { ok = 0 }          # not a tag edit at all
			if (norm(removed) != norm(added)) { ok = 0 }  # non-tag code must match
			print (ok ? "true" : "false")
		}
	'
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

# exclude_paths <all_paths> <paths_to_exclude>
# Echoes the newline-separated lines of <all_paths> that do NOT appear
# (whole-line exact) in <paths_to_exclude>, preserving order. Blank lines are
# dropped. Used by pr-tags-parse.sh to remove no-op test files from the
# changed-files list before deriving tags. When every path is excluded the
# output is empty and the exit status is 0 -- callers depend on this: `grep -v`
# exits 1 on no match, which under `set -e` would abort the whole tag step.
exclude_paths() {
	local all="$1" exclude="$2"
	# Two-file awk: read the exclude list first (NR==FNR) into a set, then print
	# lines of the all list not in it. Avoids `awk -v` (which rejects embedded
	# newlines on BSD/macOS awk) and grep -v's exit-1-on-no-match.
	awk 'NR==FNR { if ($0 != "") skip[$0] = 1; next } $0 != "" && !($0 in skip)' \
		<(printf '%s\n' "$exclude") <(printf '%s\n' "$all")
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
# find_unmapped_positron_dirs (per changed file) and check-test-tag-map.sh (per
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

# owner_root_dir_of <path>
# Like positron_dir_of, but truncates to the first-level directory under a
# KNOWN Positron root regardless of whether that directory's name contains
# "positron". Naming alone can't distinguish Positron-owned code from upstream
# VS Code code once "positron" isn't in the path, so this is only ever used
# paired with is_posit_owned_file (a copyright-header check) below -- never on
# its own, since every upstream contrib/service dir would also match. Roots
# mirror the actual root shapes used throughout test-tag-paths-map.json; extend
# the case statement if a new root shape shows up.
owner_root_dir_of() {
	local path="$1" dir
	case "$path" in
		extensions/*)
			dir="$(printf '%s\n' "$path" | sed -nE 's#^(extensions/[^/]+)/.*#\1/#p')" ;;
		src/vs/workbench/contrib/*)
			dir="$(printf '%s\n' "$path" | sed -nE 's#^(src/vs/workbench/contrib/[^/]+)/.*#\1/#p')" ;;
		src/vs/workbench/services/*)
			dir="$(printf '%s\n' "$path" | sed -nE 's#^(src/vs/workbench/services/[^/]+)/.*#\1/#p')" ;;
		src/vs/workbench/browser/*)
			dir="$(printf '%s\n' "$path" | sed -nE 's#^(src/vs/workbench/browser/[^/]+)/.*#\1/#p')" ;;
		src/vs/editor/contrib/*)
			dir="$(printf '%s\n' "$path" | sed -nE 's#^(src/vs/editor/contrib/[^/]+)/.*#\1/#p')" ;;
		src/vs/platform/*)
			dir="$(printf '%s\n' "$path" | sed -nE 's#^(src/vs/platform/[^/]+)/.*#\1/#p')" ;;
		*) return 0 ;;
	esac
	[[ -z "$dir" ]] && return 0
	printf '%s' "$dir" | grep -qiE '(^|/)(test|tests|[a-z-]*-tests?)(/|$)' && return 0
	printf '%s\n' "$dir"
}

# is_posit_owned_file <file>
# Echoes "true" iff the file's header carries a Posit copyright notice --
# the same heuristic scripts/file-origin.sh uses, minus its "positron in path"
# shortcut, since this is specifically for files where the path DOESN'T
# already say positron. A missing file (e.g. deleted before this check runs,
# or a path that was never checked out) echoes "false", never errors.
is_posit_owned_file() {
	local file="$1"
	[[ -f "$file" ]] || { echo false; return 0; }
	if head -20 "$file" 2>/dev/null | grep -qi "Copyright.*Posit"; then
		echo true
	else
		echo false
	fi
}

# valid_enum_tags <enum_file>
# Echoes the newline-separated, unique set of tag strings declared in the
# TestTags enum (test-tags.ts). Single source of truth for "is this a real
# tag", shared by check-test-tag-map.sh (validating the map's tag values) and
# split_valid_invalid_tags below (validating author-typed PR tags), so the two
# can't disagree on what counts as valid. Missing file echoes nothing.
valid_enum_tags() {
	local enum_file="$1"
	[[ -f "$enum_file" ]] || return 0
	grep -oE "'@:[a-zA-Z0-9_-]+'" "$enum_file" | tr -d "'" | sort -u
}

# feature_enum_tags <enum_file>
# Echoes the newline-separated, unique @: tag strings declared in the
# FeatureTags enum block of test-tags.ts -- the ONLY tags eligible for auto
# test-change tag derivation. Platform/special tags (separate CI lanes,
# author-controlled; @:win/@:web handled by scan_added_platform_tags) live in
# other enum blocks and are deliberately excluded, so derivation never selects a
# tag that widens the run without enabling its lane. Passed to
# derive-test-change-tags.mjs as --feature-tags. Missing file echoes nothing.
feature_enum_tags() {
	local enum_file="$1"
	[[ -f "$enum_file" ]] || return 0
	awk '
		/export enum FeatureTags[[:space:]]*\{/ { infeat = 1; next }
		infeat && /\}/ { infeat = 0 }
		infeat {
			while (match($0, /@:[a-zA-Z0-9_-]+/)) {
				print substr($0, RSTART, RLENGTH)
				$0 = substr($0, RSTART + RLENGTH)
			}
		}
	' "$enum_file" | sort -u
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
#
# Naming-convention fallback: if positron_dir_of finds no "positron" segment
# (e.g. a legacy dir like languageRuntimeService/), fall back to
# owner_root_dir_of + a copyright-header check. Without this, a Positron-owned
# file that doesn't follow the naming convention is invisible to this check
# entirely -- not just unmapped, undetectable -- and stays that way until
# someone finds it by hand (as happened with #14604).
find_unmapped_positron_dirs() {
	local changed="$1" map_file="$2"
	local file dir
	local -a out=()
	while IFS= read -r file; do
		[[ -z "$file" ]] && continue
		dir="$(positron_dir_of "$file")"
		if [[ -z "$dir" ]]; then
			dir="$(owner_root_dir_of "$file")"
			[[ -z "$dir" ]] && continue
			[[ "$(is_posit_owned_file "$file")" == "true" ]] || continue
		fi
		if ! jq -e --arg k "$dir" 'has($k)' "$map_file" >/dev/null 2>&1; then
			out+=("$dir")
		fi
	done <<< "$changed"
	[[ ${#out[@]} -eq 0 ]] && return 0
	printf '%s\n' "${out[@]}" | awk 'NF && !seen[$0]++'
}

# build_tag_reasons <final_csv> <author_csv> <map_csv> <ark> <added_win> <added_web> [<test_change_csv>]
# Assigns each tag in <final_csv> (comma-separated, order-stable) a single source
# code by precedence: required -> body -> files -> ark -> test-win -> test-web ->
# test-changed -> auto. Booleans are the strings "true"/"false". Echoes
# comma-separated "<tag>|<code>" pairs in <final_csv> order; empty final list
# echoes nothing. <test_change_csv> defaults to empty (older 6-arg callers keep
# working; those tags just fall through to "auto"). Pure: presentation of an
# already-decided tag set, no gh / $GITHUB_OUTPUT.
build_tag_reasons() {
	local final="$1" author="$2" map="$3" ark="$4" added_win="$5" added_web="$6" test_change="${7:-}"
	local tag code author_nl map_nl test_change_nl
	local -a out=()
	author_nl="${author//,/$'\n'}"
	map_nl="${map//,/$'\n'}"
	test_change_nl="${test_change//,/$'\n'}"
	while IFS= read -r tag; do
		[[ -z "$tag" ]] && continue
		if [[ "$tag" == "@:critical" ]]; then
			code="required"
		elif printf '%s\n' "$author_nl" | grep -qxF "$tag"; then
			code="body"
		elif printf '%s\n' "$map_nl" | grep -qxF "$tag"; then
			code="files"
		elif [[ "$tag" == "@:ark" && "$ark" == "true" ]]; then
			code="ark"
		elif [[ "$tag" == "@:win" && "$added_win" == "true" ]]; then
			code="test-win"
		elif [[ "$tag" == "@:web" && "$added_web" == "true" ]]; then
			code="test-web"
		elif printf '%s\n' "$test_change_nl" | grep -qxF "$tag"; then
			code="test-changed"
		else
			code="auto"
		fi
		out+=("$tag|$code")
	done < <(printf '%s\n' "${final//,/$'\n'}")
	[[ ${#out[@]} -eq 0 ]] && return 0
	printf '%s\n' "${out[@]}" | paste -sd, -
}

# render_why_these_tags <encoded>
# <encoded>: build_tag_reasons output (or the literal "@:all|body"). Echoes a
# collapsed "Why these tags?" <details> block annotating each tag with a human
# label, or NOTHING when there's nothing to explain (empty input, or the sole
# entry is the always-injected @:critical). Pure presentation: maps the source
# codes to labels. The README link that used to live in the comment footer now
# lives here.
render_why_these_tags() {
	local encoded="$1"
	[[ -z "$encoded" ]] && return 0
	# Not informative when the only entry is the required @:critical floor.
	[[ "$encoded" == "@:critical|required" ]] && return 0
	local pair tag code label rows=""
	while IFS= read -r pair; do
		[[ -z "$pair" ]] && continue
		tag="${pair%%|*}"
		code="${pair##*|}"
		case "$code" in
			required) label="Always runs (required)" ;;
			body)     label="PR description" ;;
			files)    label="Changed files" ;;
			ark)      label="Ark submodule bump" ;;
			test-win) label="New test (tags.WIN)" ;;
			test-web) label="New test (tags.WEB)" ;;
			test-changed) label="Touched test file" ;;
			*)        label="Auto-selected" ;;
		esac
		rows="${rows}| \`${tag}\` | ${label} |"$'\n'
	done < <(printf '%s\n' "${encoded//,/$'\n'}")
	cat <<EOF
<details>
<summary>Why these tags?</summary>

| Tag | Source |
| --- | --- |
${rows}
More on [automatic tags from changed files](https://github.com/posit-dev/positron/blob/main/test/e2e/README.md#automatic-tags-from-changed-files).
</details>
EOF
}
