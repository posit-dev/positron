#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.workbench.yml"
WB_TTL_PIDFILE="${SCRIPT_DIR}/.ttl.pid"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/workbench-local-lib.sh"

WB_SCRIPTS_DIR="${SCRIPT_DIR}"
# workbench-local-lib.sh is copied in too: get-latest-wb-url.sh sources it in the
# container rather than duplicating the URL-resolution rules.
WB_SCRIPTS=(install-workbench.sh ensure-connect-token.sh positronDownload.sh get-latest-wb-url.sh workbench-local-lib.sh configure-datasources.sh)

# Host OS of the test container: ubuntu24 or rocky9. Set by --os= (or WB_OS in
# .env) and threaded into the compose image, the installer, and the service
# restart below. See wb_os_* in workbench-local-lib.sh.
WB_OS="${WB_OS:-ubuntu24}"

wb_compose() { docker compose -f "${COMPOSE_FILE}" "$@"; }

# Scope to this compose project's services, not a stray container of the same name.
wb_stack_up() { wb_compose ps --services --filter status=running 2>/dev/null | grep -q '^test$'; }

# Fail fast with a friendly message when a command needs a running stack.
wb_require_stack() { wb_stack_up || { echo "Stack not running. Start with: npm run pwb" >&2; exit 1; }; }

# On Windows this script is meant to run under Git Bash, which is what npm uses
# when script-shell points at it. Run bare (`bash workbench-local.sh`) from
# PowerShell or cmd instead and `bash` resolves to C:\Windows\System32\bash.exe --
# the WSL launcher -- so everything below executes inside a Linux distro that
# usually has no reachable Docker daemon (Docker Desktop's WSL integration is
# per-distro and off by default) and no gh. The raw daemon error gives no hint
# that the shell is the problem, so name it. A WSL setup that CAN reach Docker is
# perfectly fine and passes straight through. Git Bash never matches: its
# /proc/version reads "MINGW64_NT-...", not "microsoft".
wb_check_shell() {
	grep -qi microsoft /proc/version 2>/dev/null || return 0
	docker info >/dev/null 2>&1 && return 0
	echo "Docker is not reachable from this WSL distro (${WSL_DISTRO_NAME:-unknown})." >&2
	echo "This script ran under WSL, which happens when 'bash' is invoked from PowerShell" >&2
	echo "or cmd (System32\\bash.exe is the WSL launcher). Either:" >&2
	echo "  - run it through npm, with npm's shell set to Git Bash:" >&2
	echo "      npm config set script-shell \"C:\\Program Files\\Git\\bin\\bash.exe\"" >&2
	echo "      npm run pwb" >&2
	echo "  - or enable Docker Desktop -> Settings -> Resources -> WSL integration" >&2
	echo "    for this distro (you will also need gh installed inside it)." >&2
	exit 1
}

# Cancel a pending auto-stop timer from a previous run, if any.
wb_cancel_ttl() {
	[ -f "$WB_TTL_PIDFILE" ] || return 0
	local pid; pid="$(cat "$WB_TTL_PIDFILE" 2>/dev/null || true)"
	[ -n "$pid" ] && kill "$pid" 2>/dev/null || true
	rm -f "$WB_TTL_PIDFILE"
}

# Schedule a detached best-effort auto-stop after $1 minutes (0 disables). The
# timer survives this script exiting and the terminal closing (nohup). At fire
# time it only stops if the same test instance is still running, so a manual
# restart in between is never clobbered. Re-running cmd_up resets the timer.
wb_schedule_ttl() {
	local minutes="${1:-0}"
	wb_cancel_ttl
	[ "$minutes" -gt 0 ] 2>/dev/null || return 0
	local cid; cid="$(docker inspect -f '{{.Id}}' test 2>/dev/null || true)"
	[ -n "$cid" ] || return 0
	# Args passed positionally to avoid quoting the values into the script body.
	nohup bash -c '
		sleep "$1"
		[ "$(docker inspect -f "{{.Id}}" test 2>/dev/null || true)" = "$2" ] \
			&& docker compose -f "$3" stop >/dev/null 2>&1
	' _ "$((minutes * 60))" "$cid" "$COMPOSE_FILE" >/dev/null 2>&1 &
	echo $! > "$WB_TTL_PIDFILE"
	disown 2>/dev/null || true
}

# Tell the user about the scheduled auto-stop (or stay quiet if disabled).
wb_print_ttl() {
	[ "${1:-0}" -gt 0 ] 2>/dev/null || return 0
	echo "FYI: The stack auto-stops in ${1} min. Run 'npm run pwb --no-ttl' to disable auto-stop."
}

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

# Granted scopes for the given token, from GitHub's X-OAuth-Scopes response
# header. Works for classic PATs and OAuth tokens; a fine-grained PAT (or an
# invalid token) returns nothing, so callers must treat empty as "unknown",
# not "no scopes".
wb_token_scopes() {
	curl -fsS -o /dev/null -D - -H "Authorization: Bearer ${1}" https://api.github.com 2>/dev/null \
		| tr -d '\r' | awk -F': ' 'tolower($1)=="x-oauth-scopes"{print $2}'
}

