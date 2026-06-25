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

# True if the string looks like a Workbench .deb download URL.
wb_is_deb_url() {
	local url="${1:-}"
	[[ "$url" =~ ^https?://.+\.deb$ ]]
}

# Architecture token from a .deb URL/filename (amd64|arm64), or empty if unknown.
wb_deb_arch() {
	case "$(basename "${1:-}")" in
		*-arm64.deb) printf arm64 ;;
		*-amd64.deb) printf amd64 ;;
	esac
}

_wb_fetch_downloads_json() { curl -sL "https://posit.co/wp-content/uploads/downloads.json"; }
_wb_fetch_dailies_json()   { curl -sL "https://dailies.rstudio.com/rstudio/latest/index.json"; }
# posit-dev/positron = definitive Positron release list (prerelease=false).
# posit-dev/positron-builds = all builds incl. dailies (the Workbench tarball for
# any tag is downloaded from here by positronDownload.sh).
_wb_fetch_releases_json()  { gh api "repos/posit-dev/positron/releases?per_page=30"; }
_wb_fetch_builds_json()    { gh api "repos/posit-dev/positron-builds/releases?per_page=30"; }

wb_resolve_stable_url() {
	local wb_arch="$1" url
	url="$(_wb_fetch_downloads_json | jq -r '.rstudio.pro.stable.server.installer.noble.url')"
	[ -n "$url" ] && [ "$url" != "null" ] || { echo "Failed to resolve stable URL" >&2; return 1; }
	if [ "$wb_arch" = "arm64" ]; then url="${url//amd64/arm64}"; fi
	echo "$url"
}

wb_resolve_daily_url() {
	local wb_arch="$1" url
	# Use the "workbench" product (Pro), not "server" (open-source RStudio Server).
	# noble-<arch> key matches install-workbench.sh's fetch_latest_wb_url (CI).
	url="$(_wb_fetch_dailies_json | jq -r --arg k "noble-${wb_arch}" '.products.workbench.platforms[$k].link // empty')"
	[ -n "$url" ] || { echo "No daily Workbench build for noble-${wb_arch}" >&2; return 1; }
	echo "$url"
}

wb_list_positron_releases() {
	local count="${1:-5}"
	# Releases only: posit-dev/positron marks actual releases prerelease=false and
	# daily/dev builds prerelease=true, so exclude prereleases.
	_wb_fetch_releases_json \
		| jq -r --argjson n "$count" '
			[ .[] | select(.prerelease == false) ]
			| sort_by(.published_at) | reverse | .[:$n]
			| .[] | "\(.tag_name)\t\(.published_at[:10])"'
}

wb_list_positron_dailies() {
	local count="${1:-5}" reltags
	# Dailies = positron-builds tags that are NOT posit-dev/positron releases.
	reltags="$(_wb_fetch_releases_json | jq '[ .[] | select(.prerelease == false) | .tag_name ]')"
	_wb_fetch_builds_json \
		| jq -r --argjson rel "$reltags" --argjson n "$count" '
			[ .[] | select(.tag_name as $t | ($rel | index($t)) == null) ]
			| sort_by(.published_at) | reverse | .[:$n]
			| .[] | "\(.tag_name)\t\(.published_at[:10])"'
}
