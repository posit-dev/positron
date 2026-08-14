#!/usr/bin/env bash
# Unit tests for docker/environments/wb-local/workbench-local-lib.sh.
# Plain bash (no bats) so it runs in CI with zero install. Prints PASS/FAIL per
# check and exits non-zero if any check fails.
#
# The lib isolates every network call in a _wb_fetch_* seam (plus
# wb_url_reachable); this file redefines those with fixtures, so the whole suite
# runs offline in well under a second.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/../../docker/environments/wb-local/workbench-local-lib.sh"

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

# Asserts on exit status alone, for the predicate-style functions.
assert_ok() {
	local desc="$1"; shift
	if "$@" >/dev/null 2>&1; then echo "PASS: $desc"; else echo "FAIL: $desc (expected success)"; fail=1; fi
}
assert_fails() {
	local desc="$1"; shift
	if "$@" >/dev/null 2>&1; then echo "FAIL: $desc (expected failure)"; fail=1; else echo "PASS: $desc"; fi
}

# --- Fixtures -----------------------------------------------------------------
# Trimmed to the keys the lib reads, but the values are verbatim from the live
# feeds (captured 2026-08-09) -- the arch tokens are the whole point of these
# tests, so they must not be idealized. Note the two feeds disagree about how to
# spell arm64 for rhel9: the platform *key* says arm64, the *filename* says
# aarch64. Several assertions below exist only to pin that asymmetry.

_wb_fetch_downloads_json() {
	cat <<'JSON'
{
	"rstudio": { "pro": { "stable": { "server": { "installer": {
		"noble": { "url": "https://download2.rstudio.org/server/jammy/amd64/rstudio-workbench-2026.07.1-147.pro6-amd64.deb" },
		"rhel9": { "url": "https://download2.rstudio.org/server/rocky9/x86_64/rstudio-workbench-rhel-2026.07.1-147.pro6-x86_64.rpm" },
		"rhel8": { "url": "https://download2.rstudio.org/server/rhel8/x86_64/rstudio-workbench-rhel-2026.07.1-147.pro6-x86_64.rpm" }
	} } } } }
}
JSON
}

_wb_fetch_dailies_json() {
	cat <<'JSON'
{
	"products": { "workbench": { "platforms": {
		"noble-amd64":  { "link": "https://dl.dailies.rstudio.com/server/jammy/amd64/rstudio-workbench-2026.08.0-187.pro5-amd64.deb" },
		"noble-arm64":  { "link": "https://dl.dailies.rstudio.com/server/jammy/arm64/rstudio-workbench-2026.08.0-187.pro5-arm64.deb" },
		"rhel9-x86_64": { "link": "https://dl.dailies.rstudio.com/server/rocky9/x86_64/rstudio-workbench-rhel-2026.08.0-187.pro5-x86_64.rpm" },
		"rhel9-arm64":  { "link": "https://dl.dailies.rstudio.com/server/rocky9/arm64/rstudio-workbench-rhel-2026.08.0-187.pro5-aarch64.rpm" },
		"rhel8-x86_64": { "link": "https://dl.dailies.rstudio.com/server/rhel8/x86_64/rstudio-workbench-rhel-2026.08.0-187.pro5-x86_64.rpm" }
	} } }
}
JSON
}

# Reachability is a network seam too; default to "everything exists" and flip it
# per-test where the failure path is what's under test.
wb_url_reachable() { return 0; }

# --- wb_detect_arch -----------------------------------------------------------

wb_detect_arch x86_64;  assert_eq "detect_arch x86_64 -> amd64/x64"   "amd64 x64"   "$WB_ARCH $POSITRON_ARCH"
wb_detect_arch aarch64; assert_eq "detect_arch aarch64 -> arm64/arm64" "arm64 arm64" "$WB_ARCH $POSITRON_ARCH"
wb_detect_arch arm64;   assert_eq "detect_arch arm64 -> arm64/arm64"   "arm64 arm64" "$WB_ARCH $POSITRON_ARCH"
assert_fails "detect_arch rejects an unknown machine type" wb_detect_arch ppc64le

# --- OS facts -----------------------------------------------------------------

assert_ok    "os_valid accepts ubuntu24" wb_os_valid ubuntu24
assert_ok    "os_valid accepts rocky9" wb_os_valid rocky9
# The feed names are NOT accepted as input -- one vocabulary, checked at the door.
assert_fails "os_valid rejects the feed name noble" wb_os_valid noble
assert_fails "os_valid rejects the feed name rhel9" wb_os_valid rhel9
assert_fails "os_valid rejects an empty OS"         wb_os_valid ""