# Derive auth from the gh CLI so the only one-time step is `gh auth login`.
# Borrows gh's token for GITHUB_TOKEN (used for positron-builds + the installer)
# and, only if you are NOT already logged into ghcr.io, logs Docker in with it.
# An explicit GITHUB_TOKEN (env or .env) and an existing ghcr.io login both win.
wb_ensure_auth() {
	# Track where the token came from so the remediation hint matches: a gh-
	# derived token can be fixed with `gh auth refresh`; an exported PAT cannot.
	local token_source="env"
	if [ -z "${GITHUB_TOKEN:-}" ] && command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
		GITHUB_TOKEN="$(gh auth token 2>/dev/null || true)"
		export GITHUB_TOKEN
		token_source="gh"
	fi
	if [ -z "${GITHUB_TOKEN:-}" ]; then
		echo "Not authenticated. Run 'gh auth login' once, then re-run 'npm run pwb'." >&2
		echo "(Or export GITHUB_TOKEN with a PAT that has the repo + read:packages scopes.)" >&2
		exit 1
	fi
	# Already logged into ghcr.io? Leave that credential alone -- it may be a PAT
	# with read:packages, and clobbering it with our token (which might lack that
	# scope) would break image pulls.
	wb_ghcr_logged_in && return 0
	# Check the scopes of the token we'll actually log Docker in with -- not gh's
	# stored token, which differs when GITHUB_TOKEN is an exported PAT. Only warn
	# when we can positively see read:packages is absent (empty == unknown, e.g. a
	# fine-grained PAT), and tailor the fix to where the token came from.
	local scopes; scopes="$(wb_token_scopes "$GITHUB_TOKEN")"
	if [ -n "$scopes" ] && ! printf '%s' "$scopes" | grep -q 'read:packages'; then
		echo "NOTE: the token in use lacks the 'read:packages' scope (needed to pull images)." >&2
		if [ "$token_source" = "gh" ]; then
			echo "      Add it once with: gh auth refresh -h github.com -s read:packages" >&2
		else
			echo "      Add 'read:packages' to the PAT in GITHUB_TOKEN, or log in separately:" >&2
			echo "      docker login ghcr.io -u <github-user> (paste a PAT with read:packages)" >&2
		fi
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
	docker exec test bash -c 'test -f /usr/lib/rstudio-server/bin/positron-server/new/product.json || test -f /usr/lib/rstudio-server/bin/positron-server/product.json' 2>/dev/null
}

# pgrep pattern for the session launcher. The leading [/] is load-bearing: these
# checks run as `docker exec test bash -c "... pgrep -f <pattern> ..."`, and a
# plain path would match the wrapper shell's OWN command line, so the launcher
# would always look alive -- even when it is dead, which is exactly the state
# this function exists to repair. Verified: the plain form returns a pid for a
# launcher path that does not exist at all. (Also note pgrep -x cannot be used
# with the full name: Linux truncates comm to 15 chars, so it reads
# "rstudio-launche".)
WB_LAUNCHER_PGREP='[/]usr/lib/rstudio-server/bin/rstudio-launcher'
WB_LAUNCHER_SOCKET=/var/run/rstudio-server/rserver-launcher.socket

# The container's command is a sleep loop, and the rstudio services are started
# by the installer -- not the container entrypoint. After a stop/start the
# container comes back up but none of them do, so :8787 is dead (or, with only
# rserver up, "Unable to contact session launcher"). Bring them back in the
# order rserver requires: the launcher must be running first, or rserver can't
# reach it and shuts itself down. No-op when both are already healthy (a plain
# re-run of `npm run pwb`).
wb_ensure_workbench() {
	local launcher rserver
	docker exec test bash -c "pgrep -f '${WB_LAUNCHER_PGREP}' >/dev/null 2>&1" && launcher=1 || launcher=0
	docker exec test bash -c 'pgrep -x rserver >/dev/null 2>&1' && rserver=1 || rserver=0
	[ "$launcher" = 1 ] && [ "$rserver" = 1 ] && return 0
	# Clean ordered (re)start: stop rserver, bring up the launcher, then rserver.
	#
	# Stop by signal and verify. `rstudio-server stop` returns 0 without doing
	# anything on Rocky (its status check uses `pidof -c`, blind inside a
	# container), so trusting it here used to leave the old rserver running and
	# the start below would add a SECOND one, which then spun forever failing to
	# bind :8787.
	docker exec test bash -c 'sudo rstudio-server stop' >/dev/null 2>&1 || true
	docker exec test bash -c '
		pgrep -x rserver >/dev/null 2>&1 || exit 0
		sudo pkill -x rserver 2>/dev/null || true
		for _ in $(seq 1 15); do pgrep -x rserver >/dev/null 2>&1 || exit 0; sleep 1; done
		sudo pkill -KILL -x rserver 2>/dev/null || true
	' >/dev/null 2>&1 || true
	local i
	if [ "${WB_OS}" = "rocky9" ]; then
		# The rpm's rstudio-launcher init script is broken on EL9 (see
		# install-workbench.sh), so start the binary directly and wait for its
		# socket -- rserver shuts itself down if the socket is missing.
		# Reuse $launcher from above rather than re-checking here. This command
		# string necessarily contains the launcher's real path (to start it), and
		# a pgrep in the SAME string would match this very wrapper shell -- the
		# bracket trick only hides the pattern's own text, not a second, literal
		# copy of the path beside it. That mistake silently skipped the start and
		# left the stale socket in place, which the wait below then accepted.
		# Removing the socket first is what makes that wait mean something.
		if [ "$launcher" != 1 ]; then
			docker exec test bash -c "
				sudo rm -f ${WB_LAUNCHER_SOCKET}
				sudo nohup setsid /usr/lib/rstudio-server/bin/rstudio-launcher \
					>/var/log/rstudio-launcher.stdout.log 2>&1 &
			" >/dev/null 2>&1 || true
		fi
		for i in $(seq 1 30); do
			docker exec test bash -c "test -S ${WB_LAUNCHER_SOCKET}" >/dev/null 2>&1 && break
			sleep 1
		done
	else
		docker exec test bash -c 'sudo /etc/init.d/rstudio-launcher start' >/dev/null 2>&1 || true
		for i in $(seq 1 10); do
			docker exec test bash -c "pgrep -f '${WB_LAUNCHER_PGREP}' >/dev/null 2>&1" && break
			sleep 1
		done
	fi
	docker exec test bash -c 'sudo rstudio-server start' >/dev/null 2>&1 || true
	# Wait until :8787 actually accepts connections, not just until the process
	# exists -- rserver binds the port a few seconds after it starts.
	for i in $(seq 1 20); do
		docker exec test bash -c 'curl -s -o /dev/null http://localhost:8787' >/dev/null 2>&1 && return 0
		sleep 1
	done
}

