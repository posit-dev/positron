#!/usr/bin/env bash
# Unit tests for scripts/lib/pr-docs-only-lib.sh.
# Plain bash (no bats) so it runs in CI with zero install. Prints PASS/FAIL per
# check and exits non-zero if any check fails.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/../lib/pr-docs-only-lib.sh"

fail=0
trap 'rm -rf "${WF_ROOT:-}" 2>/dev/null || true' EXIT

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

# --- ci_reachable_workflows ---------------------------------------------------

WF_ROOT="$(mktemp -d)"
mkdir -p "$WF_ROOT/.github/workflows"
cat > "$WF_ROOT/.github/workflows/root.yml" <<'YAML'
jobs:
  a:
    uses: ./.github/workflows/a.yml
  b:
    uses: "./.github/workflows/b.yml"
  a-again:
    uses: ./.github/workflows/a.yml
  action:
    steps:
      - uses: ./.github/actions/some-action
YAML
cat > "$WF_ROOT/.github/workflows/a.yml" <<'YAML'
jobs:
  c:
    uses: ./.github/workflows/c.yml
YAML
# b.yml calls back into a.yml: the walk must not loop.
cat > "$WF_ROOT/.github/workflows/b.yml" <<'YAML'
jobs:
  a:
    uses: ./.github/workflows/a.yml
YAML
cat > "$WF_ROOT/.github/workflows/c.yml" <<'YAML'
jobs:
  x:
    steps:
      - uses: './.github/actions/nested/inner'
YAML
mkdir -p "$WF_ROOT/.github/actions/some-action" "$WF_ROOT/.github/actions/composite-dep" \
	"$WF_ROOT/.github/actions/nested/inner" "$WF_ROOT/.github/actions/unused"
# A composite action that calls another, and is called back: no loop.
cat > "$WF_ROOT/.github/actions/some-action/action.yml" <<'YAML'
runs:
  steps:
    - uses: ./.github/actions/composite-dep/
YAML
cat > "$WF_ROOT/.github/actions/composite-dep/action.yaml" <<'YAML'
runs:
  steps:
    - uses: ./.github/actions/some-action
YAML
cat > "$WF_ROOT/.github/actions/unused/action.yml" <<'YAML'
runs:
  steps:
    - run: true
YAML
cat > "$WF_ROOT/.github/workflows/unrelated.yml" <<'YAML'
jobs:
  x:
    runs-on: ubuntu-latest
YAML

REACH="$(ci_reachable_paths "$WF_ROOT" .github/workflows/root.yml | sort | tr '\n' ' ')"
assert_eq "reachable: transitive, deduplicated, quoted uses, composite and nested actions" \
	".github/actions/composite-dep .github/actions/nested .github/actions/some-action .github/workflows/a.yml .github/workflows/b.yml .github/workflows/c.yml .github/workflows/root.yml " \
	"$REACH"

# The real workflow must reach the reusable workflows behind the required checks.
REAL_REACH="$(ci_reachable_paths "$HERE/../..")"
for wf in test-pull-request.yml test-unit.yml test-ext-host.yml test-e2e-ubuntu.yml; do
	assert_eq "real tree reaches $wf" true \
		"$(printf '%s\n' "$REAL_REACH" | grep -qxF ".github/workflows/$wf" && echo true || echo false)"
done
for action in setup-build-env setup-test-env download-binaries; do
	assert_eq "real tree reaches $action" true \
		"$(printf '%s\n' "$REAL_REACH" | grep -qxF ".github/actions/$action" && echo true || echo false)"
done
assert_eq "real tree does not reach pr-exploratory-test" false \
	"$(printf '%s\n' "$REAL_REACH" | grep -qxF ".github/actions/pr-exploratory-test" && echo true || echo false)"

# --- is_docs_only_path ------------------------------------------------------------

REACHABLE=$'.github/workflows/test-pull-request.yml\n.github/workflows/test-unit.yml\n.github/actions/restore-build-caches\n.github/actions/some-action'

check() {
	assert_eq "$1 -> $2" "$2" "$(is_docs_only_path "$1" "$REACHABLE")"
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
check .github/workflows/claude.yml true
check .github/workflows/lock.yml true

# Workflows the required jobs use, and non-workflow files beside them.
check .github/workflows/test-pull-request.yml false
check .github/workflows/test-unit.yml false
check .github/workflows/test-tag-paths-map.json false
check .github/workflows/check-clean-git-state.sh false
check .github/workflows/sub/nested.yml false
check .github/actions/restore-build-caches/action.yml false
check .github/actions/some-action/prompt.md false
check .github/actions/some-action/lib/helper.mjs false
check .github/actions/shared.mjs false

# Local actions the required jobs don't use.
check .github/actions/pr-exploratory-test/outcomes.mjs true
check .github/actions/pr-exploratory-test/outcomes-lib.test.mjs true
check .github/actions/restore-build-caches-v2/action.yml true

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
	"$(printf 'README.md\n.claude/skills/x/SKILL.md\n' | all_docs_only "$REACHABLE")"
assert_eq "blank lines ignored" true \
	"$(printf 'README.md\n\n.claude/x\n\n' | all_docs_only "$REACHABLE")"
assert_eq "one source file -> false" false \
	"$(printf 'README.md\nsrc/vs/foo.ts\n' | all_docs_only "$REACHABLE")"
assert_eq "no files -> false" false \
	"$(printf '' | all_docs_only "$REACHABLE")"
# A rename lists both names; the old source name keeps the tests on.
assert_eq "rename from source into docs -> false" false \
	"$(printf 'docs/foo.md\nsrc/vs/foo.ts\n' | all_docs_only "$REACHABLE")"

exit "$fail"
