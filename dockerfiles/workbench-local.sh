#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.workbench.yml"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/workbench-local-lib.sh"

WB_URL_BASE="https://raw.githubusercontent.com/posit-dev/qa-example-content/main/dockerfiles/wb-local"
WB_SCRIPTS=(install-workbench.sh positronDownload.sh get-latest-wb-noble-url.sh configure-datasources.sh)

wb_compose() { docker compose -f "${COMPOSE_FILE}" "$@"; }

# Scope to this compose project's services, not a stray container of the same name.
wb_stack_up() { wb_compose ps --services --filter status=running 2>/dev/null | grep -q '^pwb$'; }

# Fail fast with a friendly message when a command needs a running stack.
wb_require_stack() { wb_stack_up || { echo "Stack not running. Start with: npm run wb" >&2; exit 1; }; }

# Heuristic: true when the Docker config mentions ghcr.io at all (an `auths`
# entry from a prior `docker login`, or a `credHelpers` entry). It is broad on
# purpose -- a false positive only makes us SKIP the auto-login (at worst an
# image pull later fails with a plain Docker error), whereas being too strict
# risks the opposite: re-running docker login and clobbering a dedicated
# read:packages PAT with the gh token. We deliberately err toward not touching
# an existing credential.
wb_ghcr_logged_in() {
	local cfg="${DOCKER_CONFIG:-$HOME/.docker}/config.json"
	[ -f "$cfg" ] && grep -q '"ghcr.io"' "$cfg" 2>/dev/null
}

# Derive auth from the gh CLI so the only one-time step is `gh auth login`.
# Borrows gh's token for GITHUB_TOKEN (used for positron-builds + the installer)
# and, only if you are NOT already logged into ghcr.io, logs Docker in with it.
# An explicit GITHUB_TOKEN (env or .env) and an existing ghcr.io login both win.
wb_ensure_auth() {
	if [ -z "${GITHUB_TOKEN:-}" ] && command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
		GITHUB_TOKEN="$(gh auth token 2>/dev/null || true)"
		export GITHUB_TOKEN
	fi
	if [ -z "${GITHUB_TOKEN:-}" ]; then
		echo "Not authenticated. Run 'gh auth login' once, then re-run 'npm run wb'." >&2
		echo "(Or export GITHUB_TOKEN with a PAT that has the repo + read:packages scopes.)" >&2
		exit 1
	fi
	# Already logged into ghcr.io? Leave that credential alone -- it may be a PAT
	# with read:packages, and clobbering it with the gh token (which often lacks
	# that scope) would break image pulls.
	wb_ghcr_logged_in && return 0
	# Fresh setup: the gh default login omits read:packages, which the ghcr.io
	# pulls need. Flag the gap with the exact fix instead of failing cryptically.
	# (Capture gh auth status once -- it can be slow.)
	local gh_status=""
	command -v gh >/dev/null 2>&1 && gh_status="$(gh auth status 2>&1 || true)"
	if printf '%s' "$gh_status" | grep -q 'Token scopes' \
		&& ! printf '%s' "$gh_status" | grep -q 'read:packages'; then
		echo "NOTE: your gh token lacks the 'read:packages' scope (needed to pull images)." >&2
		echo "      Add it once with: gh auth refresh -h github.com -s read:packages" >&2
		echo "      (or run 'docker login ghcr.io' with a PAT that has read:packages)." >&2
	fi
	# ghcr.io wants the GitHub username; fall back to a placeholder if gh can't
	# resolve it (the token still authenticates).
	local ghuser; ghuser="$(gh api user -q .login 2>/dev/null || echo token)"
	printf '%s\n' "$GITHUB_TOKEN" | docker login ghcr.io -u "$ghuser" --password-stdin >/dev/null 2>&1 \
		|| echo "WARNING: 'docker login ghcr.io' failed; image pulls may fail (check read:packages scope)." >&2
}

wb_installed() {
	# install-workbench.sh may install Positron either into the "new" upgrade
	# slot or directly at the positron-server root; accept either.
	docker exec pwb bash -c 'test -f /usr/lib/rstudio-server/bin/positron-server/new/product.json || test -f /usr/lib/rstudio-server/bin/positron-server/product.json' 2>/dev/null
}

