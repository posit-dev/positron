#!/usr/bin/env bash
# Stops a disposable Positron instance started by launch.sh and optionally
# removes its run directory.
#
# `kill $PID` is not sufficient on every platform. On Windows the PID that
# launch.sh reports belongs to the MSYS shell that exec'd the native Electron
# binary; killing it leaves the application running and holding several
# gigabytes. Locating the process that owns the CDP port works everywhere, so
# this script does that instead of trusting the reported PID.
#
# Usage:
#   stop.sh --cdp-port <port> [--run-dir <dir>] [--timeout <seconds>]
#
# Exits non-zero when the instance is still reachable after the timeout, or when
# --run-dir does not look like a launch.sh run directory.

set -euo pipefail

CDP_PORT=""
RUN_DIR=""
TIMEOUT=15

while [[ $# -gt 0 ]]; do
	case "$1" in
		--cdp-port) CDP_PORT="$2"; shift 2 ;;
		--run-dir) RUN_DIR="$2"; shift 2 ;;
		--timeout) TIMEOUT="$2"; shift 2 ;;
		*) echo "Unknown arg: $1" >&2; exit 2 ;;
	esac
done

if [[ -z "$CDP_PORT" ]]; then
	echo "Usage: stop.sh --cdp-port <port> [--run-dir <dir>] [--timeout <seconds>]" >&2
	exit 2
fi

case "$(uname -s)" in
	MINGW*|MSYS*|CYGWIN*) IS_WINDOWS=1 ;;
	*) IS_WINDOWS=0 ;;
esac

cdp_alive() {
	curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:$CDP_PORT/json/version" 2>/dev/null
}

# Report every PID listening on the CDP port. netstat is the only listener query
# available in a bare Git Bash; lsof covers macOS and Linux.
listener_pids() {
	if [[ "$IS_WINDOWS" == "1" ]]; then
		netstat -ano \
			| awk -v port=":$CDP_PORT" '$1 == "TCP" && $2 ~ (port "$") && $4 == "LISTENING" { print $5 }' \
			| sort -u
	else
		lsof -ti "tcp:$CDP_PORT" -sTCP:LISTEN 2>/dev/null | sort -u
	fi
}

# Kill a process and its children. Electron spawns a tree, and orphaned renderer
# or utility processes keep holding memory.
kill_tree() {
	local pid="$1"
	if [[ "$IS_WINDOWS" == "1" ]]; then
		# Double slashes keep MSYS from rewriting the flags as paths.
		taskkill //F //T //PID "$pid" >/dev/null 2>&1 || true
	else
		pkill -TERM -P "$pid" 2>/dev/null || true
		kill -TERM "$pid" 2>/dev/null || true
	fi
}

if ! cdp_alive; then
	echo "[stop.sh] nothing listening on CDP port $CDP_PORT" >&2
else
	PIDS=$(listener_pids || true)
	if [[ -z "$PIDS" ]]; then
		echo "[stop.sh] CDP port $CDP_PORT answers but no listening PID was found." >&2
		echo "[stop.sh] Stop the instance by hand before reusing the port." >&2
		exit 1
	fi
	echo "[stop.sh] stopping PID(s) on CDP port $CDP_PORT: $(echo "$PIDS" | tr '\n' ' ')" >&2
	for pid in $PIDS; do
		kill_tree "$pid"
	done

	for _ in $(seq 1 "$TIMEOUT"); do
		if ! cdp_alive; then
			break
		fi
		sleep 1
	done

	if cdp_alive; then
		echo "[stop.sh] CDP port $CDP_PORT is still answering after ${TIMEOUT}s." >&2
		exit 1
	fi
	echo "[stop.sh] instance stopped" >&2
fi

# Remove the run directory only when it looks like one launch.sh generated. The
# path may be POSIX or Windows form, and the glob matches either.
if [[ -n "$RUN_DIR" ]]; then
	case "$RUN_DIR" in
		*/positron-dev-launch/*)
			rm -rf -- "${RUN_DIR:?}"
			echo "[stop.sh] removed run directory $RUN_DIR" >&2
			;;
		*)
			echo "[stop.sh] refusing to remove unexpected run directory: $RUN_DIR" >&2
			exit 1
			;;
	esac
fi