# Accept the bare credential names (SNOWFLAKE_ACCOUNT) as aliases for the
# underscore-suffixed names the installer reads (SNOWFLAKE_ACCOUNT_). The CI
# action maps these explicitly; we mirror that locally so a .env copied from
# 1Password / GitHub secrets works without the trailing underscore. The
# suffixed name is the contract (the bare names collide with what the
# Snowflake/Databricks SDKs auto-read), so an explicitly-set suffixed form wins.
wb_map_credential_aliases() {
	local base suffixed
	for base in \
		DATABRICKS_URL DATABRICKS_CLIENT_ID \
		SNOWFLAKE_ACCOUNT SNOWFLAKE_CLIENT_ID SNOWFLAKE_CLIENT_SECRET \
		AZURE_SERVICE_PRINCIPAL_CLIENT_SECRET; do
		suffixed="${base}_"
		[ -n "${!suffixed:-}" ] && continue   # suffixed form already set: leave it
		[ -n "${!base:-}" ] || continue        # no bare value to copy
		printf -v "$suffixed" '%s' "${!base}"
		export "${suffixed?}"
	done
}

wb_bootstrap_env() {
	local env_file="${SCRIPT_DIR}/.env"
	[ -f "$env_file" ] || cp "${SCRIPT_DIR}/.env.example" "$env_file"
	set -a
	# shellcheck source=/dev/null
	source "$env_file"
	set +a
	wb_map_credential_aliases
	if [ -z "${WB_PASSWORD:-}" ]; then
		# Read from the tty (not stdin) and tolerate a closed/non-interactive
		# stdin so set -euo pipefail does not abort silently when unset.
		read -r -p "Workbench password for user1: " WB_PASSWORD </dev/tty || true; export WB_PASSWORD
	fi
	: "${E2E_POSTGRES_USER:=testuser}"; : "${E2E_POSTGRES_PASSWORD:=testpassword}"
	export E2E_POSTGRES_USER E2E_POSTGRES_PASSWORD
}

# MSYS_NO_PATHCONV=1 on the two `docker exec`s below (and on the installer exec in
# cmd_install): under Git Bash the MSYS runtime rewrites a bare absolute path in
# argv into a Windows path before docker.exe sees it, so `docker exec test chmod
# +x /tmp/x` arrives in the container as `C:/Users/.../Temp/x` and fails -- which
# aborts the run here, right after the containers come up and before anything is
# installed. Only args that are *whole* paths are affected, which is why the
# `docker exec test bash -c '...'` calls elsewhere need nothing.
#
# Scope it to those calls; do NOT export it. `docker cp` below takes a HOST path
# and `docker compose -f` takes the compose file, and both depend on that same
# conversion to hand docker.exe a Windows path. The variable is meaningless off
# Windows, so this is a no-op on Linux and macOS.
wb_fetch_scripts() {
	# The installer scripts live alongside this one (docker/environments/wb-local).
	for s in "${WB_SCRIPTS[@]}"; do
		docker cp "${WB_SCRIPTS_DIR}/${s}" "test:/tmp/${s}" >/dev/null
		MSYS_NO_PATHCONV=1 docker exec test sed -i 's/\r$//' "/tmp/${s}"
		MSYS_NO_PATHCONV=1 docker exec test chmod +x "/tmp/${s}"
	done
	if [ -f "${SCRIPT_DIR}/workbench.lic" ]; then
		docker cp "${SCRIPT_DIR}/workbench.lic" test:/tmp/workbench.lic >/dev/null
		# Same CRLF strip the scripts get above, and for the same reason a
		# Windows-saved connect.lic needs one (see cmd_up): rstudio-server
		# rejects a CRLF license outright.
		MSYS_NO_PATHCONV=1 docker exec test sed -i 's/\r$//' /tmp/workbench.lic
	fi
}

