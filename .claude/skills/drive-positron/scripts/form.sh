#!/usr/bin/env bash
# Reads and fills the dialog on screen: Positron's own modal dialogs (Add
# Connection, New Folder) and upstream ones. Fields are found by their visible
# label, or their placeholder or accessible name, so a step reads like what a
# user does: fill "Database File", tick "Read Only", click "Save". Typing and
# clicks are real, since Positron's buttons ignore a click() from page script.
#
# Usage:
#   scripts/form.sh --session NAME read
#   scripts/form.sh --session NAME fill 'Name' 'Shop'
#   scripts/form.sh --session NAME check 'Read Only'      # also: uncheck
#   scripts/form.sh --session NAME click 'Save'
#
# Commands:
#   read           the dialog's title, its fields (label, kind, value, checked)
#                  and its buttons (label, enabled)
#   fill L TEXT    replace the text field labelled L with TEXT
#   check L        tick the checkbox labelled L; uncheck clears it
#   click B        click the button labelled B; refuses when it is disabled
#
# Flags:
#   --in TEXT      only the field or button in the row that also shows TEXT,
#                  for a list with one button per row ("Connect" beside SQLite)
#
# Stdout: one JSON line. Exit code: 0 on success, 1 when there is no dialog or
# no such field or button, 2 on a usage error.

set -u
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SESSION=""
IN=""
ARGS=()
while [[ $# -gt 0 ]]; do
	case "$1" in
		--session) SESSION="$2"; shift 2 ;;
		--session=*) SESSION="${1#--session=}"; shift ;;
		--in) IN="$2"; shift 2 ;;
		-h|--help) sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) ARGS+=("$1"); shift ;;
	esac
done
CMD="${ARGS[0]:-}"
A1="${ARGS[1]:-}"
A2="${ARGS[2]:-}"
pw_setup "$SESSION"

COMMON="
	const clean = el => el ? el.textContent.replace(/\\s+/g, ' ').trim() : '';
	document.querySelectorAll('[data-dp-target]').forEach(e => e.removeAttribute('data-dp-target'));
	const dialog = [...document.querySelectorAll('.positron-modal-dialog-box, .positron-dynamic-modal-dialog-box, .monaco-dialog-box, [role=dialog]')]
		.filter(d => d.offsetParent !== null).pop();
	const fields = () => [...dialog.querySelectorAll('input, textarea, select, [role=checkbox], [role=combobox]')].filter(e => e.offsetParent !== null && e.type !== 'hidden').map(e => {
		const own = e.closest('label') || (e.id && dialog.querySelector('label[for=\"' + e.id + '\"]'));
		const near = e.closest('.labeled-text-input, .checkbox, .labeled-folder-input, .radio-button, div')?.querySelector('label');
		const label = clean(own) || clean(near) || e.getAttribute('aria-label') || e.getAttribute('placeholder') || '';
		const kind = e.getAttribute('role') === 'checkbox' || e.type === 'checkbox' ? 'checkbox' : e.type === 'radio' ? 'radio' : e.tagName === 'SELECT' || e.getAttribute('role') === 'combobox' ? 'select' : 'text';
		const checked = kind === 'checkbox' || kind === 'radio' ? (e.checked === true || e.getAttribute('aria-checked') === 'true') : undefined;
		return { el: e, label, kind, value: kind === 'text' || kind === 'select' ? (e.value ?? clean(e)) : undefined, checked, placeholder: e.getAttribute('placeholder') || undefined };
	});
	const buttons = () => [...dialog.querySelectorAll('button, .monaco-button, [role=button]')].filter(b => b.offsetParent !== null && !b.closest('input'))
		.map(b => ({ el: b, label: clean(b) || b.getAttribute('aria-label') || '', enabled: !(b.disabled || b.getAttribute('aria-disabled') === 'true' || /\\bdisabled\\b/.test(b.className)) }))
		.filter(b => b.label);
	const IN = $(jq -Rn --arg v "$IN" '$v');
	// With --in, only what sits in the row that also shows that text.
	// The smallest container around it that shows TEXT, holding no other control of its label.
	const inRow = x => {
		if (!IN) { return true; }
		let a = x.el.parentElement;
		while (a && a !== dialog && !clean(a).includes(IN)) { a = a.parentElement; }
		if (!a || a === dialog) { return false; }
		return [...a.querySelectorAll('button, .monaco-button, [role=button], input, textarea, select')].filter(b => (clean(b) || b.getAttribute('aria-label')) === (clean(x.el) || x.el.getAttribute('aria-label'))).length === 1;
	};
	const byLabel = (all, want) => {
		const list = all.filter(inRow);
		const w = want.toLowerCase();
		const exact = list.filter(x => x.label.toLowerCase() === w || (x.placeholder || '').toLowerCase() === w);
		return exact.length ? exact : list.filter(x => x.label.toLowerCase().includes(w));
	};
