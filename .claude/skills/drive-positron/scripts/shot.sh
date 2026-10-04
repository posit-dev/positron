#!/usr/bin/env bash
# Takes a screenshot and logs it. A raw `playwright-cli screenshot` writes the
# file but no line in the run's action log, and a cited shot the log never took
# fails lint, so take every shot through this.
#
# Usage:
#   scripts/shot.sh --session NAME S03-01.png
#   scripts/shot.sh --session NAME S03-02.png '.positron-variables'
#
#   NAME.png    the file; a bare name goes in $DRIVE_POSITRON_SHOTS (the run's
#               shots/ folder) when that is set, else the current directory
#   SELECTOR    optional: shoot only that element; it must match exactly
#               one visible element, or be a snapshot ref (e153)
#
# Flags:
#   --session NAME  the @playwright/cli session attached to the instance (or $PW_SESSION)
#
# Stdout: the path written. Exit code: 0 when the file was written, 1 when not.

set -u
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SESSION=""
FILE=""
TARGET=""
while [[ $# -gt 0 ]]; do
	case "$1" in
		--session) SESSION="$2"; shift 2 ;;
		--session=*) SESSION="${1#--session=}"; shift ;;
		-h|--help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) if [[ -z "$FILE" ]]; then FILE="$1"; else TARGET="$1"; fi; shift ;;
	esac
done
if [[ -z "$FILE" ]]; then
	echo "shot.sh: give the file name" >&2
	exit 2
fi
pw_setup "$SESSION"
[[ "$FILE" == */* ]] || FILE="${DRIVE_POSITRON_SHOTS:-.}/$FILE"
mkdir -p "$(dirname "$FILE")"
rm -f "$FILE"
# An element shot needs exactly one visible match: with two (a selector list,
# or a class used twice) Playwright writes nothing and says nothing.
if [[ -n "$TARGET" && ! "$TARGET" =~ ^(f[0-9]+)?e[0-9]+$ ]]; then
	N=$(run_js "(() => { try { return JSON.stringify({ ok: true, n: [...document.querySelectorAll($(jq -Rn --arg v "$TARGET" '$v'))].filter(e => e.offsetParent !== null || e.getClientRects().length).length }); } catch (e) { return JSON.stringify({ ok: true, n: -1 }); } })()" | jq -r '.n')
	if [[ "$N" != "1" ]]; then
		case "$N" in
			-1) echo "shot.sh: $TARGET is not a CSS selector the page accepts" >&2 ;;
			0) echo "shot.sh: $TARGET matches nothing visible" >&2 ;;
			*) echo "shot.sh: $TARGET matches $N visible elements; narrow it to one" >&2 ;;
		esac
		exit 1
	fi
fi
pw screenshot ${TARGET:+"$TARGET"} --filename="$FILE" >/dev/null 2>&1
if [[ ! -s "$FILE" ]]; then
	echo "shot.sh: no screenshot written to $FILE" >&2
	exit 1
fi
log_action "shot.sh" "screenshot $(basename "$FILE")${TARGET:+ of $TARGET}"
echo "$FILE"