# Channel (Release/Daily) -> version list. Sets POSITRON_TAG (downloaded from
# positron-builds by tag, which holds both release and daily tarballs).
# WB_POSITRON (--positron=) skips the menus: release|daily takes the newest build
# on that channel, anything else is used as an explicit tag.
wb_pick_positron() {
	local tags=() opts=() lines tag date
	case "${WB_POSITRON:-}" in
		'') : ;;
		release|daily)
			lines="$([ "$WB_POSITRON" = release ] && wb_list_positron_releases 1 || wb_list_positron_dailies 1)"
			POSITRON_TAG="$(printf '%s' "$lines" | head -1 | cut -f1)"
			[ -n "$POSITRON_TAG" ] || { echo "No Positron ${WB_POSITRON} build found." >&2; return 1; }
			export POSITRON_TAG; return 0 ;;
		*)
			POSITRON_TAG="$WB_POSITRON"; export POSITRON_TAG; return 0 ;;
	esac
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
		# No usable /dev/tty (agent, cron, piped run): a silent default here picks a
		# build nobody chose, so say what to pass instead.
		if ! read -r -p "Choice [1]: " choice </dev/tty 2>/dev/tty; then
			echo "" >&2
			echo "No TTY available to answer '${prompt}'. Run non-interactively instead:" >&2
			echo "  npm run pwb -- --workbench=<release|daily|URL> --positron=<release|daily|TAG>" >&2
			return 1
		fi
		WB_MENU_INDEX="${choice:-1}"
	fi
	[[ "$WB_MENU_INDEX" =~ ^[0-9]+$ ]] && [ "$WB_MENU_INDEX" -ge 1 ] && [ "$WB_MENU_INDEX" -le "$n" ] || { echo "Invalid choice" >&2; return 1; }
}

# Workbench has no listable version history (Posit publishes only the current
# stable and current daily -- same as Positron's workbench-nightly CI), so each
# channel resolves to a single current build; Custom URL pins a specific package.
wb_pick_workbench() {
	local stable_url daily_url ext
	ext="$(wb_os_pkg_ext "${WB_OS}")" || return 1
	# WB_WORKBENCH (--workbench=) skips the menu: release|daily resolves that
	# channel's current build, anything else is treated as a package URL to pin.
	case "${WB_WORKBENCH:-}" in
		'') : ;;
		release|daily)
			# WB_ARCH is set by cmd_up (wb_detect_arch) before install runs.
			WB_URL="$([ "$WB_WORKBENCH" = release ] && wb_resolve_stable_url "${WB_OS}" "${WB_ARCH}" || wb_resolve_daily_url "${WB_OS}" "${WB_ARCH}")" || return 1
			[ -n "$WB_URL" ] || { echo "Workbench ${WB_WORKBENCH} URL could not be resolved (check network)." >&2; return 1; }
			wb_validate_wb_url "$WB_URL" "${WB_OS}" "${WB_ARCH}" || return 1
			export WB_URL; return 0 ;;
		*)
			WB_URL="$WB_WORKBENCH"; wb_validate_wb_url "$WB_URL" "${WB_OS}" "${WB_ARCH}" || return 1
			export WB_URL; return 0 ;;
	esac
	echo "Resolving Workbench versions..." >&2
	stable_url="$(wb_resolve_stable_url "${WB_OS}" "${WB_ARCH}" 2>/dev/null || true)"
	daily_url="$(wb_resolve_daily_url "${WB_OS}" "${WB_ARCH}" 2>/dev/null || true)"
	# No second menu (WB has one current build per channel), so show the resolved
	# version right in the labels.
	wb_menu "Workbench build" \
		"Release build ($(wb_pkg_version "$stable_url" || echo unavailable))" \
		"Daily build ($(wb_pkg_version "$daily_url" || echo unavailable))" \
		"Custom .${ext} URL" || return 1
	case "$WB_MENU_INDEX" in
		1) WB_URL="$stable_url"; [ -n "$WB_URL" ] || { echo "Release URL could not be resolved (check network)." >&2; return 1; }; wb_validate_wb_url "$WB_URL" "${WB_OS}" "${WB_ARCH}" || return 1 ;;
		2) WB_URL="$daily_url";  [ -n "$WB_URL" ] || { echo "Daily URL could not be resolved (check network)." >&2; return 1; }; wb_validate_wb_url "$WB_URL" "${WB_OS}" "${WB_ARCH}" || return 1 ;;
		3)
			echo "Pin a specific ${WB_ARCH} Workbench .${ext} (e.g. an n-1/n-2 release):" >&2
			echo "  Dailies: https://dailies.rstudio.com/rstudio/  (pick a branch -> workbench -> ${WB_OS}-$(wb_os_key_arch "${WB_OS}" "${WB_ARCH}"))" >&2
			echo "  Stable:  https://docs.posit.co/ide/server-pro/admin/getting_started/installation/installation.html" >&2
			while :; do
				read -r -p "Workbench .${ext} URL (blank to cancel): " WB_URL </dev/tty || true
				[ -n "${WB_URL:-}" ] || { echo "Cancelled (no URL entered)." >&2; return 1; }
				wb_validate_wb_url "$WB_URL" "${WB_OS}" "${WB_ARCH}" && break
				echo "Try again." >&2
			done ;;
	esac
	[ -n "${WB_URL:-}" ] || { echo "No Workbench URL resolved." >&2; return 1; }
	export WB_URL
}