# The feed vocabulary lives here and nowhere else -- these two assertions are
# the contract that keeps "rhel9"/"noble" out of the rest of the codebase.
assert_eq "feed name ubuntu24 -> noble" "noble" "$(wb_os_feed ubuntu24)"
assert_eq "feed name rocky9 -> rhel9"   "rhel9" "$(wb_os_feed rocky9)"
assert_fails "feed name rejects a feed name fed back in" wb_os_feed noble
assert_eq "image ubuntu24" "ghcr.io/posit-dev/positron-ubuntu24:24.18.0" "$(wb_os_image ubuntu24)"
assert_eq "image rocky9"   "ghcr.io/posit-dev/positron-rocky9:24.18.0"   "$(wb_os_image rocky9)"
assert_fails "image rejects an unknown OS" wb_os_image plan9

assert_eq "pkg_ext ubuntu24"  "deb" "$(wb_os_pkg_ext ubuntu24)"
assert_eq "pkg_ext rocky9"  "rpm" "$(wb_os_pkg_ext rocky9)"
assert_eq "pkg_stem ubuntu24" "rstudio-workbench-"      "$(wb_os_pkg_stem ubuntu24)"
assert_eq "pkg_stem rocky9" "rstudio-workbench-rhel-" "$(wb_os_pkg_stem rocky9)"

assert_eq "key_arch ubuntu24/amd64"  "amd64"   "$(wb_os_key_arch ubuntu24 amd64)"
assert_eq "key_arch ubuntu24/arm64"  "arm64"   "$(wb_os_key_arch ubuntu24 arm64)"
assert_eq "key_arch rocky9/amd64"  "x86_64"  "$(wb_os_key_arch rocky9 amd64)"
# The feed key says arm64 where the filename says aarch64. Pinned here so
# "fixing" the key to match the filename fails loudly rather than 404ing.
assert_eq "key_arch rocky9/arm64 is arm64, not aarch64" "arm64" "$(wb_os_key_arch rocky9 arm64)"
assert_fails "key_arch rejects an unknown arch" wb_os_key_arch rocky9 ppc64le

# --- wb_pkg_version -----------------------------------------------------------

assert_eq "pkg_version from a .deb URL" "2026.05.1-225.pro10" \
	"$(wb_pkg_version "https://dl.dailies.rstudio.com/server/jammy/amd64/rstudio-workbench-2026.05.1-225.pro10-amd64.deb")"
assert_eq "pkg_version from an arm64 .deb" "2026.08.0-187.pro5" \
	"$(wb_pkg_version "https://dl.dailies.rstudio.com/server/jammy/arm64/rstudio-workbench-2026.08.0-187.pro5-arm64.deb")"
# The rpm stem carries an extra "-rhel" segment that must not survive into the
# version -- the bug this test exists to catch is stripping the deb stem here.
assert_eq "pkg_version from an x86_64 .rpm" "2026.08.0-187.pro5" \
	"$(wb_pkg_version "https://dl.dailies.rstudio.com/server/rocky9/x86_64/rstudio-workbench-rhel-2026.08.0-187.pro5-x86_64.rpm")"
assert_eq "pkg_version from an aarch64 .rpm" "2026.07.1-147.pro6" \
	"$(wb_pkg_version "https://download2.rstudio.org/server/rocky9/arm64/rstudio-workbench-rhel-2026.07.1-147.pro6-aarch64.rpm")"
assert_eq "pkg_version from a bare filename" "2026.08.0-187.pro5" \
	"$(wb_pkg_version "rstudio-workbench-rhel-2026.08.0-187.pro5-x86_64.rpm")"
# The menu labels render `$(wb_pkg_version "$url" || echo unavailable)`, so the
# non-zero exit on junk is load-bearing, not cosmetic.
assert_eq "pkg_version of an empty URL falls back" "unavailable" \
	"$(wb_pkg_version "" || echo unavailable)"
assert_eq "pkg_version of a non-package URL falls back" "unavailable" \
	"$(wb_pkg_version "https://example.com/positron.tar.gz" || echo unavailable)"

# --- wb_is_pkg_url / wb_pkg_arch ----------------------------------------------

assert_ok    "is_pkg_url accepts https .deb" wb_is_pkg_url "https://example.com/rstudio-workbench-1-amd64.deb"
assert_ok    "is_pkg_url accepts https .rpm" wb_is_pkg_url "https://example.com/rstudio-workbench-rhel-1-x86_64.rpm"
assert_ok    "is_pkg_url accepts http"       wb_is_pkg_url "http://example.com/x.deb"
assert_fails "is_pkg_url rejects a tarball"  wb_is_pkg_url "https://example.com/x.tar.gz"
assert_fails "is_pkg_url rejects a bare path" wb_is_pkg_url "/tmp/workbench.deb"
assert_fails "is_pkg_url rejects an empty string" wb_is_pkg_url ""