wb_bootstrap_env() {
	local env_file="${SCRIPT_DIR}/.env"
	[ -f "$env_file" ] || cp "${SCRIPT_DIR}/.env.example" "$env_file"
	set -a
	# shellcheck source=/dev/null
	source "$env_file"
	set +a
	if [ -z "${WB_PASSWORD:-}" ]; then
		# Read from the tty (not stdin) and tolerate a closed/non-interactive
		# stdin so set -euo pipefail does not abort silently when unset.
		read -r -p "Workbench password for user1: " WB_PASSWORD </dev/tty || true; export WB_PASSWORD
	fi
	: "${E2E_POSTGRES_USER:=testuser}"; : "${E2E_POSTGRES_PASSWORD:=testpassword}"
	export E2E_POSTGRES_USER E2E_POSTGRES_PASSWORD
}

wb_fetch_scripts() {
	local src="${QA_CONTENT_DIR:-}"
	if [ -z "$src" ] && [ -d "${REPO_ROOT}/../qa-example-content/dockerfiles/wb-local" ]; then
		src="$(cd "${REPO_ROOT}/../qa-example-content" && pwd)"
	fi
	# Run in a subshell with one scratch dir cleaned up on EXIT (even if a
	# curl/docker cp fails under set -e). A subshell EXIT trap stays contained;
	# a function RETURN trap would leak and re-fire on later function returns.
	(
		tmpdir="$(mktemp -d)"
		trap 'rm -rf "$tmpdir"' EXIT
		for s in "${WB_SCRIPTS[@]}"; do
			if [ -n "$src" ] && [ -f "${src}/dockerfiles/wb-local/${s}" ]; then
				docker cp "${src}/dockerfiles/wb-local/${s}" "pwb:/tmp/${s}" >/dev/null
			else
				curl -fsSL "${WB_URL_BASE}/${s}" -o "${tmpdir}/${s}"
				docker cp "${tmpdir}/${s}" "pwb:/tmp/${s}" >/dev/null
			fi
			docker exec pwb sed -i 's/\r$//' "/tmp/${s}"
			docker exec pwb chmod +x "/tmp/${s}"
		done
		[ -f "${SCRIPT_DIR}/workbench.lic" ] && docker cp "${SCRIPT_DIR}/workbench.lic" pwb:/tmp/workbench.lic >/dev/null || true
	)
}

# Channel (Release/Daily) -> version list. Sets POSITRON_TAG (downloaded from
# positron-builds by tag, which holds both release and daily tarballs).
wb_pick_positron() {
	local tags=() opts=() lines tag date
	wb_menu "Positron build" "Release build" "Daily build" || return 1
	if [ "$WB_MENU_INDEX" -eq 1 ]; then
		lines="$(wb_list_positron_releases 5)"
	else
		lines="$(wb_list_positron_dailies 5)"
	fi
	while IFS=$'\t' read -r tag date; do
		[ -n "$tag" ] || continue
		tags+=("$tag"); opts+=("$tag   ($date)")
	done <<< "$lines"
	[ "${#opts[@]}" -gt 0 ] || { echo "No Positron builds found." >&2; return 1; }
	wb_menu "Select version" "${opts[@]}" || return 1
	POSITRON_TAG="${tags[$((WB_MENU_INDEX-1))]}"
	export POSITRON_TAG
}

# Sets WB_URL.
# Present a menu and set WB_MENU_INDEX (1-based). Uses fzf for arrow-key
# selection when available and interactive; otherwise falls back to a numbered
# prompt (which also keeps --ci/non-tty usage working).
wb_menu() {
	local prompt="$1"; shift
	local opts=("$@") n=$# i=1 sel choice o
	WB_MENU_INDEX=0
	echo >&2  # blank line to separate the menu from preceding output
	if command -v fzf >/dev/null 2>&1 && [ -t 0 ] && [ -t 1 ]; then
		sel="$(printf '%s\n' "${opts[@]}" | fzf --height=40% --layout=reverse --no-multi --prompt="${prompt}: ")" || return 1
		for o in "${opts[@]}"; do [ "$o" = "$sel" ] && { WB_MENU_INDEX=$i; break; }; i=$((i+1)); done
	else
		echo "${prompt}:" >&2
		for o in "${opts[@]}"; do printf '  %d) %s\n' "$i" "$o" >&2; i=$((i+1)); done
		read -r -p "Choice [1]: " choice </dev/tty 2>/dev/tty || true
		WB_MENU_INDEX="${choice:-1}"
	fi
	[[ "$WB_MENU_INDEX" =~ ^[0-9]+$ ]] && [ "$WB_MENU_INDEX" -ge 1 ] && [ "$WB_MENU_INDEX" -le "$n" ] || { echo "Invalid choice" >&2; return 1; }
}

# True if the URL responds successfully to a HEAD request (follows redirects).
wb_url_reachable() { curl -fsIL --max-time 15 "$1" >/dev/null 2>&1; }

