#!/usr/bin/env bash
# The workbench chrome around the views: panel tabs, terminals, console
# sessions and editor tabs. Clicks are real, and each command says what it did
# or why it could not.
#
# Usage:
#   scripts/panel.sh --session NAME tab Terminal          # also Console, Output, Problems, Ports
#   scripts/panel.sh --session NAME terminals
#   scripts/panel.sh --session NAME terminal 2
#   scripts/panel.sh --session NAME delete-session 'R 4.5.1'
#   scripts/panel.sh --session NAME editors
#   scripts/panel.sh --session NAME layout
#   scripts/panel.sh --session NAME resize secondary 600
#
# Commands:
#   tab NAME             show the panel tab whose label starts with NAME
#   terminals            the terminals in the panel's terminal list, in order,
#                        and which is active
#   terminal N           make the Nth terminal in that list active
#   delete-session WORDS delete the console session whose tab names WORDS,
#                        through the tab's context menu; a busy session may ask
#                        first (notifications.sh)
#   editors              every editor tab, group by group: title, active, modified
#   layout               each workbench part's size in pixels, or hidden:
#                        sidebar, secondary (where Plots and Variables are),
#                        panel, editor
#   resize PART PX       drag the edge of sidebar, secondary or panel until it
#                        is PX wide (panel: PX tall), as a person drags the
#                        sash; a pane too narrow hides things (the Plots
#                        filmstrip), and a part has a minimum size
#
# Stdout: one JSON line. Exit code: 0 on success, 1 when the tab, terminal or
# session is not there, 2 on a usage error.

set -u
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SESSION=""
ARGS=()
while [[ $# -gt 0 ]]; do
	case "$1" in
		--session) SESSION="$2"; shift 2 ;;
		--session=*) SESSION="${1#--session=}"; shift ;;
		-h|--help) sed -n '2,33p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) ARGS+=("$1"); shift ;;
	esac
done
CMD="${ARGS[0]:-}"
ARG="${ARGS[1]:-}"
pw_setup "$SESSION"
CLEAN="const clean = el => el ? el.textContent.replace(/\\s+/g, ' ').trim() : '';
	document.querySelectorAll('[data-dp-target],[data-dp-hover]').forEach(e => { e.removeAttribute('data-dp-target'); e.removeAttribute('data-dp-hover'); });"
click_marked() {
	pw click '[data-dp-target="1"]' >/dev/null 2>&1
	run_js "(() => { document.querySelectorAll('[data-dp-target],[data-dp-hover]').forEach(e => { e.removeAttribute('data-dp-target'); e.removeAttribute('data-dp-hover'); }); return '{}'; })()" >/dev/null
}
want() { jq -Rn --arg v "$1" '$v'; }
LAYOUT_JS="(() => {
	const r = s => { const e = document.querySelector(s); if (!e || !e.getClientRects().length || getComputedStyle(e).display === 'none') { return 'hidden'; }
		const b = e.getBoundingClientRect(); return { left: Math.round(b.left), top: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height) }; };
	return JSON.stringify({ ok: true, window: { width: innerWidth, height: innerHeight }, sidebar: r('.part.sidebar'), secondary: r('.part.auxiliarybar'), panel: r('.part.panel'), editor: r('.part.editor') });
})()"