cmd_install() {
	# GITHUB_TOKEN is guaranteed set by wb_ensure_auth (called in cmd_up before us).
	local creds=""
	for a in "$@"; do
		case "$a" in
			--credentials=*) creds="$a" ;;
			--workbench=*)   WB_WORKBENCH="${a#--workbench=}" ;;
			--positron=*)    WB_POSITRON="${a#--positron=}" ;;
		esac
	done
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
	# MSYS_NO_PATHCONV=1 keeps Git Bash from rewriting `/bin/bash` and the script
	# path into Windows paths -- see the note above wb_fetch_scripts.
	local wb_build; wb_build="$(basename "$WB_URL")"
	# The credential vars below use the inherit form (-e VAR, no value): docker
	# exec forwards them only when set. wb_bootstrap_env exported them by sourcing
	# .env under `set -a`, so configure-datasources.sh (run by the installer when
	# --credentials is passed) can read whichever set the chosen provider needs.
	DOCKER_CLI_HINTS=false MSYS_NO_PATHCONV=1 docker exec -i \
		-e GITHUB_TOKEN="${GITHUB_TOKEN}" \
		-e WB_URL="${WB_URL}" \
		-e POSITRON_TAG="${POSITRON_TAG}" \
		-e ARCH_SUFFIX="${WB_ARCH}" \
		-e WB_OS="${WB_OS}" \
		-e WB_PASSWORD="${WB_PASSWORD:-}" \
		-e DATABRICKS_URL_ -e DATABRICKS_CLIENT_ID_ \
		-e SNOWFLAKE_ACCOUNT_ -e SNOWFLAKE_CLIENT_ID_ -e SNOWFLAKE_CLIENT_SECRET_ \
		-e AZURE_SERVICE_PRINCIPAL_CLIENT_SECRET_ \
		test /bin/bash /tmp/install-workbench.sh ${creds:+"$creds"} 2>&1 \
		| awk -v build="$wb_build" '
			{ print }
			/[Ww]orkbench version:/ { print "Workbench build:     " build }
		'
	# Record the exact Workbench package URL so status can show the build.
	docker exec -e WB_URL="${WB_URL}" test bash -c 'printf "%s\n" "$WB_URL" > /var/lib/wb-local-source' || true
	# install-workbench.sh writes /var/lib/wb-local-credentials itself, only on a
	# successful configure-datasources.sh run. Without --credentials there's
	# nothing to configure, so clear any stale marker from a prior install here.
	if [ -z "$creds" ]; then
		docker exec test bash -c 'rm -f /var/lib/wb-local-credentials' || true
	fi
}