# Validate a Workbench .deb URL: format, architecture match, and reachability.
# Prints the reason on failure.
wb_validate_wb_url() {
	local url="${1:-}" a
	wb_is_deb_url "$url" || { echo "Not a valid .deb URL (expected https://....deb)." >&2; return 1; }
	a="$(wb_deb_arch "$url")"
	if [ -n "$a" ] && [ "$a" != "${WB_ARCH}" ]; then
		echo "That .deb is for ${a}, but this machine is ${WB_ARCH}. Choose a ${WB_ARCH} build." >&2; return 1
	fi
	wb_url_reachable "$url" || { echo "URL not reachable (HTTP check failed): $url" >&2; return 1; }
}

# Workbench has no listable version history (Posit publishes only the current
# stable and current daily -- same as Positron's workbench-nightly CI), so each
# channel resolves to a single current build; Custom URL pins a specific .deb.
wb_pick_workbench() {
	echo "Resolving Workbench versions..." >&2
	local stable_url daily_url
	stable_url="$(wb_resolve_stable_url "${WB_ARCH}" 2>/dev/null || true)"
	daily_url="$(wb_resolve_daily_url "${WB_ARCH}" 2>/dev/null || true)"
	# No second menu (WB has one current build per channel), so show the resolved
	# version right in the labels.
	wb_menu "Workbench build" \
		"Release build ($(wb_deb_version "$stable_url" || echo unavailable))" \
		"Daily build ($(wb_deb_version "$daily_url" || echo unavailable))" \
		"Custom .deb URL" || return 1
	case "$WB_MENU_INDEX" in
		1) WB_URL="$stable_url"; [ -n "$WB_URL" ] || { echo "Release URL could not be resolved (check network)." >&2; return 1; }; wb_validate_wb_url "$WB_URL" || return 1 ;;
		2) WB_URL="$daily_url";  [ -n "$WB_URL" ] || { echo "Daily URL could not be resolved (check network)." >&2; return 1; }; wb_validate_wb_url "$WB_URL" || return 1 ;;
		3)
			echo "Pin a specific ${WB_ARCH} Workbench .deb (e.g. an n-1/n-2 release):" >&2
			echo "  Dailies: https://dailies.rstudio.com/rstudio/  (pick a branch -> workbench -> noble-${WB_ARCH})" >&2
			echo "  Stable:  https://docs.posit.co/ide/server-pro/admin/getting_started/installation/installation.html" >&2
			while :; do
				read -r -p "Workbench .deb URL (blank to cancel): " WB_URL </dev/tty || true
				[ -n "${WB_URL:-}" ] || { echo "Cancelled (no URL entered)." >&2; return 1; }
				wb_validate_wb_url "$WB_URL" && break
				echo "Try again." >&2
			done ;;
	esac
	[ -n "${WB_URL:-}" ] || { echo "No Workbench URL resolved." >&2; return 1; }
	export WB_URL
}

cmd_install() {
	# GITHUB_TOKEN is guaranteed set by wb_ensure_auth (called in cmd_up before us).
	local creds=""
	for a in "$@"; do case "$a" in --credentials=*) creds="$a" ;; esac; done
	wb_pick_workbench
	wb_pick_positron
	echo "Installing Workbench from: ${WB_URL}"
	echo "Positron: ${POSITRON_TAG:-LATEST}"
	# The .proN build lives only in the .deb filename, not the runtime version
	# the installer prints. Stream the installer output through awk to slot our
	# exact build line right after its "Workbench version:" line. Pass creds as a
	# real arg (not interpolated into bash -c) so it can't be word-split/injected.
	# DOCKER_CLI_HINTS=false drops Docker's "What's next / Try Docker Debug" hint;
	# -i (no -t) because piping the output precludes a usable container TTY.
	local wb_build; wb_build="$(basename "$WB_URL")"
	DOCKER_CLI_HINTS=false docker exec -i \
		-e GITHUB_TOKEN="${GITHUB_TOKEN}" \
		-e WB_URL="${WB_URL}" \
		-e POSITRON_TAG="${POSITRON_TAG}" \
		-e ARCH_SUFFIX="${WB_ARCH}" \
		-e WB_PASSWORD="${WB_PASSWORD:-}" \
		pwb /bin/bash /tmp/install-workbench.sh ${creds:+"$creds"} 2>&1 \
		| awk -v build="$wb_build" '
			{ print }
			/[Ww]orkbench version:/ { print "Workbench build:     " build }
		'
	# Record the exact Workbench package URL so status/report can show the build.
	docker exec -e WB_URL="${WB_URL}" pwb bash -c 'printf "%s\n" "$WB_URL" > /var/lib/wb-local-source' || true
}

