#!/usr/bin/env bash
# Pure-ish resolver functions for workbench-local.sh. Network access is isolated
# in the _wb_fetch_* seams (and wb_url_reachable) so tests can stub them with
# fixtures -- see scripts/test/workbench-local-lib-test.sh.
#
# OS vocabulary: there is exactly one, "ubuntu24" | "rocky9", and it is the same
# string the user types (--os=), the compose image is named after, and the
# installer branches on. Posit's download feeds spell the same two OSes "noble"
# and "rhel9"; that is confined to wb_os_feed below and must not leak out of it,
# because a second vocabulary in the middle layers is exactly how the wrong
# package gets resolved for the right container.
#
# Everything else that differs between the two OSes (package format, filename
# stem, the arch token in feed keys, the container image) is a wb_os_* helper, so
# adding an OS means editing those helpers and nothing else.

wb_detect_arch() {
	local m="${1:-$(uname -m)}"
	case "$m" in
		x86_64|amd64)  POSITRON_ARCH="x64";   WB_ARCH="amd64" ;;
		aarch64|arm64) POSITRON_ARCH="arm64"; WB_ARCH="arm64" ;;
		*) echo "Unsupported architecture: $m" >&2; return 1 ;;
	esac
	export POSITRON_ARCH WB_ARCH
}

# --- OS facts -----------------------------------------------------------------

WB_OS_CHOICES='ubuntu24 rocky9'

wb_os_valid() {
	case "${1:-}" in
		ubuntu24|rocky9) return 0 ;;
		*) echo "Unsupported OS: '${1:-}' (expected one of: ${WB_OS_CHOICES})" >&2; return 1 ;;
	esac
}

# The name Posit's download feeds use for this OS. It keys both
# downloads.json (.installer.<feed>.url) and the dailies index
# (platforms["<feed>-<arch>"]). The ONLY place the feed vocabulary is allowed.
wb_os_feed() {
	case "${1:-}" in
		ubuntu24) printf noble ;;
		rocky9)   printf rhel9 ;;
		*) return 1 ;;
	esac
}

# Container image the test stack runs for this OS. Both are multi-arch manifest
# lists, so Docker picks amd64/arm64 itself.
#
# Keep the ubuntu24 tag in step with the `image:` default in
# docker-compose.workbench.yml. They are two independent copies of the same
# constant (Compose cannot read this lib), and they drifted once already: #15243
# bumped Compose to 24.18.0 while this function was added pinned to 24.15.0, so
# `--os=ubuntu24` silently ran an older image than a bare `docker compose up` or
# CI -- which is exactly the kind of difference that makes a local repro of a CI
# failure disagree for no visible reason.
wb_os_image() {
	case "${1:-}" in
		ubuntu24) printf 'ghcr.io/posit-dev/positron-ubuntu24:24.18.0' ;;
		rocky9)   printf 'ghcr.io/posit-dev/positron-rocky9:24.18.0' ;;
		*) return 1 ;;
	esac
}

# Package format: deb (Ubuntu) or rpm (RHEL family).
wb_os_pkg_ext() {
	case "${1:-}" in
		ubuntu24) printf deb ;;
		rocky9)   printf rpm ;;
		*) return 1 ;;
	esac
}

# Package filename prefix, everything ahead of the version. The RHEL packages
# carry an extra "-rhel" segment, so this is not derivable from the extension.
wb_os_pkg_stem() {
	case "${1:-}" in
		ubuntu24) printf 'rstudio-workbench-' ;;
		rocky9)   printf 'rstudio-workbench-rhel-' ;;
		*) return 1 ;;
	esac
}

# Arch token as it appears in the *dailies feed key* for this OS, given our
# normalized arch (amd64|arm64). Careful: this is not the same vocabulary the
# package *filenames* use -- the rhel9 feed keys arm64 as "arm64" but names the
# file "-aarch64.rpm". Only the key spelling belongs here; the filename spelling
# is handled where filenames are (wb_pkg_arch, and the rewrite in
# wb_resolve_stable_url).
wb_os_key_arch() {
	case "${1:-}:${2:-}" in
		ubuntu24:amd64) printf amd64 ;;
		ubuntu24:arm64) printf arm64 ;;
		rocky9:amd64)   printf x86_64 ;;
		rocky9:arm64)   printf arm64 ;;
		*) return 1 ;;
	esac
}

# --- Package URL parsing ------------------------------------------------------

# Extract the Workbench version (incl .proN) from a package URL/filename:
#   .../rstudio-workbench-2026.05.1-225.pro10-amd64.deb      -> 2026.05.1-225.pro10
#   .../rstudio-workbench-rhel-2026.08.0-187.pro5-x86_64.rpm -> 2026.08.0-187.pro5
# Non-zero (and prints nothing) when the name isn't a Workbench package, so
# callers' `|| echo unavailable` fallback fires.
wb_pkg_version() {
	local url="${1:-}" base
	[ -n "$url" ] || return 1
	base="$(basename "$url")"
	case "$base" in
		# The rpm stem is a superset of the deb stem, so strip by extension
		# rather than trying both prefixes.
		*.deb) base="${base#"$(wb_os_pkg_stem ubuntu24)"}"; base="${base%-*.deb}" ;;
		*.rpm) base="${base#"$(wb_os_pkg_stem rocky9)"}";   base="${base%-*.rpm}" ;;
		*) return 1 ;;
	esac
	[ -n "$base" ] || return 1
	printf '%s' "$base"
}

