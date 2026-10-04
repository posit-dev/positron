#!/usr/bin/env bash
# Reads and drives the Plots pane: what plot it shows, the history filmstrip,
# and the toolbar. Clicks are real, since Positron's buttons ignore a click()
# from page script, and each command reports the pane after it.
#
# Usage:
#   scripts/plots.sh --session NAME read
#   scripts/plots.sh --session NAME prev            # also: next
#   scripts/plots.sh --session NAME select 2
#   scripts/plots.sh --session NAME clear
#   scripts/plots.sh --session NAME remove 2
#   scripts/plots.sh --session NAME zoom 50%
#   scripts/plots.sh --session NAME open 'editor tab'
#   scripts/plots.sh --session NAME save            # opens the Save Plot dialog; fill it with form.sh
#
# Commands:
#   read      the plot shown: its name, session, image size (natural, and
#             the img element's box, which can be larger than the picture),
#             how many colours a 10 x 10 grid of its pixels holds (1 = a
#             blank image) and its top-left pixel; "blank": true when the pane
#             shows no plot at all; the toolbar buttons (off = disabled); the
#             filmstrip thumbnails, when it is shown, with the selected one
#   prev      click Show Previous Plot; next clicks Show Next Plot
#   select N  click the Nth filmstrip thumbnail, 1 = first; the filmstrip shows
#             only with several plots and room for it (plots.historyPolicy
#             "auto"); set it to "always" in the workspace settings to use this
#             in a small pane
#   remove N  hover the Nth thumbnail and click its Remove plot button
#   zoom L    pick zoom level L (Fit, 50%, 75%, 100%, 200%) from the zoom menu
#   open W    pick W from the "Select where to open plot" menu (its words,
#             such as "editor tab" or "new window")
#   clear     click Clear All Plots, and report any prompt it raised
#   save      click Save Plot and report the dialog it opened (form.sh read)
#
# Stdout: one JSON line. Exit code: 0 on success, 1 when the pane, button or
# thumbnail is not there or the button is disabled, 2 on a usage error.

set -u
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SESSION=""
ARGS=()
while [[ $# -gt 0 ]]; do
	case "$1" in
		--session) SESSION="$2"; shift 2 ;;
		--session=*) SESSION="${1#--session=}"; shift ;;
		-h|--help) sed -n '2,36p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) ARGS+=("$1"); shift ;;
	esac
done
CMD="${ARGS[0]:-}"
ARG="${ARGS[1]:-}"
pw_setup "$SESSION"
DIR="$(dirname "${BASH_SOURCE[0]}")"
SFLAG=(); [[ -n "$SESSION" ]] && SFLAG=(--session "$SESSION")

COMMON="
	const clean = el => el ? el.textContent.replace(/\\s+/g, ' ').trim() : '';
	document.querySelectorAll('[data-dp-target]').forEach(e => e.removeAttribute('data-dp-target'));
	const pane = [...document.querySelectorAll('.positron-plots-container')].find(p => p.offsetParent !== null);
	const buttons = () => [...pane.querySelectorAll('.action-bars button[aria-label]')]
		.filter(b => !b.classList.contains('action-bar-button-drop-down-button') && b.getAttribute('aria-label') !== 'overflow')
		.map(b => ({ el: b, label: b.getAttribute('aria-label'), enabled: !(b.disabled || b.getAttribute('aria-disabled') === 'true') }));
	const thumbs = () => [...pane.querySelectorAll('.plot-thumbnail')].filter(t => t.offsetParent !== null);
