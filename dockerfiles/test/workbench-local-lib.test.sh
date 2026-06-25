#!/usr/bin/env bash
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "${HERE}/../workbench-local-lib.sh"

fail=0
check() { # desc expected actual
	if [ "$2" = "$3" ]; then echo "ok   - $1"; else echo "FAIL - $1: expected [$2] got [$3]"; fail=1; fi
}

# Override fetch seams to read fixtures (no network)
# shellcheck disable=SC2329
_wb_fetch_downloads_json() { cat "${HERE}/fixtures/downloads.json"; }
# shellcheck disable=SC2329
_wb_fetch_dailies_json()   { cat "${HERE}/fixtures/dailies.json"; }
# shellcheck disable=SC2329
_wb_fetch_releases_json()  { cat "${HERE}/fixtures/releases.json"; }
# shellcheck disable=SC2329
_wb_fetch_builds_json()    { cat "${HERE}/fixtures/builds.json"; }

# arch detection
wb_detect_arch "x86_64"; check "x86_64 -> POSITRON_ARCH" "x64" "$POSITRON_ARCH"; check "x86_64 -> WB_ARCH" "amd64" "$WB_ARCH"
wb_detect_arch "arm64";  check "arm64 -> POSITRON_ARCH" "arm64" "$POSITRON_ARCH"; check "arm64 -> WB_ARCH" "arm64" "$WB_ARCH"
wb_detect_arch "aarch64"; check "aarch64 -> POSITRON_ARCH" "arm64" "$POSITRON_ARCH"; check "aarch64 -> WB_ARCH" "arm64" "$WB_ARCH"

# stable url: amd64 passthrough, arm64 rewrite
check "stable amd64" \
	"https://download2.rstudio.org/server/noble/amd64/rstudio-workbench-2026.05.1-225.pro10-amd64.deb" \
	"$(wb_resolve_stable_url amd64)"
check "stable arm64 rewrite" \
	"https://download2.rstudio.org/server/noble/arm64/rstudio-workbench-2026.05.1-225.pro10-arm64.deb" \
	"$(wb_resolve_stable_url arm64)"

# daily url for arm64 must resolve the WORKBENCH product (pro), not server (OSS)
check "daily arm64 is workbench (pro), not server" \
	"https://s3.amazonaws.com/rstudio-ide-build/server/jammy/arm64/rstudio-workbench-2026.06.0-242.pro13-arm64.deb" \
	"$(wb_resolve_daily_url arm64)"

# release list: releases only (prerelease=false), newest first, capped.
# The 2026.07.0-230 daily is the newest entry but prerelease=true -> must be excluded.
check "releases newest is a release, not the daily" "2026.06.1-6" "$(wb_list_positron_releases 5 | head -1 | cut -f1)"
check "releases exclude daily/prerelease" "" "$(wb_list_positron_releases 5 | grep '2026.07.0-230' || true)"
check "releases count capped" "2" "$(wb_list_positron_releases 2 | wc -l | tr -d ' ')"

# daily list = positron-builds tags minus release tags, newest first
check "dailies newest tag" "2026.07.0-230" "$(wb_list_positron_dailies 5 | head -1 | cut -f1)"
check "dailies exclude release tags" "" "$(wb_list_positron_dailies 5 | grep '2026.06.1-6' || true)"

# deb version extraction (incl .proN), and empty-in/empty-out
check "deb version with pro" "2026.05.1-225.pro10" \
	"$(wb_deb_version "https://download2.rstudio.org/server/noble/arm64/rstudio-workbench-2026.05.1-225.pro10-arm64.deb")"
check "deb version empty url" "" "$(wb_deb_version "")"

# deb URL format validation
wb_is_deb_url "https://example.com/x.deb"     && check "deb url valid https"  "0" "0" || check "deb url valid https"  "0" "1"
wb_is_deb_url "http://example.com/x.deb"      && check "deb url valid http"   "0" "0" || check "deb url valid http"   "0" "1"
wb_is_deb_url "https://example.com/x.tar.gz"  && check "deb url not .deb"     "1" "0" || check "deb url not .deb"     "1" "1"
wb_is_deb_url "ftp://example.com/x.deb"       && check "deb url bad scheme"   "1" "0" || check "deb url bad scheme"   "1" "1"
wb_is_deb_url ""                              && check "deb url empty"        "1" "0" || check "deb url empty"        "1" "1"

# deb arch extraction
check "deb arch arm64" "arm64" "$(wb_deb_arch "https://x/rstudio-workbench-2026.07.0-daily-48.pro2-arm64.deb")"
check "deb arch amd64" "amd64" "$(wb_deb_arch "https://x/rstudio-workbench-2026.07.0-daily-48.pro2-amd64.deb")"
check "deb arch unknown" "" "$(wb_deb_arch "https://x/something.deb")"

# build-free URL construction
check "build-free url arm64" \
	"https://download2.rstudio.org/server/jammy/arm64/rstudio-workbench-2026.05.1-arm64.deb" \
	"$(wb_build_free_url "2026.05.1" "arm64")"
check "build-free url amd64" \
	"https://download2.rstudio.org/server/jammy/amd64/rstudio-workbench-2026.05.1-amd64.deb" \
	"$(wb_build_free_url "2026.05.1" "amd64")"
check "build-free rejects no-patch" "" "$(wb_build_free_url "2026.05" "arm64")"
check "build-free rejects junk"     "" "$(wb_build_free_url "latest" "arm64")"

exit $fail
