#!/usr/bin/env bash
# Pure helpers for deciding whether a PR or push changes only docs or tooling,
# so pr-dispatch.yml and main-dispatch.yml can skip the tests in
# posit-dev/positron-builds. On PRs, required-tests then passes without a run.
# No `gh`, no $GITHUB_OUTPUT side effects: everything is string-in / string-out
# so it can be unit-tested without network or GitHub Actions context.
# Source this file; do not execute it.
#
# This is an allowlist: a path is docs-only only if a rule below says so, and a
# PR or push skips the tests only if every changed path is docs-only. A new or unknown
# path runs the tests by default.

# is_docs_only_path <path>
# Echoes "true" iff changing <path> can't change the outcome of the unit,
# ext-host, or e2e tests.
is_docs_only_path() {
	local path="$1"
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
		# Local actions: positron-builds' workflows call them from the checkout,
		# and nothing here tracks which ones, so a change to any of them runs,
		# markdown included.
		.github/actions/*)
			echo false; return 0 ;;
		# `*` in a case pattern also matches `/`, so the nested checks below keep
		# these two rules to files directly in their directory.
		.github/*.md)
			[[ "$path" == */*/* ]] || { echo true; return 0; } ;;
		# The tests run from positron-builds' own workflows, never from a
		# workflow here. This includes pr-dispatch.yml and main-dispatch.yml:
		# a PR can't exercise either one, so it merges with no test run.
		# Scripts, JSON maps, and the like under .github/workflows/ are not
		# matched here and so still run.
		.github/workflows/*.yml|.github/workflows/*.yaml)
			[[ "$path" == */*/*/* ]] && echo false || echo true
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

# all_docs_only
# Reads changed paths on stdin, one per line. Echoes "true" iff there is at
# least one path and every path is docs-only.
all_docs_only() {
	local path count=0
	while IFS= read -r path; do
		[[ -z "$path" ]] && continue
		count=$((count + 1))
		if [[ "$(is_docs_only_path "$path")" != true ]]; then
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
