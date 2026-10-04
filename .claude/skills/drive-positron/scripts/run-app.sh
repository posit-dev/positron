#!/usr/bin/env bash
# Clicks the active editor's Run App button, whatever the extension calls it
# ("Run Shiny App", "Run Flask App in Terminal", "Run Streamlit App in
# Terminal"), and fails loudly when the editor has none.
#
# Usage:
#   scripts/run-app.sh --session NAME
#   scripts/run-app.sh --session NAME --label 'Run Shiny App'
#   scripts/run-app.sh --session NAME --list
#
# Flags:
#   --session NAME  the @playwright/cli session attached to the instance (or $PW_SESSION)
#   --label TEXT    click the button with exactly this label; needed only when
#                   the editor has several run buttons
#   --list          print the editor's run buttons and click nothing
#
# Open the app file first (open-file.sh). The app's own progress, such as
# "Found app URL", is in the App Launcher output channel; a prompt such as
# "The runtime is busy..." arrives as a toast: check notifications.sh after.
#
# Stdout: one JSON line, e.g. {"ok":true,"clicked":"Run Shiny App","buttons":["Run Shiny App"]}
# Exit code: 0 when a button was clicked, 1 when none matched, 2 on a usage error.

set -u
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SESSION=""
LABEL=""
LIST=0
while [[ $# -gt 0 ]]; do
	case "$1" in
		--session) SESSION="$2"; shift 2 ;;
		--session=*) SESSION="${1#--session=}"; shift ;;
		--label) LABEL="$2"; shift 2 ;;
		--list) LIST=1; shift ;;
		-h|--help) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) echo "run-app.sh: unknown arg $1" >&2; exit 2 ;;
	esac
done
pw_setup "$SESSION"

JS="(async () => {
	const LABEL = $(jq -Rn --arg v "$LABEL" '$v');
	const LIST = $LIST === 1;
	const group = document.querySelector('.editor-group-container.active') || document;
	// Positron's editor action bar sits in the group's title, beside the upstream one.
	const buttons = [...group.querySelectorAll('.title [aria-label], .editor-actions .action-label')]
		.filter(b => b.offsetParent !== null)
		.map(b => ({ el: b, label: b.getAttribute('aria-label') || b.getAttribute('title') || '' }))
		.filter(b => /^Run\\b/i.test(b.label) && !/drop-down/.test(b.el.className));
	const labels = buttons.map(b => b.label);
	if (LIST) { return JSON.stringify({ ok: true, buttons: labels }); }
	const apps = LABEL ? buttons.filter(b => b.label === LABEL) : buttons.filter(b => /\\bApp\\b/.test(b.label));
	if (apps.length !== 1) {
		return JSON.stringify({ ok: false, error: apps.length ? apps.length + ' run buttons match; pass --label' : 'the active editor has no Run App button', buttons: labels });
	}
	apps[0].el.click();
	await new Promise(r => setTimeout(r, 300));
	return JSON.stringify({ ok: true, clicked: apps[0].label, buttons: labels });
})()"
RESULT=$(run_js "$JS") || { echo "$RESULT"; exit 1; }
if [[ "$(echo "$RESULT" | jq -r '.ok')" == "true" && "$LIST" == 0 ]]; then
	log_action "run-app.sh" "$(echo "$RESULT" | jq -r '.clicked')"
fi
echo "$RESULT"
[[ "$(echo "$RESULT" | jq -r '.ok')" == "true" ]]
