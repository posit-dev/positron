#!/usr/bin/env bash
# Unit tests for scripts/is-docs-only-change.sh.
# Plain bash (no bats) so it runs in CI with zero install. Prints PASS/FAIL per
# check and exits non-zero if any check fails.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../is-docs-only-change.sh"

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

# Helper: run the script with the given newline-delimited paths on stdin.
run() { printf '%s' "$1" | bash "$SCRIPT"; }

assert_eq "all markdown -> true" "true" \
	"$(run "$(printf 'README.md\ndocs/foo/bar.md')")"
assert_eq "docs dir only -> true" "true" \
	"$(run "$(printf 'docs/guide.txt\ndocs/img/x.png')")"
assert_eq "root license/changelog -> true" "true" \
	"$(run "$(printf 'LICENSE\nCHANGELOG.md\nNOTICE')")"
assert_eq "mixed docs + code -> false" "false" \
	"$(run "$(printf 'README.md\nsrc/vs/foo.ts')")"
assert_eq "single code file -> false" "false" \
	"$(run "src/vs/foo.ts")"
# 'docs/' as a substring inside a code path must NOT count as docs-only.
assert_eq "docs substring in code path -> false" "false" \
	"$(run "src/docsviewer/foo.ts")"
# A .md deeper in the tree still counts.
assert_eq "nested markdown -> true" "true" \
	"$(run "src/vs/workbench/contrib/foo/README.md")"
assert_eq "empty input -> false" "false" \
	"$(run "")"

if [[ "$fail" -ne 0 ]]; then
	echo "SOME TESTS FAILED"
	exit 1
fi
echo "ALL TESTS PASSED"
