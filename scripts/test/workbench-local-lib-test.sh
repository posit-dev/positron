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
# feeds (rhel9/noble captured 2026-08-09, opensuse15 2026-09-02) -- the arch
# tokens are the whole point of these tests, so they must not be idealized. Note
# the two feeds disagree about how to spell arm64 for rhel9: the platform *key*
# says arm64, the *filename* says aarch64. Several assertions below exist only to
# pin that asymmetry.
#
# There is deliberately no "opensuse15-arm64" key and no arm64 rpm in the stable
# fixture: the live feeds publish neither, which is why wb_os_arches lists
# opensuse15 as amd64-only. Adding a fake arm64 key here would make the tests
# pass on a URL that 404s in reality.

_wb_fetch_downloads_json() {
	cat <<'JSON'
{
	"rstudio": { "pro": { "stable": { "server": { "installer": {
		"noble": { "url": "https://download2.rstudio.org/server/jammy/amd64/rstudio-workbench-2026.07.1-147.pro6-amd64.deb" },
		"rhel9": { "url": "https://download2.rstudio.org/server/rocky9/x86_64/rstudio-workbench-rhel-2026.07.1-147.pro6-x86_64.rpm" },
		"rhel8": { "url": "https://download2.rstudio.org/server/rhel8/x86_64/rstudio-workbench-rhel-2026.07.1-147.pro6-x86_64.rpm" },
		"opensuse15": { "url": "https://download2.rstudio.org/server/opensuse15/x86_64/rstudio-workbench-2026.08.2-200.pro1-x86_64.rpm" }
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
		"rhel8-x86_64": { "link": "https://dl.dailies.rstudio.com/server/rhel8/x86_64/rstudio-workbench-rhel-2026.08.0-187.pro5-x86_64.rpm" },
		"opensuse15-x86_64": { "link": "https://dl.dailies.rstudio.com/server/opensuse15/x86_64/rstudio-workbench-2026.09.0-166.pro8-x86_64.rpm" }
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
assert_ok    "os_valid accepts opensuse15" wb_os_valid opensuse15
# The feed names are NOT accepted as input -- one vocabulary, checked at the door.
assert_fails "os_valid rejects the feed name noble" wb_os_valid noble
assert_fails "os_valid rejects the feed name rhel9" wb_os_valid rhel9
assert_fails "os_valid rejects an empty OS"         wb_os_valid ""

# The feed vocabulary lives here and nowhere else -- these two assertions are
# the contract that keeps "rhel9"/"noble" out of the rest of the codebase.
assert_eq "feed name ubuntu24 -> noble" "noble" "$(wb_os_feed ubuntu24)"
assert_eq "feed name rocky9 -> rhel9"   "rhel9" "$(wb_os_feed rocky9)"
# opensuse15 is the one OS whose token and feed name coincide. Asserted so the
# coincidence is a checked fact rather than a reason to skip wb_os_feed.
assert_eq "feed name opensuse15 -> opensuse15" "opensuse15" "$(wb_os_feed opensuse15)"
assert_fails "feed name rejects a feed name fed back in" wb_os_feed noble
assert_eq "image ubuntu24" "ghcr.io/posit-dev/positron-ubuntu24:24.18.0" "$(wb_os_image ubuntu24)"
assert_eq "image rocky9"   "ghcr.io/posit-dev/positron-rocky9:24.18.0"   "$(wb_os_image rocky9)"
assert_eq "image opensuse15" "ghcr.io/posit-dev/positron-opensuse156:24.18.0" "$(wb_os_image opensuse15)"
assert_fails "image rejects an unknown OS" wb_os_image plan9

assert_eq "pkg_ext ubuntu24"  "deb" "$(wb_os_pkg_ext ubuntu24)"
assert_eq "pkg_ext rocky9"  "rpm" "$(wb_os_pkg_ext rocky9)"
assert_eq "pkg_ext opensuse15" "rpm" "$(wb_os_pkg_ext opensuse15)"
assert_eq "pkg_stem ubuntu24" "rstudio-workbench-"      "$(wb_os_pkg_stem ubuntu24)"
assert_eq "pkg_stem rocky9" "rstudio-workbench-rhel-" "$(wb_os_pkg_stem rocky9)"
# Same extension as rocky9, different stem: the openSUSE rpm has no "-rhel"
# segment. This pair is what wb_pkg_version's two-step strip depends on.
assert_eq "pkg_stem opensuse15" "rstudio-workbench-" "$(wb_os_pkg_stem opensuse15)"

assert_eq "family ubuntu24"   "debian" "$(wb_os_family ubuntu24)"
assert_eq "family rocky9"     "redhat" "$(wb_os_family rocky9)"
assert_eq "family opensuse15" "suse"   "$(wb_os_family opensuse15)"
assert_fails "family rejects an unknown OS" wb_os_family plan9

# --- wb_os_arches / wb_os_supports_arch / wb_os_platform ----------------------
# Posit publishes no arm64 Workbench for openSUSE 15 on either channel, so this
# is a fact about the feeds, not a policy choice. Everything downstream (URL
# resolution refusing, the local stack forcing an emulated amd64 container)
# hangs off these three.

assert_eq "arches ubuntu24"   "amd64 arm64" "$(wb_os_arches ubuntu24)"
assert_eq "arches rocky9"     "amd64 arm64" "$(wb_os_arches rocky9)"
assert_eq "arches opensuse15" "amd64"       "$(wb_os_arches opensuse15)"

assert_ok    "supports_arch ubuntu24/arm64"   wb_os_supports_arch ubuntu24 arm64
assert_ok    "supports_arch opensuse15/amd64" wb_os_supports_arch opensuse15 amd64
assert_fails "supports_arch rejects opensuse15/arm64" wb_os_supports_arch opensuse15 arm64
assert_fails "supports_arch rejects an unknown arch"  wb_os_supports_arch rocky9 ppc64le
assert_fails "supports_arch rejects an unknown OS"    wb_os_supports_arch plan9 amd64

# Empty means "let Docker resolve the multi-arch manifest"; non-empty is the
# emulation escape hatch, and it must fire ONLY for a pair with no package.
assert_eq "platform ubuntu24/arm64 is unset"     "" "$(wb_os_platform ubuntu24 arm64)"
assert_eq "platform rocky9/arm64 is unset"       "" "$(wb_os_platform rocky9 arm64)"
assert_eq "platform opensuse15/amd64 is unset"   "" "$(wb_os_platform opensuse15 amd64)"
assert_eq "platform opensuse15/arm64 forces amd64" "linux/amd64" "$(wb_os_platform opensuse15 arm64)"

assert_eq "key_arch ubuntu24/amd64"  "amd64"   "$(wb_os_key_arch ubuntu24 amd64)"
assert_eq "key_arch ubuntu24/arm64"  "arm64"   "$(wb_os_key_arch ubuntu24 arm64)"
assert_eq "key_arch rocky9/amd64"  "x86_64"  "$(wb_os_key_arch rocky9 amd64)"
# The feed key says arm64 where the filename says aarch64. Pinned here so
# "fixing" the key to match the filename fails loudly rather than 404ing.
assert_eq "key_arch rocky9/arm64 is arm64, not aarch64" "arm64" "$(wb_os_key_arch rocky9 arm64)"
assert_eq "key_arch opensuse15/amd64" "x86_64" "$(wb_os_key_arch opensuse15 amd64)"
assert_fails "key_arch has no opensuse15/arm64" wb_os_key_arch opensuse15 arm64
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
# The openSUSE rpm shares rocky9's extension but uses ubuntu24's stem, so a
# version parser that picks its strip by extension alone leaves "rstudio-
# workbench-" glued to the front. Both directions are asserted because the fix
# is order-dependent: strip the longer stem first, then the shorter.
assert_eq "pkg_version from an openSUSE .rpm (plain stem, rpm extension)" "2026.09.0-166.pro8" \
	"$(wb_pkg_version "https://dl.dailies.rstudio.com/server/opensuse15/x86_64/rstudio-workbench-2026.09.0-166.pro8-x86_64.rpm")"
assert_eq "pkg_version still strips the rhel stem, not just the plain one" "2026.08.0-187.pro5" \
	"$(wb_pkg_version "rstudio-workbench-rhel-2026.08.0-187.pro5-aarch64.rpm")"
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
assert_eq "stable opensuse15/amd64 is the published URL verbatim" \
	"https://download2.rstudio.org/server/opensuse15/x86_64/rstudio-workbench-2026.08.2-200.pro1-x86_64.rpm" \
	"$(wb_resolve_stable_url opensuse15 amd64)"
# The refusal matters more than the success: without it the arm64 rewrite below
# would fall through its case statement and hand back the x86_64 rpm unchanged,
# which looks exactly like a successful resolution.
assert_fails "stable refuses opensuse15/arm64 rather than returning the x86 URL" \
	wb_resolve_stable_url opensuse15 arm64
assert_eq "stable prints no URL for opensuse15/arm64" "" \
	"$(wb_resolve_stable_url opensuse15 arm64 2>/dev/null)"
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
assert_eq "daily opensuse15/amd64 uses the x86_64 platform key" \
	"https://dl.dailies.rstudio.com/server/opensuse15/x86_64/rstudio-workbench-2026.09.0-166.pro8-x86_64.rpm" \
	"$(wb_resolve_daily_url opensuse15 amd64)"
assert_fails "daily refuses opensuse15/arm64" wb_resolve_daily_url opensuse15 arm64
assert_fails "daily rejects an unsupported OS"   wb_resolve_daily_url plan9 amd64
assert_fails "daily rejects an unsupported arch" wb_resolve_daily_url rocky9 ppc64le

_wb_orig_dailies="$(declare -f _wb_fetch_dailies_json)"
_wb_fetch_dailies_json() { echo '{"products":{"workbench":{"platforms":{}}}}'; }
assert_fails "daily fails when the platform key is absent" wb_resolve_daily_url rocky9 arm64
eval "$_wb_orig_dailies"

# --- Round trip ---------------------------------------------------------------
# The property that actually protects the non-Ubuntu lanes: whatever a resolver
# hands back must parse back to the architecture that was asked for. A wrong
# rewrite rule (e.g. leaving -x86_64.rpm on an arm64 URL) fails here even if the
# string assertions above were updated to match the bug.
#
# Driven off wb_os_arches rather than a hardcoded arch list, so adding an OS
# extends the property automatically and an amd64-only OS is not asked for a
# URL that does not exist.

for _os in $WB_OS_CHOICES; do
	for _arch in $(wb_os_arches "$_os"); do
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
assert_ok "validate accepts a matching opensuse15/amd64 .rpm" \
	wb_validate_wb_url "https://dl.dailies.rstudio.com/server/opensuse15/x86_64/rstudio-workbench-2026.09.0-166.pro8-x86_64.rpm" opensuse15 amd64
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

# --- wb_container_platform ----------------------------------------------------
# With nothing requested this must be exactly wb_os_platform, or every existing
# stack would be recreated on its next run. A request (WB_CONTAINER_ARCH) is how
# Apple Silicon runs a linux-x64 CI build, so the arm64-host -> amd64 case is
# the one that matters.

assert_eq "container_platform with no request matches os_platform (ubuntu24/arm64)" \
	"$(wb_os_platform ubuntu24 arm64)" "$(wb_container_platform ubuntu24 arm64 "")"
assert_eq "container_platform with no request keeps the opensuse15 emulation" \
	"linux/amd64" "$(wb_container_platform opensuse15 arm64 "")"
assert_eq "container_platform: requesting the host's own arch forces nothing" \
	"" "$(wb_container_platform ubuntu24 amd64 amd64)"
assert_eq "container_platform: amd64 on an arm64 host forces linux/amd64" \
	"linux/amd64" "$(wb_container_platform ubuntu24 arm64 amd64)"
assert_eq "container_platform: x86_64 is accepted for amd64" \
	"linux/amd64" "$(wb_container_platform rocky9 arm64 x86_64)"
assert_eq "container_platform: x64 is accepted for amd64" \
	"linux/amd64" "$(wb_container_platform ubuntu24 arm64 x64)"
assert_eq "container_platform: aarch64 on an amd64 host forces linux/arm64" \
	"linux/arm64" "$(wb_container_platform ubuntu24 amd64 aarch64)"
# openSUSE has no arm64 package, so asking for one must fail up front rather
# than build a container that cannot install Workbench.
assert_fails "container_platform refuses arm64 for opensuse15" wb_container_platform opensuse15 amd64 arm64
assert_fails "container_platform refuses an unknown arch" wb_container_platform ubuntu24 amd64 ppc64le

# --- wb_parse_build_source ----------------------------------------------------

assert_eq "build source: a bare run ID means posit-dev/positron" \
	"$(printf 'run\tposit-dev/positron\t36598746699')" "$(wb_parse_build_source 36598746699)"
assert_eq "build source: a run URL" \
	"$(printf 'run\tposit-dev/positron\t36598746699')" \
	"$(wb_parse_build_source https://github.com/posit-dev/positron/actions/runs/36598746699)"
assert_eq "build source: a job URL still names the run" \
	"$(printf 'run\tposit-dev/positron\t36598746699')" \
	"$(wb_parse_build_source https://github.com/posit-dev/positron/actions/runs/36598746699/job/123456)"
assert_eq "build source: a run URL with a query string" \
	"$(printf 'run\tposit-dev/positron\t36598746699')" \
	"$(wb_parse_build_source 'https://github.com/posit-dev/positron/actions/runs/36598746699?pr=16300')"
# positron-builds' release runs build both architectures, which is what an
# Apple Silicon machine can use natively.
assert_eq "build source: a run URL in another repo keeps that repo" \
	"$(printf 'run\tposit-dev/positron-builds\t123')" \
	"$(wb_parse_build_source https://github.com/posit-dev/positron-builds/actions/runs/123)"
assert_eq "build source: anything else is a file" \
	"$(printf 'file\t~/Downloads/positron-workbench-linux-x64-branch.tar.gz')" \
	"$(wb_parse_build_source '~/Downloads/positron-workbench-linux-x64-branch.tar.gz')"
assert_eq "build source: a relative path is a file" \
	"$(printf 'file\tpwb/build.tar.gz')" "$(wb_parse_build_source pwb/build.tar.gz)"
# A pasted URL that is not a run must not be read as a (missing) file name.
assert_fails "build source refuses a non-run URL" wb_parse_build_source https://github.com/posit-dev/positron/pull/16300
assert_fails "build source refuses an empty value" wb_parse_build_source ""

# --- wb_select_build_artifact -------------------------------------------------
# Artifact names verbatim from real runs: positron's test-full-suite (which
# uploads the Workbench build next to e2e reports) and positron-builds' Linux
# release build (both arches, plus look-alikes that are not Workbench builds).

positron_run_json='{"artifacts":[
	{"name":"blob-report-workbench-1","size_in_bytes":1000,"expired":false},
	{"name":"positron-workbench-linux-x64","size_in_bytes":759659161,"expired":false}]}'
builds_run_json='{"artifacts":[
	{"name":"positron-binary-server-x64","size_in_bytes":1,"expired":false},
	{"name":"positron-binary-reh-arm64","size_in_bytes":2,"expired":false},
	{"name":"positron-binary-workbench-x64","size_in_bytes":3,"expired":false},
	{"name":"positron-binary-workbench-arm64","size_in_bytes":4,"expired":false}]}'
expired_run_json='{"artifacts":[
	{"name":"positron-workbench-linux-x64","size_in_bytes":759659161,"expired":true}]}'

assert_eq "artifact: positron CI's x64 build, with its size" \
	"$(printf 'positron-workbench-linux-x64\t759659161')" "$(wb_select_build_artifact x64 "$positron_run_json")"
# The Apple Silicon case: CI has no arm64 build, and that must be an error, not
# the x64 build handed to an arm64 container.
assert_fails "artifact: an arm64 container gets nothing from an x64-only run" \
	wb_select_build_artifact arm64 "$positron_run_json"
assert_eq "artifact: positron-builds' arm64 Workbench build, not the REH or server" \
	"$(printf 'positron-binary-workbench-arm64\t4')" "$(wb_select_build_artifact arm64 "$builds_run_json")"
assert_eq "artifact: positron-builds' x64 Workbench build, not the server" \
	"$(printf 'positron-binary-workbench-x64\t3')" "$(wb_select_build_artifact x64 "$builds_run_json")"
assert_fails "artifact: an expired build is not offered" wb_select_build_artifact x64 "$expired_run_json"
assert_fails "artifact: a run with no artifacts" wb_select_build_artifact x64 '{"artifacts":[]}'

# --- wb_build_tarball_arch ----------------------------------------------------

assert_eq "tarball arch from the top-level entry" "x64" \
	"$(wb_build_tarball_arch vscode-reh-web-pwb-linux-x64/ positron-workbench-linux-x64-branch.tar.gz)"
assert_eq "tarball arch falls back to the file name" "arm64" \
	"$(wb_build_tarball_arch ./ positron-workbench-linux-arm64-2026.10.0-150.tar.gz)"
assert_eq "tarball arch is empty when nothing says" "" "$(wb_build_tarball_arch build/ build.tar.gz)"

# --- wb_version_gt ------------------------------------------------------------

assert_ok    "version_gt: a newer minor"        wb_version_gt 1.6.0 1.5.0
assert_fails "version_gt: equal is not newer"   wb_version_gt 1.5.0 1.5.0
assert_fails "version_gt: an older patch"       wb_version_gt 1.5.0 1.5.1
# Numeric, not lexical: "10" sorts before "9" as a string.
assert_ok    "version_gt: compares numerically" wb_version_gt 1.10.0 1.9.9
assert_ok    "version_gt: a newer major wins"   wb_version_gt 2.0.0 1.99.99
assert_ok    "version_gt: a pre-release suffix is ignored" wb_version_gt 1.5.1-dev.3 1.5.0
assert_ok    "version_gt: a missing patch is 0" wb_version_gt 1.5 1.4.9
assert_fails "version_gt: junk is never newer"  wb_version_gt abc 1.0.0

# --- wb_host_path -------------------------------------------------------------
# Only where there is no cygpath (Linux, macOS); Git Bash rewrites the result.

if ! command -v cygpath >/dev/null 2>&1; then
	assert_eq "host_path: absolute stays" "/tmp/x.tar.gz" "$(wb_host_path /tmp/x.tar.gz)"
	assert_eq "host_path: relative resolves against INIT_CWD (where npm was run)" \
		"/work/sub/x.vsix" "$(INIT_CWD=/work/sub wb_host_path x.vsix)"
	assert_eq "host_path: ~/ expands to HOME" "/home/me/x.vsix" "$(HOME=/home/me wb_host_path '~/x.vsix')"
fi

[[ $fail -eq 0 ]] && echo "ALL PASS"
exit $fail
