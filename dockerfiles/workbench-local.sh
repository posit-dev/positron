#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.workbench.yml"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/workbench-local-lib.sh"

WB_URL_BASE="https://raw.githubusercontent.com/posit-dev/qa-example-content/main/dockerfiles/wb-local"
WB_SCRIPTS="install-workbench.sh positronDownload.sh get-latest-wb-noble-url.sh configure-datasources.sh"

wb_compose() { docker compose -f "${COMPOSE_FILE}" "$@"; }

wb_stack_up() { docker ps --format '{{.Names}}' | grep -q '^test$'; }

wb_installed() {
	docker exec test bash -c 'test -f /usr/lib/rstudio-server/bin/positron-server/new/product.json' 2>/dev/null
}

wb_bootstrap_env() {
	local env_file="${SCRIPT_DIR}/.env"
	[ -f "$env_file" ] || cp "${SCRIPT_DIR}/.env.example" "$env_file"
	set -a
	# shellcheck source=/dev/null
	source "$env_file"
	set +a
	if [ -z "${WB_PASSWORD:-}" ]; then
		read -r -p "Workbench password for user1: " WB_PASSWORD; export WB_PASSWORD
	fi
	: "${E2E_POSTGRES_USER:=testuser}"; : "${E2E_POSTGRES_PASSWORD:=testpassword}"
	export E2E_POSTGRES_USER E2E_POSTGRES_PASSWORD
}

wb_fetch_scripts() {
	local src="${QA_CONTENT_DIR:-}"
	local tmpdir
	if [ -z "$src" ] && [ -d "${REPO_ROOT}/../qa-example-content/dockerfiles/wb-local" ]; then
		src="$(cd "${REPO_ROOT}/../qa-example-content" && pwd)"
	fi
	for s in $WB_SCRIPTS; do
		if [ -n "$src" ] && [ -f "${src}/dockerfiles/wb-local/${s}" ]; then
			docker cp "${src}/dockerfiles/wb-local/${s}" "test:/tmp/${s}" >/dev/null
		else
			tmpdir="$(mktemp -d)"
			curl -fsSL "${WB_URL_BASE}/${s}" -o "${tmpdir}/${s}"
			docker cp "${tmpdir}/${s}" "test:/tmp/${s}" >/dev/null
			rm -rf "${tmpdir}"
		fi
		docker exec test sed -i 's/\r$//' "/tmp/${s}"
		docker exec test chmod +x "/tmp/${s}"
	done
	[ -f "${SCRIPT_DIR}/workbench.lic" ] && docker cp "${SCRIPT_DIR}/workbench.lic" test:/tmp/workbench.lic >/dev/null || true
}

# Sets POSITRON_TAG (empty => latest/local). Sets WB_SOURCE_LOCAL=1 for source build.
wb_pick_positron() {
	echo "Select Positron build:" >&2
	local i=1 tags=() lines
	lines="$(wb_list_positron_releases 5)"
	while IFS=$'\t' read -r tag date; do
		[ -n "$tag" ] || continue
		echo "  $i) $tag   ($date)" >&2; tags+=("$tag"); i=$((i+1))
	done <<< "$lines"
	echo "  $i) Local source build (current repo)" >&2
	local choice; read -r -p "Choice [1]: " choice || true; choice="${choice:-1}"
	if ! [[ "$choice" =~ ^[0-9]+$ ]] || [ "$choice" -lt 1 ] || [ "$choice" -gt "$i" ]; then
		echo "Invalid choice: $choice" >&2; return 1
	fi
	if [ "$choice" = "$i" ]; then
		WB_SOURCE_LOCAL=1; POSITRON_TAG=""
	else
		WB_SOURCE_LOCAL=0; POSITRON_TAG="${tags[$((choice-1))]}"
	fi
	export POSITRON_TAG WB_SOURCE_LOCAL
}

# Sets WB_URL.
wb_pick_workbench() {
	echo "Select Workbench version:" >&2
	echo "  1) Stable (latest released)" >&2
	echo "  2) Daily (latest preview)" >&2
	echo "  3) Custom .deb URL" >&2
	local choice; read -r -p "Choice [1]: " choice || true; choice="${choice:-1}"
	case "$choice" in
		1) WB_URL="$(wb_resolve_stable_url "${WB_ARCH}")" ;;
		2) WB_URL="$(wb_resolve_daily_url "${WB_ARCH}")" ;;
		3) read -r -p "Workbench .deb URL: " WB_URL || true ;;
		*) echo "Invalid choice" >&2; return 1 ;;
	esac
	export WB_URL
}

cmd_install() {
	[ -n "${GITHUB_TOKEN:-}" ] || { echo "GITHUB_TOKEN is required (export it first)." >&2; exit 1; }
	local creds=""
	for a in "$@"; do case "$a" in --credentials=*) creds="$a" ;; esac; done
	wb_pick_workbench
	wb_pick_positron
	echo "Installing Workbench from: ${WB_URL}"
	if [ "${WB_SOURCE_LOCAL:-0}" = "1" ]; then
		echo "Positron: LOCAL SOURCE"
	else
		echo "Positron: ${POSITRON_TAG:-LATEST}"
	fi
	docker exec -it \
		-e GITHUB_TOKEN="${GITHUB_TOKEN}" \
		-e WB_URL="${WB_URL}" \
		-e POSITRON_TAG="${POSITRON_TAG}" \
		-e ARCH_SUFFIX="${WB_ARCH}" \
		-e WB_PASSWORD="${WB_PASSWORD:-}" \
		test /bin/bash -c "/tmp/install-workbench.sh ${creds}"
	if [ "${WB_SOURCE_LOCAL:-0}" = "1" ]; then
		echo "Overlaying local source build..."
		cmd_overlay
	fi
	cmd_status
}

