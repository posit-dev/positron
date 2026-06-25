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

# arch detection
wb_detect_arch "x86_64"; check "x86_64 -> POSITRON_ARCH" "x64" "$POSITRON_ARCH"; check "x86_64 -> WB_ARCH" "amd64" "$WB_ARCH"
wb_detect_arch "arm64";  check "arm64 -> POSITRON_ARCH" "arm64" "$POSITRON_ARCH"; check "arm64 -> WB_ARCH" "arm64" "$WB_ARCH"

# stable url: amd64 passthrough, arm64 rewrite
check "stable amd64" \
	"https://download2.rstudio.org/server/noble/amd64/rstudio-workbench-2026.05.1-225.pro10-amd64.deb" \
	"$(wb_resolve_stable_url amd64)"
check "stable arm64 rewrite" \
	"https://download2.rstudio.org/server/noble/arm64/rstudio-workbench-2026.05.1-225.pro10-arm64.deb" \
	"$(wb_resolve_stable_url arm64)"

# daily url for arm64
check "daily arm64" \
	"https://s3.amazonaws.com/rstudio-ide-build/server/noble/arm64/rstudio-workbench-2026.06.0-242.pro7-arm64.deb" \
	"$(wb_resolve_daily_url arm64)"

# release list includes prereleases, newest first, capped
check "releases newest tag" "2026.06.1-6" "$(wb_list_positron_releases 5 | head -1 | cut -f1)"
check "releases count capped" "2" "$(wb_list_positron_releases 2 | wc -l | tr -d ' ')"

exit $fail
