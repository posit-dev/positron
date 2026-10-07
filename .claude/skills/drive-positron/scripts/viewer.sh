#!/usr/bin/env bash
# Drives the Viewer: its toolbar by accessible name, and the web page it shows,
# whose nested frames it finds and drives by role and name. Shoots just the Viewer.
#
# Usage:
#   scripts/viewer.sh --session NAME reload
#   scripts/viewer.sh --session NAME back | forward | clear | interrupt
#   scripts/viewer.sh --session NAME open editor | browser
#   scripts/viewer.sh --session NAME shot S04-02.png
#   scripts/viewer.sh --session NAME buttons
#
# Commands:
#   reload       reload the page (URL or HTML content)
#   back, forward, clear, interrupt
#                the toolbar buttons of those names (clear, like reload,
#                works on a URL and on HTML content, whose toolbars name it
#                differently); refuses when the button is missing or
#                disabled, and says which
#   open WHERE   the "Select where to open" menu: editor (Open in Editor Tab)
#                or browser (Open in Browser)
#   shot NAME    a screenshot of the Viewer pane only, saved and logged like
#                shot.sh
#   buttons      the toolbar's buttons and whether each is enabled
#   click NAME   click the element named NAME inside the page (a button,
#                link, checkbox, tab, or else its exact text), and report how
#                the page changed
#   fill NAME T  type T into the field named NAME (or labelled, or with that
#                placeholder) inside the page
#   wait-content [SECS]
#                wait up to SECS (default 15) for the page to show anything;
#                says "blank" when it never does, which a snapshot alone cannot
#                tell from a page still loading
#
#   read         the URL and the page's accessibility tree
#
# view-read.sh --view Viewer prints the same as text.
# Stdout: one JSON line (shot: the path). Exit code: 0 on success, 1 when the
# Viewer or the button is not there, 2 on a usage error.

set -u
DIR="$(dirname "${BASH_SOURCE[0]}")"
SESSION=""
ARGS=()
while [[ $# -gt 0 ]]; do
	case "$1" in
		--session) SESSION="${2-}"; shift 2 || { echo "${0##*/}: $1 needs a value" >&2; exit 2; }; [[ -n "$SESSION" ]] || { echo "${0##*/}: --session needs the session name" >&2; exit 2; } ;;
		--session=*) SESSION="${1#--session=}"; [[ -n "$SESSION" ]] || { echo "${0##*/}: --session needs the session name" >&2; exit 2; }; shift ;;
		-h|--help) exec node "$DIR/dp.ts" help "$0" ;;
		*) ARGS+=("$1"); shift ;;
	esac
done
S=(); [[ -n "$SESSION" ]] && S=(--session "$SESSION")
if [[ "${ARGS[0]:-}" == open ]]; then
	eval "$(node "$DIR/selectors.ts" names)"
	case "${ARGS[1]:-}" in
		editor) ITEM="$viewer_openInEditor" ;;
		browser) ITEM="$viewer_openInBrowser" ;;
		*) echo '{"ok":false,"error":"open editor or open browser"}'; exit 2 ;;
	esac
	exec bash "$DIR/ui.sh" "${S[@]}" choose button "$viewer_openMenu" "$ITEM" --in "$views_viewer"
fi
# Implemented in dp-viewer.ts.
exec node "$DIR/dp.ts" viewer "${S[@]}" ${ARGS[@]+"${ARGS[@]}"}
