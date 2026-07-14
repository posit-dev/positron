#!/bin/bash
# with-connect.sh -- local-dev wrapper around the `with-connect` CLI
# (https://github.com/posit-dev/with-connect) for the e2e-connect test lane.
#
# `with-connect` stands up an ephemeral Posit Connect in Docker and hands back a
# freshly bootstrapped API key. This wrapper adapts it to what the e2e tests
# expect locally:
#   - Connect reachable at http://localhost:3939
#   - the publisher API key written to ./.tokens/connect_bootstrap_token, where
#     PositConnect.resolveApiKey() reads it (no env setup required)
#
# Because Connect is ephemeral, every `start` begins from a clean slate and the
# bootstrapped key rotates each run; the publisher tests' keychain self-heal
# (the `.tokens/.last_publisher_key` marker) detects that and re-enters the
# saved credential, so the marker is deliberately preserved across runs.
#
# Subcommands: start | stop | status | token
#
# Env overrides:
#   CONNECT_VERSION  Connect version passed to `with-connect --version`
#                    (default: release). Use "preview" for the daily build, or a
#                    dated version like "2025.09.0".
#   CONNECT_IMAGE    Full image ref passed to `with-connect --image` (overrides
#                    CONNECT_VERSION).

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

TOKENS_DIR="${SCRIPT_DIR}/.tokens"
TOKEN_FILE="${TOKENS_DIR}/connect_bootstrap_token"
CONTAINER_ID_FILE="${TOKENS_DIR}/.container_id"
PING_URL="http://localhost:3939"

require_cli() {
	if ! command -v with-connect >/dev/null 2>&1; then
		echo "ERROR: the 'with-connect' CLI is not installed." >&2
		echo "       Install it with uv (recommended):" >&2
		echo "         uv tool install git+https://github.com/posit-dev/with-connect.git" >&2
		echo "       Requires Docker and Python 3.13+ (uv provides Python)." >&2
		exit 1
	fi
}

# Resolve a Connect license: prefer a connect.lic in this dir, else reuse the
# shared wb-local one.
resolve_license() {
	if [ -f "connect/connect.lic" ]; then
		echo "${SCRIPT_DIR}/connect/connect.lic"
	elif [ -f "../wb-local/connect/connect.lic" ]; then
		echo "$(cd ../wb-local/connect && pwd)/connect.lic"
	else
		echo "ERROR: no Connect license found at connect/connect.lic or ../wb-local/connect/connect.lic." >&2
		echo "       Add a license file (see README.md)." >&2
		exit 1
	fi
}

# Stop and remove the container recorded in .container_id, if any. Preserves the
# .last_publisher_key marker.
stop_running() {
	if [ -f "$CONTAINER_ID_FILE" ]; then
		local cid
		cid="$(cat "$CONTAINER_ID_FILE")"
		if [ -n "$cid" ]; then
			with-connect --stop "$cid" >/dev/null 2>&1 || true
			docker rm "$cid" >/dev/null 2>&1 || true
		fi
		rm -f "$CONTAINER_ID_FILE"
	fi
	rm -f "$TOKEN_FILE"
}

cmd_start() {
	require_cli
	local license
	license="$(resolve_license)"

	# Clean slate: tear down any container from a prior start.
	stop_running

	mkdir -p "$TOKENS_DIR"

	# Switch Connect to PAM auth (mirrors the Workbench lane) so the publisher
	# tests can create a system user1 and sign in as a viewer, avoiding the
	# built-in password provider's account-confirmation step. Done via CONNECT_*
	# env overrides rather than a --config file, so the image's own runtime config
	# (its R / Python / Quarto executable paths, which vary by image/arch) is
	# preserved -- a replacement gcfg would have to hard-code those paths.
	local args=(--license "$license"
		-e CONNECT_AUTHENTICATION_PROVIDER=pam
		-e CONNECT_PAM_SERVICE=rstudio-connect)
	if [ -n "${CONNECT_IMAGE:-}" ]; then
		args+=(--image "$CONNECT_IMAGE")
	else
		args+=(--version "${CONNECT_VERSION:-release}")
	fi

	echo "Starting ephemeral Posit Connect via with-connect..."
	# Start-only mode: with-connect prints CONNECT_API_KEY / CONNECT_SERVER /
	# CONTAINER_ID on stdout and leaves the container running. Progress goes to
	# stderr, so capturing stdout gives us just the KEY=value lines.
	local out
	out="$(with-connect "${args[@]}")"

	local api_key server container_id
	api_key="$(printf '%s\n' "$out" | sed -n 's/^CONNECT_API_KEY=//p')"
	server="$(printf '%s\n' "$out" | sed -n 's/^CONNECT_SERVER=//p')"
	container_id="$(printf '%s\n' "$out" | sed -n 's/^CONTAINER_ID=//p')"

	if [ -z "$api_key" ] || [ -z "$container_id" ]; then
		echo "ERROR: with-connect did not return an API key / container id." >&2
		printf '%s\n' "$out" >&2
		exit 1
	fi

	printf '%s' "$api_key" > "$TOKEN_FILE"
	printf '%s' "$container_id" > "$CONTAINER_ID_FILE"

	echo ""
	echo "Connect is up at ${server:-$PING_URL}. Publisher key written to:"
	echo "  ${TOKEN_FILE}"
	echo ""
	echo "Run the tests with:"
	echo "  npx playwright test --project e2e-connect test/e2e/tests/connect/"
	echo ""
}

cmd_stop() {
	require_cli
	stop_running
	echo "Stopped Connect and removed the bootstrapped token (marker preserved)."
}

cmd_status() {
	# Container running?
	if [ -f "$CONTAINER_ID_FILE" ] && docker ps --no-trunc --format '{{.ID}}' | grep -q "$(cat "$CONTAINER_ID_FILE")"; then
		echo "container: running ($(cat "$CONTAINER_ID_FILE" | cut -c1-12))"
	else
		echo "container: not running"
	fi
	# Reachable?
	if curl -fsS "${PING_URL}/__ping__" >/dev/null 2>&1 || curl -fsS "$PING_URL" >/dev/null 2>&1; then
		echo "reachable: yes ($PING_URL)"
	else
		echo "reachable: no ($PING_URL)"
	fi
	# Token present?
	if [ -s "$TOKEN_FILE" ]; then
		echo "token:     present ($TOKEN_FILE)"
	else
		echo "token:     missing ($TOKEN_FILE)"
	fi
}

cmd_token() {
	if [ -s "$TOKEN_FILE" ]; then
		cat "$TOKEN_FILE"
		echo ""
	else
		echo "ERROR: no token at ${TOKEN_FILE}. Run 'npm run connect:start' first." >&2
		exit 1
	fi
}

case "${1:-}" in
	start) cmd_start ;;
	stop) cmd_stop ;;
	status) cmd_status ;;
	token) cmd_token ;;
	*)
		echo "Usage: $0 {start|stop|status|token}" >&2
		exit 1
		;;
esac