cmd_up() {
	# Default to a 60-minute auto-stop (override with --ttl N / WB_TTL_MINUTES,
	# disable with --no-ttl). Collect everything else for cmd_install.
	local ttl="${WB_TTL_MINUTES:-60}" reinstall=0 os_flag=""
	local passthru=()
	while [ $# -gt 0 ]; do
		case "$1" in
			--reinstall) reinstall=1 ;;
			--no-ttl)    ttl=0 ;;
			--ttl)       shift; ttl="${1:-60}" ;;
			--ttl=*)     ttl="${1#--ttl=}" ;;
			--os)        shift; os_flag="${1:-}" ;;
			--os=*)      os_flag="${1#--os=}" ;;
			*)           passthru+=("$1") ;;
		esac
		shift
	done
	case "$ttl" in ''|*[!0-9]*) ttl=60 ;; esac

	wb_detect_arch
	export ARCH_SUFFIX="${WB_ARCH}"
	wb_bootstrap_env
	# After wb_bootstrap_env, which sources .env under `set -a` and would
	# otherwise clobber the flag with a WB_OS set there. Precedence: --os beats
	# .env beats the ubuntu24 default.
	[ -n "$os_flag" ] && WB_OS="$os_flag"
	# Sticky OS. With neither --os nor a WB_OS in .env, stay on whatever the
	# existing test container already is, rather than falling back to the
	# ubuntu24 default -- otherwise a bare `npm run pwb` after an --os=rocky9
	# install recreates the container and silently throws the install away.
	# An explicit signal (flag or .env) still wins, hence the grep rather than a
	# comparison against the default, which cannot tell "unset" from
	# "explicitly ubuntu24".
	if [ -z "$os_flag" ] && ! grep -qE '^[[:space:]]*WB_OS=' "${SCRIPT_DIR}/.env" 2>/dev/null; then
		local running_os; running_os="$(wb_running_os)"
		wb_os_valid "$running_os" 2>/dev/null && WB_OS="$running_os"
	fi
	# Validate before anything slow happens -- a typo here otherwise surfaces as
	# a confusing Docker or package-manager error minutes later.
	wb_os_valid "${WB_OS}" || exit 1
	# Drives the `image:` in the compose file. Changing it makes Compose recreate
	# the test container, which wipes the in-container install, so switching OS
	# always costs a reinstall (reported below rather than left to look spurious).
	WB_TEST_IMAGE="$(wb_os_image "${WB_OS}")"; export WB_TEST_IMAGE
	# Sources .env first (may set GITHUB_TOKEN), then fills auth gaps from gh and
	# logs into ghcr.io -- must run before the image pull below.
	wb_ensure_auth
	# The base images are multi-arch manifests pinned to a single tag in the
	# compose file, so Docker resolves the arch automatically -- no per-arch tag
	# selection is needed here. ARCH_SUFFIX (set above) still drives the
	# in-container Positron download.
	# Connect requires a valid base64 Bootstrap.SecretKey; the compose default
	# ("testkey") is not valid base64 and makes the connect container exit. Mint
	# one the first time and persist it to .env: test carries this var too, so a
	# fresh value every run makes Compose recreate the test container and wipe the
	# in-container Positron/Workbench install (forcing a needless reinstall).
	if [ -z "${CONNECT_BOOTSTRAP_SECRETKEY:-}" ]; then
		CONNECT_BOOTSTRAP_SECRETKEY="$(openssl rand -base64 32)"
		export CONNECT_BOOTSTRAP_SECRETKEY
		# Leading newline so the entry can't merge onto a .env last line that
		# lacks a trailing newline (a harmless blank line otherwise).
		printf '\nCONNECT_BOOTSTRAP_SECRETKEY="%s"\n' "$CONNECT_BOOTSTRAP_SECRETKEY" >> "${SCRIPT_DIR}/.env"
	fi
	mkdir -p "${SCRIPT_DIR}/connect"
	# A prior run without a license lets Compose's bind-mount auto-create
	# connect/connect.lic as a *directory* on the host. That then makes connect
	# fail to start ("cannot mount directory onto file") and makes the cp below
	# land the license file *inside* the directory -- a confusing crash that
	# persists even after the license is added. Clear that stale mount artifact
	# so the copy creates a real file.
	if [ -d "${SCRIPT_DIR}/connect/connect.lic" ]; then
		rm -rf "${SCRIPT_DIR}/connect/connect.lic"
	fi
	if [ -f "${SCRIPT_DIR}/connect.lic" ]; then
		# Strip CR on the way in. A license saved or copied on Windows arrives
		# CRLF, and Connect then refuses to parse it at all -- it starts fine,
		# answers 402 on every request, never goes healthy, and the only error
		# you see is 'test' failing on its depends_on, which points nowhere near
		# the license. (license-manager status shows an empty "License file
		# status" and Has-Key: No.) tr, not `sed -i 's/\r$//'`: BSD sed on macOS
		# reads '\r' as a literal 'r' and would eat a trailing r instead. The CR
		# is expanded by the shell, so BSD and GNU tr behave the same here.
		#
		# Convert through a temp file rather than redirecting onto the
		# destination: a redirect truncates the target before tr reads a byte,
		# which would destroy the license outright if the two paths ever resolve
		# to the same file, and leaves a half-written one behind on any failure.
		# mktemp is 0600, and this gets bind-mounted into the connect container,
		# which does not necessarily read it as our uid -- so set the mode.
		#
		# The temp file goes in the destination directory, not $TMPDIR: only a
		# same-filesystem mv is an atomic rename, and /tmp is frequently a
		# separate filesystem (tmpfs on Linux), where mv falls back to
		# copy-then-unlink and can leave exactly the half-written license this
		# is meant to rule out. A template with six X's satisfies both GNU and
		# BSD mktemp. connect/ is created earlier in cmd_up.
		local lic_tmp; lic_tmp="$(mktemp "${SCRIPT_DIR}/connect/connect.lic.XXXXXX")"
		tr -d $'\r' < "${SCRIPT_DIR}/connect.lic" > "$lic_tmp"
		chmod 0644 "$lic_tmp"
		mv "$lic_tmp" "${SCRIPT_DIR}/connect/connect.lic"
	fi
	# 'test' depends on connect being healthy; a missing license makes connect exit
	# and the wait loop below just times out. Warn clearly up front. (Connect's
	# config comes from the image defaults plus the CONNECT_* env in the compose --
	# no gcfg bind-mount to check.)
	if [ ! -f "${SCRIPT_DIR}/connect/connect.lic" ]; then
		echo "WARNING: no Connect license at ${SCRIPT_DIR}/connect.lic -- the connect container" >&2
		echo "         will not become healthy and 'test' won't start (startup will time out)." >&2
		echo "         Add connect.lic (see docker/environments/wb-local/README.md)." >&2
	fi
	# Say so up front when the running stack is on the other OS: the recreate
	# below wipes the install, so the reinstall that follows is expected rather
	# than a bug.
	local running_image
	running_image="$(docker inspect -f '{{.Config.Image}}' test 2>/dev/null || true)"
	if [ -n "$running_image" ] && [ "$running_image" != "$WB_TEST_IMAGE" ]; then
		echo "Switching the test container to --os=${WB_OS}:"
		echo "  from ${running_image}"
		echo "  to   ${WB_TEST_IMAGE}"
		echo "This recreates the container, so Workbench and Positron get reinstalled."
	fi
	# --remove-orphans clears a leftover container from a prior run under a
	# different service name that would otherwise hold the same ports.
	wb_compose up -d --remove-orphans
	echo "Waiting for containers to become healthy..."
	local tries=0
	until wb_stack_up; do
		tries=$((tries+1))
		if [ "$tries" -ge 120 ]; then
			echo "Timed out waiting for the 'test' container to start." >&2
			echo "Check service health: docker compose -f ${COMPOSE_FILE} ps" >&2
			wb_compose ps >&2 || true
			exit 1
		fi
		sleep 1
	done
	wb_fetch_scripts
	if wb_installed && [ "$reinstall" -eq 0 ]; then
		wb_ensure_workbench
		wb_print_ready
		echo "Wrong version? run 'npm run pwb -- --reinstall' to switch versions"
		wb_schedule_ttl "$ttl"
		wb_print_ttl "$ttl"
		return 0
	fi
	cmd_install ${passthru[@]+"${passthru[@]}"}
	wb_ensure_workbench
	wb_schedule_ttl "$ttl"
	wb_print_ttl "$ttl"
}