assert_eq "pkg_arch amd64 deb"   "amd64" "$(wb_pkg_arch "https://x/rstudio-workbench-1-amd64.deb")"
assert_eq "pkg_arch arm64 deb"   "arm64" "$(wb_pkg_arch "https://x/rstudio-workbench-1-arm64.deb")"
assert_eq "pkg_arch x86_64 rpm"  "amd64" "$(wb_pkg_arch "https://x/rstudio-workbench-rhel-1-x86_64.rpm")"
assert_eq "pkg_arch aarch64 rpm" "arm64" "$(wb_pkg_arch "https://x/rstudio-workbench-rhel-1-aarch64.rpm")"
assert_eq "pkg_arch of an untokenized name is empty" "" "$(wb_pkg_arch "https://x/workbench.deb")"

# --- wb_resolve_stable_url ----------------------------------------------------

assert_eq "stable ubuntu24/amd64 is the published URL verbatim" \
	"https://download2.rstudio.org/server/jammy/amd64/rstudio-workbench-2026.07.1-147.pro6-amd64.deb" \
	"$(wb_resolve_stable_url ubuntu24 amd64)"
assert_eq "stable ubuntu24/arm64 rewrites amd64 -> arm64" \
	"https://download2.rstudio.org/server/jammy/arm64/rstudio-workbench-2026.07.1-147.pro6-arm64.deb" \
	"$(wb_resolve_stable_url ubuntu24 arm64)"
assert_eq "stable rocky9/amd64 is the published URL verbatim" \
	"https://download2.rstudio.org/server/rocky9/x86_64/rstudio-workbench-rhel-2026.07.1-147.pro6-x86_64.rpm" \
	"$(wb_resolve_stable_url rocky9 amd64)"
# Two distinct rewrites in one URL: the path segment becomes arm64, the filename
# token becomes aarch64. Verified reachable against the live feed when written.
assert_eq "stable rocky9/arm64 rewrites the path and the filename differently" \
	"https://download2.rstudio.org/server/rocky9/arm64/rstudio-workbench-rhel-2026.07.1-147.pro6-aarch64.rpm" \
	"$(wb_resolve_stable_url rocky9 arm64)"
assert_fails "stable rejects an unsupported OS" wb_resolve_stable_url plan9 amd64

_wb_orig_downloads="$(declare -f _wb_fetch_downloads_json)"

# Both halves of the rhel9 rewrite are guarded, so a feed that starts publishing
# the arm64 rpm directly must pass through untouched rather than accumulate a
# second -aarch64.rpm / /arm64 segment.
_wb_fetch_downloads_json() {
	echo '{"rstudio":{"pro":{"stable":{"server":{"installer":{"rhel9":{"url":
	"https://download2.rstudio.org/server/rocky9/arm64/rstudio-workbench-rhel-2026.07.1-147.pro6-aarch64.rpm"}}}}}}}'
}
assert_eq "stable rocky9/arm64 leaves an already-arm64 URL alone" \
	"https://download2.rstudio.org/server/rocky9/arm64/rstudio-workbench-rhel-2026.07.1-147.pro6-aarch64.rpm" \
	"$(wb_resolve_stable_url rocky9 arm64)"

# An unexpected path shape must not gain a spurious /arm64 segment; only the
# parts that actually matched get rewritten.
_wb_fetch_downloads_json() {
	echo '{"rstudio":{"pro":{"stable":{"server":{"installer":{"rhel9":{"url":
	"https://example.com/pkgs/rstudio-workbench-rhel-2026.07.1-147.pro6-x86_64.rpm"}}}}}}}'
}
assert_eq "stable rocky9/arm64 rewrites only what matched" \
	"https://example.com/pkgs/rstudio-workbench-rhel-2026.07.1-147.pro6-aarch64.rpm" \
	"$(wb_resolve_stable_url rocky9 arm64)"

# A feed that stops publishing our OS must fail loudly, not hand back "null".
_wb_fetch_downloads_json() { echo '{"rstudio":{"pro":{"stable":{"server":{"installer":{}}}}}}'; }
assert_fails "stable fails when the feed has no entry for the OS" wb_resolve_stable_url ubuntu24 amd64
assert_eq "stable prints nothing on a missing entry" "" "$(wb_resolve_stable_url ubuntu24 amd64 2>/dev/null)"
eval "$_wb_orig_downloads"

# --- wb_resolve_daily_url -----------------------------------------------------

assert_eq "daily ubuntu24/amd64" \
	"https://dl.dailies.rstudio.com/server/jammy/amd64/rstudio-workbench-2026.08.0-187.pro5-amd64.deb" \
	"$(wb_resolve_daily_url ubuntu24 amd64)"
