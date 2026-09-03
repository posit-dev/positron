#!/usr/bin/env bash
# Pure-ish resolver functions for workbench-local.sh. Network access is isolated
# in the _wb_fetch_* seams (and wb_url_reachable) so tests can stub them with
# fixtures -- see scripts/test/workbench-local-lib-test.sh.
#
# OS vocabulary: there is exactly one, "ubuntu24" | "rocky9" | "opensuse15", and
# it is the same string the user types (--os=), the compose image is named after,
# and the installer branches on. Posit's download feeds spell the first two
# "noble" and "rhel9"; that is confined to wb_os_feed below and must not leak out
# of it, because a second vocabulary in the middle layers is exactly how the
# wrong package gets resolved for the right container. (opensuse15 happens to
# spell the same in both vocabularies -- do not read that as permission to skip
# wb_os_feed for it.)
#
# Everything else that differs between the OSes (package format, filename stem,
# the arch token in feed keys, the container image, which architectures exist at
# all) is a wb_os_* helper, so adding an OS means editing those helpers and
# nothing else.

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

WB_OS_CHOICES='ubuntu24 rocky9 opensuse15'

wb_os_valid() {
	case "${1:-}" in
		ubuntu24|rocky9|opensuse15) return 0 ;;
		*) echo "Unsupported OS: '${1:-}' (expected one of: ${WB_OS_CHOICES})" >&2; return 1 ;;
	esac
}

# The name Posit's download feeds use for this OS. It keys both
# downloads.json (.installer.<feed>.url) and the dailies index
# (platforms["<feed>-<arch>"]). The ONLY place the feed vocabulary is allowed.
wb_os_feed() {
	case "${1:-}" in
		ubuntu24)   printf noble ;;
		rocky9)     printf rhel9 ;;
		opensuse15) printf opensuse15 ;;
		*) return 1 ;;
	esac
}

# Container image the test stack runs for this OS. All three are multi-arch
# manifest lists, so Docker picks amd64/arm64 itself -- except where
# wb_os_platform overrides it because the OS has no arm64 Workbench package.
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
		ubuntu24)   printf 'ghcr.io/posit-dev/positron-ubuntu24:24.18.0' ;;
		rocky9)     printf 'ghcr.io/posit-dev/positron-rocky9:24.18.0' ;;
		# The same image test-e2e-suse.yml runs, so the Workbench lane and the
		# electron SUSE lane share one openSUSE definition.
		opensuse15) printf 'ghcr.io/posit-dev/positron-opensuse156:24.18.0' ;;
		*) return 1 ;;
	esac
}

# Package format: deb (Ubuntu) or rpm (RHEL family, SUSE).
wb_os_pkg_ext() {
	case "${1:-}" in
		ubuntu24)          printf deb ;;
		rocky9|opensuse15) printf rpm ;;
		*) return 1 ;;
	esac
}

# Package filename prefix, everything ahead of the version. The RHEL packages
# carry an extra "-rhel" segment and the openSUSE ones do not, so this is
# derivable from neither the extension nor the package format.
wb_os_pkg_stem() {
	case "${1:-}" in
		ubuntu24)   printf 'rstudio-workbench-' ;;
		rocky9)     printf 'rstudio-workbench-rhel-' ;;
		opensuse15) printf 'rstudio-workbench-' ;;
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
		ubuntu24:amd64)   printf amd64 ;;
		ubuntu24:arm64)   printf arm64 ;;
		rocky9:amd64)     printf x86_64 ;;
		rocky9:arm64)     printf arm64 ;;
		opensuse15:amd64) printf x86_64 ;;
		# No opensuse15:arm64 on purpose -- see wb_os_arches.
		*) return 1 ;;
	esac
}

# Init-script / package-manager family. Doubles as the name of the
# extras/init.d/<family> directory the Workbench package ships (verified against
# the real packages: debian, redhat and suse all exist), which is what the
# installer copies into /etc/init.d on the two OSes whose package installs
# systemd units instead. Branching the installer on the family rather than on the
# OS is what keeps a third OS from adding a third arm to every case statement.
wb_os_family() {
	case "${1:-}" in
		ubuntu24)   printf debian ;;
		rocky9)     printf redhat ;;
		opensuse15) printf suse ;;
		*) return 1 ;;
	esac
}