"
READ_JS="(async () => {$COMMON
	if (!pane) { return JSON.stringify({ ok: false, error: 'the Plots pane is not on screen; run Session: Focus on Plots View' }); }
	const img = [...pane.querySelectorAll('.selected-plot img')].find(i => i.offsetParent !== null);
	const sample = async im => {
		try {
			const c = document.createElement('canvas');
			c.width = im.naturalWidth; c.height = im.naturalHeight;
			const x = c.getContext('2d');
			const i = new Image(); i.src = im.src; await i.decode(); x.drawImage(i, 0, 0);
			const px = (a, b) => { const d = x.getImageData(a, b, 1, 1).data; return 'rgb(' + d[0] + ',' + d[1] + ',' + d[2] + ')'; };
			const seen = new Set();
			for (let a = 0; a < 10; a++) { for (let b = 0; b < 10; b++) { seen.add(px(Math.floor((a + 0.5) * c.width / 10), Math.floor((b + 0.5) * c.height / 10))); } }
			return { topLeft: px(3, 3), colours: seen.size };
		} catch (e) { return { error: String(e) }; }
	};
	let plot = null;
	if (img) {
		const r = img.getBoundingClientRect();
		plot = { name: clean(pane.querySelector('.plot-name')) || img.alt, session: clean(pane.querySelector('.plot-session-name')) || undefined,
			natural: img.naturalWidth + 'x' + img.naturalHeight, box: Math.round(r.width) + 'x' + Math.round(r.height), pixels: await sample(img) };
	}
	const other = !img ? clean(pane.querySelector('.selected-plot')) || undefined : undefined;
	const t = thumbs();
	const zoom = [...pane.querySelectorAll('.action-bars button[aria-haspopup=menu]')].map(x => x.getAttribute('aria-label')).find(l => /^(Fit|\\d+%)$/.test(l || ''));
	return JSON.stringify({ ok: true, blank: !img && !other, plot, otherContent: other, zoom,
		toolbar: buttons().map(b => b.enabled ? b.label : b.label + ' (off)'),
		filmstrip: t.length ? t.map((x, i) => ({ n: i + 1, selected: x.classList.contains('selected'), name: x.querySelector('img')?.alt || clean(x) || undefined })) : 'not shown' });
})()"
read_pane() { run_js "$READ_JS"; }
ok() { [[ "$(echo "$1" | jq -r '.ok')" == "true" ]]; }
click_button() {
	local want="$1" m
	m=$(run_js "(() => {$COMMON
		if (!pane) { return JSON.stringify({ ok: false, error: 'the Plots pane is not on screen' }); }
		const b = buttons().find(x => x.label === $(jq -Rn --arg v "$want" '$v'));
		if (!b) { return JSON.stringify({ ok: false, error: 'no ' + $(jq -Rn --arg v "$want" '$v') + ' button; the pane may be too narrow and have put it in the overflow menu', toolbar: buttons().map(x => x.label) }); }
		if (!b.enabled) { return JSON.stringify({ ok: false, error: b.label + ' is disabled' }); }
		b.el.setAttribute('data-dp-target', '1');
		return JSON.stringify({ ok: true });
	})()") || { echo "$m"; return 1; }
	ok "$m" || { echo "$m"; return 1; }
	pw click '[data-dp-target="1"]' >/dev/null 2>&1
	log_action "plots.sh" "click $want"
}

