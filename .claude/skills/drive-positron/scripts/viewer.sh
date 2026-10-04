#!/usr/bin/env bash
# Drives the Viewer pane's toolbar with real clicks, and shoots just the Viewer.
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
#                the toolbar buttons of those names; refuses when the button
#                is missing or disabled, and says which
#   open WHERE   the "Select where to open" menu: editor (Open in Editor Tab)
#                or browser (Open in Browser)
#   shot NAME    a screenshot of the Viewer pane only, saved and logged like
#                shot.sh
#   buttons      the toolbar's buttons and whether each is enabled
#   click NAME   click the element named NAME inside the page (a button,
#                link or text), found in a fresh snapshot of the Viewer's frames
#   fill NAME T  type T into the field named NAME inside the page
#   wait-content [SECS]
#                wait up to SECS (default 15) for the page to show anything;
#                says "blank" when it never does, which a snapshot alone cannot
#                tell from a page still loading
#
# Read the page itself with view-read.sh --view Viewer.
# Stdout: one JSON line (shot: the path). Exit code: 0 on success, 1 when the
# Viewer or the button is not there, 2 on a usage error.

set -u
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SESSION=""
ARGS=()
while [[ $# -gt 0 ]]; do
	case "$1" in
		--session) SESSION="$2"; shift 2 ;;
		--session=*) SESSION="${1#--session=}"; shift ;;
		-h|--help) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) ARGS+=("$1"); shift ;;
	esac
done
CMD="${ARGS[0]:-}"
ARG="${ARGS[1]:-}"
pw_setup "$SESSION"
HERE="$(dirname "${BASH_SOURCE[0]}")"

# The Viewer pane: the pane whose header reads Viewer.
PANE_JS="const clean = el => el ? el.textContent.replace(/\\s+/g, ' ').trim() : '';
	const pane = [...document.querySelectorAll('.pane')].filter(p => p.offsetParent !== null)
		.find(p => clean(p.querySelector('.pane-header .title')).toLowerCase() === 'viewer');
	document.querySelectorAll('[data-dp-target]').forEach(e => e.removeAttribute('data-dp-target'));"

mark_button() {
	run_js "(() => { $PANE_JS
		if (!pane) { return JSON.stringify({ ok: false, error: 'the Viewer is not on screen' }); }
		const want = $(jq -Rn --arg v "$1" '$v');
		const buttons = [...pane.querySelectorAll('[aria-label]')].filter(b => b.offsetParent !== null);
		// A split button has an action half and a drop-down half of the same label; a menu wants the drop-down.
		const all = buttons.filter(x => new RegExp(want, 'i').test(x.getAttribute('aria-label')));
		const b = all.find(x => x.getAttribute('aria-haspopup')) && /where to open/i.test(want) ? all.find(x => x.getAttribute('aria-haspopup')) : all[0];
		if (!b) { return JSON.stringify({ ok: false, error: 'no button matching ' + want, buttons: buttons.map(x => x.getAttribute('aria-label')) }); }
		if (b.disabled || b.getAttribute('aria-disabled') === 'true' || /disabled/.test(b.className)) { return JSON.stringify({ ok: false, error: b.getAttribute('aria-label') + ' is disabled' }); }
		b.setAttribute('data-dp-target', '1');
		return JSON.stringify({ ok: true, button: b.getAttribute('aria-label') });
	})()"
}

press_button() {
	local m
	m=$(mark_button "$1") || { echo "$m"; exit 1; }
	[[ "$(echo "$m" | jq -r '.ok')" == "true" ]] || { echo "$m"; exit 1; }
	pw click '[data-dp-target="1"]' >/dev/null 2>&1
	run_js "(() => { document.querySelectorAll('[data-dp-target]').forEach(e => e.removeAttribute('data-dp-target')); return '{}'; })()" >/dev/null
	log_action "viewer.sh" "$(echo "$m" | jq -r '.button')"
	echo "$m"
}