assert_eq "daily ubuntu24/arm64" \
	"https://dl.dailies.rstudio.com/server/jammy/arm64/rstudio-workbench-2026.08.0-187.pro5-arm64.deb" \
	"$(wb_resolve_daily_url ubuntu24 arm64)"
# Reads the rhel9-x86_64 key, NOT rhel9-amd64 (which does not exist in the feed).
assert_eq "daily rocky9/amd64 uses the x86_64 platform key" \
	"https://dl.dailies.rstudio.com/server/rocky9/x86_64/rstudio-workbench-rhel-2026.08.0-187.pro5-x86_64.rpm" \
	"$(wb_resolve_daily_url rocky9 amd64)"
assert_eq "daily rocky9/arm64 uses the arm64 platform key" \
	"https://dl.dailies.rstudio.com/server/rocky9/arm64/rstudio-workbench-rhel-2026.08.0-187.pro5-aarch64.rpm" \
	"$(wb_resolve_daily_url rocky9 arm64)"
assert_fails "daily rejects an unsupported OS"   wb_resolve_daily_url plan9 amd64
assert_fails "daily rejects an unsupported arch" wb_resolve_daily_url rocky9 ppc64le

_wb_orig_dailies="$(declare -f _wb_fetch_dailies_json)"
_wb_fetch_dailies_json() { echo '{"products":{"workbench":{"platforms":{}}}}'; }
assert_fails "daily fails when the platform key is absent" wb_resolve_daily_url rocky9 arm64
eval "$_wb_orig_dailies"

# --- Round trip ---------------------------------------------------------------
# The property that actually protects the Rocky lane: whatever a resolver hands
# back must parse back to the architecture that was asked for. A wrong rewrite
# rule (e.g. leaving -x86_64.rpm on an arm64 URL) fails here even if the string
# assertions above were updated to match the bug.

for _os in ubuntu24 rocky9; do
	for _arch in amd64 arm64; do
		assert_eq "round trip: stable ${_os}/${_arch} parses back to ${_arch}" "$_arch" \
			"$(wb_pkg_arch "$(wb_resolve_stable_url "$_os" "$_arch")")"
		assert_eq "round trip: daily ${_os}/${_arch} parses back to ${_arch}" "$_arch" \
			"$(wb_pkg_arch "$(wb_resolve_daily_url "$_os" "$_arch")")"
		# Both channels of an OS must agree on the package format.
		assert_eq "round trip: daily ${_os}/${_arch} has the OS's package extension" \
			"$(wb_os_pkg_ext "$_os")" \
			"$(basename "$(wb_resolve_daily_url "$_os" "$_arch")" | sed 's/.*\.//')"
	done
done

# --- wb_validate_wb_url -------------------------------------------------------

assert_ok "validate accepts a matching ubuntu24/amd64 .deb" \
	wb_validate_wb_url "https://dl.dailies.rstudio.com/server/jammy/amd64/rstudio-workbench-2026.08.0-187.pro5-amd64.deb" ubuntu24 amd64
assert_ok "validate accepts a matching rocky9/arm64 .rpm" \
	wb_validate_wb_url "https://dl.dailies.rstudio.com/server/rocky9/arm64/rstudio-workbench-rhel-2026.08.0-187.pro5-aarch64.rpm" rocky9 arm64
# The mistake this guards is pasting the URL you had in your scrollback from the
# other lane: right arch, wrong package format for the container.
assert_fails "validate rejects a .deb when the OS installs rpms" \
	wb_validate_wb_url "https://x/rstudio-workbench-2026.08.0-187.pro5-amd64.deb" rocky9 amd64
assert_fails "validate rejects an .rpm when the OS installs debs" \
	wb_validate_wb_url "https://x/rstudio-workbench-rhel-2026.08.0-187.pro5-x86_64.rpm" ubuntu24 amd64
assert_fails "validate rejects an arch mismatch" \
	wb_validate_wb_url "https://x/rstudio-workbench-rhel-2026.08.0-187.pro5-x86_64.rpm" rocky9 arm64
assert_fails "validate rejects a non-package URL" \
	wb_validate_wb_url "https://x/positron.tar.gz" ubuntu24 amd64
assert_fails "validate rejects an unsupported OS" \
	wb_validate_wb_url "https://x/rstudio-workbench-1-amd64.deb" noble amd64
# A name with no arch token can't be checked, so validation must fall through to
# reachability rather than guessing.
assert_ok "validate allows a package with no arch token" \
	wb_validate_wb_url "https://x/workbench.deb" ubuntu24 amd64

wb_url_reachable() { return 1; }
assert_fails "validate rejects an unreachable URL" \
	wb_validate_wb_url "https://x/rstudio-workbench-2026.08.0-187.pro5-amd64.deb" ubuntu24 amd64
wb_url_reachable() { return 0; }

[[ $fail -eq 0 ]] && echo "ALL PASS"
exit $fail
