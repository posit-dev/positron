#!/usr/bin/env bash
# Start Positron Web (code-server) for browser automation and block until it is
# actually serving, then print a single JSON line with the URL and paths.
#
# Why this exists: `npm run e2e-start-server` binds the port long before it can
# serve. On a cold checkout it first downloads electron, downloads the server
# node binary (gulp node), and installs the built-in marketplace extensions -
# several minutes during which curl gets a connection but no response. Polling
# the port is therefore not a readiness check; this polls the URL.
#
# Usage:
#   start-web.sh [--port N] [--token T] [--repo PATH] [--workspace PATH]
#                [--user-data-dir PATH] [--timeout SECONDS]
#
# Defaults: --port 8080  --token dev-token  --repo $PWD  --timeout 600

set -euo pipefail

PORT=8080
TOKEN=dev-token
REPO=""
WORKSPACE=""
USER_DATA_DIR=""
LICENSE_KEY="${POSITRON_LICENSE_KEY:-}"
LICENSE_KEY_FILE="${POSITRON_LICENSE_KEY_FILE:-}"
TIMEOUT=600

while [[ $# -gt 0 ]]; do
	case "$1" in
		--port) PORT="$2"; shift 2 ;;
		--token) TOKEN="$2"; shift 2 ;;
		--repo) REPO="$2"; shift 2 ;;
		--workspace) WORKSPACE="$2"; shift 2 ;;
		--user-data-dir) USER_DATA_DIR="$2"; shift 2 ;;
		--license-key) LICENSE_KEY="$2"; shift 2 ;;
		--license-key-file) LICENSE_KEY_FILE="$2"; shift 2 ;;
		--timeout) TIMEOUT="$2"; shift 2 ;;
		*) echo "Unknown arg: $1" >&2; exit 2 ;;
	esac
done

if [[ -z "$REPO" ]]; then
	if [[ -x "$PWD/scripts/code-server.sh" ]]; then
		REPO="$PWD"
	else
		echo "Could not find a Positron checkout in $PWD. Pass --repo <path>." >&2
		exit 2
	fi
fi

# Keep this SHORT. The server opens unix sockets underneath the user-data-dir and
# macOS caps sun_path at 104 bytes; a long $TMPDIR path is what breaks the
# Electron launcher the same way (see the positron-launch skill).
if [[ -z "$USER_DATA_DIR" ]]; then
	USER_DATA_DIR="/tmp/positron-web/$(date +%Y%m%d-%H%M%S)-$$"
fi
mkdir -p "$USER_DATA_DIR"

# Positron Web refuses to serve without a signed license token, and there is no
# dev bypass (see src/vs/server/node/remoteLicenseKey.ts). CI supplies it from
# the POSITRON_LICENSE secret. Without one the server exits during startup with
# only a log line, so check up front rather than waiting out the timeout.
if [[ -z "${LICENSE_KEY:-}" && -z "${LICENSE_KEY_FILE:-}" \
	&& -z "${POSITRON_LICENSE_KEY:-}" && -z "${POSITRON_LICENSE_KEY_FILE:-}" ]]; then
	echo "[start-web] No license key. Positron Web needs a signed license token:" >&2
	echo "            --license-key <key> | --license-key-file <path>, or" >&2
	echo "            POSITRON_LICENSE_KEY / POSITRON_LICENSE_KEY_FILE in the env." >&2
	echo "            Posit-internal; the CI value lives in the POSITRON_LICENSE secret." >&2
	exit 2
fi

LOG_FILE="$USER_DATA_DIR/server.log"
URL="http://localhost:$PORT/?tkn=$TOKEN"

if lsof -ti ":$PORT" >/dev/null 2>&1; then
	echo "[start-web] port $PORT is already in use. Pass --port or stop the other server." >&2
	exit 2
fi

echo "[start-web] repo:          $REPO" >&2
echo "[start-web] user-data-dir: $USER_DATA_DIR" >&2
echo "[start-web] log:           $LOG_FILE" >&2
echo "[start-web] url:           $URL" >&2

ARGS=(
	--no-launch
	--host 127.0.0.1
	--connection-token "$TOKEN"
	--port "$PORT"
	--user-data-dir "$USER_DATA_DIR"
	--disable-telemetry
	--disable-experiments
	--disable-workspace-trust
	--accept-server-license-terms
)
# e2e-start-server.sh passes --skip-welcome, --skip-release-notes, --no-cached-data,
# --disable-updates and --use-inmemory-secretstorage; the server logs
# "Ignoring option ...: not supported for server" for each, so they are omitted here.
if [[ -n "$LICENSE_KEY" ]]; then
	ARGS+=(--license-key "$LICENSE_KEY")
elif [[ -n "$LICENSE_KEY_FILE" ]]; then
	ARGS+=(--license-key-file "$LICENSE_KEY_FILE")
fi
if [[ -n "$WORKSPACE" ]]; then
	# Resolve symlinks: on macOS /tmp is a symlink to /private/tmp, and the
	# folder is silently ignored if the path doesn't resolve.
	ARGS+=(--default-folder "$(cd "$WORKSPACE" && pwd -P)")
fi

# ELECTRON_RUN_AS_NODE is commonly inherited from an integrated terminal and
# breaks the launcher scripts.
unset ELECTRON_RUN_AS_NODE

nohup "$REPO/scripts/code-server.sh" "${ARGS[@]}" </dev/null >>"$LOG_FILE" 2>&1 &
PID=$!
disown "$PID" 2>/dev/null || true

echo "[start-web] waiting for the server to serve (timeout ${TIMEOUT}s; a cold checkout downloads electron + node + built-in extensions)..." >&2
READY=0
for (( i = 0; i < TIMEOUT; i += 3 )); do
	if ! kill -0 "$PID" 2>/dev/null; then
		echo "[start-web] server exited before it served. Log tail:" >&2
		tail -n 40 "$LOG_FILE" >&2
		exit 1
	fi
	# Poll the URL, not the port: the port binds minutes before it responds.
	if curl -sf -o /dev/null --max-time 2 "$URL" 2>/dev/null; then
		READY=1
		echo "[start-web] serving after ${i}s" >&2
		break
	fi
	sleep 3
done
if [[ "$READY" != "1" ]]; then
	echo "[start-web] timed out after ${TIMEOUT}s. Log tail:" >&2
	tail -n 40 "$LOG_FILE" >&2
	exit 1
fi

node -e '
	console.log(JSON.stringify({
		pid: '"$PID"',
		port: '"$PORT"',
		url: process.argv[1],
		token: process.argv[2],
		userDataDir: process.argv[3],
		logFile: process.argv[4],
		repo: process.argv[5],
	}));
' "$URL" "$TOKEN" "$USER_DATA_DIR" "$LOG_FILE" "$REPO"
