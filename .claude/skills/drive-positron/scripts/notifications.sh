#!/usr/bin/env bash
# Lists the notifications on screen, with their buttons, and clicks one. A
# prompt often arrives as a toast ("The runtime is busy... interrupt it and
# restart?") that a screenshot misses and a click elsewhere hides, so after an
# action that might ask something, run this before deciding it did nothing.
#
# Usage:
#   scripts/notifications.sh --session NAME
#   scripts/notifications.sh --session NAME --click 'Restart' --match 'runtime is busy'
#   scripts/notifications.sh --session NAME --clear
#
# Flags:
#   --session NAME  the @playwright/cli session attached to the instance (or $PW_SESSION)
#   --click TEXT    click the button with this exact label
#   --match TEXT    with --click, only on a notification whose message holds TEXT;
#                   needed when several notifications have that button
#   --clear         close every notification toast
#
# Reads toasts and, when it is open, the notification center (View: Toggle
# Notifications). Hidden toasts stay in the center, so open it with
# palette-run.sh 'Notifications: Show Notifications' to read older ones.
#
# Stdout: one JSON line, e.g.
#   {"ok":true,"notifications":[{"severity":"info","message":"...","source":"...","buttons":["Yes","No"]}]}
# Exit code: 0 on success, 1 when --click found no such button, 2 on a usage error.
#
# Required tools on PATH: jq.

set -u
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SESSION=""
CLICK=""
MATCH=""
CLEAR=0
while [[ $# -gt 0 ]]; do
	case "$1" in
		--session) SESSION="$2"; shift 2 ;;
		--session=*) SESSION="${1#--session=}"; shift ;;
		--click) CLICK="$2"; shift 2 ;;
		--match) MATCH="$2"; shift 2 ;;
		--clear) CLEAR=1; shift ;;
		-h|--help) sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) echo "notifications.sh: unknown arg $1" >&2; exit 2 ;;
	esac
done
pw_setup "$SESSION"

JS="(async () => {
	const CLICK = $(jq -Rn --arg v "$CLICK" '$v');
	const MATCH = $(jq -Rn --arg v "$MATCH" '$v');
	const CLEAR = $CLEAR === 1;
	const clean = el => el ? el.textContent.replace(/\\s+/g, ' ').trim() : '';
	const items = [...document.querySelectorAll('.notification-toast .monaco-list-row, .notifications-center .monaco-list-row')]
		.filter(r => r.offsetParent !== null);
	const read = r => {
		const icon = r.querySelector('.notification-list-item-icon');
		const severity = icon ? (['error', 'warning', 'info'].find(s => icon.className.includes(s)) || '') : '';
		return {
			severity,
			message: clean(r.querySelector('.notification-list-item-message')),
			source: clean(r.querySelector('.notification-list-item-source')),
			buttons: [...r.querySelectorAll('.notification-list-item-buttons-container .monaco-button')].map(b => clean(b)).filter(Boolean),
			inCenter: !!r.closest('.notifications-center'),
		};
	};
	const list = items.map(read);
	if (CLICK) {
		const row = items.find(r => { const n = read(r); return n.buttons.includes(CLICK) && (!MATCH || n.message.includes(MATCH)); });
		const candidates = items.filter(r => read(r).buttons.includes(CLICK) && (!MATCH || read(r).message.includes(MATCH)));
		if (candidates.length > 1) { return JSON.stringify({ ok: false, error: candidates.length + ' notifications have a \"' + CLICK + '\" button; pass --match', notifications: list }); }
		if (!row) { return JSON.stringify({ ok: false, error: 'no notification has a \"' + CLICK + '\" button', notifications: list }); }
		const button = [...row.querySelectorAll('.notification-list-item-buttons-container .monaco-button')].find(b => clean(b) === CLICK);
		button.click();
		await new Promise(r => setTimeout(r, 200));
		return JSON.stringify({ ok: true, clicked: CLICK, message: read(row).message, notifications: [...document.querySelectorAll('.notification-toast .monaco-list-row')].filter(r => r.offsetParent !== null).map(read) });
	}
	if (CLEAR) {
		for (const t of document.querySelectorAll('.notification-toast .codicon-notifications-clear')) { (t.closest('a,.action-label') || t).click(); }
		await new Promise(r => setTimeout(r, 200));
	}
	return JSON.stringify({ ok: true, notifications: list });
})()"
RESULT=$(run_js "$JS") || { echo "$RESULT"; exit 1; }
if [[ -n "$CLICK" && "$(echo "$RESULT" | jq -r '.ok')" == "true" ]]; then
	log_action "notifications.sh" "clicked \"$CLICK\" on \"$(echo "$RESULT" | jq -r '.message' | cut -c1-80)\""
fi
[[ "$CLEAR" == 1 ]] && log_action "notifications.sh" "cleared toasts"
echo "$RESULT"
[[ "$(echo "$RESULT" | jq -r '.ok')" == "true" ]]