case "$CMD" in
	read) read_pane ;;
	prev|next)
		[[ "$CMD" == prev ]] && WANT="Show Previous Plot" || WANT="Show Next Plot"
		BEFORE=$(read_pane)
		click_button "$WANT" || exit 1
		sleep 0.6
		AFTER=$(read_pane)
		echo "$AFTER" | jq -c --arg b "$WANT" --argjson before "$BEFORE" '{ok: true, clicked: $b, changed: (.plot != $before.plot or .blank != $before.blank)} + del(.ok)' ;;
	select)
		[[ "$ARG" =~ ^[0-9]+$ ]] || { echo '{"ok":false,"error":"give the thumbnail number, 1 = first"}'; exit 2; }
		M=$(run_js "(() => {$COMMON
			if (!pane) { return JSON.stringify({ ok: false, error: 'the Plots pane is not on screen' }); }
			const t = thumbs();
			if (!t.length) { return JSON.stringify({ ok: false, error: 'the filmstrip is not shown: it needs several plots and room, or plots.historyPolicy set to always' }); }
			const x = t[$ARG - 1];
			if (!x) { return JSON.stringify({ ok: false, error: 'only ' + t.length + ' thumbnails' }); }
			(x.querySelector('button') || x).setAttribute('data-dp-target', '1');
			return JSON.stringify({ ok: true });
		})()") || { echo "$M"; exit 1; }
		ok "$M" || { echo "$M"; exit 1; }
		pw click '[data-dp-target="1"]' >/dev/null 2>&1
		log_action "plots.sh" "select plot thumbnail $ARG"
		sleep 0.6
		read_pane ;;
	clear)
		click_button "Clear All Plots" || exit 1
		sleep 0.6
		P=$("$DIR/notifications.sh" "${SFLAG[@]}" 2>/dev/null | jq -c '[.notifications[]? | {kind, message, buttons}]' 2>/dev/null || echo '[]')
		read_pane | jq -c --argjson p "${P:-[]}" '. + {prompts: $p}' ;;
	save)
		click_button "Save Plot" || exit 1
		sleep 0.8
		"$DIR/form.sh" "${SFLAG[@]}" read ;;
	remove)
		[[ "$ARG" =~ ^[0-9]+$ ]] || { echo '{"ok":false,"error":"give the thumbnail number, 1 = first"}'; exit 2; }
		BEFORE=$(read_pane)
		M=$(run_js "(() => {$COMMON
			if (!pane) { return JSON.stringify({ ok: false, error: 'the Plots pane is not on screen' }); }
			const t = thumbs();
			if (!t.length) { return JSON.stringify({ ok: false, error: 'the filmstrip is not shown: widen the pane (panel.sh resize secondary 600) or set plots.historyPolicy to always' }); }
			const x = t[$ARG - 1];
			if (!x) { return JSON.stringify({ ok: false, error: 'only ' + t.length + ' thumbnails' }); }
			const b = x.querySelector('.plot-close, button[title=\"Remove plot\"]');
			if (!b) { return JSON.stringify({ ok: false, error: 'no Remove plot button on that thumbnail' }); }
			x.setAttribute('data-dp-hover', '1');
			b.setAttribute('data-dp-target', '1');
			return JSON.stringify({ ok: true, name: x.querySelector('img')?.alt });
		})()") || { echo "$M"; exit 1; }
		ok "$M" || { echo "$M"; exit 1; }
		pw hover '[data-dp-hover="1"]' >/dev/null 2>&1
		pw click '[data-dp-target="1"]' >/dev/null 2>&1
		run_js "(() => { document.querySelectorAll('[data-dp-hover]').forEach(e => e.removeAttribute('data-dp-hover')); return '{}'; })()" >/dev/null
		log_action "plots.sh" "remove plot thumbnail $ARG ($(echo "$M" | jq -r '.name'))"
		sleep 0.6
		AFTER=$(read_pane)
		echo "$AFTER" | jq -c --argjson b "$BEFORE" '{ok: ((.filmstrip | length) < ($b.filmstrip | length))} + (if (.filmstrip | length) < ($b.filmstrip | length) then {} else {error: "the filmstrip did not shrink: the click did not land"} end) + del(.ok)'
		[[ "$(echo "$AFTER" | jq '.filmstrip | length')" -lt "$(echo "$BEFORE" | jq '.filmstrip | length')" ]] ;;
	zoom|open)
		[[ -n "$ARG" ]] || { echo '{"ok":false,"error":"give the menu item"}'; exit 2; }
		M=$(run_js "(() => {$COMMON
			if (!pane) { return JSON.stringify({ ok: false, error: 'the Plots pane is not on screen' }); }
			const menus = [...pane.querySelectorAll('.action-bars button[aria-haspopup=menu]')];
			const b = '$CMD' === 'zoom' ? menus.find(x => /^(Fit|\\d+%)$/.test(x.getAttribute('aria-label') || ''))
				: menus.find(x => x.getAttribute('aria-label') === 'Select where to open plot');
			if (!b) { return JSON.stringify({ ok: false, error: 'no ' + ('$CMD' === 'zoom' ? 'zoom' : 'open') + ' menu in the toolbar; the pane may be too narrow', menus: menus.map(x => x.getAttribute('aria-label')) }); }
			b.setAttribute('data-dp-target', '1');
			return JSON.stringify({ ok: true, before: b.getAttribute('aria-label') });
		})()") || { echo "$M"; exit 1; }
		ok "$M" || { echo "$M"; exit 1; }
		pw click '[data-dp-target="1"]' >/dev/null 2>&1
		run_js "(() => { document.querySelectorAll('[data-dp-target]').forEach(e => e.removeAttribute('data-dp-target')); return '{}'; })()" >/dev/null
		sleep 0.4
		# The menu's rows are matched by their whole text, or for open, by words in it.
		WANT="$ARG"
		if [[ "$CMD" == open ]]; then
			WANT=$(run_js "(() => { const w = $(jq -Rn --arg v "$ARG" '$v').toLowerCase(); const rows = [...document.querySelectorAll('.action-menu-item, .custom-context-menu-item, [role=menuitem]')].filter(e => e.offsetParent !== null).map(e => e.textContent.trim()); const l = r => r.toLowerCase(); const hits = [rows.filter(r => l(r) === w), rows.filter(r => l(r).endsWith(w)), rows.filter(r => l(r).includes(w))].find(h => h.length === 1) || []; return JSON.stringify({ ok: hits.length === 1, item: hits[0] || '', rows }); })()" | jq -r 'if .ok then .item else "" end')
			[[ -n "$WANT" ]] || { pw press Escape >/dev/null 2>&1; echo "{\"ok\":false,\"error\":\"no single open-menu row holds $ARG\"}"; exit 1; }
		fi
		I=$(run_js "$(node "$DIR/tree-page.ts" menu-mark "$WANT")") || { pw press Escape >/dev/null 2>&1; echo "$I"; exit 1; }
		ok "$I" || { pw press Escape >/dev/null 2>&1; echo "$I"; exit 1; }
		pw click '[data-dp-target="1"]' >/dev/null 2>&1
		log_action "plots.sh" "$CMD: $WANT"
		sleep 0.6
		read_pane | jq -c --arg c "$CMD" --arg w "$WANT" --argjson m "$M" '. + {chose: $w, menuBefore: $m.before}' ;;
	*) echo '{"ok":false,"error":"command: read, prev, next, select, remove, zoom, open, clear or save"}'; exit 2 ;;
esac
