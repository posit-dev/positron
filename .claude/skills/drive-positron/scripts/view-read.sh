#!/usr/bin/env bash
# Prints one view as a screen reader hears it, such as Connections, Variables
# or Viewer, by its heading or tab name: its accessibility tree as text (the same
# as ui.sh read, without the JSON). For the Viewer, the URL and the page it
# shows, from inside its frames.
#
# Usage:
#   scripts/view-read.sh --session NAME --view Connections
#   scripts/view-read.sh --session NAME --view Variables
#   scripts/view-read.sh --session NAME --view Viewer
#
# Lists and trees draw only the rows in view: scroll them, or read the rest with
# the view's own filter, before saying a row is missing.
#
# Stdout: the view's tree (Viewer: "url: <url>" then the page's tree).
# Exit code: 0 when the view was found, 1 when it is not on screen, 2 on a usage error.

set -u
DIR="$(dirname "${BASH_SOURCE[0]}")"
SESSION=""
VIEW=""
ARGS=()
BAD=""
while [[ $# -gt 0 ]]; do
	case "$1" in
		--session) SESSION="$2"; shift 2 ;;
		--session=*) SESSION="${1#--session=}"; shift ;;
		--view) VIEW="$2"; ARGS+=("$1" "$2"); shift 2 ;;
		-h|--help) exec node "$DIR/dp.ts" help "$0" ;;
		*) BAD="${BAD:-$1}"; ARGS+=("$1"); shift ;;
	esac
done
# A usage error is a failure like any other: one line in the action log.
usage_error() {
	echo "view-read.sh: $1" >&2
	node "$DIR/dp.ts" fail view-read.sh "$SESSION" "$1" ${ARGS[@]+"${ARGS[@]}"} >/dev/null
	exit 2
}
[[ -z "$BAD" ]] || usage_error "unexpected argument \"$BAD\"; give the view as --view TITLE"
[[ -n "$VIEW" ]] || usage_error "give --view TITLE"
S=(); [[ -n "$SESSION" ]] && S=(--session "$SESSION")
# The read below logs its one line under this script's name.
export DRIVE_POSITRON_LOG_AS=view-read.sh
if [[ "$(echo "$VIEW" | tr '[:upper:]' '[:lower:]')" == viewer ]]; then
	R=$(node "$DIR/dp.ts" viewer "${S[@]}" read)
else
	R=$(node "$DIR/dp.ts" ui "${S[@]}" read "$VIEW")
fi
if [[ "$(echo "$R" | jq -r '.ok')" != "true" ]]; then
	echo "view-read.sh: $(echo "$R" | jq -r '.error')$(echo "$R" | jq -r 'if .views then "; views on screen: " + (.views | join(", ")) else "" end')" >&2
	exit 1
fi
if [[ "$(echo "$VIEW" | tr '[:upper:]' '[:lower:]')" == viewer ]]; then
	echo "url: $(echo "$R" | jq -r '.url // ""')"
	echo "$R" | jq -r '.page // .note'
else
	echo "$R" | jq -r '.tree'
fi