"
js() { run_js "(() => {$COMMON if (!dialog) { return JSON.stringify({ ok: false, error: 'no dialog is open' }); } $1 })()"; }
unmark() { run_js "(() => { document.querySelectorAll('[data-dp-target]').forEach(e => e.removeAttribute('data-dp-target')); return '{}'; })()" >/dev/null; }

case "$CMD" in
	read)
		js "return JSON.stringify({ ok: true, title: clean(dialog.querySelector('.simple-title-bar, .draggable-title-bar, .dialog-message-text, h1, h2, .title')),
			fields: fields().map(({ label, kind, value, checked }) => ({ label, kind, value, checked })),
			buttons: buttons().map(({ label, enabled }) => ({ label, enabled })) });" ;;
	fill|check|uncheck)
		[[ -n "$A1" ]] || { echo '{"ok":false,"error":"give the field label"}'; exit 2; }
		M=$(js "const hits = byLabel(fields(), $(jq -Rn --arg v "$A1" '$v'));
			if (hits.length !== 1) { return JSON.stringify({ ok: false, error: hits.length ? hits.length + ' fields match' : 'no field labelled ' + $(jq -Rn --arg v "$A1" '$v'), fields: fields().map(f => f.label) }); }
			hits[0].el.setAttribute('data-dp-target', '1');
			return JSON.stringify({ ok: true, label: hits[0].label, kind: hits[0].kind, checked: hits[0].checked });") || { echo "$M"; exit 1; }
		[[ "$(echo "$M" | jq -r '.ok')" == "true" ]] || { echo "$M"; exit 1; }
		if [[ "$CMD" == fill ]]; then
			pw fill '[data-dp-target="1"]' "$A2" >/dev/null 2>&1
			log_action "form.sh" "fill \"$(echo "$M" | jq -r '.label')\" with \"$A2\""
		else
			IS=$(echo "$M" | jq -r '.checked')
			if [[ ( "$CMD" == check && "$IS" != true ) || ( "$CMD" == uncheck && "$IS" == true ) ]]; then
				pw click '[data-dp-target="1"]' >/dev/null 2>&1
				log_action "form.sh" "$CMD \"$(echo "$M" | jq -r '.label')\""
			fi
		fi
		unmark
		echo "$M" | jq -c 'del(.checked)' ;;
	click)
		[[ -n "$A1" ]] || { echo '{"ok":false,"error":"give the button label"}'; exit 2; }
		M=$(js "const hits = byLabel(buttons(), $(jq -Rn --arg v "$A1" '$v'));
			if (hits.length !== 1) { return JSON.stringify({ ok: false, error: hits.length ? hits.length + ' buttons match' : 'no button labelled ' + $(jq -Rn --arg v "$A1" '$v'), buttons: buttons().map(b => b.label) }); }
			if (!hits[0].enabled) { return JSON.stringify({ ok: false, error: hits[0].label + ' is disabled' }); }
			hits[0].el.setAttribute('data-dp-target', '1');
			return JSON.stringify({ ok: true, button: hits[0].label });") || { echo "$M"; exit 1; }
		[[ "$(echo "$M" | jq -r '.ok')" == "true" ]] || { echo "$M"; exit 1; }
		pw click '[data-dp-target="1"]' >/dev/null 2>&1
		unmark
		log_action "form.sh" "click \"$(echo "$M" | jq -r '.button')\""
		echo "$M" ;;
	*) echo '{"ok":false,"error":"command: read, fill, check, uncheck or click"}'; exit 2 ;;
esac
