#!/usr/bin/env bash
# Tests for scripts/bump-ai-lib.sh. A local ai-lib repo stands in for
# posit-dev/ai-lib and a small superproject stands in for positron, with one
# file: dependency into ai-lib, so this needs no network.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$(cd "$HERE/.." && pwd)/bump-ai-lib.sh"

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

export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com

# The ai-lib stand-in: one package with a version and a contract version.
AILIB="$TMP/ai-lib"
git init -q -b main "$AILIB"
mkdir -p "$AILIB/packages/ai-provider-bridge/src"

# ailib_commit <package version> <contract version> <subject>: echoes the new sha.
ailib_commit() {
	printf '{ "name": "ai-provider-bridge", "version": "%s" }\n' "$1" \
		> "$AILIB/packages/ai-provider-bridge/package.json"
	printf 'export const HEADLESS_CONTRACT_VERSION = %s;\n' "$2" \
		> "$AILIB/packages/ai-provider-bridge/src/headless.ts"
	git -C "$AILIB" add -A
	git -C "$AILIB" commit -q --allow-empty -m "$3"
	git -C "$AILIB" rev-parse HEAD
}

FIRST=$(ailib_commit 1.0.0 1 "Initial")

# The positron stand-in, with ai-lib at FIRST and a matching lockfile.
POSITRON="$TMP/positron"
git init -q -b main "$POSITRON"
git -C "$POSITRON" -c protocol.file.allow=always submodule add -q "$AILIB" ai-lib
printf '{ "name": "p", "version": "0.0.0", "dependencies": { "ai-provider-bridge": "file:./ai-lib/packages/ai-provider-bridge" } }\n' \
	> "$POSITRON/package.json"
(cd "$POSITRON" && npm install --package-lock-only --ignore-scripts --no-audit --no-fund --loglevel=error >/dev/null)
# A lockfile that has nothing to do with ai-lib.
mkdir -p "$POSITRON/other"
printf '{ "name": "other", "lockfileVersion": 3 }\n' > "$POSITRON/other/package-lock.json"
printf '{ "name": "other" }\n' > "$POSITRON/other/package.json"
git -C "$POSITRON" add -A
git -C "$POSITRON" commit -q -m "Add ai-lib"

run() {
	(cd "$POSITRON" && "$SCRIPT" --summary "$TMP/summary.json" --pr-body "$TMP/body.md" "$@" 2>"$TMP/stderr")
}
summary() {
	jq -r "$1" "$TMP/summary.json"
}

# --- Already at latest ---
run
assert_eq "already at latest: exits 0" "0" "$?"
assert_eq "already at latest: not changed" "false" "$(summary .changed)"
assert_eq "already at latest: nothing staged" "" "$(git -C "$POSITRON" diff --cached --name-only)"

# --- A bump with no package or contract change ---
SECOND=$(ailib_commit 1.0.0 1 "Fix a thing (#12)")
run
assert_eq "plain bump: pointer staged" "$SECOND" "$(git -C "$POSITRON" ls-files -s ai-lib | awk '{ print $2 }')"
assert_eq "plain bump: no lockfiles" "0" "$(summary '.lockfiles | length')"
assert_eq "plain bump: PR parsed" "12 Fix a thing (#12)" "$(summary '.commits[0] | "\(.pr) \(.subject)"')"
grep -q WARNING "$TMP/body.md"
assert_eq "plain bump: no warning" "1" "$?"
grep -q '^No lockfile changes.$' "$TMP/body.md"
assert_eq "plain bump: body says no lockfile changes" "0" "$?"
git -C "$POSITRON" commit -q -m "Bump ai-lib"

# --- A bump that changes the package version and the contract version ---
THIRD=$(ailib_commit 1.1.0 2 "Bump the contract (#13)")
FOURTH=$(ailib_commit 1.1.0 2 "Direct commit without a PR")
run
assert_eq "contract bump: pointer staged" "$FOURTH" "$(git -C "$POSITRON" ls-files -s ai-lib | awk '{ print $2 }')"
assert_eq "contract bump: lockfile staged" "package-lock.json" "$(git -C "$POSITRON" diff --cached --name-only -- package-lock.json)"
assert_eq "contract bump: lockfile listed" "package-lock.json" "$(summary '.lockfiles | join(",")')"
assert_eq "contract bump: contract versions" "1 2 true" "$(summary '.contractVersion | "\(.old) \(.new) \(.changed)"')"
assert_eq "contract bump: commits newest first" "null 13" "$(summary '[.commits[].pr] | map(tostring) | join(" ")')"
grep -q 'from 1 to 2' "$TMP/body.md"
assert_eq "contract bump: body warns" "0" "$?"
grep -q "^- posit-dev/ai-lib@${FOURTH:0:10} \`Direct commit without a PR\`$" "$TMP/body.md"
assert_eq "contract bump: commit without a PR linked by sha" "0" "$?"
git -C "$POSITRON" commit -q -m "Bump ai-lib again"

