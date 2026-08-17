#!/usr/bin/env bash
# Starts Positron Web for browser automation, waits for an HTTP response, and
# prints one JSON line containing the connection details.
#
# `npm run e2e-start-server` returns when the port binds, before cold-start
# downloads and extension installation finish. Polling the URL provides the
# readiness guarantee that callers need.
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

# Keep this path short: the server creates Unix sockets beneath the user-data
# directory, and macOS limits socket paths to 104 bytes.
if [[ -z "$USER_DATA_DIR" ]]; then
	USER_DATA_DIR="/tmp/positron-web/$(date +%Y%m%d-%H%M%S)-$$"
fi
mkdir -p "$USER_DATA_DIR"

# Positron Web requires a signed license. Check for an explicit key or the local
# issuer before starting so a missing license fails immediately.
#
# scripts/code-server.js automatically mints a key when it finds the issuer at:
#   <repo-parent>/positron-license/pdol/target/debug/pdol
# For a nested worktree, symlink positron-license beside the worktrees directory.
#   ln -s ~/posit/positron-license <worktrees-parent>/positron-license
ISSUER="$(cd "$REPO/.." && pwd)/positron-license/pdol/target/debug/pdol"
if [[ ! -x "$ISSUER" && -z "$LICENSE_KEY" && -z "$LICENSE_KEY_FILE" ]]; then
	echo "[start-web] No license key and no license issuer at:" >&2
	echo "              $ISSUER" >&2
	echo "            Either symlink a positron-license checkout there, or pass" >&2
	echo "            --license-key / --license-key-file (or set POSITRON_LICENSE_KEY)." >&2
	echo "            Posit-internal; CI uses the POSITRON_LICENSE secret." >&2
	exit 2
fi
if [[ -x "$ISSUER" ]]; then
	echo "[start-web] license issuer found; code-server.js will mint a key" >&2
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
# Omit e2e-start-server.sh flags that code-server reports as unsupported.
if [[ -n "$LICENSE_KEY" ]]; then
	ARGS+=(--license-key "$LICENSE_KEY")
elif [[ -n "$LICENSE_KEY_FILE" ]]; then
	ARGS+=(--license-key-file "$LICENSE_KEY_FILE")
fi
if [[ -n "$WORKSPACE" ]]; then
	# Resolve symlinks because Positron silently ignores a workspace path that does
	# not match its canonical path, such as /tmp instead of /private/tmp on macOS.
	ARGS+=(--default-folder "$(cd "$WORKSPACE" && pwd -P)")
fi

# Integrated terminals may inherit ELECTRON_RUN_AS_NODE, which breaks the
# launcher.
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
	# Poll the URL because the port may bind before the server can respond.
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
