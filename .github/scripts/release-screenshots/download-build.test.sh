#!/usr/bin/env bash
#
# Tests for download-build.sh's version resolution.
#
# The bug this covers: a release becomes visible to GET /releases the moment it
# is created, but its ~1 GiB build asset can finish uploading minutes later. On
# 2026-08-27 run 33070335039 resolved 2026.09.0-177 at 12:10 whose asset landed
# at 12:15, and six of seven matrix jobs died with "no assets match the file
# pattern" -- while the seventh had resolved 60 seconds earlier, got -166, and
# passed. So the run both failed AND split across two builds.
#
# gh is stubbed rather than mocked at the function level so the assertions run
# the real script, including the ordering of resolve_arch/resolve_os against
# resolve_version. uname is stubbed too, so the asset names under test do not
# depend on the developer's machine -- the runner is linux/x64 and a Mac would
# otherwise exercise the darwin branch against linux fixtures.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOWNLOAD_BUILD="$SCRIPT_DIR/download-build.sh"

tests_run=0
tests_failed=0
fail() { tests_failed=$((tests_failed + 1)); echo "FAIL: $1"; }
pass() { echo "ok: $1"; }

STUB_DIR="$(mktemp -d)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$STUB_DIR" "$WORK_DIR"' EXIT

# Releases newest-first, the order the API returns them. -177 exists but its
# linux x64 asset is still uploading; -166 is complete.
RELEASES_JSON='[
  {"tag_name":"2026.09.0-177","prerelease":true,"assets":[
    {"name":"positron-reh-linux-x64-2026.09.0-177.tar.gz","state":"uploaded"}
  ]},
  {"tag_name":"2026.09.0-166","prerelease":true,"assets":[
    {"name":"Positron-linux-2026.09.0-166-x64.tar.gz","state":"uploaded"},
    {"name":"Positron-darwin-2026.09.0-166-arm64.zip","state":"uploaded"}
  ]},
  {"tag_name":"2026.09.0-150","prerelease":true,"assets":[
    {"name":"Positron-linux-2026.09.0-150-x64.tar.gz","state":"uploaded"}
  ]}
]'

# A gh that answers the releases query from RELEASES_JSON and satisfies
# `gh release download` by writing a tarball the real extract step can unpack.
write_stubs() {
  cat > "$STUB_DIR/uname" <<'STUB'
#!/usr/bin/env bash
case "${1:-}" in
  -s) echo "${UNAME_S:-Linux}" ;;
  -m) echo "${UNAME_M:-x86_64}" ;;
  *) echo "${UNAME_S:-Linux}" ;;
esac
STUB
  chmod +x "$STUB_DIR/uname"

  cat > "$STUB_DIR/gh" <<'STUB'
#!/usr/bin/env bash
set -uo pipefail
if [[ "${1:-}" == "api" ]]; then
  JQ_PROG=""
  for ((i=1; i<=$#; i++)); do
    if [[ "${!i}" == "--jq" ]]; then j=$((i+1)); JQ_PROG="${!j}"; fi
  done
  printf '%s' "$GH_STUB_RELEASES" | jq -r "$JQ_PROG"
  exit 0
fi
if [[ "${1:-}" == "release" && "${2:-}" == "download" ]]; then
  TAG="$3"; DIR=""; PATTERN=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dir) DIR="$2"; shift 2 ;;
      --pattern) PATTERN="$2"; shift 2 ;;
      *) shift ;;
    esac
  done
  echo "$TAG" >> "$GH_STUB_CALLS"
  # A real archive of the right kind: the script extracts it and asserts the
  # executable is there, so a placeholder file would fail for the wrong reason.
  if [[ "$PATTERN" == *.zip ]]; then
    python3 - "$DIR/$PATTERN" <<'PYZ'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w") as z:
    z.writestr("Positron.app/Contents/MacOS/Positron", "")
PYZ
  else
    STAGE="$(mktemp -d)"
    : > "$STAGE/positron"
    chmod +x "$STAGE/positron"
    tar -czf "$DIR/$PATTERN" -C "$STAGE" positron
  fi
  exit 0
