#!/usr/bin/env bash
# Reads the active Data Explorer's grid: every column header, the visible rows'
# values under them, and the status bar. The grid draws only the columns in
# view, so a wide table shows a few headers at a time; this scrolls it sideways
# with the wheel events the grid handles itself, collecting as it goes, and
# scrolls back to where it started.
#
# Usage:
#   scripts/de-read.sh --session NAME
#   scripts/de-read.sh --session NAME --rows 5
#
# Flags:
#   --session NAME  the @playwright/cli session attached to the instance (or $PW_SESSION)
#   --rows N        how many of the top rows to read (default 10)
#   --title TEXT    the editor tab the grid must be in, such as "Data: df";
#                   refuses when the active tab is another, so a grid left
#                   open from an earlier step is never read by mistake
#
# Stdout: one JSON line:
#   {"ok":true,"title":"Data: df","status":"Showing 12 rows ...","columns":["id","name",...],
#    "rows":[{"id":"1","name":"Alice",...}, ...]}
# A cell the grid has not drawn yet reads as null. Column names are taken as
# unique; with two columns of one name, the second gets " (2)".
# Exit code: 0 when a grid was read, 1 when there is none.

set -u
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SESSION=""
ROWS=10
TITLE=
while [[ $# -gt 0 ]]; do
	case "$1" in
		--session) SESSION="$2"; shift 2 ;;
		--session=*) SESSION="${1#--session=}"; shift ;;
		--rows) ROWS="$2"; shift 2 ;;
		--title) TITLE="$2"; shift 2 ;;
		-h|--help) sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) echo "de-read.sh: unknown arg $1" >&2; exit 2 ;;
	esac
done
pw_setup "$SESSION"

JS="(async () => {
	const ROWS = $ROWS;
	const TITLE = $(jq -Rn --arg v "$TITLE" '$v');
	const clean = el => el ? el.textContent.replace(/\\s+/g, ' ').trim() : '';
	const group = document.querySelector('.editor-group-container.active') || document;
	// The summary panel is a grid too; the table is the one with column headers.
	const waffle = [...group.querySelectorAll('.data-grid-waffle')].find(w => w.offsetParent !== null && w.querySelector('.data-grid-column-headers'));
	if (!waffle) { return JSON.stringify({ ok: false, error: 'no Data Explorer grid in the active editor' }); }
	const activeTitle = clean(group.querySelector('.tab.active .label-name'));
	if (TITLE && activeTitle !== TITLE) { return JSON.stringify({ ok: false, error: 'the active tab is ' + activeTitle + ', not ' + TITLE }); }
	const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
	const wheel = dx => waffle.dispatchEvent(new WheelEvent('wheel', { deltaX: dx, deltaY: 0, bubbles: true, cancelable: true }));
	const headers = () => [...waffle.querySelectorAll('.data-grid-column-header')].filter(h => h.offsetParent !== null)
		.map(h => ({ x: h.getBoundingClientRect().left, w: h.getBoundingClientRect().width, name: clean(h.querySelector('.title')) || clean(h) }));
	const rowsNow = () => [...waffle.querySelectorAll('.data-grid-row')].filter(r => r.offsetParent !== null)
		.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).slice(0, ROWS)
		.map(r => [...r.querySelectorAll('.data-grid-row-cell')].map(c => ({ x: c.getBoundingClientRect().left, text: clean(c) })));
	const columns = [];
	const seen = new Map();
	const rows = Array.from({ length: ROWS }, () => ({}));
	let moved = 0;
	for (let page = 0; page < 200; page++) {
		const hs = headers().sort((a, b) => a.x - b.x);
		const before = columns.length;
		const names = [];
		for (const h of hs) {
			let name = h.name, n = 1;
			while (names.includes(name)) { name = h.name + ' (' + (++n) + ')'; }
			names.push(name);
			if (!seen.has(name)) { seen.set(name, true); columns.push(name); }
		}
		// Each row's cells line up with the headers by position.
		rowsNow().forEach((cells, i) => {
			for (const c of cells) {
				const h = hs.findIndex(x => Math.abs(x.x - c.x) < 2);
				if (h >= 0) { rows[i][names[h]] = c.text; }
			}
		});
		if (page > 0 && columns.length === before) { break; }
		const width = waffle.getBoundingClientRect().width;
		wheel(width * 0.8); moved += width * 0.8;
		await frame(); await new Promise(r => setTimeout(r, 120));
	}
	wheel(-moved * 2); await frame();
	const editorTitle = clean(group.querySelector('.tab.active .label-name'));
	const status = clean(group.querySelector('.status-bar, .data-explorer-status-bar, [class*=status-bar]'));
	const used = rows.filter(r => Object.keys(r).length);
	return JSON.stringify({ ok: true, title: editorTitle, status, columns, rows: used.map(r => Object.fromEntries(columns.map(c => [c, c in r ? r[c] : null]))) });
})()"
RESULT=$(run_js "$JS") || { echo "$RESULT"; exit 1; }
echo "$RESULT"
[[ "$(echo "$RESULT" | jq -r '.ok')" == "true" ]]
