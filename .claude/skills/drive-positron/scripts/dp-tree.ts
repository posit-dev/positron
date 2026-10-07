/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// A tree in a view: upstream trees (Explorer, Outline) are lists of treeitems
// with levels and expanded states in the accessibility tree; Positron's own
// trees (Data Connections) are a grid with no rows, levels or states there, so
// their rows are read from the page until they get those roles. Rows are found
// by label: the whole text of one piece of the row ("orders", without its
// "Table" prefix). tree.sh wraps these.

import { Exit, inPage, log, parse, textFlag, usage, type Json, type PageFn } from './dp-lib.ts';

interface Args { view: string; cmd: string; label: string; nth: number; item: string }

// runs in run-code
const tree: PageFn<Args> = async (page, a, lib) => {
	let scope = page.locator('body');
	if (a.view) {
		const sc = await lib.scope(a.view);
		if (!('loc' in sc) || !sc.loc) { return { ok: false, ...sc }; }
		scope = sc.loc;
	}
	// Every visible row, top to bottom: level (0 = top), state and pieces of text.
	const t = lib.css.tree;
	const read = () => scope.evaluate((root, t) => {
		const clean = (e: Element | null | undefined) => e ? (e.textContent ?? '').replace(/\s+/g, ' ').trim() : '';
		const rows = [...root.querySelectorAll<HTMLElement>(`${t.row}, ${t.listRow}`)]
			.filter(r => r.offsetParent !== null)
			.sort((p, q) => p.getBoundingClientRect().top - q.getBoundingClientRect().top);
		return rows.map((r, index) => {
			const positron = r.matches(t.row);
			const content = (positron ? r.querySelector(t.content) : r.querySelector(t.listContent)) ?? r;
			const twisty = positron ? r.querySelector(t.twisty) : r.querySelector(t.listTwisty);
			const state = positron
				? ((twisty?.className.match(new RegExp(t.twistyClass + '(\\w+)')) ?? [])[1] ?? '')
				: r.getAttribute('aria-expanded') === 'true' ? 'expanded' : r.getAttribute('aria-expanded') === 'false' ? 'collapsed' : 'leaf';
			const indent = positron ? r.querySelector(t.indent) : null;
			const level = positron
				? Math.round((indent?.getBoundingClientRect().width ?? 0) / (parseFloat(getComputedStyle(indent ?? r).getPropertyValue(t.indentVar)) || 8))
				: Number(r.getAttribute('aria-level') ?? 1) - 1;
			// Each piece, and each part of a piece joined by " \u00B7 " ("Shop \u00B7 SQLite"), is a label.
			const leaves = [...content.querySelectorAll('*')].filter(e => e.children.length === 0).map(clean).filter(Boolean);
			const pieces = [...new Set([...leaves, ...leaves.flatMap(p => p.split(/\s+\u00B7\s+/)), ...clean(content).split(/\s+\u00B7\s+/)])];
			r.setAttribute('data-dp-row', String(index));
			return { index, level, state, text: clean(content), pieces, hasTwisty: !!twisty && !twisty.matches(t.leaf) };
		});
	}, t);
	const rows = await read();
	if (a.cmd === 'rows') { return { ok: true, rows: rows.map(({ level, state, text }) => ({ level, state, text })) }; }
	const hits = rows.filter(x => x.pieces.includes(a.label) || x.text === a.label);
	if (!hits.length) { return { ok: false, error: `no visible row labelled "${a.label}"; expand its parent or scroll` }; }
	if (!a.nth && hits.length > 1) { return { ok: false, error: `${hits.length} rows labelled "${a.label}"; pass --nth (1 = top)`, matches: hits.map(x => x.text) }; }
	const hit = hits[(a.nth || 1) - 1];
	if (!hit) { return { ok: false, error: `only ${hits.length} rows labelled "${a.label}"` }; }
	const row = scope.locator(`[data-dp-row="${hit.index}"]`);
	const content = row.locator(`${t.content}, ${t.listContent}`).first();
	const twisty = row.locator(`${t.twisty}, ${t.listTwisty}`).first();
	const now = async () => (await read()).find(x => x.text === hit.text && x.level === hit.level);
	switch (a.cmd) {
		case 'expand': case 'collapse': {
			const want = a.cmd === 'expand' ? 'expanded' : 'collapsed';
			if ((a.cmd === 'expand' && hit.state === 'expanded') || (a.cmd === 'collapse' && hit.state !== 'expanded')) { return { ok: true, text: hit.text, state: hit.state, level: hit.level, changed: false }; }
			if (!hit.hasTwisty) { return { ok: false, error: 'the row has no expand button: it is a leaf' }; }
			await twisty.scrollIntoViewIfNeeded().catch(() => { });
			await twisty.click({ timeout: 3000 });
			// Loading children can take a moment.
			let after = await now();
			for (let i = 0; i < 15 && (!after || after.state === 'loading' || after.state === hit.state); i++) { await lib.sleep(200); after = await now(); }
			const reached = after?.state === want;
			// A row in an error state can collapse when clicked: say whether it reached the state asked.
			return { ok: reached, text: hit.text, level: hit.level, before: hit.state, state: after?.state ?? null, changed: after?.state !== hit.state, ...(reached ? {} : { error: `the row is ${after?.state}, not ${want}, after the click` }) };
		}
		case 'click':
			await content.click({ timeout: 3000 });
			return { ok: true, text: hit.text, state: hit.state, level: hit.level };
		case 'menu': {
			await content.click({ button: 'right', timeout: 3000 });
			const items = page.locator(lib.css.menu.treeItems).filter({ visible: true });
			try { await items.first().waitFor({ timeout: 2000 }); } catch { return { ok: false, error: 'no context menu opened' }; }
			// Menu labels can start with an icon glyph and end with a shortcut.
			const shown = await items.evaluateAll((es, m) => es.map(e => {
				let text = ((e.querySelector(m.label) ?? e).textContent ?? '').replace(/\s+/g, ' ').trim();
				const kb = (e.querySelector(m.keybinding)?.textContent ?? '').trim();
				if (kb && text.endsWith(kb)) { text = text.slice(0, -kb.length); }
				return text.replace(/^[\uE000-\uF8FF\s]+/, '').trim();
			}), lib.css.menu);
			const at = shown.findIndex(x => x === a.item);
			if (at < 0) { await lib.closeMenu(); return { ok: false, error: `the menu has no item "${a.item}"`, shown }; }
			await items.nth(at).hover(); await lib.sleep(100); await items.nth(at).click({ timeout: 3000 });
			return { ok: true, row: hit.text, item: a.item, shown };
		}
	}
	return { ok: false, error: 'command: rows, expand, collapse, click or menu' };
};

export const treeCommands: Record<string, (argv: string[]) => Json | string> = {
	tree: argv => {
		const p = parse(argv, ['session', 'view', 'nth'], { rows: 1, expand: 2, collapse: 2, click: 2, menu: 3 });
		const [cmd, label, item] = p.rest;
		if (p.flags.help || !cmd) { usage('tree.sh'); }
		if (cmd !== 'rows' && !label) { throw new Exit(2, { ok: false, error: 'give the row label' }); }
		if (cmd === 'menu' && !item) { throw new Exit(2, { ok: false, error: 'give the row label and the menu item' }); }
		const view = textFlag(p, 'view');
		const out = inPage(p.session, tree, { view, cmd, label: label ?? '', nth: Number(p.flags.nth ?? 0), item: item ?? '' });
		if (out.ok && cmd !== 'rows' && out.changed !== false) {
			log('tree.sh', p.session, `${cmd === 'menu' ? `menu "${item}" on` : cmd} "${label}"${p.flags.nth ? ` (nth ${p.flags.nth})` : ''} in ${view || 'any view'}`);
		}
		return out;
	},
};