# Architectures Posit publishes a Workbench package for, per OS. Not cosmetic:
# openSUSE 15 is x86_64-only on both channels -- the dailies feed has an
# "opensuse15-x86_64" key and no arm64 one, and downloads.json publishes only the
# x86_64 rpm -- so unlike rhel9 there is no arm64 artifact for an arm64 URL to be
# rewritten to. Resolution has to refuse rather than hand an x86 package to an
# arm64 container, which is a failure that would otherwise surface as an opaque
# zypper error minutes into an install.
wb_os_arches() {
	case "${1:-}" in
		ubuntu24|rocky9) printf 'amd64 arm64' ;;
		opensuse15)      printf 'amd64' ;;
		*) return 1 ;;
	esac
}

# True if this OS has a Workbench package for this arch. Prints the reason when
# it does not, so callers can `|| return 1` and say nothing themselves.
wb_os_supports_arch() {
	local os="${1:-}" arch="${2:-}" a
	wb_os_valid "$os" || return 1
	for a in $(wb_os_arches "$os"); do
		[ "$a" = "$arch" ] && return 0
	done
	echo "No ${arch} Workbench package exists for ${os} (Posit publishes: $(wb_os_arches "$os"))." >&2
	return 1
}

# Docker platform to force the test container to, or empty to let Docker pick
# from the multi-arch manifest. Non-empty only when this machine's architecture
# has no Workbench package for the chosen OS: on Apple Silicon, --os=opensuse15
# runs an emulated amd64 container, because the alternative is no local loop at
# all. Emulated is slow but correct; the CI runners are amd64 and never hit this.
wb_os_platform() {
	local os="${1:-}" arch="${2:-}"
	wb_os_supports_arch "$os" "$arch" 2>/dev/null && return 0
	printf 'linux/amd64'
}

# --- Package URL parsing ------------------------------------------------------

# Extract the Workbench version (incl .proN) from a package URL/filename:
#   .../rstudio-workbench-2026.05.1-225.pro10-amd64.deb      -> 2026.05.1-225.pro10
#   .../rstudio-workbench-rhel-2026.08.0-187.pro5-x86_64.rpm -> 2026.08.0-187.pro5
#   .../rstudio-workbench-2026.09.0-166.pro8-x86_64.rpm      -> 2026.09.0-166.pro8
# Non-zero (and prints nothing) when the name isn't a Workbench package, so
# callers' `|| echo unavailable` fallback fires.
wb_pkg_version() {
	local url="${1:-}" base
	[ -n "$url" ] || return 1
	base="$(basename "$url")"
	case "$base" in
		*.deb) base="${base#"$(wb_os_pkg_stem ubuntu24)"}"; base="${base%-*.deb}" ;;
		# Two stems share the .rpm extension: rhel9 carries the "-rhel" segment
		# and opensuse15 does not. The rhel stem is a strict superset of the
		# plain one, so strip the longer first and let the shorter fall through
		# -- whichever matched, the other is then a no-op. Getting this wrong is
		# silent: it leaves the stem on the front of the "version" and only ever
		# shows up as a mangled label in the picker menu.
		*.rpm)
			base="${base#"$(wb_os_pkg_stem rocky9)"}"
			base="${base#"$(wb_os_pkg_stem opensuse15)"}"
			base="${base%-*.rpm}"
			;;
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
	# Before touching the network: an OS/arch pair Posit does not build has no
	# URL to resolve, and the arm64 rewrite below would otherwise pass the x86
	# URL through untouched and look like a success.
	wb_os_supports_arch "$os" "$wb_arch" || return 1
	feed="$(wb_os_feed "$os")"
	url="$(_wb_fetch_downloads_json | jq -r --arg os "$feed" '.rstudio.pro.stable.server.installer[$os].url // empty')"
	[ -n "$url" ] && [ "$url" != "null" ] || { echo "Failed to resolve stable URL for ${os} (feed key '${feed}')" >&2; return 1; }
	# The feed publishes only the x86 installer for every OS. Where an arm64 build
	# exists it is released at the same path with the arch tokens swapped (both
	# rewrites verified reachable against the live feed). opensuse15 never reaches
	# here: it has no arm64 build, and wb_os_supports_arch above rejected it.
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
	wb_os_supports_arch "$os" "$wb_arch" || return 1
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
