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
if "$CLI" -s="$SESSION" console > "$L/$PORT-console.log"; then
	copied+=("$PORT-console.log")
else
	echo "collect-logs: playwright-cli console failed for session $SESSION" >&2
fi

# "<Language> <version> Console.log" and "<Language> Kernel.log", the kernel's
# own log (Ark's or ipykernel's) streamed from a temp folder the run never
# sees otherwise; named by language unless two share one.
# The ${a[@]+...} guards keep bash 3.2 under set -u from failing on an empty array.
shopt -s nullglob
for kind in Console Kernel; do
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
	echo "logs/$name | $errors [error] lines"
done
echo "logs/all/$PORT/ | full tree"