cmd_up() {
	wb_detect_arch
	export ARCH_SUFFIX="${WB_ARCH}"
	wb_bootstrap_env
	# Sources .env first (may set GITHUB_TOKEN), then fills auth gaps from gh and
	# logs into ghcr.io -- must run before the image pull below.
	wb_ensure_auth
	# The amd64 and arm64 images have independent tag sequences, so a single
	# default tag cannot serve both arches. Pick the arch-correct default unless
	# the user pinned one in .env (sourced above by wb_bootstrap_env).
	if [ "${WB_ARCH}" = "arm64" ]; then
		export WB_IMAGE_TAG="${WB_IMAGE_TAG:-127}"
		export PG_IMAGE_TAG="${PG_IMAGE_TAG:-143}"
	else
		export WB_IMAGE_TAG="${WB_IMAGE_TAG:-141}"
		export PG_IMAGE_TAG="${PG_IMAGE_TAG:-142}"
	fi
	# Connect requires a valid base64 Bootstrap.SecretKey; the compose default
	# ("testkey") is not valid base64 and makes the connect container exit. Mint
	# one per run unless the user pinned it in .env (mirrors wb-local/run.sh).
	if [ -z "${CONNECT_BOOTSTRAP_SECRETKEY:-}" ]; then
		CONNECT_BOOTSTRAP_SECRETKEY="$(openssl rand -base64 32)"
		export CONNECT_BOOTSTRAP_SECRETKEY
	fi
	mkdir -p "${SCRIPT_DIR}/connect"
	if [ -f "${SCRIPT_DIR}/connect.lic" ]; then
		cp "${SCRIPT_DIR}/connect.lic" "${SCRIPT_DIR}/connect/connect.lic"
	fi
	# 'pwb' depends on connect being healthy; a missing license or config makes
	# connect exit and the wait loop below just times out. Warn clearly up front.
	# (rstudio-connect.gcfg is committed, but a missing bind-mount source becomes
	# an empty dir and breaks connect, so check it too.)
	if [ ! -f "${SCRIPT_DIR}/connect/connect.lic" ]; then
		echo "WARNING: no Connect license at ${SCRIPT_DIR}/connect.lic -- the connect container" >&2
		echo "         will not become healthy and 'pwb' won't start (startup will time out)." >&2
		echo "         Add connect.lic (see dockerfiles/README-workbench-local.md)." >&2
	fi
	if [ ! -f "${SCRIPT_DIR}/connect/rstudio-connect.gcfg" ]; then
		echo "WARNING: ${SCRIPT_DIR}/connect/rstudio-connect.gcfg is missing -- connect will fail to start." >&2
		echo "         It is committed to the repo; restore with: git checkout dockerfiles/connect/rstudio-connect.gcfg" >&2
	fi
	# --remove-orphans clears containers from a prior service name (e.g. the
	# pre-rename 'test' container) that would otherwise hold the same ports.
	wb_compose up -d --remove-orphans
	echo "Waiting for containers to become healthy..."
	local tries=0
	until wb_stack_up; do
		tries=$((tries+1))
		if [ "$tries" -ge 120 ]; then
			echo "Timed out waiting for the 'pwb' container to start." >&2
			echo "Check service health: docker compose -f ${COMPOSE_FILE} ps" >&2
			wb_compose ps >&2 || true
			exit 1
		fi
		sleep 1
	done
	wb_fetch_scripts
	if wb_installed && [ "${1:-}" != "--reinstall" ]; then
		echo "Stack already up with Positron + Workbench installed. (Use --reinstall to change versions.)"
		cmd_status
		return 0
	fi
	cmd_install "$@"
}

cmd_stop() { wb_compose stop; echo "Paused (volumes preserved). Resume with: npm run wb"; }
cmd_down() { wb_compose down --remove-orphans; echo "Stack torn down. Next 'npm run wb' will reinstall."; }

cmd_restart() { wb_require_stack; docker exec pwb bash -c 'sudo rstudio-server restart'; echo "rstudio-server restarted."; }

wb_versions() {
	local wb pos
	wb="$(docker exec pwb bash -c 'rstudio-server version 2>/dev/null | head -1 | awk "{print \$1}"' 2>/dev/null || true)"
	pos="$(docker exec pwb bash -c '
		for d in /usr/lib/rstudio-server/bin/positron-server/new /usr/lib/rstudio-server/bin/positron-server; do
			if [ -f "$d/product.json" ]; then
				v=$(grep positronVersion "$d/product.json" | sed "s/.*: *\"\([^\"]*\)\".*/\1/")
				b=$(grep positronBuildNumber "$d/product.json" | sed "s/.*: *\"\([^\"]*\)\".*/\1/")
				[ -n "$v" ] && [ -n "$b" ] && { echo "${v}-${b}"; break; }
			fi
		done' 2>/dev/null || true)"
	printf '%s\t%s\n' "${wb:-not installed}" "${pos:-not installed}"
}

