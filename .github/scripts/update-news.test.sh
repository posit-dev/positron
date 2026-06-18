#!/usr/bin/env bash
#
# Tests for update-news.sh — the script that inserts PWB Code Server and
# Code OSS versions into rstudio-pro's .github/NEWS.md Dependencies section.

set -uo pipefail

SCRIPT_DIR="$(dirname "${BASH_SOURCE[0]}")"
UPDATE_NEWS="$SCRIPT_DIR/update-news.sh"

tests_run=0
tests_failed=0

fail() {
  tests_failed=$((tests_failed + 1))
  echo "FAIL: $1"
}

pass() {
  echo "ok: $1"
}

# Run update-news.sh against a temp NEWS file with the given body.
# Usage: run_update <news_body> <pwb_version> <code_oss_version>
# Echoes the resulting file contents. Because callers capture stdout via
# command substitution (a subshell), the exit code is written to the global
# RC_FILE so the parent shell can read it back as RC.
RC_FILE="$(mktemp)"
trap 'rm -f "$RC_FILE"' EXIT
run_update() {
  local body="$1" pwb="$2" oss="$3"
  local tmp rc
  tmp="$(mktemp)"
  printf '%s' "$body" > "$tmp"
  bash "$UPDATE_NEWS" "$tmp" "$pwb" "$oss"
  rc=$?
  echo "$rc" > "$RC_FILE"
  cat "$tmp"
  rm -f "$tmp"
}
read_rc() { RC="$(cat "$RC_FILE")"; }

# Extract the "### Dependencies" section (heading through the line before the
# next "### " heading or end of file). Buffers blank lines and only emits them
# when followed by more content, which trims any trailing blank lines.
deps_section() {
  awk '
    /^### Dependencies/ { f=1 }
    /^### / { if (f && $0 !~ /Dependencies/) exit }
    f && NF == 0 { pending++; next }
    f { while (pending-- > 0) print ""; pending=0; print }
  ' <<<"$1"
}

# Print an indented before/after of the Dependencies section for a test case.
# Usage: show_example <before_text> <after_text>
show_example() {
  echo "  in:"
  deps_section "$1" | sed 's/^/    /'
  echo "  out:"
  deps_section "$2" | sed 's/^/    /'
}

NEWS_WITH_PLACEHOLDER='## Posit Workbench Release Notes

### Fixed
- (rstudio-pro#1): something

### Dependencies
-
'

# --- Test 1: insert into a section with only the placeholder line ---
tests_run=$((tests_run + 1))
version_line="- PWB Code Server 2026.06-b2855, Code OSS 1.118.0"
out="$(run_update "$NEWS_WITH_PLACEHOLDER" "2026.06-b2855" "1.118.0")"; read_rc
if [ "$RC" -ne 0 ]; then
  fail "insert: expected exit 0, got $RC"
elif ! grep -qx -- "$version_line" <<<"$out"; then
  fail "insert: missing version line"
elif ! grep -qx -- "-" <<<"$out"; then
  fail "insert: placeholder dash line should be preserved"
else
  # version line must sit under the Dependencies heading
  deps="$(awk '/^### Dependencies/{f=1;next} /^### /{f=0} f' <<<"$out")"
  if grep -qx -- "$version_line" <<<"$deps"; then
    pass "insert into placeholder section"
    show_example "$NEWS_WITH_PLACEHOLDER" "$out"
  else
    fail "insert: version line not under Dependencies heading"
  fi
fi

# --- Test 2: idempotent — running twice yields no duplicates ---
tests_run=$((tests_run + 1))
once="$(run_update "$NEWS_WITH_PLACEHOLDER" "2026.06-b2855" "1.118.0")"
twice="$(run_update "$once" "2026.06-b2855" "1.118.0")"; read_rc
line_count="$(grep -cx -- "$version_line" <<<"$twice")"
if [ "$RC" -eq 0 ] && [ "$line_count" -eq 1 ]; then
  pass "idempotent re-run (no duplicate lines)"
  show_example "$once" "$twice"
else
  fail "idempotent: line_count=$line_count rc=$RC"
fi

# --- Test 3: replace existing lines with old versions ---
tests_run=$((tests_run + 1))
NEWS_WITH_OLD='## Notes

### Dependencies
- PWB Code Server 2026.05-b2853, Code OSS 1.117.0
-
'
out="$(run_update "$NEWS_WITH_OLD" "2026.06-b2855" "1.118.0")"; read_rc
if [ "$RC" -ne 0 ]; then
  fail "replace: expected exit 0, got $RC"
elif grep -qx -- "- PWB Code Server 2026.05-b2853, Code OSS 1.117.0" <<<"$out"; then
  fail "replace: old version line still present"
elif [ "$(grep -cx -- "$version_line" <<<"$out")" -ne 1 ]; then
  fail "replace: new version line count != 1"
else
  pass "replace existing version line"
  show_example "$NEWS_WITH_OLD" "$out"
fi

# --- Test 4: error when Dependencies heading is missing ---
tests_run=$((tests_run + 1))
NEWS_NO_DEPS='## Notes

### Fixed
- nothing
'
err="$(run_update "$NEWS_NO_DEPS" "2026.06-b2855" "1.118.0" 2>&1 >/dev/null)"; read_rc
if [ "$RC" -ne 0 ]; then
  pass "error on missing Dependencies heading"
  echo "  error: $err"
else
  fail "missing-heading: expected non-zero exit, got 0"
fi

# --- Test 5: error when a version argument is empty ---
tests_run=$((tests_run + 1))
err_oss="$(run_update "$NEWS_WITH_PLACEHOLDER" "2026.06-b2855" "" 2>&1 >/dev/null)"; read_rc
rc_empty_oss=$RC
err_pwb="$(run_update "$NEWS_WITH_PLACEHOLDER" "" "1.118.0" 2>&1 >/dev/null)"; read_rc
rc_empty_pwb=$RC
if [ "$rc_empty_oss" -ne 0 ] && [ "$rc_empty_pwb" -ne 0 ]; then
  pass "error on empty version argument"
  echo "  error (empty Code OSS): $err_oss"
  echo "  error (empty PWB):      $err_pwb"
else
  fail "empty-arg: expected non-zero exit (oss=$rc_empty_oss pwb=$rc_empty_pwb)"
fi

echo
echo "Ran $tests_run tests, $tests_failed failed."
[ "$tests_failed" -eq 0 ]
