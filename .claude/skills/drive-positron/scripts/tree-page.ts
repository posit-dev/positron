/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Prints the page script for one step of tree.sh. Kept apart from the shell
// script so the JavaScript needs no shell quoting.
//
//   node tree-page.ts rows <view> '' 0
//   node tree-page.ts mark <view> <label> <nth> <row|twisty>
//   node tree-page.ts menu-mark <item>
//   node tree-page.ts unmark
//
// A row is found by a label that is the whole text of one of its pieces (a
// node's name, without the "Table ·" prefix or the type beside it). `mark` tags
// the element to click with data-dp-target, so tree.sh can click it with a real
// mouse click: Positron's buttons ignore a click() from page script.

const [step, view, label, nth, part]: string[] = process.argv.slice(2);

const common = `
	const VIEW = ${JSON.stringify((view ?? '').toLowerCase())};
	const clean = el => el ? el.textContent.replace(/\\s+/g, ' ').trim() : '';
	const scope = (() => {
		if (!VIEW) { return document; }
		const panes = [...document.querySelectorAll('.pane')].filter(p => p.offsetParent !== null);
		const pane = panes.find(p => clean(p.querySelector('.pane-header .title')).toLowerCase() === VIEW)
			|| panes.find(p => clean(p.querySelector('.pane-header .title')).toLowerCase().includes(VIEW));
		return pane ? pane.querySelector('.pane-body') : null;
	})();
	// Positron's own trees are data grids of .positron-tree-row; upstream trees
	// are Monaco lists of treeitems. Read both the same way.
	const rows = () => !scope ? [] : [...scope.querySelectorAll('.positron-tree-row, .monaco-list-row[role=treeitem]')]
		.filter(r => r.offsetParent !== null)
		.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
	const readRow = r => {
		const positron = r.classList.contains('positron-tree-row');
		const content = positron ? r.querySelector('.positron-tree-content') : r.querySelector('.monaco-tl-contents') || r;
		const twisty = positron ? r.querySelector('.positron-tree-twisty') : r.querySelector('.monaco-tl-twistie');
		const state = positron
			? ((twisty?.className.match(/positron-tree-twisty-(\\w+)/) || [])[1] || '')
			: (r.getAttribute('aria-expanded') === 'true' ? 'expanded' : r.getAttribute('aria-expanded') === 'false' ? 'collapsed' : 'leaf');
		const indent = positron ? r.querySelector('.positron-tree-indent') : null;
		const level = positron
			? Math.round((indent?.getBoundingClientRect().width || 0) / (parseFloat(getComputedStyle(indent || r).getPropertyValue('--positron-tree-indent-width')) || 8))
			: Number(r.getAttribute('aria-level') || 1) - 1;
		const pieces = [...content.querySelectorAll('*')].filter(e => e.children.length === 0).map(clean).filter(Boolean);
		return { level, state, text: clean(content), pieces, el: r, twisty };
	};
	const find = (want, n) => {
		const all = rows().map(readRow).filter(x => x.pieces.includes(want) || x.text === want);
		if (all.length === 0) { return { error: 'no visible row labelled "' + want + '"; expand its parent or scroll' }; }
		if (!n && all.length > 1) { return { error: all.length + ' rows labelled "' + want + '"; pass --nth (1 = top)', matches: all.map(x => x.text) }; }
		const hit = all[(n || 1) - 1];
		return hit ? { hit } : { error: 'only ' + all.length + ' rows labelled "' + want + '"' };
	};
	const unmark = () => document.querySelectorAll('[data-dp-target]').forEach(e => e.removeAttribute('data-dp-target'));
`;

const steps: Record<string, string> = {
	rows: `(() => {${common}
		if (!scope) { return JSON.stringify({ ok: false, error: 'no view titled ' + VIEW + ' on screen' }); }
		return JSON.stringify({ ok: true, rows: rows().map(readRow).map(({ level, state, text }) => ({ level, state, text })) });
	})()`,

	mark: `(() => {${common}
		unmark();
		const { hit, error, matches } = find(${JSON.stringify(label ?? '')}, ${Number(nth) || 0});
		if (error) { return JSON.stringify({ ok: false, error, matches }); }
		const target = ${JSON.stringify(part)} === 'twisty' ? hit.twisty : (hit.el.querySelector('.positron-tree-content, .monaco-tl-contents') || hit.el);
		if (!target) { return JSON.stringify({ ok: false, error: 'the row has no expand button: it is a leaf' }); }
		target.scrollIntoView({ block: 'nearest' });
		target.setAttribute('data-dp-target', '1');
		return JSON.stringify({ ok: true, text: hit.text, state: hit.state, level: hit.level });
	})()`,

	// The context menu Positron shows: an upstream Monaco menu or Positron's own.
	'menu-mark': `(async () => {
		const clean = el => el ? el.textContent.replace(/\\s+/g, ' ').trim() : '';
		document.querySelectorAll('[data-dp-target]').forEach(e => e.removeAttribute('data-dp-target'));
		const WANT = ${JSON.stringify(view ?? '')};
		let items = [];
		for (let i = 0; i < 15 && !items.length; i++) {
			items = [...document.querySelectorAll('.context-view .action-menu-item, .monaco-menu .action-menu-item, .custom-context-menu-item, .positron-modal-popup [role=menuitem], [role=menu] [role=menuitem]')]
				.filter(e => e.offsetParent !== null);
			if (!items.length) { await new Promise(r => setTimeout(r, 100)); }
		}
		// Menu labels can start with an icon glyph and end with a keyboard
		// shortcut; compare the text with both stripped.
		const label = e => {
			let t = clean(e.querySelector('.action-label') || e);
			const kb = clean(e.querySelector('.keybinding, [class*=keybinding], [class*=shortcut]'));
			if (kb && t.endsWith(kb)) { t = t.slice(0, -kb.length); }
			return t.replace(/^[\\uE000-\\uF8FF\\s]+/, '').trim();
		};
		const shown = items.map(label).filter(Boolean);
		if (!items.length) { return JSON.stringify({ ok: false, error: 'no context menu is open' }); }
		const hit = items.find(e => label(e) === WANT);
		if (!hit) { return JSON.stringify({ ok: false, error: 'the menu has no item "' + WANT + '"', shown }); }
		hit.setAttribute('data-dp-target', '1');
		return JSON.stringify({ ok: true, item: WANT, shown });
	})()`,

	unmark: `(() => { document.querySelectorAll('[data-dp-target]').forEach(e => e.removeAttribute('data-dp-target')); return JSON.stringify({ ok: true }); })()`,
};

if (!steps[step]) {
	console.error('tree-page.ts: unknown step ' + step);
	process.exit(2);
}
console.log(steps[step]);
