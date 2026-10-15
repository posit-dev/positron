#!/usr/bin/env bash
# ---------------------------------------------------------------------------------------------
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

# Copies one instance's logs into a run's logs/ folder before stop.sh deletes
# them, and prints each copy with its error count for the ledger's ## Logs.
#
# Usage (from the checkout, where launch.sh printed <logFile> and <cdpPort>):
#   collect-logs.sh <logFile> <cdpPort> <playwright-cli session> <run dir>
#
# The logs are found from code.log's logsPath: line (with --log debug), or in
# <run dir>/logs, where launch.sh puts them.
#
# Run it before closing the window or stopping the instance: the browser
# console (<port>-console.log, the renderer's messages) and each interpreter
# console's text (<port>-<language>-console.log) are read from the live window
# through the session and exist nowhere on disk. Once the window is closed or
# the app stopped, only the log files are copied, and it says so.

set -euo pipefail

if [[ $# -ne 4 ]]; then
	echo "usage: collect-logs.sh <logFile> <cdpPort> <session> <run dir>" >&2
	exit 2
fi
LOG_FILE="$1"
PORT="$2"
SESSION="$3"
L="$4/logs"
CLI="${PLAYWRIGHT_CLI:-./node_modules/.bin/playwright-cli}"

T=$(sed -n "s/^ *logsPath: '\(.*\)'.*/\1/p" "$LOG_FILE" | tail -1)
# launch.sh passes --logsPath=<run dir>/logs, beside code.log, so that folder
# holds them even without --log debug.
if [[ -z "$T" || ! -d "$T" ]] && [[ -d "$(dirname "$LOG_FILE")/logs/window1" ]]; then
	T="$(dirname "$LOG_FILE")/logs"
fi
if [[ -z "$T" || ! -d "$T" ]]; then
	echo "collect-logs: no logsPath: in $LOG_FILE and no logs/ beside it; relaunch with --log debug" >&2
	exit 1
fi

mkdir -p "$L/all"
rm -rf "$L/all/$PORT"
cp -R "$T" "$L/all/$PORT"
copied=()
copy() {
	if [[ -f "$1" ]]; then
		cp "$1" "$L/$2"
		copied+=("$2")
	fi
}
copy "$T/window1/renderer.log" "$PORT-renderer.log"
copy "$T/window1/exthost/exthost.log" "$PORT-exthost.log"
copy "$LOG_FILE" "$PORT-code.log"
if "$CLI" -s="$SESSION" console > "$L/$PORT-console.log" 2> "$L/.console.err"; then
	copied+=("$PORT-console.log")
else
	rm -f "$L/$PORT-console.log"
	if ! curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/json/version" 2>/dev/null; then
		echo "collect-logs: the instance on CDP port $PORT is not running, so its browser console cannot be read: it lives only in a running window. Collect logs before closing the window or stopping the instance. The log files on disk were copied." >&2
	else
		echo "collect-logs: playwright-cli console failed for session $SESSION ($(head -1 "$L/.console.err")): the window it drove may be closed (shot.sh --list), and a closed window's browser console is gone. The log files on disk were copied." >&2
	fi
fi
rm -f "$L/.console.err"

# What each interpreter's console printed, read from the live window (the app
# writes no file of it): <port>-<language>-console.log, with the session id
# added when two consoles share a language. Tracebacks are expanded first.
# drive-positron is this script's sibling in a checkout, but not in CI's
# sparse harness copy, so fall back to the checkout it runs from.
DP="$(dirname "${BASH_SOURCE[0]}")/../../drive-positron/scripts"
[[ -f "$DP/panel.sh" ]] || DP="$PWD/.claude/skills/drive-positron/scripts"
if [[ ! -f "$DP/panel.sh" ]]; then
	echo "collect-logs: no drive-positron/scripts beside this script or under $PWD/.claude/skills, so no <language>-console.log was saved: run it from the checkout" >&2
elif SESSIONS=$(DRIVE_POSITRON_QUIET_READS=1 bash "$DP/panel.sh" --session "$SESSION" sessions 2>/dev/null); then
	while IFS=$'\t' read -r id lang; do
		[[ -z "$id" ]] && continue
		n=$(echo "$SESSIONS" | jq --arg l "$lang" '[.sessions[] | select(.language == $l)] | length')
		name="$PORT-$lang-console.log"
		[[ "$n" -gt 1 ]] && name="$PORT-$lang-${id#*-}-console.log"
		if DRIVE_POSITRON_QUIET_READS=1 bash "$DP/console-read.sh" --session "$SESSION" --name "$id" --expand --tail 0 > "$L/$name" 2>/dev/null; then
			copied+=("$name")
		else
			rm -f "$L/$name"
			echo "collect-logs: could not read the console of $id; its text is not saved" >&2
		fi
	done < <(echo "$SESSIONS" | jq -r '.sessions[] | [.id, .language] | @tsv')
else
	echo "collect-logs: could not list the console sessions through session $SESSION (the window may be closed), so no <language>-console.log was saved: they are read from the live window" >&2
fi

# "<Language> Kernel.log": the kernel's own log (Ark's or ipykernel's), which
# the supervisor streams into this file. The "Streaming kernel log file" path
# it names is a temp file that can be empty or gone; this is the copy to read.
# Named by language unless two share one.
# The ${a[@]+...} guards keep bash 3.2 under set -u from failing on an empty array.
shopt -s nullglob
for kind in Kernel; do
	files=("$T"/window1/exthost/positron.positron-supervisor/*" $kind.log")
	suffix=$(echo "$kind" | tr '[:upper:]' '[:lower:]')
	for f in ${files[@]+"${files[@]}"}; do
		base=$(basename "$f" " $kind.log")
		lang=$(echo "${base%% *}" | tr '[:upper:]' '[:lower:]')
		n=0
		for g in ${files[@]+"${files[@]}"}; do
			[[ "$(basename "$g" | cut -d' ' -f1 | tr '[:upper:]' '[:lower:]')" == "$lang" ]] && n=$((n + 1))
		done
		if [[ $n -gt 1 && "$base" == *" "* ]]; then
			version=$(echo "${base#* }" | tr ' ' '-')
			copy "$f" "$PORT-$lang-$version-$suffix.log"
		else
			copy "$f" "$PORT-$lang-$suffix.log"
		fi
	done
done

for name in ${copied[@]+"${copied[@]}"}; do
	errors=$(grep -ci '\[error\]' "$L/$name" || true)
	# A kernel log has its own levels: Ark's ERROR and WARN, Python's tracebacks.
	if [[ "$name" == *-kernel.log ]]; then
		errors=$(grep -cE 'ERROR|Traceback' "$L/$name" || true)
		warns=$(grep -c 'WARN' "$L/$name" || true)
		echo "logs/$name | $errors error, $warns WARN lines"
		continue
	fi
	# A console's text: an error there is a traceback or R's "Error".
	if [[ "$name" == *-*-console.log ]]; then
		errors=$(grep -cE '^Error|Traceback|Error:' "$L/$name" || true)
		echo "logs/$name | $(wc -l < "$L/$name" | tr -d ' ') lines, $errors error lines"
		continue
	fi
	echo "logs/$name | $errors [error] lines"
done
echo "logs/all/$PORT/ | full tree"
