#!/usr/bin/env bash
# Prints one view as a screen reader hears it, such as Connections, Variables,
# Viewer or Help, by its heading or tab name: its accessibility tree as text (the
# same as ui.sh read, without the JSON). For the Viewer and Help, the page they
# show, from inside their frames (and the Viewer's URL).
#
# Usage:
#   scripts/view-read.sh --session NAME --view Connections
#   scripts/view-read.sh --session NAME --view Variables
#   scripts/view-read.sh --session NAME --view Viewer
#   scripts/view-read.sh --session NAME --view Help
#
# Lists and trees draw only the rows in view: scroll them, or read the rest with
# the view's own filter, before saying a row is missing.
#
# Stdout: the view's tree (Viewer: "url: <url>" then the page's tree; Help: the
# page's tree).
# Exit code: 0 when the view was found, 1 when it is not on screen, 2 on a usage error.

set -u
DIR="$(dirname "${BASH_SOURCE[0]}")"
# A usage error: the error on stderr, a FAILED line in the action log, exit 2.
ARGV=("$@")
usage_error() { exec node "$DIR/dp.ts" usage-error --text "${0##*/}" "$1" ${ARGV[@]+"${ARGV[@]}"}; }
SESSION=""
VIEW=""
BAD=""
while [[ $# -gt 0 ]]; do
	case "$1" in
		--session=*|--view=*) set -- "${1%%=*}" "${1#*=}" "${@:2}" ;;  # --flag=value is --flag value, as in the dp.ts helpers
		--session) [[ -n "${2-}" ]] || usage_error "--session needs a value; leave the flag out for \$PW_SESSION"; SESSION="$2"; shift 2 ;;
		--view) VIEW="${2-}"; shift 2 || usage_error "$1 needs a value" ;;
		-h|--help) exec node "$DIR/dp.ts" help "$0" ;;
		*) BAD="${BAD:-$1}"; shift ;;
	esac
done
[[ -z "$BAD" ]] || usage_error "unexpected argument \"$BAD\"; give the view as --view TITLE"
[[ -n "$VIEW" ]] || usage_error "give --view TITLE"
S=(); [[ -n "$SESSION" ]] && S=(--session "$SESSION")
# The read below logs its one line under this script's name.
export DRIVE_POSITRON_LOG_AS=view-read.sh
LOWER="$(echo "$VIEW" | tr '[:upper:]' '[:lower:]')"
if [[ "$LOWER" == viewer || "$LOWER" == help ]]; then
	R=$(node "$DIR/dp.ts" viewer "${S[@]}" --view "$VIEW" read)
else
	R=$(node "$DIR/dp.ts" ui "${S[@]}" read "$VIEW")
fi
if [[ "$(echo "$R" | jq -r '.ok')" != "true" ]]; then
	echo "view-read.sh: $(echo "$R" | jq -r '.error')$(echo "$R" | jq -r 'if .views then "; views on screen: " + (.views | join(", ")) else "" end')" >&2
	exit 1
fi
if [[ "$LOWER" == viewer || "$LOWER" == help ]]; then
	[[ "$LOWER" == viewer ]] && echo "url: $(echo "$R" | jq -r '.url // ""')"
	echo "$R" | jq -r '.page // .note'
else
	echo "$R" | jq -r '.tree'
fi