fi
echo "unexpected gh invocation: $*" >&2
exit 1
STUB
  chmod +x "$STUB_DIR/gh"
}

write_stubs

# Run download-build.sh with the stubbed gh. Echoes stdout; stderr is captured
# to $ERR_FILE and the exit code to $RC_FILE so callers can read both back
# after the command substitution's subshell has gone.
RC_FILE="$WORK_DIR/rc"
ERR_FILE="$WORK_DIR/err"
CALLS_FILE="$WORK_DIR/calls"
run_download() {
  : > "$CALLS_FILE"
  local rc
  PATH="$STUB_DIR:$PATH" \
  UNAME_S="${UNAME_S_OVERRIDE:-Linux}" \
  UNAME_M="${UNAME_M_OVERRIDE:-x86_64}" \
  GH_STUB_RELEASES="${RELEASES_OVERRIDE:-$RELEASES_JSON}" \
  GH_STUB_CALLS="$CALLS_FILE" \
  RUNNER_TEMP="$WORK_DIR/runner" \
    bash "$DOWNLOAD_BUILD" "$@" 2>"$ERR_FILE"
  rc=$?
  echo "$rc" > "$RC_FILE"
}
read_rc() { RC="$(cat "$RC_FILE")"; }

# --- the regression ---------------------------------------------------------

tests_run=$((tests_run + 1))
OUT="$(run_download latest-prerelease)"
read_rc
if [[ "$RC" == "0" ]] && grep -q '2026.09.0-166' "$CALLS_FILE"; then
  pass "latest-prerelease skips a release whose asset is still uploading"
else
  fail "latest-prerelease skips a release whose asset is still uploading
    rc=$RC downloaded='$(cat "$CALLS_FILE")'
    stderr: $(tail -3 "$ERR_FILE")"
fi

tests_run=$((tests_run + 1))
if ! grep -q '2026.09.0-177' "$CALLS_FILE"; then
  pass "the incomplete release is never downloaded"
else
  fail "the incomplete release is never downloaded: got $(cat "$CALLS_FILE")"
fi

# Once the asset lands, the newest release must win again -- the fix must skip
# incomplete releases, not pin to an older one.
tests_run=$((tests_run + 1))
RELEASES_OVERRIDE='[
  {"tag_name":"2026.09.0-177","prerelease":true,"assets":[
    {"name":"Positron-linux-2026.09.0-177-x64.tar.gz","state":"uploaded"}
  ]},
  {"tag_name":"2026.09.0-166","prerelease":true,"assets":[
    {"name":"Positron-linux-2026.09.0-166-x64.tar.gz","state":"uploaded"}
  ]}
]'
OUT="$(run_download latest-prerelease)"
read_rc
if [[ "$RC" == "0" ]] && grep -q '2026.09.0-177' "$CALLS_FILE"; then
  pass "the newest release wins once its asset has finished uploading"
else
  fail "the newest release wins once its asset has finished uploading
    rc=$RC downloaded='$(cat "$CALLS_FILE")'"
fi
unset RELEASES_OVERRIDE

# An asset row that exists but has not finished uploading must not count.
tests_run=$((tests_run + 1))
RELEASES_OVERRIDE='[
  {"tag_name":"2026.09.0-177","prerelease":true,"assets":[
    {"name":"Positron-linux-2026.09.0-177-x64.tar.gz","state":"starter"}
  ]},
  {"tag_name":"2026.09.0-166","prerelease":true,"assets":[
    {"name":"Positron-linux-2026.09.0-166-x64.tar.gz","state":"uploaded"}
  ]}
]'
OUT="$(run_download latest-prerelease)"
read_rc
if [[ "$RC" == "0" ]] && grep -q '2026.09.0-166' "$CALLS_FILE"; then
  pass "an asset still in state=starter does not count as available"
else
  fail "an asset still in state=starter does not count as available
    rc=$RC downloaded='$(cat "$CALLS_FILE")'"
fi
unset RELEASES_OVERRIDE

# No usable release at all must fail loudly rather than download nothing.
tests_run=$((tests_run + 1))
RELEASES_OVERRIDE='[
  {"tag_name":"2026.09.0-177","prerelease":true,"assets":[]}
]'
OUT="$(run_download latest-prerelease)"
read_rc
if [[ "$RC" != "0" ]] && grep -qi 'could not resolve' "$ERR_FILE"; then
  pass "no release with a usable asset fails with a clear message"