case "$CMD" in
	tab)
		[[ -n "$ARG" ]] || { echo '{"ok":false,"error":"give the panel tab name"}'; exit 2; }
		M=$(run_js "(() => { $CLEAN
			const w = $(want "$ARG").toLowerCase();
			const tabs = [...document.querySelectorAll('.part.panel .composite-bar .action-item a, .part.panel .composite-bar .action-item .action-label')].filter(t => t.offsetParent !== null);
			const t = tabs.find(x => (x.getAttribute('aria-label') || clean(x)).toLowerCase().startsWith(w));
			if (!t) { return JSON.stringify({ ok: false, error: 'no panel tab named ' + w, tabs: tabs.map(x => x.getAttribute('aria-label') || clean(x)) }); }
			t.setAttribute('data-dp-target', '1');
			return JSON.stringify({ ok: true, tab: t.getAttribute('aria-label') || clean(t) }); })()") || { echo "$M"; exit 1; }
		[[ "$(echo "$M" | jq -r '.ok')" == "true" ]] || { echo "$M"; exit 1; }
		click_marked
		log_action "panel.sh" "panel tab $(echo "$M" | jq -r '.tab')"
		echo "$M" ;;
	terminals|terminal)
		M=$(run_js "(() => { $CLEAN
			const entries = [...document.querySelectorAll('.terminal-tabs-entry')].filter(e => e.offsetParent !== null);
			const list = entries.map((e, i) => ({ n: i + 1, name: clean(e.querySelector('.label-name')) || clean(e), active: e.closest('.monaco-list-row')?.classList.contains('selected') || false }));
			if ('$CMD' === 'terminals') { return JSON.stringify({ ok: true, terminals: list, note: entries.length ? undefined : 'no terminal list: with one terminal the panel shows no list' }); }
			const e = entries[Number($(want "$ARG")) - 1];
			if (!e) { return JSON.stringify({ ok: false, error: 'no terminal ' + $(want "$ARG"), terminals: list }); }
			e.setAttribute('data-dp-target', '1');
			return JSON.stringify({ ok: true, terminal: list[Number($(want "$ARG")) - 1] }); })()") || { echo "$M"; exit 1; }
		[[ "$(echo "$M" | jq -r '.ok')" == "true" ]] || { echo "$M"; exit 1; }
		if [[ "$CMD" == terminal ]]; then click_marked; log_action "panel.sh" "terminal $ARG"; fi
		echo "$M" ;;
	delete-session)
		[[ -n "$ARG" ]] || { echo '{"ok":false,"error":"give words of the session name"}'; exit 2; }
		M=$(run_js "(() => { $CLEAN
			const w = $(want "$ARG");
			const tabs = [...document.querySelectorAll('[data-testid^=\"console-tab-\"]')].filter(t => (t.getAttribute('aria-label') || '').includes(w));
			if (tabs.length !== 1) { return JSON.stringify({ ok: false, error: tabs.length ? tabs.length + ' sessions match' : 'no console session named like ' + w, sessions: [...document.querySelectorAll('[data-testid^=\"console-tab-\"]')].map(t => t.getAttribute('aria-label')) }); }
			tabs[0].setAttribute('data-dp-hover', '1');
			return JSON.stringify({ ok: true, session: tabs[0].getAttribute('aria-label') }); })()") || { echo "$M"; exit 1; }
		[[ "$(echo "$M" | jq -r '.ok')" == "true" ]] || { echo "$M"; exit 1; }
		# The tab's trash button hides when the tab list is narrow (under 110 px),
		# so use the tab's context menu, which has Delete at any width.
		run_js "(() => { const t = document.querySelector('[data-dp-hover=\"1\"]'); t.removeAttribute('data-dp-hover'); t.setAttribute('data-dp-target', '1'); return '{}'; })()" >/dev/null
		pw click '[data-dp-target="1"]' right >/dev/null 2>&1
		B=$(run_js "$(node "$(dirname "${BASH_SOURCE[0]}")/tree-page.ts" menu-mark Delete)") || { echo "$B"; pw press Escape >/dev/null 2>&1; exit 1; }
		[[ "$(echo "$B" | jq -r '.ok')" == "true" ]] || { pw press Escape >/dev/null 2>&1; echo "$B"; exit 1; }
		click_marked
		log_action "panel.sh" "delete session $(echo "$M" | jq -r '.session')"
		# A busy session asks first; report the question rather than a deletion.
		sleep 1
		NAME_NOW=$(echo "$M" | jq -r '.session')
		GONE=$(run_js "(() => JSON.stringify({ gone: ![...document.querySelectorAll('[data-testid^=\"console-tab-\"]')].some(t => t.getAttribute('aria-label') === $(want "$NAME_NOW")) }))()" | jq -r '.gone')
		P=$("$(dirname "${BASH_SOURCE[0]}")/notifications.sh" ${PW_SESSION_NAME:+--session "$PW_SESSION_NAME"} 2>/dev/null | jq -c '[.notifications[]? | {message, buttons}]' 2>/dev/null || echo '[]')
		echo "$M" | jq -c --argjson g "${GONE:-false}" --argjson p "${P:-[]}" '. + {deleted: $g, prompts: $p} + (if $g then {} else {hint: "not deleted yet: answer the prompt with notifications.sh"} end)' ;;
	editors)
		run_js "(() => { const clean = el => el ? el.textContent.replace(/\\s+/g, ' ').trim() : '';
			const groups = [...document.querySelectorAll('.editor-group-container')].filter(g => g.offsetParent !== null)
				.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
			return JSON.stringify({ ok: true, groups: groups.map((g, i) => ({ group: i + 1, active: g.classList.contains('active'),
				tabs: [...g.querySelectorAll('.tab')].map(t => ({ title: clean(t.querySelector('.label-name')), active: t.classList.contains('active'), modified: t.classList.contains('dirty') })) })) }); })()" ;;
	layout) run_js "$LAYOUT_JS" ;;
	resize)
		PX="${ARGS[2]:-}"
		[[ ( "$ARG" == sidebar || "$ARG" == secondary || "$ARG" == panel ) && "$PX" =~ ^[0-9]+$ ]] || { echo '{"ok":false,"error":"give sidebar, secondary or panel, and the size in pixels"}'; exit 2; }
		# The sash on the part's inner edge: right of the sidebar, left of the
		# secondary side bar, top of the panel. Its centre is where to grab.
		M=$(run_js "(() => {
			const part = $(want "$ARG");
			const e = document.querySelector({ sidebar: '.part.sidebar', secondary: '.part.auxiliarybar', panel: '.part.panel' }[part]);
			if (!e || !e.getClientRects().length) { return JSON.stringify({ ok: false, error: part + ' is hidden; show it first' }); }
			const b = e.getBoundingClientRect();
			const sashes = [...document.querySelectorAll('.monaco-sash')].filter(x => x.getClientRects().length && !x.classList.contains('disabled')).map(x => ({ x, r: x.getBoundingClientRect() }));
			const near = (a, c) => Math.abs(a - c) < 5;
			const s = part === 'panel'
				? sashes.find(({ x, r }) => x.classList.contains('horizontal') && near(r.top + r.height / 2, b.top) && r.left < b.right && r.right > b.left)
				: sashes.find(({ x, r }) => x.classList.contains('vertical') && near(r.left + r.width / 2, part === 'sidebar' ? b.right : b.left) && r.height > b.height / 2);
			if (!s) { return JSON.stringify({ ok: false, error: 'no sash on the edge of ' + part }); }
			const px = $PX;
			const from = { x: Math.round(s.r.left + s.r.width / 2), y: Math.round(s.r.top + s.r.height / 2) };
			const to = part === 'sidebar' ? { x: Math.round(b.left + px), y: from.y } : part === 'secondary' ? { x: Math.round(b.right - px), y: from.y } : { x: from.x, y: Math.round(b.bottom - px) };
			return JSON.stringify({ ok: true, from, to, before: part === 'panel' ? Math.round(b.height) : Math.round(b.width) });
		})()") || { echo "$M"; exit 1; }
		[[ "$(echo "$M" | jq -r '.ok')" == "true" ]] || { echo "$M"; exit 1; }
		FX=$(echo "$M" | jq -r '.from.x'); FY=$(echo "$M" | jq -r '.from.y'); TX=$(echo "$M" | jq -r '.to.x'); TY=$(echo "$M" | jq -r '.to.y')
		pw mousemove "$FX" "$FY" >/dev/null 2>&1
		pw mousedown >/dev/null 2>&1
		pw mousemove $(( (FX + TX) / 2 )) $(( (FY + TY) / 2 )) >/dev/null 2>&1
		pw mousemove "$TX" "$TY" >/dev/null 2>&1
		pw mouseup >/dev/null 2>&1
		log_action "panel.sh" "resize $ARG to $PX px"
		sleep 0.3
		L=$(run_js "$LAYOUT_JS")
		echo "$L" | jq -c --arg p "$ARG" --argjson m "$M" --argjson want "$PX" '(.[$p] | if type == "object" then (if $p == "panel" then .height else .width end) else null end) as $now
			| {ok: true, part: $p, before: $m.before, asked: $want, now: $now} + (if $now != null and ($now - $want | fabs) > 8 then {note: "it stopped short of the size asked: the part or its neighbours have a minimum or maximum size"} else {} end)' ;;
	*) echo '{"ok":false,"error":"command: tab, terminals, terminal, delete-session, editors, layout or resize"}'; exit 2 ;;
esac
