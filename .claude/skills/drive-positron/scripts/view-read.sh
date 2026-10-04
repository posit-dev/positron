#!/usr/bin/env bash
# Prints the text of one view, such as Connections, Variables or Viewer, by the
# title its pane header shows. A view keeps stale or stacked instances in the
# page (the Variables pane has one per session, only one shown), so this reads
# only what is on screen. For the Viewer, whose content is a web page in nested
# frames the page's own text cannot reach, it reads the frame content from an
# accessibility snapshot, plus the URL bar.
#
# Usage:
#   scripts/view-read.sh --session NAME --view Connections
#   scripts/view-read.sh --session NAME --view Variables
#   scripts/view-read.sh --session NAME --view Viewer
#
# Lists and trees draw only the rows in view: scroll them, or read the rest with
# the view's own filter, before saying a row is missing.
#
# Stdout: the view's text (Viewer: "url: <url>" then the frame's snapshot lines).
# Exit code: 0 when the view was found, 1 when it is not on screen, 2 on a usage error.

set -u
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SESSION=""
VIEW=""
while [[ $# -gt 0 ]]; do
	case "$1" in
		--session) SESSION="$2"; shift 2 ;;
		--session=*) SESSION="${1#--session=}"; shift ;;
		--view) VIEW="$2"; shift 2 ;;
		-h|--help) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) echo "view-read.sh: unknown arg $1" >&2; exit 2 ;;
	esac
done
if [[ -z "$VIEW" ]]; then
	echo "view-read.sh: give --view TITLE" >&2
	exit 2
fi
pw_setup "$SESSION"

JS="(() => {
	const WANT = $(jq -Rn --arg v "$VIEW" '$v').toLowerCase();
	const clean = el => el ? el.textContent.replace(/\\s+/g, ' ').trim() : '';
	const panes = [...document.querySelectorAll('.pane')].filter(p => p.offsetParent !== null);
	const pane = panes.find(p => clean(p.querySelector('.pane-header .title')).toLowerCase() === WANT)
		|| panes.find(p => clean(p.querySelector('.pane-header .title')).toLowerCase().includes(WANT));
	// A view alone in its container has no pane header; its container title names it.
	const single = !pane && [...document.querySelectorAll('.composite.title .title-label, .panel .composite-bar .action-item.checked')]
		.find(t => clean(t).toLowerCase().includes(WANT));
	const body = pane ? pane.querySelector('.pane-body') : single ? single.closest('.part')?.querySelector('.content, .composite') : null;
	if (!body) { return JSON.stringify({ ok: false, error: 'no view titled ' + WANT + ' on screen', views: panes.map(p => clean(p.querySelector('.pane-header .title'))).filter(Boolean) }); }
	// Only what is drawn: a view stacks one instance per session and shows one,
	// with the rest behind it (z-index -1), so leave those out.
	let parts = body.innerText;
	const removed = [];
	for (const el of body.querySelectorAll('*')) {
		if (removed.some(r => r.contains(el))) { continue; }
		const st = getComputedStyle(el);
		if ((st.zIndex === '-1' || st.visibility === 'hidden') && el.innerText) {
			removed.push(el);
			parts = parts.replace(el.innerText, '');
		}
	}
	const url = body.querySelector('input[type=text], .url-bar input, input');
	return JSON.stringify({ ok: true, text: parts.replace(/\\u00A0/g, ' ').replace(/\\n{3,}/g, '\\n\\n').trim(), url: url ? url.value : null });
})()"
RESULT=$(run_js "$JS") || { echo "$RESULT" >&2; exit 1; }
if [[ "$(echo "$RESULT" | jq -r '.ok')" != "true" ]]; then
	echo "view-read.sh: $(echo "$RESULT" | jq -r '.error'); views on screen: $(echo "$RESULT" | jq -r '.views | join(", ")')" >&2
	exit 1
fi
if [[ "$(echo "$VIEW" | tr '[:upper:]' '[:lower:]')" == "viewer" ]]; then
	echo "url: $(echo "$RESULT" | jq -r '.url // ""')"
	# The page in the Viewer lives in frames; their nodes carry refs starting with f.
	pw snapshot 2>/dev/null | grep -E '\[ref=f[0-9]+e' | sed -E 's/ \[ref=[^]]+\]//; s/^ {2,}/  /'
else
	echo "$RESULT" | jq -r '.text'
fi
