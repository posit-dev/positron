#!/usr/bin/env bash
# Tests for scripts/pr-docs-only.sh: how each mode gets the changed files, and
# every way it falls back to running the tests. A local file:// remote stands in
# for GitHub in push mode and a stub `gh` serves the PR API, so this needs no
# network.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$(cd "$HERE/.." && pwd)"

fail=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

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

# The stub gh prints FAKE_PR_FILES (tsv of filename and previous name) for the
# files API and FAKE_PR_COUNT for the PR itself, or fails when FAKE_GH_FAIL is set.
mkdir -p "$TMP/bin"
cat > "$TMP/bin/gh" <<'SH'
#!/usr/bin/env bash
[[ -n "${FAKE_GH_FAIL:-}" ]] && exit 1
if [[ "$*" == */files* ]]; then
	printf '%b\n' "$FAKE_PR_FILES"
else
	echo "$FAKE_PR_COUNT"
fi
SH
chmod +x "$TMP/bin/gh"

ORIGIN="$TMP/origin"
git init -q -b main "$ORIGIN"
git -C "$ORIGIN" config user.email test@example.com
git -C "$ORIGIN" config user.name test
# Let the shallow clones fetch any commit by SHA with a filter, as GitHub does.
git -C "$ORIGIN" config uploadpack.allowFilter true
git -C "$ORIGIN" config uploadpack.allowAnySHA1InWant true

mkdir -p "$ORIGIN/scripts/lib" "$ORIGIN/.github/workflows" "$ORIGIN/src"
cp "$SRC/pr-docs-only.sh" "$ORIGIN/scripts/"
cp "$SRC/lib/pr-docs-only-lib.sh" "$ORIGIN/scripts/lib/"
printf 'jobs:\n  unit:\n    uses: ./.github/workflows/test-unit.yml\n' > "$ORIGIN/.github/workflows/test-pull-request.yml"
printf 'jobs:\n  unit:\n    uses: ./.github/workflows/test-unit.yml\n  win:\n    uses: ./.github/workflows/merge-only.yml\n' \
	> "$ORIGIN/.github/workflows/test-merge.yml"
printf 'jobs: {}\n' > "$ORIGIN/.github/workflows/merge-only.yml"
printf 'jobs: {}\n' > "$ORIGIN/.github/workflows/test-unit.yml"
printf 'jobs: {}\n' > "$ORIGIN/.github/workflows/unrelated.yml"
printf 'x\n' > "$ORIGIN/src/a.ts"
printf 'x\n' > "$ORIGIN/README.md"

# commit <message>: commits everything in origin and echoes the new SHA.
commit() {
	git -C "$ORIGIN" add -A
	git -C "$ORIGIN" commit -q -m "$1"
	git -C "$ORIGIN" rev-parse HEAD
}

BASE=$(commit base)

# run <head_sha> [env...]: shallow-clones origin at head_sha, as actions/checkout
# does, and echoes the script's docs_only value.
run() {
	local head="$1"
	shift
	local clone
	clone=$(mktemp -d "$TMP/clone.XXXXXX")
	git init -q "$clone"
	git -C "$clone" remote add origin "file://$ORIGIN"
	git -C "$clone" fetch -q --depth=1 origin "$head"
	git -C "$clone" checkout -q FETCH_HEAD
	env CI_WORKFLOW=.github/workflows/test-merge.yml GITHUB_OUTPUT= "$@" \
		PATH="$TMP/bin:$PATH" GITHUB_REPOSITORY=o/r \
		bash "$clone/scripts/pr-docs-only.sh" 2>/dev/null | sed -n 's/^docs_only=//p'
}

# --- push mode -----------------------------------------------------------------

printf 'y\n' >> "$ORIGIN/README.md"
DOCS=$(commit "docs only")
assert_eq "docs-only push -> true" true "$(run "$DOCS" BEFORE_SHA="$BASE")"

printf 'y\n' >> "$ORIGIN/.github/workflows/unrelated.yml"
UNRELATED=$(commit "workflow the merge run doesn't call")
assert_eq "uncalled workflow -> true" true "$(run "$UNRELATED" BEFORE_SHA="$DOCS")"

printf 'y\n' >> "$ORIGIN/.github/workflows/test-unit.yml"
CALLED=$(commit "workflow the merge run calls")
assert_eq "called workflow -> false" false "$(run "$CALLED" BEFORE_SHA="$UNRELATED")"

# The PR-mode section checks the same file comes out true there.
printf 'y\n' >> "$ORIGIN/.github/workflows/merge-only.yml"
MERGE_ONLY=$(commit "workflow only the merge run calls")
assert_eq "workflow only the merge run calls -> false" false "$(run "$MERGE_ONLY" BEFORE_SHA="$CALLED")"

# A push is judged on its own commits: a docs-only push after a code push
# skips, but one push carrying both runs the tests.
printf 'y\n' >> "$ORIGIN/src/a.ts"
CODE=$(commit "code")
printf 'z\n' >> "$ORIGIN/README.md"
DOCS_AFTER_CODE=$(commit "docs after code")
assert_eq "docs-only push after a code push -> true" true "$(run "$DOCS_AFTER_CODE" BEFORE_SHA="$CODE")"
assert_eq "one push with code and docs commits -> false" false "$(run "$DOCS_AFTER_CODE" BEFORE_SHA="$MERGE_ONLY")"

# A rename lists the old name too, so moving source into docs is not docs-only.
git -C "$ORIGIN" mv src/a.ts NOTES.md
RENAME=$(commit "move source to docs")
assert_eq "rename from source into docs -> false" false "$(run "$RENAME" BEFORE_SHA="$DOCS_AFTER_CODE")"

# Every failure runs the tests.
assert_eq "no CI_WORKFLOW -> false" false "$(run "$DOCS" BEFORE_SHA="$BASE" CI_WORKFLOW=)"
assert_eq "branch creation (zero SHA) -> false" false "$(run "$DOCS" BEFORE_SHA=0000000000000000000000000000000000000000)"
assert_eq "unfetchable base -> false" false "$(run "$DOCS" BEFORE_SHA=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef)"
assert_eq "base is HEAD (no changes) -> false" false "$(run "$DOCS" BEFORE_SHA="$DOCS")"

# --- PR mode -------------------------------------------------------------------

# pr <count> <files>: runs PR mode against the stub API. CI_WORKFLOW is unset,
# so the PR workflow's list applies.
pr() {
	run "$DOCS" PR_NUMBER=1 CI_WORKFLOW= FAKE_PR_COUNT="$1" FAKE_PR_FILES="$2" "${@:3}"
}

assert_eq "PR: docs only -> true" true "$(pr 2 'README.md\t\n.claude/x.md\t')"
assert_eq "PR: docs and source -> false" false "$(pr 2 'README.md\t\nsrc/a.ts\t')"
assert_eq "PR: rename from source into docs -> false" false "$(pr 1 'NOTES.md\tsrc/a.ts')"
assert_eq "PR: workflow only the merge run calls -> true" true "$(pr 1 '.github/workflows/merge-only.yml\t')"
assert_eq "PR: truncated file list -> false" false "$(pr 3 'README.md\t\nNOTES.md\t')"
assert_eq "PR: API failure -> false" false "$(pr 1 'README.md\t' FAKE_GH_FAIL=1)"

exit "$fail"