cmd_up() {
	wb_detect_arch
	export ARCH_SUFFIX="${WB_ARCH}"
	wb_bootstrap_env
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
	wb_compose up -d
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
	if wb_installed && [ "${1:-}" != "--reinstall" ]; then
		echo "Stack already up with Positron + Workbench installed. (Use --reinstall to change versions, 'overlay' for source.)"
		cmd_status
		return 0
	fi
	cmd_install "$@"
}

cmd_stop() { wb_compose stop; echo "Paused (volumes preserved). Resume with: npm run wb"; }
cmd_down() { wb_compose down; echo "Stack torn down. Next 'npm run wb' will reinstall."; }

cmd_restart() { docker exec test bash -c 'sudo rstudio-server restart'; echo "rstudio-server restarted."; }

cmd_overlay() {
	wb_detect_arch
	local build_dir="${REPO_ROOT}/../vscode-reh-web-pwb-linux-${POSITRON_ARCH}"
	echo "Building Positron server from source (gulp vscode-reh-web-pwb-linux-${POSITRON_ARCH})..."
	( cd "${REPO_ROOT}" && npm run gulp "vscode-reh-web-pwb-linux-${POSITRON_ARCH}" )
	[ -d "${build_dir}" ] || { echo "Expected build output at ${build_dir}" >&2; exit 1; }
	echo "Overlaying into container..."
	tar -C "$(dirname "${build_dir}")" -czf /tmp/positron-custom.tar.gz "vscode-reh-web-pwb-linux-${POSITRON_ARCH}"
	docker cp /tmp/positron-custom.tar.gz test:/tmp/positron-custom.tar.gz
	docker exec test /bin/bash -c "
		cd /tmp &&
		tar -xzf positron-custom.tar.gz &&
		rm -rf /usr/lib/rstudio-server/bin/positron-server/new &&
		cp -r vscode-reh-web-pwb-linux-${POSITRON_ARCH} /usr/lib/rstudio-server/bin/positron-server/new &&
		chown -R rstudio-server:rstudio-server /usr/lib/rstudio-server/bin/positron-server/new &&
		sudo rstudio-server restart
	"
	echo "Source build overlaid. Reload http://localhost:8787"
}

wb_versions() {
	local wb pos
	wb="$(docker exec test bash -c 'rstudio-server version 2>/dev/null | head -1 | awk "{print \$1}"' 2>/dev/null || true)"
	pos="$(docker exec test bash -c '
		d=/usr/lib/rstudio-server/bin/positron-server/new
		if [ -f "$d/product.json" ]; then
			v=$(grep positronVersion "$d/product.json" | sed "s/.*: *\"\([^\"]*\)\".*/\1/")
			b=$(grep positronBuildNumber "$d/product.json" | sed "s/.*: *\"\([^\"]*\)\".*/\1/")
			[ -n "$v" ] && [ -n "$b" ] && echo "${v}-${b}"
		fi' 2>/dev/null || true)"
	printf '%s\t%s\n' "${wb:-not installed}" "${pos:-not installed}"
}

cmd_status() {
	echo "=== Workbench Local Status ==="
	if ! wb_stack_up; then echo "Containers: not running. Start with: npm run wb"; return 0; fi
	docker ps --format '  {{.Names}}: {{.Status}}' | grep -E 'test|postgres|connect' || true
	local v; v="$(wb_versions)"
	echo "  Workbench: $(echo "$v" | cut -f1)"
	echo "  Positron:  $(echo "$v" | cut -f2)"
	echo "  Access:    http://localhost:8787 (user1 / WB_PASSWORD)   Connect: http://localhost:3939"
	docker exec test bash -c 'rstudio-server status >/dev/null 2>&1' || echo "  NOTE: rstudio-server not running -- try: npm run wb restart"
}

cmd_report() {
	local v; v="$(wb_versions)"; wb_detect_arch
	cat <<EOF
Environment:
- Positron: $(echo "$v" | cut -f2)  (under Workbench)
- Workbench: $(echo "$v" | cut -f1)
- Arch: POSITRON_ARCH=${POSITRON_ARCH}, WB_ARCH=${WB_ARCH}
- Containers: $(docker ps --format '{{.Names}}={{.Status}}' | grep -E 'test|postgres|connect' | paste -sd', ' - || echo 'none')
EOF
}

cmd_logs() {
	case "${1:-rserver}" in
		rserver|workbench) docker exec test bash -c 'tail -n 100 -f /var/log/rstudio/rstudio-server/rserver.log' ;;
		connect)           docker logs -f connect ;;
		*)                 docker logs -f "${1}" ;;
	esac
}

cmd_test() {
	local grep_arg="${1:-}"
	( cd "${REPO_ROOT}" && npx playwright test --project e2e-workbench ${grep_arg:+--grep "$grep_arg"} )
}

main() {
	local sub="${1:-up}"; shift || true
	case "$sub" in
		up)      cmd_up "$@" ;;
		status)  cmd_status "$@" ;;
		report)  cmd_report "$@" ;;
		logs)    cmd_logs "$@" ;;
		test)    cmd_test "$@" ;;
		overlay) cmd_overlay "$@" ;;
		restart) cmd_restart "$@" ;;
		stop)    cmd_stop ;;
		down)    cmd_down ;;
		-h|--help) echo "Usage: workbench-local.sh [up|status|report|logs|test|overlay|restart|stop|down]" ;;
		*) echo "Unknown subcommand: $sub" >&2; exit 1 ;;
	esac
}
main "$@"
