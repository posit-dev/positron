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
	# shellcheck source=/dev/null
	set -a; source "$env_file"; set +a
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
	[ -f "${SCRIPT_DIR}/connect.lic" ] && docker cp "${SCRIPT_DIR}/connect.lic" test:/tmp/connect.lic >/dev/null || true
}

cmd_up() {
	wb_detect_arch
	export ARCH_SUFFIX="${WB_ARCH}"
	wb_bootstrap_env
	wb_compose up -d
	echo "Waiting for containers to become healthy..."
	until wb_stack_up; do sleep 1; done
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