else
  fail "no release with a usable asset fails with a clear message
    rc=$RC stderr: $(tail -3 "$ERR_FILE")"
fi
unset RELEASES_OVERRIDE

# An explicit tag must bypass the asset check entirely: asking for a specific
# build and silently getting a different one would be worse than failing.
tests_run=$((tests_run + 1))
OUT="$(run_download 2026.09.0-177)"
read_rc
if grep -q '2026.09.0-177' "$CALLS_FILE"; then
  pass "an explicit tag is downloaded as asked, asset check bypassed"
else
  fail "an explicit tag is downloaded as asked, asset check bypassed
    rc=$RC downloaded='$(cat "$CALLS_FILE")'"
fi

# The asset name is platform-specific, so the check must be too: on darwin the
# fixture's only complete build is -166's arm64 zip.
tests_run=$((tests_run + 1))
# Assigned then unset rather than prefixed: `VAR=x OUT="$(...)"` is two
# assignments, not a prefixed command, so VAR would stay set for every test
# below it and silently run them all against the darwin branch.
UNAME_S_OVERRIDE=Darwin
UNAME_M_OVERRIDE=arm64
OUT="$(run_download latest-prerelease)"
read_rc
unset UNAME_S_OVERRIDE UNAME_M_OVERRIDE
if [[ "$RC" == "0" ]] && grep -q '2026.09.0-166' "$CALLS_FILE"; then
  pass "the asset check is platform-specific, not hardcoded to linux"
else
  fail "the asset check is platform-specific, not hardcoded to linux
    rc=$RC downloaded='$(cat "$CALLS_FILE")'
    stderr: $(tail -3 "$ERR_FILE")"
fi

# --- resolve-only mode -------------------------------------------------------
# The memory workflow resolves the version ONCE in a prep job and passes the
# literal tag to all seven matrix jobs, so that a new prerelease published
# mid-run cannot split the matrix across two builds. That prep job must not pay
# to download 1 GiB it will never use.

tests_run=$((tests_run + 1))
OUT="$(run_download --resolve-only latest-prerelease)"
read_rc
if [[ "$RC" == "0" ]] && [[ "$OUT" == "VERSION=2026.09.0-166" ]]; then
  pass "--resolve-only prints VERSION= for \$GITHUB_OUTPUT"
else
  fail "--resolve-only prints VERSION= for \$GITHUB_OUTPUT
    rc=$RC stdout='$OUT'
    stderr: $(tail -3 "$ERR_FILE")"
fi

tests_run=$((tests_run + 1))
if [[ ! -s "$CALLS_FILE" ]]; then
  pass "--resolve-only downloads nothing"
else
  fail "--resolve-only downloads nothing: downloaded '$(cat "$CALLS_FILE")'"
fi

tests_run=$((tests_run + 1))
OUT="$(run_download --resolve-only 2026.09.0-177)"
read_rc
if [[ "$OUT" == "VERSION=2026.09.0-177" ]]; then
  pass "--resolve-only echoes an explicit tag unchanged"
else
  fail "--resolve-only echoes an explicit tag unchanged: got '$OUT'"
fi

# The whole point of the prep job is that the tag it hands out still downloads,
# so a resolved tag fed back in must behave like any explicit tag.
tests_run=$((tests_run + 1))
RESOLVED="$(run_download --resolve-only latest-prerelease)"
RESOLVED="${RESOLVED#VERSION=}"
OUT="$(run_download "$RESOLVED")"
read_rc
if [[ "$RC" == "0" ]] && grep -q "$RESOLVED" "$CALLS_FILE"; then
  pass "a tag from --resolve-only downloads as an explicit tag"
else
  fail "a tag from --resolve-only downloads as an explicit tag
    rc=$RC resolved='$RESOLVED' downloaded='$(cat "$CALLS_FILE")'"
fi

echo
echo "$((tests_run - tests_failed))/$tests_run passed"
[[ "$tests_failed" -eq 0 ]]
