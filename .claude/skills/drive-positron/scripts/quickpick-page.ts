/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Prints the page script for one step of palette-run.sh or start-session.sh.
// Kept apart from the shell scripts so the JavaScript needs no shell quoting.
//
//   node quickpick-page.ts blur
//   node quickpick-page.ts fill <text>
//   node quickpick-page.ts choose <exact|words> <text> [--dry]
//   node quickpick-page.ts open
//
// `choose` reads the visible quick pick's rows and selects one: with `exact`,
// the row whose label is exactly <text>; with `words`, the only row whose label
// holds every word of <text>. It never takes the highlighted row on trust: the
// Command Palette highlights its best guess, which can be a "similar commands"
// entry such as Delete All Cells, so Enter on a near miss runs the wrong thing.

const [step, mode, text, flag, desc]: string[] = process.argv.slice(2);

const common = `
	const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
	const sleep = ms => new Promise(r => setTimeout(r, ms));
	const widget = () => [...document.querySelectorAll('.quick-input-widget')].find(w => w.offsetParent !== null);
	const clean = el => el ? el.textContent.replace(/\\s+/g, ' ').trim() : '';
`;

const steps: Record<string, string> = {
	// Move focus out of a webview or editor that would swallow the shortcut.
	blur: `(() => {
		const a = document.activeElement;
		const inFrame = a && a.tagName === 'IFRAME';
		if (a && a !== document.body) { a.blur(); }
		const wb = document.querySelector('.monaco-workbench');
		if (wb) { wb.setAttribute('tabindex', '-1'); wb.focus(); }
		return JSON.stringify({ ok: true, wasInFrame: !!inFrame });
	})()`,

	// Whether a quick pick is open.
	open: `(() => {${common}
		const w = widget();
		const input = w?.querySelector('.quick-input-box input');
		return JSON.stringify({ ok: !!w, value: input ? input.value : null, title: clean(w?.querySelector('.quick-input-title')) });
	})()`,

	// Set the quick pick's filter text, as typing would.
	fill: `(async () => {${common}
		const w = widget();
		const input = w?.querySelector('.quick-input-box input');
		if (!input) { return JSON.stringify({ ok: false, error: 'no visible quick pick' }); }
		input.focus();
		input.value = ${JSON.stringify(mode ?? '')};
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await sleep(250); await frame();
		return JSON.stringify({ ok: true, value: input.value });
	})()`,

	choose: `(async () => {${common}
		const MODE = ${JSON.stringify(mode)};
		const WANT = ${JSON.stringify(text ?? '')};
		const DRY = ${JSON.stringify(flag === '--dry')};
		const w = widget();
		if (!w) { return JSON.stringify({ ok: false, error: 'no visible quick pick' }); }
		const list = w.querySelector('.quick-input-list');
		const input = w.querySelector('.quick-input-box input') || w;
		const rows = () => [...list.querySelectorAll('.monaco-list-row')].filter(r => r.offsetParent !== null)
			.map(r => ({ el: r, index: Number(r.getAttribute('data-index')), label: clean(r.querySelector('.label-name')),
				description: clean(r.querySelector('.label-description')), focused: r.classList.contains('focused'),
				separator: !!r.querySelector('.quick-input-list-separator-as-item') }))
			.filter(r => Number.isFinite(r.index) && !r.separator);
		const key = (k, code) => { input.focus(); input.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k, keyCode: code, which: code, bubbles: true, cancelable: true })); };
		// Whole words, so "R" does not match the r in "positron-python"; a word may
		// end at a dot, so "4" and "4.5" match the version "4.5.1".
		const words = WANT.split(/\\s+/).filter(Boolean).map(x => new RegExp('(^|[^\\\\w.-])' + x.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&') + '($|[^\\\\w-])', 'i'));
		const DESC = ${JSON.stringify(desc ?? '')};
		const matches = r => (MODE === 'exact' ? r.label === WANT : words.every(x => x.test(r.label + ' ' + r.description)))
			&& (!DESC || r.description.includes(DESC));

		// The list may still be filtering; give it a moment to settle.
		let found = [];
		for (let i = 0; i < 10; i++) { found = rows().filter(matches); if (found.length) { break; } await sleep(100); }
		const shown = rows().slice(0, 8).map(r => r.label + (r.description ? ' (' + r.description + ')' : ''));
		if (found.length === 0) {
			return JSON.stringify({ ok: false, error: 'no row matches "' + WANT + '"', shown });
		}
		if (found.length > 1) {
			return JSON.stringify({ ok: false, error: found.length + ' rows match "' + WANT + '"; be more specific', shown: found.map(r => r.label + (r.description ? ' (' + r.description + ')' : '')) });
		}
		const target = found[0];
		// Walk focus to the target with the keys the quick pick handles itself.
		for (let i = 0; i < 60; i++) {
			const f = rows().find(r => r.focused);
			if (f && f.index === target.index) { break; }
			key(f && f.index > target.index ? 'ArrowUp' : 'ArrowDown', f && f.index > target.index ? 38 : 40);
			await frame();
		}
		const f = rows().find(r => r.focused);
		if (!f || f.index !== target.index) {
			return JSON.stringify({ ok: false, error: 'could not move the highlight to "' + target.label + '"', shown });
		}
		if (DRY) { return JSON.stringify({ ok: true, chosen: target.label, description: target.description, dry: true }); }
		key('Enter', 13);
		await sleep(200); await frame();
		return JSON.stringify({ ok: true, chosen: target.label, description: target.description, closed: !widget() });
	})()`,
};

if (!steps[step]) {
	console.error('quickpick-page.ts: unknown step ' + step);
	process.exit(2);
}
console.log(steps[step]);
