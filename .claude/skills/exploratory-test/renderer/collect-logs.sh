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
# The instance must have been launched with --log debug; without it code.log
# has no logsPath: line and this exits non-zero.

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
if [[ -z "$T" || ! -d "$T" ]]; then
	echo "collect-logs: no logsPath: in $LOG_FILE; relaunch with --log debug" >&2
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

# "<Language> <version> Console.log", named by language unless two share one.
# The ${a[@]+...} guards keep bash 3.2 under set -u from failing on an empty array.
shopt -s nullglob
consoles=("$T"/window1/exthost/positron.positron-supervisor/*" Console.log")
for f in ${consoles[@]+"${consoles[@]}"}; do
	base=$(basename "$f" " Console.log")
	lang=$(echo "${base%% *}" | tr '[:upper:]' '[:lower:]')
	n=0
	for g in ${consoles[@]+"${consoles[@]}"}; do
		[[ "$(basename "$g" | cut -d' ' -f1 | tr '[:upper:]' '[:lower:]')" == "$lang" ]] && n=$((n + 1))
	done
	if [[ $n -gt 1 ]]; then
		version=$(echo "${base#* }" | tr ' ' '-')
		copy "$f" "$PORT-$lang-$version-console.log"
	else
		copy "$f" "$PORT-$lang-console.log"
	fi
done

for name in ${copied[@]+"${copied[@]}"}; do
	errors=$(grep -ci '\[error\]' "$L/$name" || true)
	echo "logs/$name | $errors [error] lines"
done
echo "logs/all/$PORT/ | full tree"
