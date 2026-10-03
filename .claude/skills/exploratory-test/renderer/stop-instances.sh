#!/usr/bin/env bash
# ---------------------------------------------------------------------------------------------
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

# Stops every instance a run launched that is still up, after the explorer
# returns. Each launch.sh line is in <run dir>/instances.jsonl. An instance is
# stopped only when its port answers and the process on it has the recorded
# --user-data-dir, so a port reused by another app is left alone. Run
# directories are kept: stop.sh deletes nothing without --run-dir.
#
# Usage:
#   stop-instances.sh <run dir>

set -euo pipefail

if [[ $# -ne 1 ]]; then
	echo "usage: stop-instances.sh <run dir>" >&2
	exit 2
fi
LIST="$1/instances.jsonl"
STOP="${STOP_SH:-$(dirname "$0")/../../drive-positron/scripts/stop.sh}"
[[ -f "$LIST" ]] || exit 0

case "$(uname -s)" in
	MINGW*|MSYS*|CYGWIN*) IS_WINDOWS=1 ;;
	*) IS_WINDOWS=0 ;;
esac

status=0
while read -r port udd; do
	curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:$port/json/version" 2>/dev/null || continue
	if [[ "$IS_WINDOWS" == "1" ]]; then
		echo "port $port still answers; stop it with stop.sh --cdp-port $port" >&2
		status=1
		continue
	fi
	if ! ps -axww -o command= | grep -F -- "--remote-debugging-port=$port" | grep -qF -- "--user-data-dir=$udd"; then
		echo "port $port answers but is not this run's instance; left running" >&2
		continue
	fi
	if bash "$STOP" --cdp-port "$port"; then
		echo "stopped $port"
	else
		status=1
	fi
done < <(node -e '
	for (const line of require("fs").readFileSync(process.argv[1], "utf8").split("\n")) {
		try { const i = JSON.parse(line); if (i.cdpPort) { console.log(i.cdpPort, i.userDataDir); } } catch {}
	}
' "$LIST")
exit $status
