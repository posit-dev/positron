#!/usr/bin/env bash
# Launches Positron from source in an isolated profile for UI automation.
#
# This is a maintained fork of .agents/skills/launch/scripts/launch.sh. Compare
# it with the upstream script when that file changes; fixes are not inherited
# automatically.
#
# Positron-specific behavior:
#   1. Uses a short run directory to keep macOS IPC socket paths below 104 bytes.
#   2. Seeds the profile from $POSITRON_DEV_USER_DATA_DIR or ~/.positron-dev.
#   3. Provides an isolated shared-data directory and unique debug ports.
#   4. Rechecks process liveness after CDP starts, catching late startup crashes.
#   5. Runs on Windows (Git Bash) as well as macOS and Linux: falls back to tar
#      where rsync is absent, and converts paths for the native Electron binary.
#
# Prints connection details as JSON on stdout and diagnostics on stderr.
#
# Usage:
#   launch.sh [--agents] [--source-user-data-dir <path>] [--repo <vscode-repo-root>]
#             [--clone-extensions] [--full] [-- <extra code.sh args>]
#
# Flags:
#   --clone-extensions  Copy the source extensions/ into the new profile (~10s).
#                       Default: start with an EMPTY extensions/ dir - fastest
#                       and conflict-free, but no third-party extensions.
#   --full              Copy the entire profile (incl. extensions). Use if the
#                       slim copy is missing something you need.
#
# Defaults:
#   --source-user-data-dir  $POSITRON_DEV_USER_DATA_DIR (else ~/.positron-dev)
#   --repo                  $PWD if it looks like a Positron checkout

set -euo pipefail
umask 077

# Platform and tool detection. Git Bash on Windows (MSYS) ships neither rsync
# nor pgrep, and Electron there cannot read MSYS-style paths such as /tmp/x.
case "$(uname -s)" in
	MINGW*|MSYS*|CYGWIN*) IS_WINDOWS=1 ;;
	*) IS_WINDOWS=0 ;;
esac
if command -v rsync >/dev/null 2>&1; then
	HAVE_RSYNC=1
else
	HAVE_RSYNC=0
fi

# Convert a path for the Electron binary. On Windows the app is a native
# executable that cannot read MSYS paths, and MSYS argument translation does not
# reliably rewrite them inside --flag=value pairs. Elsewhere this is a no-op.
to_native_path() {
	if [[ "$IS_WINDOWS" == "1" ]]; then
		cygpath -m "$1"
	else
		printf '%s\n' "$1"
	fi
}

