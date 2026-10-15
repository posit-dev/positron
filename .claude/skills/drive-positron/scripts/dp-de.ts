/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The active Data Explorer's grid: its column headers (role columnheader), the
// top rows' values under them, and the status bar. The grid's cells have no
// roles, so they are read from the page; the grid draws only the columns in
// view, so it is scrolled sideways with the wheel events it handles itself,
// collecting as it goes, and scrolled back. de-read.sh wraps this.

import { count, inPage, logRead, parse, usage, type Json, type PageFn } from './dp-lib.ts';

// runs in run-code
const read: PageFn<{ rows: number; title: string }> = async (page, a, lib) => {
	const group = page.locator(lib.css.editorGroup.active);
	const active = await group.getByRole('tab', { selected: true }).first().getAttribute('aria-label').catch(() => null);
	if (a.title && active !== a.title) { return { ok: false, error: `the active tab is ${active}, not ${a.title}` }; }
	return group.evaluate(async (g, args) => {
		const clean = (e: Element | null | undefined) => e ? (e.textContent ?? '').replace(/\s+/g, ' ').trim() : '';
		// The summary panel is a grid too; the table is the one with column headers.
		const grid = [...g.querySelectorAll<HTMLElement>('[role=grid]')].find(w => w.offsetParent !== null && w.querySelector('[role=columnheader]'));
		if (!grid) { return { ok: false, error: 'no Data Explorer grid in the active editor' }; }
		const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
		const wheel = (dx: number) => grid.dispatchEvent(new WheelEvent('wheel', { deltaX: dx, deltaY: 0, bubbles: true, cancelable: true }));
		const headers = () => [...grid.querySelectorAll<HTMLElement>('[role=columnheader]')].filter(h => h.offsetParent !== null)
			.map(h => ({ x: h.getBoundingClientRect().left, name: clean(h.querySelector(args.grid.headerTitle)) || clean(h) }));
		const rowsNow = () => [...grid.querySelectorAll<HTMLElement>(args.grid.row)].filter(r => r.offsetParent !== null)
			.sort((p, q) => p.getBoundingClientRect().top - q.getBoundingClientRect().top).slice(0, args.rows)
			.map(r => [...r.querySelectorAll(args.grid.cell)].map(c => ({ x: c.getBoundingClientRect().left, text: clean(c) })));
		const columns: string[] = [];
		const rows: Record<string, string>[] = Array.from({ length: args.rows }, () => ({}));
		let moved = 0;
		for (let pageNo = 0; pageNo < 200; pageNo++) {
			const hs = headers().sort((p, q) => p.x - q.x);
			const before = columns.length;
			const names: string[] = [];
			for (const h of hs) {
				// Column names are taken as unique; a second of one name gets " (2)".
				let name = h.name;
				let n = 1;
				while (names.includes(name)) { name = `${h.name} (${++n})`; }
				names.push(name);
				if (!columns.includes(name)) { columns.push(name); }
			}
			// Each row's cells line up with the headers by position.
			rowsNow().forEach((cells, i) => {
				for (const c of cells) {
					const h = hs.findIndex(x => Math.abs(x.x - c.x) < 2);
					if (h >= 0) { rows[i][names[h]] = c.text; }
				}
			});
			if (pageNo > 0 && columns.length === before) { break; }
			const width = grid.getBoundingClientRect().width;
			wheel(width * 0.8);
			moved += width * 0.8;
			await frame();
			await new Promise(r => setTimeout(r, 120));
		}
		wheel(-moved * 2);
		await frame();
		const status = clean(g.querySelector(args.grid.status));
		const used = rows.filter(r => Object.keys(r).length);
		return { ok: true, title: args.active, status, columns, rows: used.map(r => Object.fromEntries(columns.map(c => [c, c in r ? r[c] : null]))) };
	}, { rows: a.rows, active, grid: lib.css.dataGrid });
};

export const deCommands: Record<string, (argv: string[]) => Json | string> = {
	'de-read': argv => {
		const p = parse(argv, ['session', 'rows', 'title']);
		if (p.flags.help) { usage('de-read.sh'); }
		const out = inPage(p.session, read, { rows: count(p, 'rows', 10, 1, 'how many rows to read'), title: String(p.flags.title ?? '') });
		if (out.ok) { logRead('de-read.sh', p.session, `${out.title}: ${out.status}; ${(out.columns as string[]).join(', ')}; ${(out.rows as Record<string, unknown>[]).slice(0, 3).map(r => Object.values(r).join(' ')).join(' | ')}`); }
		return out;
	},
};