cmd_stop() { wb_cancel_ttl; wb_compose stop; echo ""; echo "Paused (volumes preserved). Resume with 'npm run pwb'"; }
# -v removes the named volumes (postgres-data, connect-data, connect_tokens)
# too; without it they leak and a later run reuses stale Postgres/Connect state.
cmd_down() { wb_cancel_ttl; wb_compose down --remove-orphans --volumes; echo ""; echo "Stack torn down. Next 'npm run pwb' will reinstall."; }

wb_versions() {
	local wb pos
	wb="$(docker exec test bash -c 'rstudio-server version 2>/dev/null | head -1 | awk "{print \$1}"' 2>/dev/null || true)"
	pos="$(docker exec test bash -c '
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
	docker exec test bash -c 'if [ -f /var/lib/wb-local-source ]; then basename "$(cat /var/lib/wb-local-source)"; fi' 2>/dev/null || true
}

# Which OS the *running* container actually is, mapped back from its image.
# Deliberately not just "$WB_OS": `status` and `logs` never parse --os, so the
# variable there is only ever the default and would misreport a rocky9 stack.
# Falls back to the raw image ref for anything we don't recognize.
wb_running_os() {
	local img os
	img="$(docker inspect -f '{{.Config.Image}}' test 2>/dev/null || true)"
	[ -n "$img" ] || { printf 'unknown'; return 0; }
	for os in $WB_OS_CHOICES; do
		[ "$img" = "$(wb_os_image "$os")" ] && { printf '%s' "$os"; return 0; }
	done
	printf '%s' "$img"
}

# The configured managed-credential type (databricks/snowflake/azure), recorded
# at install time. Empty if the stack was installed without --credentials.
wb_credentials_type() {
	docker exec test bash -c 'if [ -f /var/lib/wb-local-credentials ]; then cat /var/lib/wb-local-credentials; fi' 2>/dev/null || true
}

# Clean post-startup summary, with the same labels install-workbench.sh prints
# so a resume reads the same as a fresh install. The header reflects real
# readiness: this image's init script has no 'status' verb, so we check for the
# running rserver process directly.
wb_print_ready() {
	local v wb pos src creds
	v="$(wb_versions)"
	wb="$(printf '%s' "$v" | cut -f1)"
	pos="$(printf '%s' "$v" | cut -f2)"
	src="$(wb_source_build)"
	creds="$(wb_credentials_type)"
	echo ''
	if docker exec test bash -c 'pgrep -x rserver >/dev/null 2>&1'; then
		# allow-any-unicode-next-line
		echo "Workbench ready ✅"
	else
		echo "Workbench installed -- rstudio-server not running (run: docker exec test sudo rstudio-server restart)"
	fi
	printf 'OS:                  %s\n' "$(wb_running_os)"
	printf 'Positron version:    %s\n' "$pos"
	printf 'Workbench version:   %s\n' "$wb"
	[ -n "$src" ] && printf 'Workbench build:     %s\n' "$src"
	[ -n "$creds" ] && printf 'Credentials:         %s\n' "$creds"
	printf 'Workbench URL:       %s  (user1 / WB_PASSWORD)\n' "http://localhost:8787"
	printf 'Connect URL:         %s\n' "http://localhost:3939"
	echo ''
}

