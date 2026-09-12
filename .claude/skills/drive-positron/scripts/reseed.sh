#!/usr/bin/env bash
# Turns the profile of a disposable Positron instance into a seed directory, so
# the next launch starts warm instead of cold.
#
# A fresh disposable profile only ever exercises the cold-start path. Anything
# that depends on state written during the previous run -- the runtime discovery
# cache, the recently opened list, storage-backed migrations -- is untested by a
# single launch, and a bug that only appears on the second launch is invisible.
#
# The instance has to be stopped before the copy: the profile state lives in a
# SQLite database (`User/globalStorage/state.vscdb`) that the running app holds
# open, and a copy taken while it is writing can be torn. Stopping without
# deleting the run directory is what `stop.sh` does when `--run-dir` is omitted,
# which is the one thing that makes this workflow possible.
#
# Usage:
#   scripts/reseed.sh --run-dir "$RUN_DIR" --seed /tmp/positron-seed --cdp-port "$CDP_PORT"
#   scripts/reseed.sh --run-dir "$RUN_DIR" --seed /tmp/positron-seed --keep-running
#   scripts/reseed.sh --run-dir "$RUN_DIR" --seed /tmp/positron-seed --list-keys
#
#   --run-dir       the `runDir` the launcher reported
#   --seed          seed directory to create or overwrite
#   --cdp-port      stop this instance first, without deleting its run directory
#   --keep-running  copy without stopping; only safe when the app has already exited
#   --include PATH  copy an extra profile-relative path (repeatable)
#   --list-keys     print the storage keys in the seeded database (needs sqlite3)
#
# Copies, relative to the profile root, when present:
#   User/globalStorage/state.vscdb (plus -wal and -shm)
#   User/globalStorage/storage.json
#   User/settings.json
#   User/keybindings.json
#
# Workspace storage is deliberately not copied: it is per-workspace, the
# launcher excludes it from its own seeding, and carrying it forward would make
# the next run depend on a workspace path that may not be the one under test.
#
# Stdout: the launch command to run next.
# Exit code: 0 on success, 1 when the copy could not be made, 2 on usage error.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RUN_DIR=""
SEED=""
CDP_PORT=""
KEEP_RUNNING=0
LIST_KEYS=0
EXTRA=()

while [[ $# -gt 0 ]]; do
	case "$1" in
		--run-dir) RUN_DIR="$2"; shift 2 ;;
		--seed) SEED="$2"; shift 2 ;;
		--cdp-port) CDP_PORT="$2"; shift 2 ;;
		--keep-running) KEEP_RUNNING=1; shift ;;
		--include) EXTRA+=("$2"); shift 2 ;;
		--list-keys) LIST_KEYS=1; shift ;;
		-h|--help)
			sed -n '2,42p' "$0" | sed 's/^# \{0,1\}//'
			exit 0 ;;
		*) echo "reseed.sh: unknown arg $1" >&2; exit 2 ;;
	esac
done

if [[ -z "$RUN_DIR" || -z "$SEED" ]]; then
	echo "Usage: reseed.sh --run-dir <dir> --seed <dir> [--cdp-port <port>] [--keep-running]" >&2
	exit 2
fi

PROFILE="$RUN_DIR/user-data"
if [[ ! -d "$PROFILE" ]]; then
	echo "reseed.sh: no profile at $PROFILE; is --run-dir the runDir the launcher reported?" >&2
	exit 1
fi

if [[ -n "$CDP_PORT" && "$KEEP_RUNNING" != "1" ]]; then
	# No --run-dir here on purpose: that argument is what makes stop.sh delete
	# the directory we are about to read.
	echo "[reseed.sh] stopping the instance on CDP port $CDP_PORT, keeping $RUN_DIR" >&2
	"$SCRIPT_DIR/stop.sh" --cdp-port "$CDP_PORT"
elif [[ "$KEEP_RUNNING" != "1" ]]; then
	echo "reseed.sh: pass --cdp-port to stop the instance, or --keep-running if it has already exited" >&2
	exit 2
fi

# A live CDP port means the app is still writing to the database.
if [[ -n "$CDP_PORT" ]] && curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:$CDP_PORT/json/version" 2>/dev/null; then
	echo "reseed.sh: CDP port $CDP_PORT still answers; the profile is in use and the copy would be unreliable" >&2
	exit 1
fi

PATHS=(
	'User/globalStorage/state.vscdb'
	'User/globalStorage/state.vscdb-wal'
	'User/globalStorage/state.vscdb-shm'
	'User/globalStorage/storage.json'
	'User/settings.json'
	'User/keybindings.json'
)
PATHS+=(${EXTRA[@]+"${EXTRA[@]}"})

rm -rf "$SEED"
COPIED=0
for rel in "${PATHS[@]}"; do
	src="$PROFILE/$rel"
	[[ -e "$src" ]] || continue
	mkdir -p "$SEED/$(dirname "$rel")"
	cp -R "$src" "$SEED/$rel"
	echo "[reseed.sh] $rel" >&2
	COPIED=$((COPIED + 1))
done

if (( COPIED == 0 )); then
	echo "reseed.sh: nothing to copy from $PROFILE" >&2
	exit 1
fi

if [[ "$LIST_KEYS" == "1" ]]; then
	if command -v sqlite3 >/dev/null 2>&1 && [[ -f "$SEED/User/globalStorage/state.vscdb" ]]; then
		echo "[reseed.sh] storage keys and value sizes:" >&2
		sqlite3 "$SEED/User/globalStorage/state.vscdb" \
			'SELECT key, length(value) FROM ItemTable ORDER BY key;' >&2 || true
	else
		echo "[reseed.sh] --list-keys needs sqlite3 on PATH and a copied state.vscdb" >&2
	fi
fi

echo "[reseed.sh] seeded $COPIED path(s) into $SEED" >&2
cat <<EOF
.claude/skills/drive-positron/scripts/launch.sh \\
	--source-user-data-dir $SEED -- \\
	--log debug
EOF