# Copy a directory tree, honoring rsync-style exclude patterns.
#
# Prefers rsync where it exists so the established macOS and Linux behavior is
# unchanged, and falls back to a streaming tar pipe on Windows. The tar path
# skips excluded directories rather than copying and then deleting them, which
# matters because the caches being excluded can run to gigabytes.
#
# Exclude patterns use rsync semantics: a leading slash anchors the pattern at
# the transfer root, anything else matches at any depth. GNU tar's default
# non-anchored matching produces the same result once a leading slash has been
# rewritten to './'.
copy_tree() {
	local src="$1" dst="$2"
	shift 2
	mkdir -p "$dst"

	local excl=()
	local pattern
	if [[ "$HAVE_RSYNC" == "1" ]]; then
		for pattern in "$@"; do
			excl+=("--exclude=$pattern")
		done
		rsync -a "${excl[@]}" "$src/" "$dst/"
		return
	fi

	for pattern in "$@"; do
		if [[ "$pattern" == /* ]]; then
			excl+=("--exclude=.$pattern")
		else
			excl+=("--exclude=$pattern")
		fi
	done
	( cd "$src" && tar -cf - "${excl[@]}" . ) | ( cd "$dst" && tar -xf - )
}

AGENTS=0
SOURCE_UDD="${POSITRON_DEV_USER_DATA_DIR:-$HOME/.positron-dev}"
REPO=""
EXTRA_ARGS=()
CLONE_EXTENSIONS=0
FULL=0

while [[ $# -gt 0 ]]; do
	case "$1" in
		--agents) AGENTS=1; shift ;;
		--source-user-data-dir) SOURCE_UDD="$2"; shift 2 ;;
		--repo) REPO="$2"; shift 2 ;;
		--clone-extensions|--copy-extensions) CLONE_EXTENSIONS=1; shift ;;
		--full) FULL=1; shift ;;
		--) shift; EXTRA_ARGS=("$@"); break ;;
		*) echo "Unknown arg: $1" >&2; exit 2 ;;
	esac
done

if [[ -z "$REPO" ]]; then
	if [[ -x "$PWD/scripts/code.sh" ]]; then
		REPO="$PWD"
	else
		echo "Could not find a Positron checkout in $PWD. Pass --repo <path>." >&2
		exit 2
	fi
fi

if [[ ! -d "$SOURCE_UDD" ]]; then
	echo "Source user-data-dir does not exist: $SOURCE_UDD" >&2
	echo "Pass --source-user-data-dir <path> or set POSITRON_DEV_USER_DATA_DIR." >&2
	exit 2
fi

pick_port() {
	node -e '
		const net = require("net");
		const s = net.createServer();
		s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => console.log(p)); });
	'
}

CDP_PORT=$(pick_port)
EXTHOST_PORT=$(pick_port)
MAIN_PORT=$(pick_port)
AGENTHOST_PORT=$(pick_port)

STAMP=$(date +%Y%m%d-%H%M%S)-$$
# Keep the run directory short enough for the main-process Unix socket. Windows
# uses named pipes instead, so the length limit does not apply there.
RUN_DIR="${POSITRON_LAUNCH_TMP:-/tmp}/positron-dev-launch/$STAMP"
DEST_UDD="$RUN_DIR/user-data"
SHARED_DATA_DIR="$RUN_DIR/shared-data"
mkdir -p "$DEST_UDD" "$SHARED_DATA_DIR"

# Use a deny-list so newly introduced profile data is copied by default.
# Leading-slash patterns match only at the profile root.
EXCLUDES=(
	'/extensions'                                       # handled separately below
	'/workspaceStorage' 'User/workspaceStorage'         # per-workspace state, incl. chat sessions
	'User/History'                                      # local file edit history
	'/CachedExtensionVSIXs'                             # backup VSIXs
	'/logs'
	'/Cache' '/Code Cache' '/CachedData' '/component_crx_cache'
	'/GPUCache' '/ShaderCache' '/Dawn*Cache'
	'/Backups' '/blob_storage' '/BrowserMetrics' '/Crashpad'
	'/Session Storage'
	'/Singleton*'
	'*.lock' '*.sock'
)

COPY_TOOL=$([[ "$HAVE_RSYNC" == "1" ]] && echo rsync || echo tar)
if [[ "$FULL" == "1" ]]; then
	echo "[launch.sh] full copy ($COPY_TOOL): $SOURCE_UDD -> $DEST_UDD" >&2
	copy_tree "$SOURCE_UDD" "$DEST_UDD"
else
	echo "[launch.sh] slim copy ($COPY_TOOL): $SOURCE_UDD -> $DEST_UDD" >&2
	copy_tree "$SOURCE_UDD" "$DEST_UDD" "${EXCLUDES[@]}"
fi

# Prepare extensions according to the selected profile-copy mode.
EXT_DIR="$DEST_UDD/extensions"
mkdir -p "$EXT_DIR"
if [[ "$FULL" != "1" && "$CLONE_EXTENSIONS" == "1" ]]; then
	echo "[launch.sh] copying extensions: $SOURCE_UDD/extensions -> $EXT_DIR" >&2
	copy_tree "$SOURCE_UDD/extensions" "$EXT_DIR"
fi

# Force the quick-input file dialog because CDP cannot control native dialogs.
# This modifies only the disposable profile.
SETTINGS_FILE="$DEST_UDD/User/settings.json"
mkdir -p "$(dirname "$SETTINGS_FILE")"
# Update files.simpleDialog.enable without parsing and rewriting the entire JSONC
# document, preserving comments and strings that contain `//`.
if ! node - "$SETTINGS_FILE" <<'NODE'
const fs = require('fs');
const f = process.argv[2];
const KEY = 'files.simpleDialog.enable';

let text;
try { text = fs.readFileSync(f, 'utf8'); }
catch (e) {
	if (e.code === 'ENOENT') text = '';
	else { console.error('[launch.sh] cannot read ' + f + ': ' + e.message); process.exit(1); }
}

// Write a new object when the file is empty.
if (text.trim() === '') {
	fs.writeFileSync(f, '{\n  "' + KEY + '": true\n}\n');
	process.exit(0);
}

// Update only the existing key's value.
const keyValueRe = new RegExp('("' + KEY.replace(/\./g, '\\.') + '"\\s*:\\s*)(true|false|null|"[^"\\n]*"|-?\\d+(?:\\.\\d+)?)', 'g');
if (keyValueRe.test(text)) {
	const updated = text.replace(keyValueRe, '$1true');
	fs.writeFileSync(f, updated);
	process.exit(0);
}

// Otherwise, insert the key before the final closing brace. Avoid parsing JSONC
// so comments and formatting remain intact.
const lastBrace = text.lastIndexOf('}');
if (lastBrace === -1) {
	console.error('[launch.sh] settings.json has no closing brace — refusing to clobber it: ' + f);
	process.exit(1);
}

// Add a comma only when the object already contains non-comment content.
const firstBrace = text.indexOf('{');
if (firstBrace === -1 || firstBrace >= lastBrace) {
	console.error('[launch.sh] settings.json has no opening brace — refusing to clobber it: ' + f);
	process.exit(1);
}
const between = text.slice(firstBrace + 1, lastBrace)
	.replace(/\/\*[\s\S]*?\*\//g, '')
	.replace(/\/\/[^\n]*/g, '')
	.trim();
const insertion = between.length === 0
	? '\n  "' + KEY + '": true\n'
	: ',\n  "' + KEY + '": true\n';

fs.writeFileSync(f, text.slice(0, lastBrace) + insertion + text.slice(lastBrace));
NODE
then
	echo "[launch.sh] failed to ensure files.simpleDialog.enable=true in $SETTINGS_FILE — automation may need to fall back to per-key input" >&2
	exit 1
fi
echo "[launch.sh] ensured files.simpleDialog.enable=true in $SETTINGS_FILE" >&2

# Integrated terminals may inherit ELECTRON_RUN_AS_NODE, which breaks code.sh.
unset ELECTRON_RUN_AS_NODE

CODE_SH="$REPO/scripts/code.sh"
if [[ ! -x "$CODE_SH" ]]; then
	echo "Could not find an executable Code OSS launcher at $CODE_SH. Pass --repo <vscode-repo-root>." >&2
	exit 2
fi

ARGS=(
	"--user-data-dir=$(to_native_path "$DEST_UDD")"
	"--extensions-dir=$(to_native_path "$EXT_DIR")"
	"--shared-data-dir=$(to_native_path "$SHARED_DATA_DIR")"
	"--remote-debugging-port=$CDP_PORT"
	"--inspect-extensions=$EXTHOST_PORT"
	"--inspect=$MAIN_PORT"
	"--inspect-agenthost=$AGENTHOST_PORT"
)
if [[ "$AGENTS" == "1" ]]; then
	ARGS=("--agents" "${ARGS[@]}")
fi
if (( ${#EXTRA_ARGS[@]} )); then
	ARGS+=("${EXTRA_ARGS[@]}")
fi

LOG_FILE="$RUN_DIR/code.log"
echo "[launch.sh] launching: $CODE_SH ${ARGS[*]}" >&2
echo "[launch.sh] logs: $LOG_FILE" >&2

# Run pre-launch synchronously so download or compilation errors are visible
# before code.sh starts.
#
# Pre-launch is the one step that writes outside the disposable profile. It can
# delete and re-download $REPO/.build/builtInExtensions/<name> and
# $REPO/.build/electron, and it compiles into $REPO/out when that directory is
# absent. An interrupted run can leave a built-in extension half-written, which
# breaks the normal development build until it is re-downloaded. See SKILL.md.
echo "[launch.sh] running pre-launch (ensures electron + compiled output + built-ins)..." >&2
echo "[launch.sh] WARNING: pre-launch writes to the shared .build/ and out/ directories in $REPO." >&2
echo "[launch.sh] WARNING: interrupting it can leave a built-in extension half-written; repair with 'npm run download-builtin-extensions'." >&2
if ! ( cd "$REPO" && node build/lib/preLaunch.ts ) >>"$LOG_FILE" 2>&1; then
	echo "[launch.sh] pre-launch FAILED. Log tail:" >&2
	tail -n 80 "$LOG_FILE" >&2
	exit 1
fi

# Detach code.sh after pre-launch. Once CDP responds, Electron has established
# its independent process tree.
nohup env VSCODE_SKIP_PRELAUNCH=1 "$CODE_SH" "${ARGS[@]}" \
	</dev/null >>"$LOG_FILE" 2>&1 &
PID=$!
disown $PID 2>/dev/null || true

# Wait until CDP responds, reporting an early exit or timeout with the log tail.
echo "[launch.sh] waiting for CDP on port $CDP_PORT (timeout 90s)..." >&2
READY=0
for i in $(seq 1 90); do
	if ! kill -0 "$PID" 2>/dev/null; then
		echo "[launch.sh] code.sh (PID $PID) exited before CDP came up. Log tail:" >&2
		tail -n 80 "$LOG_FILE" >&2
		exit 1
	fi
	if curl -sf -o /dev/null --max-time 1 "http://127.0.0.1:$CDP_PORT/json/version" 2>/dev/null; then
		READY=1
		echo "[launch.sh] CDP ready after ${i}s" >&2
		break
	fi
	sleep 1
done
if [[ "$READY" != "1" ]]; then
	echo "[launch.sh] timed out waiting for CDP on port $CDP_PORT. Log tail:" >&2
	tail -n 80 "$LOG_FILE" >&2
	exit 1
fi

# CDP can become available immediately before a main-process socket failure.
# Recheck liveness after a short delay before reporting success.
sleep 2
if ! kill -0 "$PID" 2>/dev/null; then
	echo "[launch.sh] app exited immediately after CDP came up. Log tail:" >&2
	tail -n 80 "$LOG_FILE" >&2
	exit 1
fi

node -e '
	console.log(JSON.stringify({
		pid: '"$PID"',
		cdpPort: '"$CDP_PORT"',
		extHostPort: '"$EXTHOST_PORT"',
		mainPort: '"$MAIN_PORT"',
		agentHostPort: '"$AGENTHOST_PORT"',
		userDataDir: process.argv[1],
		extensionsDir: process.argv[2],
		sharedDataDir: process.argv[3],
		runDir: process.argv[4],
		logFile: process.argv[5],
		repo: process.argv[6],
		agents: '"$AGENTS"' === 1,
	}));
' "$DEST_UDD" "$EXT_DIR" "$SHARED_DATA_DIR" "$RUN_DIR" "$LOG_FILE" "$REPO"