cmd_status() {
	if ! wb_stack_up; then echo "Containers are not running. Start with: npm run pwb"; return 0; fi
	echo "Containers:"
	docker ps --format '{{.Names}}\t{{.Status}}' | grep -E '^(test|postgres|connect)[[:space:]]' \
		| awk -F'\t' '{ printf "  %-9s %s\n", $1, $2 }'
	wb_print_ready
}

cmd_logs() {
	wb_require_stack
	# Default to the full interleaved history of every service and follow live
	# (parity with the old `docker compose up` foreground view): Ctrl-C to stop,
	# then scroll back over the whole run. Name a service for just that one.
	# rserver logs to a file inside the test container (the container's own
	# docker log is only the keepalive loop), so tail that file from the top
	# (-n +1) for its full history rather than docker logs.
	case "${1:-all}" in
		all)               wb_compose logs -f ;;
		rserver|workbench) docker exec test bash -c 'tail -n +1 -f /var/log/rstudio/rstudio-server/rserver.log' ;;
		connect|postgres)  wb_compose logs -f "${1}" ;;
		*)                 docker logs -f "${1}" ;;
	esac
}

# Drop into an interactive shell in the Workbench container, for poking at
# rserver config (/etc/rstudio), logs, or the installed Positron build. Defaults
# to the 'test' container; pass a name (postgres, connect) to target another.
cmd_shell() {
	wb_require_stack
	docker exec -it "${1:-test}" bash
}

cmd_help() {
	cat >&2 <<'EOF'
workbench-local.sh -- run Positron + Posit Workbench together, locally, for QA.

USAGE
  npm run pwb                 Bring the stack up. First run: pick versions + install.
                             Already installed: (re)start the stack and show status.
                             Auto-stops after 60 min; resets each time you run it.
  npm run pwb -- --reinstall  Re-run the version pickers and reinstall (switch versions).
  npm run pwb -- --os=<os>    Host OS for the test container: ubuntu24 (default) or
                             rocky9. Switching recreates the container, so it always
                             reinstalls. WB_OS in .env does the same. Once a stack
                             exists, a bare 'npm run pwb' stays on its OS.
  npm run pwb -- --credentials=<type>
                             Install with a managed data source: databricks, snowflake,
                             or azure (set the provider's vars in .env first).
  npm run pwb -- --ttl N      Set the auto-stop to N minutes (--no-ttl to disable).
  npm run pwb -- status       Containers, installed Positron + Workbench versions, URLs.
  npm run pwb -- logs [svc]   Follow full history of all services (default), or one:
                             rserver, connect, postgres. Ctrl-C to stop, then scroll back.
  npm run pwb -- shell [svc]  Open a shell in the container: test (default), postgres, connect.
  npm run pwb -- stop         Pause the stack (containers stopped, volumes kept).
  npm run pwb -- down         Tear the stack down (removes containers and volumes).

VERSION PICKERS
  Positron:  Release / Daily channel, then choose a version.
  Workbench: Release / Daily (current build each), or a Custom URL to pin a
             specific n-1/n-2 build (.deb on ubuntu24, .rpm on rocky9).

NON-INTERACTIVE (no TTY: agents, CI, piped runs)
  Skip both pickers by naming the builds up front:
    npm run pwb -- --workbench=daily --positron=release
    npm run pwb -- --workbench=https://.../rstudio-workbench-....deb --positron=2026.09.0-11
  release|daily takes that channel's current build; anything else is used verbatim
  (a package URL for --workbench, a build tag for --positron). WB_WORKBENCH / WB_POSITRON
  in .env do the same. Add --reinstall to switch an already-installed stack.

ACCESS
  Workbench  http://localhost:8787   (user1 / WB_PASSWORD from docker/environments/wb-local/.env)
  Connect    http://localhost:3939

SETUP  (details: docker/environments/wb-local/README.md)
  gh auth login (once, include read:packages)   workbench.lic + connect.lic in docker/environments/wb-local/
  GITHUB_TOKEN and docker login ghcr.io are derived from gh automatically.
  optional: fzf (arrow-key pickers; falls back to a numbered prompt)
EOF
}

main() {
	local sub="${1:-up}"; shift || true
	# --help stays answerable without Docker; everything else needs a daemon.
	case "$sub" in -h|--help) : ;; *) wb_check_shell ;; esac
	case "$sub" in
		up)          cmd_up "$@" ;;
		# Flag-style invocations (no explicit "up") route to cmd_up with the flag.
		--reinstall|--ttl|--ttl=*|--no-ttl|--os|--os=*|--credentials=*|--workbench=*|--positron=*) cmd_up "$sub" "$@" ;;
		status)      cmd_status "$@" ;;
		logs)        cmd_logs "$@" ;;
		shell)       cmd_shell "$@" ;;
		stop)        cmd_stop ;;
		down)        cmd_down ;;
		-h|--help)   cmd_help ;;
		*) echo "Unknown subcommand: $sub" >&2; echo "Run 'npm run pwb -- --help' for usage." >&2; exit 1 ;;
	esac
}
main "$@"
