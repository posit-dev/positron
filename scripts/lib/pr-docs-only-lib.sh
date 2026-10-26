#!/usr/bin/env bash
# Pure helpers for deciding whether a PR or push changes only docs or tooling,
# so test-pull-request.yml and test-merge.yml can skip their test jobs. On PRs,
# the required-tests gate counts a skipped job as passing.
# No `gh`, no $GITHUB_OUTPUT side effects: everything is string-in / string-out
# so it can be unit-tested without network or GitHub Actions context.
# Source this file; do not execute it.
#
# This is an allowlist: a path is docs-only only if a rule below says so, and a
# PR skips the tests only if every changed path is docs-only. A new or unknown
# path runs the tests by default.

# ci_reachable_paths <repo_root> [root_workflow]
# Echoes every workflow file and local action directory that root_workflow
# (default .github/workflows/test-pull-request.yml) uses, directly or
# transitively, plus root_workflow itself. None of these is docs-only.
# Actions are reported as .github/actions/<name>, and every action.yml under
# that directory is followed, so nested actions count.
ci_reachable_paths() {
	local root="$1" start="${2:-.github/workflows/test-pull-request.yml}"
	local -a queue=("$start") files
	local seen=$'\n'
	local item callee
	while ((${#queue[@]} > 0)); do
		item="${queue[0]}"
		queue=("${queue[@]:1}")
		[[ "$seen" == *$'\n'"$item"$'\n'* ]] && continue
		seen+="$item"$'\n'
		echo "$item"
		files=()
		case "$item" in
			.github/actions/*)
				[[ -d "$root/$item" ]] || continue
				while IFS= read -r callee; do
					files+=("$callee")
				done < <(find "$root/$item" -type f \( -name action.yml -o -name action.yaml \)) ;;
			*) [[ -f "$root/$item" ]] && files=("$root/$item") ;;
		esac
		((${#files[@]} > 0)) || continue
		while IFS= read -r callee; do
			queue+=("$callee")
		done < <(grep -hoE 'uses:[[:space:]]*["'\'']?\./\.github/(workflows|actions)/[^"'\''[:space:]@]+' "${files[@]}" |
			sed -E 's#^uses:[[:space:]]*["'\'']?\./##; s#^(\.github/actions/[^/]+).*#\1#')
	done
}

# is_docs_only_path <path> <reachable>
# Echoes "true" iff changing <path> can't change the outcome of the required
# unit, ext-host, or e2e jobs. <reachable> is the newline-separated
# output of ci_reachable_paths.
is_docs_only_path() {
	local path="$1" reachable="$2"
	local base="${path##*/}"

	# Claude Code and agent skills, rules, and settings, including the skills'
	# own scripts, tests, and fixtures: none of it is built into the product.
	case "$path" in
		.claude/*|.agents/*) echo true; return 0 ;;
	esac

	# Test inputs: markdown fixtures, snapshots, and test workspaces are read by
	# the tests themselves, so they are never docs-only.
	case "$path" in
		test/*|*/test/*|*/tests/*|*/fixtures/*|*/__snapshots__/*|*test-workspace/*|*testWorkspace/*|*/test-files/*)
			echo false; return 0 ;;
	esac

	case "$path" in
		# Copilot customizations and GitHub community files.
		.github/ISSUE_TEMPLATE/*|.github/instructions/*|.github/prompts/*|.github/agents/*|.github/skills/*|.github/learnings/*)
			echo true; return 0 ;;
		# `*` in a case pattern also matches `/`, so the nested checks below keep
		# these two rules to files directly in their directory.
		.github/*.md)
			[[ "$path" == */*/* ]] || { echo true; return 0; } ;;
		# A workflow the required jobs don't call. Scripts, JSON maps, and the
		# like under .github/workflows/ are not matched here and so still run.
		.github/workflows/*.yml|.github/workflows/*.yaml)
			if [[ "$path" == */*/*/* ]] || printf '%s\n' "$reachable" | grep -qxF "$path"; then
				echo false
			else
				echo true
			fi
			return 0 ;;
		# Any file in a local action the required jobs don't use. Files directly
		# in .github/actions/ belong to no action and so still run.
		.github/actions/*/*)
			local action="${path#.github/actions/}"
			action=".github/actions/${action%%/*}"
			if printf '%s\n' "$reachable" | grep -qxF "$action"; then
				echo false
			else
				echo true
			fi
			return 0 ;;
		# Top-level markdown (README, CONTRIBUTING, ...).
		*/*) ;;
		*.md) echo true; return 0 ;;
	esac

	# Markdown elsewhere in the tree is often runtime content (prompts,
	# walkthroughs, skill templates), so only well-known docs names count.
	case "$base" in
		README.md|CLAUDE.md|AGENTS.md|CONTRIBUTING.md|CHANGELOG.md)
			echo true; return 0 ;;
	esac

	echo false
}

# all_docs_only <reachable>
# Reads changed paths on stdin, one per line. Echoes "true" iff there is at
# least one path and every path is docs-only.
all_docs_only() {
	local reachable="$1" path count=0
	while IFS= read -r path; do
		[[ -z "$path" ]] && continue
		count=$((count + 1))
		if [[ "$(is_docs_only_path "$path" "$reachable")" != true ]]; then
			echo false
			return 0
		fi
	done
	if ((count == 0)); then
		echo false
	else
		echo true
	fi
}
