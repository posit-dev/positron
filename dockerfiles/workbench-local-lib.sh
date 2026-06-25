#!/usr/bin/env bash
# Pure-ish resolver functions for workbench-local.sh. Network access is isolated
# in the _wb_fetch_* seams so tests can stub them with fixtures.

wb_detect_arch() {
	local m="${1:-$(uname -m)}"
	case "$m" in
		x86_64|amd64)  POSITRON_ARCH="x64";   WB_ARCH="amd64" ;;
		aarch64|arm64) POSITRON_ARCH="arm64"; WB_ARCH="arm64" ;;
		*) echo "Unsupported architecture: $m" >&2; return 1 ;;
	esac
	export POSITRON_ARCH WB_ARCH
}

# Extract the Workbench version (incl .proN) from a .deb URL/filename, e.g.
# .../rstudio-workbench-2026.05.1-225.pro10-amd64.deb -> 2026.05.1-225.pro10
wb_deb_version() {
	local url="${1:-}" base
	[ -n "$url" ] || return 0
	base="$(basename "$url")"
	base="${base#rstudio-workbench-}"
	base="${base%-*.deb}"
	printf '%s' "$base"
}

_wb_fetch_downloads_json() { curl -sL "https://posit.co/wp-content/uploads/downloads.json"; }
_wb_fetch_dailies_json()   { curl -sL "https://dailies.rstudio.com/rstudio/latest/index.json"; }
_wb_fetch_releases_json()  { gh api "repos/posit-dev/positron-builds/releases?per_page=30"; }

wb_resolve_stable_url() {
	local wb_arch="$1" url
	url="$(_wb_fetch_downloads_json | jq -r '.rstudio.pro.stable.server.installer.noble.url')"
	[ -n "$url" ] && [ "$url" != "null" ] || { echo "Failed to resolve stable URL" >&2; return 1; }
	if [ "$wb_arch" = "arm64" ]; then url="${url//amd64/arm64}"; fi
	echo "$url"
}

wb_resolve_daily_url() {
	local wb_arch="$1" url
	# Prefer noble for the arch; the index keys platforms as "<distro>-<arch>".
	url="$(_wb_fetch_dailies_json | jq -r --arg k "noble-${wb_arch}" '.products.server.platforms[$k].link // empty')"
	[ -n "$url" ] || { echo "No daily build for noble-${wb_arch}" >&2; return 1; }
	echo "$url"
}

wb_list_positron_releases() {
	local count="${1:-5}"
	# Include prereleases (every positron-builds release is prerelease=true).
	_wb_fetch_releases_json \
		| jq -r --argjson n "$count" '
			[ .[] | select(any(.assets[]?; .name | test("^positron-workbench-linux-(x64|arm64)-"))) ]
			| sort_by(.published_at) | reverse | .[:$n]
			| .[] | "\(.tag_name)\t\(.published_at[:10])"'
}