# True if the string looks like a Workbench package download URL (.deb or .rpm).
wb_is_pkg_url() {
	local url="${1:-}"
	[[ "$url" =~ ^https?://.+\.(deb|rpm)$ ]]
}

# Normalized architecture (amd64|arm64) of a package URL/filename, or empty when
# the name carries no recognized arch token.
wb_pkg_arch() {
	case "$(basename "${1:-}")" in
		*-arm64.deb|*-arm64.rpm|*-aarch64.rpm) printf arm64 ;;
		*-amd64.deb|*-x86_64.rpm)              printf amd64 ;;
	esac
}

# --- Network seams ------------------------------------------------------------

_wb_fetch_downloads_json() { curl -sL "https://posit.co/wp-content/uploads/downloads.json"; }
_wb_fetch_dailies_json()   { curl -sL "https://dailies.rstudio.com/rstudio/latest/index.json"; }
# posit-dev/positron = definitive Positron release list (prerelease=false).
# posit-dev/positron-builds = all builds incl. dailies (the Workbench tarball for
# any tag is downloaded from here by positronDownload.sh).
_wb_fetch_releases_json()  { gh api "repos/posit-dev/positron/releases?per_page=30"; }
_wb_fetch_builds_json()    { gh api "repos/posit-dev/positron-builds/releases?per_page=30"; }

# True if the URL responds successfully to a HEAD request (follows redirects).
wb_url_reachable() { curl -fsIL --max-time 15 "$1" >/dev/null 2>&1; }

# --- Workbench URL resolution -------------------------------------------------

wb_resolve_stable_url() {
	local os="${1:-}" wb_arch="${2:-}" feed url dir base
	wb_os_valid "$os" || return 1
	feed="$(wb_os_feed "$os")"
	url="$(_wb_fetch_downloads_json | jq -r --arg os "$feed" '.rstudio.pro.stable.server.installer[$os].url // empty')"
	[ -n "$url" ] && [ "$url" != "null" ] || { echo "Failed to resolve stable URL for ${os} (feed key '${feed}')" >&2; return 1; }
	# The feed publishes only the x86 installer for both OSes. The arm64 build is
	# released at the same path with the arch tokens swapped (both rewrites
	# verified reachable against the live feed).
	if [ "$wb_arch" = "arm64" ]; then
		case "$os" in
			ubuntu24) url="${url//amd64/arm64}" ;;
			rocky9)
				# The rhel path segment and the filename token differ (arm64 vs
				# aarch64), so rewrite them separately. Split on the last slash
				# rather than substituting slashes inside ${...}, which needs
				# escaping that not every shell reads the same way. Both halves
				# are guarded, so a feed that starts publishing an arm64 rpm
				# directly passes through untouched.
				dir="${url%/*}"; base="${url##*/}"
				case "$dir"  in */x86_64)     dir="${dir%/x86_64}/arm64" ;; esac
				case "$base" in *-x86_64.rpm) base="${base%-x86_64.rpm}-aarch64.rpm" ;; esac
				url="${dir}/${base}"
				;;
		esac
	fi
	echo "$url"
}

wb_resolve_daily_url() {
	local os="${1:-}" wb_arch="${2:-}" key url
	wb_os_valid "$os" || return 1
	key="$(wb_os_key_arch "$os" "$wb_arch")" || { echo "Unsupported architecture: ${wb_arch}" >&2; return 1; }
	key="$(wb_os_feed "$os")-${key}"
	# Use the "workbench" product (Pro), not "server" (open-source RStudio Server).
	url="$(_wb_fetch_dailies_json | jq -r --arg k "$key" '.products.workbench.platforms[$k].link // empty')"
	[ -n "$url" ] || { echo "No daily Workbench build for ${key}" >&2; return 1; }
	echo "$url"
}

# Validate a Workbench package URL: format, that the format matches the target
# OS, architecture match, and reachability. Prints the reason on failure.
wb_validate_wb_url() {
	local url="${1:-}" os="${2:-}" wb_arch="${3:-}" ext a
	wb_os_valid "$os" || return 1
	ext="$(wb_os_pkg_ext "$os")"
	wb_is_pkg_url "$url" || { echo "Not a valid package URL (expected https://....${ext})." >&2; return 1; }
	case "$(basename "$url")" in
		*".${ext}") : ;;
		*) echo "That package is not a .${ext}, which is what ${os} installs." >&2; return 1 ;;
	esac
	a="$(wb_pkg_arch "$url")"
	if [ -n "$a" ] && [ "$a" != "$wb_arch" ]; then
		echo "That package is for ${a}, but this machine is ${wb_arch}. Choose a ${wb_arch} build." >&2; return 1
	fi
	wb_url_reachable "$url" || { echo "URL not reachable (HTTP check failed): $url" >&2; return 1; }
}

# --- Positron build listing ---------------------------------------------------

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
