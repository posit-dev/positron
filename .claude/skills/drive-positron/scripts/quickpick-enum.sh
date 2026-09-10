#!/usr/bin/env bash
# Enumerates every row of the quick pick that is currently on screen, in list
# order, through the attached @playwright/cli CDP session.
#
# Reading the rows straight out of the DOM under-reports the list. The quick
# pick renders into a virtualized Monaco tree: only a window of rows around the
# focused one exists, the rest are not in the DOM at all, and the window is
# moved with a CSS transform rather than `scrollTop`. Setting `scrollTop` on the
# list therefore appears to work and changes nothing, so a snapshot taken after
# it looks like the list is missing items.
#
# This script instead walks the list with ArrowDown, which the quick pick
# handles by revealing the next row, and harvests every rendered row at each
# step. A single-select quick pick loops at the end (`shouldLoop = !canSelectMany`
# in quickInput.ts), so the walk stops when focus returns to where it started,
# which also leaves the picker on its original item. A multi-select pick does not
# loop; there the walk stops when focus no longer moves.
#
# Usage:
#   scripts/quickpick-enum.sh
#   scripts/quickpick-enum.sh --session positron
#   scripts/quickpick-enum.sh --max 200
#   scripts/quickpick-enum.sh --json
#
# Stdout: one pipe-delimited line per row, ordered by list index:
#   index|kind|label|description|detail|active
# `kind` is `group` for a separator heading and `item` for a selectable row, so
# the heading order and the item order within each heading are both readable.
# `active` is `active` on the row the picker had focused when the walk started
# (the recommended item), empty otherwise. With --json, the raw result object.
# Stderr: the column header and a one-line summary.
#
# Exit code:
#   0  enumerated at least one row
#   1  no visible quick pick, eval failed, or the walk hit --max
#   2  argument/usage error, or a required tool is missing
#
# Required tools on PATH: npx (with @playwright/cli reachable), jq.
#
# Assumes you have already run
# `npx @playwright/cli [-s=NAME] attach --cdp=http://127.0.0.1:$CDP` and that
# the quick pick is open. Closed quick input widgets stay in the DOM, so the
# script picks the one whose `offsetParent` is not null; without that filter it
# would read a stale list from a previous picker.

set -u

MAX=500
JSON=0
PW_SESSION_OVERRIDE=""
while [[ $# -gt 0 ]]; do
	case "$1" in
		--max) MAX="$2"; shift 2 ;;
		--max=*) MAX="${1#--max=}"; shift ;;
		--json) JSON=1; shift ;;
		--session) PW_SESSION_OVERRIDE="$2"; shift 2 ;;
		--session=*) PW_SESSION_OVERRIDE="${1#--session=}"; shift ;;
		-h|--help)
			sed -n '2,45p' "$0" | sed 's/^# \{0,1\}//'
			exit 0 ;;
		*) echo "quickpick-enum.sh: unknown arg $1" >&2; exit 2 ;;
	esac
done

if [[ ! "$MAX" =~ ^[0-9]+$ ]] || (( MAX < 1 )); then
	echo "quickpick-enum.sh: --max must be a positive integer" >&2
	exit 2
fi

for tool in npx jq; do
	if ! command -v "$tool" >/dev/null 2>&1; then
		echo "quickpick-enum.sh: required tool '$tool' not on PATH" >&2
		exit 2
	fi
done

SESSION="${PW_SESSION_OVERRIDE:-${PW_SESSION:-}}"
PW_ARGS=()
[[ -n "$SESSION" ]] && PW_ARGS=("-s=$SESSION")