case "$CMD" in
	reload) press_button '^Reload' ;;
	back) press_button 'previous URL' ;;
	forward) press_button 'next URL' ;;
	clear) press_button '^Clear' ;;
	interrupt) press_button '^Interrupt' ;;
	open)
		case "$ARG" in
			editor) ITEM='Open in Editor Tab' ;;
			browser) ITEM='Open in Browser' ;;
			*) echo '{"ok":false,"error":"open editor or open browser"}'; exit 2 ;;
		esac
		press_button '^Select where to open' >/dev/null || exit 1
		CHOSE=$(run_js "$(node "$HERE/tree-page.ts" menu-mark "$ITEM")") || { echo "$CHOSE"; pw press Escape >/dev/null 2>&1; exit 1; }
		[[ "$(echo "$CHOSE" | jq -r '.ok')" == "true" ]] || { pw press Escape >/dev/null 2>&1; echo "$CHOSE"; exit 1; }
		pw click '[data-dp-target="1"]' >/dev/null 2>&1
		log_action "viewer.sh" "$ITEM"
		echo "$CHOSE" | jq -c '{ok: true, item}' ;;
	shot)
		[[ -n "$ARG" ]] || { echo '{"ok":false,"error":"shot needs a file name"}'; exit 2; }
		M=$(run_js "(() => { $PANE_JS
			if (!pane) { return JSON.stringify({ ok: false, error: 'the Viewer is not on screen' }); }
			pane.setAttribute('data-dp-target', '1');
			return JSON.stringify({ ok: true }); })()") || { echo "$M"; exit 1; }
		[[ "$(echo "$M" | jq -r '.ok')" == "true" ]] || { echo "$M"; exit 1; }
		"$HERE/shot.sh" ${PW_SESSION_NAME:+--session "$PW_SESSION_NAME"} "$ARG" '[data-dp-target="1"]'
		RC=$?
		run_js "(() => { document.querySelectorAll('[data-dp-target]').forEach(e => e.removeAttribute('data-dp-target')); return '{}'; })()" >/dev/null
		exit $RC ;;
	buttons)
		run_js "(() => { $PANE_JS
			if (!pane) { return JSON.stringify({ ok: false, error: 'the Viewer is not on screen' }); }
			return JSON.stringify({ ok: true, buttons: [...pane.querySelectorAll('[aria-label]')].filter(b => b.offsetParent !== null)
				.map(b => ({ label: b.getAttribute('aria-label'), enabled: !(b.disabled || b.getAttribute('aria-disabled') === 'true' || /disabled/.test(b.className)) })) });
		})()" ;;
	click|fill)
		[[ -n "$ARG" ]] || { echo '{"ok":false,"error":"give the element name"}'; exit 2; }
		# Frame refs change after every reload, so take them from a fresh snapshot.
		SNAP=$(pw snapshot 2>/dev/null | grep -E '\[ref=f[0-9]+e')
		REF=$(printf '%s\n' "$SNAP" | NAME="$ARG" awk 'index($0, "\"" ENVIRON["NAME"] "\"") || $0 ~ (": " ENVIRON["NAME"] "$") { match($0, /ref=f[0-9]+e[0-9]+/); print substr($0, RSTART + 4, RLENGTH - 4) }' | head -1)
		if [[ -z "$REF" ]]; then
			printf '%s\n' "$SNAP" | head -30 | jq -Rsc --arg n "$ARG" '{ok: false, error: ("nothing named " + $n + " in the Viewer page"), page: (split("\n") | map(select(length > 0) | sub(" \\[ref=[^]]+\\]"; "")))}'
			exit 1
		fi
		if [[ "$CMD" == click ]]; then pw click "$REF" >/dev/null 2>&1; else pw fill "$REF" "${ARGS[2]:-}" >/dev/null 2>&1; fi
		log_action "viewer.sh" "$CMD \"$ARG\" in the Viewer page"
		jq -cn --arg c "$CMD" --arg n "$ARG" --arg r "$REF" '{ok: true, action: $c, element: $n, ref: $r}' ;;
	wait-content)
		END=$(( $(date +%s) + ${ARG:-15} ))
		while (( $(date +%s) <= END )); do
			# Anything in the frames beyond the frame and document nodes themselves.
			N=$(pw snapshot 2>/dev/null | grep -E '\[ref=f[0-9]+e' | grep -vcE '^\s*- (iframe|document)( \[|:)')
			(( N > 0 )) && { jq -cn --argjson n "$N" '{ok: true, content: true, nodes: $n}'; exit 0; }
			sleep 1
		done
		jq -cn --arg s "${ARG:-15}" '{ok: false, content: false, error: ("the Viewer page is blank after " + $s + " s")}'
		exit 1 ;;
	*) echo '{"ok":false,"error":"command: reload, back, forward, clear, interrupt, open, shot, buttons, click, fill or wait-content"}'; exit 2 ;;
esac
