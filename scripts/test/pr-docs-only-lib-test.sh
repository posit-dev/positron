#!/usr/bin/env bash
# Unit tests for scripts/lib/pr-docs-only-lib.sh.
# Plain bash (no bats) so it runs in CI with zero install. Prints PASS/FAIL per
# check and exits non-zero if any check fails.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/../lib/pr-docs-only-lib.sh"

fail=0

assert_eq() {
	local desc="$1" expected="$2" actual="$3"
	if [[ "$expected" == "$actual" ]]; then
		echo "PASS: $desc"
	else
		echo "FAIL: $desc"
		echo "  expected: [$expected]"
		echo "  actual:   [$actual]"
		fail=1
	fi
}

# --- is_docs_only_path ------------------------------------------------------------

check() {
	assert_eq "$1 -> $2" "$2" "$(is_docs_only_path "$1")"
}

# Docs and tooling.
check README.md true
check CONTRIBUTING.md true
check NOTES.md true
check CLAUDE.md true
check .claude/skills/foo/SKILL.md true
check .claude/skills/foo/scripts/run.sh true
check .claude/settings.json true
check .claude/skills/foo/renderer/fixtures/scenes.expected.txt true
check .agents/skills/launch/SKILL.md true
check .github/ISSUE_TEMPLATE/bug_report.md true
check .github/instructions/foo.instructions.md true
check .github/prompts/foo.prompt.md true
check .github/copilot-instructions.md true
check extensions/positron-r/README.md true
check src/vs/workbench/contrib/positronConsole/CLAUDE.md true
check extensions/positron-python/CHANGELOG.md true
# Workflows here never run the tests; positron-builds has its own.
check .github/workflows/claude.yml true
check .github/workflows/test-unit.yml true
check .github/workflows/pr-dispatch.yml true

# Non-workflow files beside them, and every local action: positron-builds
# calls the actions, and nothing here tracks which ones.
check .github/workflows/test-tag-paths-map.json false
check .github/workflows/check-clean-git-state.sh false
check .github/workflows/sub/nested.yml false
check .github/actions/restore-build-caches/action.yml false
check .github/actions/some-action/prompt.md false
check .github/actions/some-action/CLAUDE.md false
check .github/actions/some-action/lib/helper.mjs false
check .github/actions/shared.mjs false
check .github/actions/pr-exploratory-test/outcomes.mjs false

# Source, scripts, and markdown that is runtime content or a test input.
check src/vs/workbench/workbench.common.main.ts false
check scripts/pr-tags-parse.sh false
check package.json false
check extensions/positron-assistant/src/md/prompts/chat/agent.md false
check extensions/positron-python/resources/walkthrough/data-science.md false
check test/e2e/README.md false
check test/e2e/tests/foo/README.md false
check extensions/markdown-language-features/test-workspace/a.md false
check extensions/github/testWorkspace/README.md false
check src/vs/platform/agentHost/test/node/e2e/providers/__snapshots__/x.md false
check extensions/copilot/test/simulation/fixtures/edit/markdown/README.md false

# --- all_docs_only ------------------------------------------------------------

assert_eq "all docs -> true" true \
	"$(printf 'README.md\n.claude/skills/x/SKILL.md\n' | all_docs_only)"
assert_eq "blank lines ignored" true \
	"$(printf 'README.md\n\n.claude/x\n\n' | all_docs_only)"
assert_eq "one source file -> false" false \
	"$(printf 'README.md\nsrc/vs/foo.ts\n' | all_docs_only)"
assert_eq "no files -> false" false \
	"$(printf '' | all_docs_only)"
# A rename lists both names; the old source name keeps the tests on.
assert_eq "rename from source into docs -> false" false \
	"$(printf 'docs/foo.md\nsrc/vs/foo.ts\n' | all_docs_only)"

exit "$fail"
