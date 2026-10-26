#!/usr/bin/env bash
# Tests for the push mode of scripts/pr-docs-only.sh: the diff from the last
# successful run, and every way it falls back to running the tests.
# A local file:// remote stands in for GitHub and a fake `gh` returns the last
# successful run's commit, so this needs no network.
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

# The fake gh prints $FAKE_BASE, or fails when FAKE_GH_FAIL is set.
mkdir -p "$TMP/bin"
cat > "$TMP/bin/gh" <<'SH'
#!/usr/bin/env bash
[[ -n "${FAKE_GH_FAIL:-}" ]] && exit 1
echo "${FAKE_BASE:-}"
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
printf 'jobs:\n  unit:\n    uses: ./.github/workflows/test-unit.yml\n' > "$ORIGIN/.github/workflows/test-merge.yml"
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
	local clone="$TMP/clone-$RANDOM"
	git init -q "$clone"
	git -C "$clone" remote add origin "file://$ORIGIN"
	git -C "$clone" fetch -q --depth=1 origin "$head"
	git -C "$clone" checkout -q FETCH_HEAD
	env PATH="$TMP/bin:$PATH" GITHUB_REPOSITORY=o/r PUSH_BRANCH=main \
		CI_WORKFLOW=.github/workflows/test-merge.yml GITHUB_OUTPUT= "$@" \
		bash "$clone/scripts/pr-docs-only.sh" 2>/dev/null | sed -n 's/^docs_only=//p'
}

printf 'y\n' >> "$ORIGIN/README.md"
DOCS=$(commit "docs only")
assert_eq "docs-only since the last success -> true" true "$(run "$DOCS" FAKE_BASE="$BASE")"

printf 'y\n' >> "$ORIGIN/.github/workflows/unrelated.yml"
UNRELATED=$(commit "workflow the merge run doesn't call")
assert_eq "uncalled workflow -> true" true "$(run "$UNRELATED" FAKE_BASE="$DOCS")"

printf 'y\n' >> "$ORIGIN/.github/workflows/test-unit.yml"
CALLED=$(commit "workflow the merge run calls")
assert_eq "called workflow -> false" false "$(run "$CALLED" FAKE_BASE="$UNRELATED")"

# Code lands, its run fails, then a docs-only push follows. Diffing from the
# last success still sees the code.
printf 'y\n' >> "$ORIGIN/src/a.ts"
CODE=$(commit "code")
printf 'z\n' >> "$ORIGIN/README.md"
DOCS_AFTER_CODE=$(commit "docs after untested code")
assert_eq "docs push after a failed code run -> false" false "$(run "$DOCS_AFTER_CODE" FAKE_BASE="$CALLED")"
assert_eq "docs push after a green code run -> true" true "$(run "$DOCS_AFTER_CODE" FAKE_BASE="$CODE")"

# A rename lists the old name too, so moving source into docs is not docs-only.
git -C "$ORIGIN" mv src/a.ts NOTES.md
RENAME=$(commit "move source to docs")
assert_eq "rename from source into docs -> false" false "$(run "$RENAME" FAKE_BASE="$DOCS_AFTER_CODE")"

# Every failure runs the tests.
assert_eq "no CI_WORKFLOW -> false" false "$(run "$DOCS" FAKE_BASE="$BASE" CI_WORKFLOW=)"
assert_eq "API failure -> false" false "$(run "$DOCS" FAKE_GH_FAIL=1)"
assert_eq "no successful run -> false" false "$(run "$DOCS" FAKE_BASE=)"
assert_eq "unfetchable base -> false" false "$(run "$DOCS" FAKE_BASE=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef)"
assert_eq "base is HEAD (no changes) -> false" false "$(run "$DOCS" FAKE_BASE="$DOCS")"

exit "$fail"
