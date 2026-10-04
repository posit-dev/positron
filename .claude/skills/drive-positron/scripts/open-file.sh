#!/usr/bin/env bash
# Opens a workspace file in an editor through Quick Open, and waits for its tab.
# Typing Cmd+P while focus is in a webview (the Viewer, a notebook output, an
# app) sends the keys to the page instead, and Enter on a fuzzy match opens the
# wrong file, so this moves focus to the workbench first and picks the row
# whose name is exactly the file's.
#
# Usage:
#   scripts/open-file.sh --session NAME app.R
#   scripts/open-file.sh --session NAME rapp/app.R      # when two files share the name
#
# Stdout: one JSON line, e.g. {"ok":true,"opened":"app.R","folder":"rapp"}
# Exit code: 0 when the file's tab is active, 1 when not, 2 on a usage error.

set -u
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SESSION=""
FILE=""
while [[ $# -gt 0 ]]; do
	case "$1" in
		--session) SESSION="$2"; shift 2 ;;
		--session=*) SESSION="${1#--session=}"; shift ;;
		-h|--help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) FILE="$1"; shift ;;
	esac
done
if [[ -z "$FILE" ]]; then
	echo '{"ok":false,"error":"give the file"}'
	exit 2
fi
pw_setup "$SESSION"
HERE="$(dirname "${BASH_SOURCE[0]}")"
page() { node "$HERE/quickpick-page.ts" "$@"; }
NAME=$(basename "$FILE")
DIR=$(dirname "$FILE"); [[ "$DIR" == "." ]] && DIR=""

pw press Escape >/dev/null 2>&1 || true
run_js "$(page blur)" >/dev/null || true
pw press "${CMD_MOD}+p" >/dev/null 2>&1
run_js "$(page fill "$FILE")" >/dev/null || { echo '{"ok":false,"error":"Quick Open did not open"}'; exit 1; }
# Exact name; the folder, when given, must be in the row's description.
CHOSEN=$(run_js "$(page choose exact "$NAME" --dry)") || { echo "$CHOSEN"; pw press Escape >/dev/null 2>&1; exit 1; }
if [[ "$(echo "$CHOSEN" | jq -r '.ok')" != "true" ]]; then
	pw press Escape >/dev/null 2>&1
	echo "$CHOSEN" | jq -c '. + {hint: "pass the file with its folder, such as rapp/app.R, when several share the name"}'
	exit 1
fi
if [[ -n "$DIR" && "$(echo "$CHOSEN" | jq -r '.description')" != *"$DIR"* ]]; then
	pw press Escape >/dev/null 2>&1
	echo "$CHOSEN" | jq -c --arg d "$DIR" '{ok: false, error: ("the matching row is in " + .description + ", not " + $d)}'
	exit 1
fi
pw press Enter >/dev/null 2>&1
for _ in 1 2 3 4 5 6 7 8 9 10; do
	# A custom editor (a .parquet or .csv viewer) may title its tab differently,
	# so also accept a tab whose title or label names the file.
	ACTIVE=$(run_js "(() => { const t = document.querySelector('.editor-group-container.active .tab.active'); const n = $(jq -Rn --arg v "$NAME" '$v');
		const label = (t?.querySelector('.label-name') || {}).textContent || '';
		const named = [label, t?.getAttribute('title') || '', t?.getAttribute('aria-label') || ''].some(x => x === n || x.includes('/' + n) || x.startsWith(n + ',') || x.includes(n));
		return JSON.stringify({ ok: true, tab: named ? n : label }); })()") || break
	[[ "$(echo "$ACTIVE" | jq -r '.tab')" == "$NAME" ]] && break
	sleep 0.3
done
log_action "open-file.sh" "$FILE"
TAB=""; [[ -n "${ACTIVE:-}" ]] && TAB=$(echo "$ACTIVE" | jq -r '.tab // ""')
echo "$CHOSEN" | jq -c --arg t "$TAB" '{ok: ($t == .chosen), opened: .chosen, folder: .description, activeTab: $t}'