# The whole walk runs inside one eval. Doing it from bash would spend a process
# launch per keystroke, and the extra time between steps gives the picker room
# to lose focus or refilter between reads.
JS=$(cat <<'JSEOF'
(async () => {
	const MAX = __MAX__;
	const widget = Array.from(document.querySelectorAll('.quick-input-widget'))
		.find(w => w.offsetParent !== null);
	if (!widget) {
		return JSON.stringify({ ok: false, error: 'no visible quick-input widget' });
	}
	const list = widget.querySelector('.quick-input-list');
	if (!list) {
		return JSON.stringify({ ok: false, error: 'visible quick-input widget has no list' });
	}
	const input = widget.querySelector('.quick-input-box input');

	const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
	const clean = el => el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
	const focused = () => list.querySelector('.monaco-list-row.focused');
	const indexOf = row => row ? Number(row.getAttribute('data-index')) : NaN;

	const readRow = row => {
		const entry = row.querySelector('.quick-input-list-entry');
		const cells = row.querySelectorAll('.quick-input-list-rows > .quick-input-list-row');
		const head = cells[0];
		return {
			index: indexOf(row),
			kind: entry && entry.classList.contains('quick-input-list-separator-as-item') ? 'group' : 'item',
			label: clean(head && head.querySelector('.label-name')),
			description: clean(head && head.querySelector('.label-description')),
			detail: clean(row.querySelector('.quick-input-list-label-meta'))
		};
	};

	// A heading reaches the DOM one of two ways: as its own row, or attached to
	// the item below it. The attached element is part of a recycled row
	// template, and the renderer hides it with `display: none` without clearing
	// its text, so a stale heading from a previous item stays readable. Take it
	// only while it is actually displayed.
	const readAttachedGroup = row => {
		const separator = row.querySelector('.quick-input-list-separator');
		if (!separator || separator.offsetParent === null) { return undefined; }
		const label = clean(separator);
		return label ? label : undefined;
	};

	// Every row in the render window is readable, not just the focused one, so
	// each keystroke can contribute several rows.
	const seen = new Map();
	const groups = new Map();
	const harvest = () => {
		for (const row of list.querySelectorAll('.monaco-list-row')) {
			if (row.offsetParent === null) { continue; }
			const read = readRow(row);
			if (!Number.isFinite(read.index)) { continue; }
			seen.set(read.index, read);
			const group = readAttachedGroup(row);
			if (group !== undefined) { groups.set(read.index, group); }
		}
	};

	const arrowDown = () => {
		const target = input || widget;
		target.focus();
		target.dispatchEvent(new KeyboardEvent('keydown', {
			key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40,
			bubbles: true, cancelable: true
		}));
	};

	harvest();
	if (!focused()) {
		// Nothing is focused yet, for instance right after the picker opened
		// with an empty filter. One ArrowDown focuses the first item.
		arrowDown();
		await frame();
		harvest();
	}
	const startIndex = indexOf(focused());
	if (!Number.isFinite(startIndex)) {
		return JSON.stringify({ ok: false, error: 'no focused row after ArrowDown; is the quick pick empty?' });
	}

	let steps = 0;
	let previous = startIndex;
	let stop = 'wrapped';
	while (true) {
		if (++steps > MAX) { stop = 'hit-max'; break; }
		arrowDown();
		await frame();
		harvest();
		const current = indexOf(focused());
		if (!Number.isFinite(current)) { stop = 'lost-focus'; break; }
		if (current === startIndex) { stop = 'wrapped'; break; }
		if (current === previous) { stop = 'no-loop-end'; break; }
		previous = current;
	}

	// Interleave the attached headings back in, each one immediately above the
	// item it was rendered on.
	const rows = [];
	for (const row of Array.from(seen.values()).sort((a, b) => a.index - b.index)) {
		const group = groups.get(row.index);
		if (group !== undefined) {
			rows.push({ index: row.index, kind: 'group', label: group, description: '', detail: '' });
		}
		rows.push(row);
	}
	return JSON.stringify({
		ok: rows.length > 0 && stop !== 'hit-max',
		stop,
		steps,
		startIndex,
		rows,
		error: stop === 'hit-max' ? 'walk did not terminate within --max steps' : undefined
	});
})()
JSEOF
)
JS="${JS//__MAX__/$MAX}"

RAW=$(npx @playwright/cli ${PW_ARGS[@]+"${PW_ARGS[@]}"} eval "$JS" 2>&1) || {
	echo "quickpick-enum.sh: @playwright/cli eval failed" >&2
	echo "$RAW" >&2
	exit 1
}

RESULT_LINE=$(echo "$RAW" | grep -A 1 '### Result' | tail -n1)
if [[ -z "$RESULT_LINE" ]]; then
	echo "quickpick-enum.sh: no ### Result section in eval output" >&2
	echo "$RAW" >&2
	exit 1
fi

# RESULT_LINE is a JSON-encoded string wrapping the result object.
RESULT=$(echo "$RESULT_LINE" | jq -r 'fromjson' 2>/dev/null) || {
	echo "quickpick-enum.sh: failed to parse result line" >&2
	echo "$RESULT_LINE" >&2
	exit 1
}

if [[ "$JSON" == "1" ]]; then
	echo "$RESULT" | jq .
else
	echo "index|kind|label|description|detail|active" >&2
	echo "$RESULT" | jq -r --argjson start "$(echo "$RESULT" | jq '.startIndex // -1')" '
		.rows // [] | .[] |
		[ (.index | tostring), .kind, .label, .description, .detail,
		  (if .kind == "item" and .index == $start then "active" else "" end) ] | join("|")'
fi

ERROR=$(echo "$RESULT" | jq -r '.error // empty')
echo "quickpick-enum.sh: $(echo "$RESULT" | jq -r '(.rows // []) | length') rows, stop=$(echo "$RESULT" | jq -r '.stop // "none"'), steps=$(echo "$RESULT" | jq -r '.steps // 0')${ERROR:+, error=$ERROR}" >&2

[[ "$(echo "$RESULT" | jq -r '.ok')" == "true" ]]
