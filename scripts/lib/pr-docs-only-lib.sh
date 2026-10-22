#!/usr/bin/env bash
# Pure helpers for deciding whether a PR changes only docs or tooling, so
# test-pull-request.yml can skip its unit, ext-host, and e2e / electron jobs.
# The required-tests gate counts a skipped job as passing.
# No `gh`, no $GITHUB_OUTPUT side effects: everything is string-in / string-out
# so it can be unit-tested without network or GitHub Actions context.
# Source this file; do not execute it.
#
# This is an allowlist: a path is docs-only only if a rule below says so, and a
# PR skips the tests only if every changed path is docs-only. A new or unknown
# path runs the tests by default.

# ci_reachable_workflows <repo_root> [root_workflow]
# Echoes, one per line, the repo-relative path of every workflow file that
# root_workflow (default .github/workflows/test-pull-request.yml) calls,
# directly or through other called workflows, plus root_workflow itself. A
# change to any of these can change what the tests do, so none of
# them is docs-only.
ci_reachable_workflows() {
	local root="$1" start="${2:-.github/workflows/test-pull-request.yml}"
	local -a queue=("$start")
	local seen=$'\n'
	local wf callee
	while ((${#queue[@]} > 0)); do
		wf="${queue[0]}"
		queue=("${queue[@]:1}")
		[[ "$seen" == *$'\n'"$wf"$'\n'* ]] && continue
		seen+="$wf"$'\n'
		echo "$wf"
		[[ -f "$root/$wf" ]] || continue
		while IFS= read -r callee; do
			queue+=("$callee")
		done < <(grep -oE 'uses:[[:space:]]*["'\'']?\./\.github/workflows/[^"'\''[:space:]@]+' "$root/$wf" |
			sed -E 's#^uses:[[:space:]]*["'\'']?\./##')
	done
}

# is_docs_only_path <path> <reachable_workflows>
# Echoes "true" iff changing <path> can't change the outcome of the required
# unit, ext-host, or e2e jobs. <reachable_workflows> is the newline-separated
# output of ci_reachable_workflows.
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

# all_docs_only <reachable_workflows>
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