# --- --base counts from an older positron ref ---
run --base HEAD~1
assert_eq "--base: not changed" "false" "$(summary .changed)"
assert_eq "--base: lists commits since base" "2" "$(summary '.commits | length')"
assert_eq "--base: lockfile counted from base" "package-lock.json" "$(summary '.lockfiles | join(",")')"

# --- --target pins an older commit ---
run --target "$THIRD"
assert_eq "--target: pointer staged" "$THIRD" "$(git -C "$POSITRON" ls-files -s ai-lib | awk '{ print $2 }')"
git -C "$POSITRON" reset -q --hard
git -C "$POSITRON" submodule update -q

# --- Subjects can't mention people or close positron issues; tags are set ---
ailib_commit 1.1.0 "3 as const" 'Bump @ai-sdk, Fixes #42, keep `code` (#14)' >/dev/null
run
assert_eq "subject: wrapped in a code span" "- posit-dev/ai-lib#14 \`Bump @ai-sdk, Fixes #42, keep 'code'\`" "$(grep '#14' "$TMP/body.md")"
assert_eq "tags: assistant and workbench" "@:assistant @:workbench" "$(tail -1 "$TMP/body.md")"
assert_eq "contract: 'as const' form parsed" "2 3" "$(summary '.contractVersion | "\(.old) \(.new)"')"
git -C "$POSITRON" commit -q -m "Bump ai-lib a third time"

# --- A bump branch behind main only lists its own lockfile changes ---
git -C "$POSITRON" branch bot
printf '{ "name": "other", "lockfileVersion": 3, "changed": true }\n' > "$POSITRON/other/package-lock.json"
jq '.name = "p2"' "$POSITRON/package-lock.json" > "$TMP/lock" && mv "$TMP/lock" "$POSITRON/package-lock.json"
git -C "$POSITRON" commit -q -am "Unrelated lockfile changes on main"
git -C "$POSITRON" checkout -q bot
ailib_commit 1.1.0 "3 as const" "Another change (#15)" >/dev/null
run --base main
assert_eq "behind main: bumped" "true" "$(summary .changed)"
assert_eq "behind main: main's lockfile changes not listed" "0" "$(summary '.lockfiles | length')"
git -C "$POSITRON" reset -q --hard
git -C "$POSITRON" checkout -q main
git -C "$POSITRON" submodule update -q

# --- Output paths are relative to where the script runs ---
mkdir -p "$POSITRON/sub"
(cd "$POSITRON/sub" && "$SCRIPT" --summary rel.json 2>/dev/null)
assert_eq "relative --summary: written in the current folder" "true" "$([ -s "$POSITRON/sub/rel.json" ] && echo true)"
git -C "$POSITRON" reset -q --hard
git -C "$POSITRON" submodule update -q
rm -rf "$POSITRON/sub"

# --- Local edits in ai-lib stop the bump ---
printf 'edited\n' >> "$POSITRON/ai-lib/packages/ai-provider-bridge/package.json"
run
assert_eq "dirty ai-lib: fails" "1" "$?"
assert_eq "dirty ai-lib: says why" "1" "$(grep -c 'uncommitted changes' "$TMP/stderr")"
assert_eq "dirty ai-lib: nothing staged" "" "$(git -C "$POSITRON" diff --cached --name-only)"
git -C "$POSITRON/ai-lib" checkout -q -- .

# --- Bad input ---
run --target abc123
assert_eq "--target short sha: fails" "1" "$?"
run --nope
assert_eq "unknown flag: fails" "1" "$?"
(cd "$POSITRON" && "$SCRIPT" --summary 2>"$TMP/stderr")
assert_eq "flag without a value: fails" "1" "$?"
assert_eq "flag without a value: says why" "Error: --summary needs a value" "$(cat "$TMP/stderr")"

exit $fail