# The .proN build suffix lives only in the installed .deb filename, not in the
# runtime version, so report the exact Workbench package we installed (recorded
# at install time). Empty if unknown (e.g. installed outside this tool).
wb_source_build() {
	docker exec pwb bash -c 'if [ -f /var/lib/wb-local-source ]; then basename "$(cat /var/lib/wb-local-source)"; fi' 2>/dev/null || true
}

cmd_status() {
	echo "=== Workbench Local Status ==="
	if ! wb_stack_up; then echo "Containers: not running. Start with: npm run wb"; return 0; fi
	docker ps --format '  {{.Names}}: {{.Status}}' | grep -E 'pwb|postgres|connect' || true
	local v; v="$(wb_versions)"
	echo "  Workbench: $(echo "$v" | cut -f1)"
	local src; src="$(wb_source_build)"; [ -n "$src" ] && echo "  WB build:  $src"
	echo "  Positron:  $(echo "$v" | cut -f2)"
	echo "  Access:    http://localhost:8787 (user1 / WB_PASSWORD)   Connect: http://localhost:3939"
	# This image's init script has no 'status' verb, so check for the running
	# rserver process directly.
	docker exec pwb bash -c 'pgrep -x rserver >/dev/null 2>&1' || echo "  NOTE: rstudio-server not running -- try: npm run wb restart"
}

cmd_report() {
	local v; v="$(wb_versions)"; wb_detect_arch
	cat <<EOF
Environment:
- Positron: $(echo "$v" | cut -f2)  (under Workbench)
- Workbench: $(echo "$v" | cut -f1)
- WB build: $(wb_source_build || true)
- Arch: POSITRON_ARCH=${POSITRON_ARCH}, WB_ARCH=${WB_ARCH}
- Containers: $(docker ps --format '{{.Names}}={{.Status}}' | grep -E 'pwb|postgres|connect' | paste -sd', ' - || echo 'none')
EOF
}

cmd_logs() {
	wb_require_stack
	case "${1:-rserver}" in
		rserver|workbench) docker exec pwb bash -c 'tail -n 100 -f /var/log/rstudio/rstudio-server/rserver.log' ;;
		connect)           docker logs -f connect ;;
		*)                 docker logs -f "${1}" ;;
	esac
}

cmd_help() {
	cat >&2 <<'EOF'
workbench-local.sh -- run Positron + Posit Workbench together, locally, for QA.

USAGE
  npm run wb                 Bring the stack up. First run: pick versions + install.
                             Already installed: (re)start the stack and show status.
  npm run wb -- --reinstall  Re-run the version pickers and reinstall (switch versions).
  npm run wb -- status       Containers, installed Positron + Workbench versions, URLs.
  npm run wb -- report       Paste-able environment block for bug reports.
  npm run wb -- logs [svc]   Tail logs: rserver (default), connect, or a container name.
  npm run wb -- restart      Restart rstudio-server inside the container.
  npm run wb -- stop         Pause the stack (containers stopped, volumes kept).
  npm run wb -- down         Tear the stack down (removes containers).

VERSION PICKERS
  Positron:  Release / Daily channel, then choose a version.
  Workbench: Release / Daily (current build each), or Custom .deb URL to pin a
             specific n-1/n-2 build.

ACCESS
  Workbench  http://localhost:8787   (user1 / WB_PASSWORD from dockerfiles/.env)
  Connect    http://localhost:3939

SETUP  (details: dockerfiles/README-workbench-local.md)
  gh auth login (once, include read:packages)   workbench.lic + connect.lic in dockerfiles/
  GITHUB_TOKEN and docker login ghcr.io are derived from gh automatically.
  optional: fzf (arrow-key pickers; falls back to a numbered prompt)
EOF
}

main() {
	local sub="${1:-up}"; shift || true
	case "$sub" in
		up)          cmd_up "$@" ;;
		--reinstall) cmd_up --reinstall "$@" ;;
		status)      cmd_status "$@" ;;
		report)      cmd_report "$@" ;;
		logs)        cmd_logs "$@" ;;
		restart)     cmd_restart "$@" ;;
		stop)        cmd_stop ;;
		down)        cmd_down ;;
		-h|--help)   cmd_help ;;
		*) echo "Unknown subcommand: $sub" >&2; echo "Run 'npm run wb -- --help' for usage." >&2; exit 1 ;;
	esac
}
main "$@"
