/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Quarto inline output in the active .qmd editor: its cells, each cell's
// toolbar (found by its accessible name, "Quarto cell actions") and run state,
// and the output under each cell. The outputs are not in the accessibility
// tree (Monaco hides its view zones from it), so they are read from the page.
// qmd.sh wraps these.
//
// A cell's toolbar shows only for the cell under the mouse or the cursor, so
// each command puts the cursor in the cell and the mouse over it first.

import { readFileSync, existsSync } from 'fs';
import { Exit, inPage, log, logRead, mod, parse, secondsOf, textFlag, usage, type Json, type PageFn } from './dp-lib.ts';
import { names } from './selectors.ts';

interface Cell { n: number; language: string; fenceLine: number; firstCodeLine: number; endLine: number }

/**
 * The active editor's tab, its file's path, and whether it has unsaved edits;
 * with want, waits up to 3 s for that file's editor to be the active one and
 * its lines drawn, as it is a moment after an open-file switched tabs.
 * runs in run-code
 */
const activeFile: PageFn<{ want: string }> = async (page, a, lib) => {
	const read = () => page.evaluate(({ g, label, monaco }) => {
		const group = document.querySelector(g.active);
		const tab = group?.querySelector(g.activeTab);
		if (!tab) { return { ok: false, error: 'no editor is active' }; }
		// The tab's label names the full path, then any problems: /x/doc.qmd \u2022 1 problem.
		const path = (tab.querySelector(label.icon)?.getAttribute('aria-label') ?? '').split(' \u2022 ')[0];
		const drawn = !!group?.querySelector(`${monaco.editor} ${monaco.lineNumbers}`);
		return { ok: true, name: (tab.getAttribute('aria-label') ?? '').replace(/, Editor Group \d+$/, ''), path, dirty: tab.matches(g.dirty), drawn };
	}, { g: lib.css.editorGroup, label: lib.css.label, monaco: lib.css.monaco });
	let f = await read();
	for (let i = 0; i < 15 && a.want && !(f.ok && f.name === a.want && f.drawn); i++) { await lib.sleep(200); f = await read(); }
	return f;
};

/** The code cells of the saved file, from its fences. */
function cellsOf(path: string): Cell[] {
	const lines = readFileSync(path, 'utf8').split('\n');
	const cells: Cell[] = [];
	let open: Cell | null = null;
	lines.forEach((l, i) => {
		const n = i + 1;
		const start = !open && l.match(/^\s*```+\s*\{([a-zA-Z]+)/);
		if (start) { open = { n: cells.length + 1, language: start[1], fenceLine: n, firstCodeLine: n + 1, endLine: n }; cells.push(open); return; }
		if (open && /^\s*```+\s*$/.test(l)) { open.endLine = n; open = null; }
	});
	return cells;
}

interface Target { cell?: Cell; label: string; mod: string; seconds: number; cmd: string; text: string }

/**
 * Brings the cell on screen (cursor on its first code line, mouse over its
 * fence), then reads its toolbar and output; with run, stop or button, clicks
 * the toolbar button and waits for the state to move; with menu, opens More
 * cell actions and lists or chooses an item; with clear or link, clicks the
 * output's Clear output button or a link in it.
 * runs in run-code
 */
const cellAction: PageFn<Target> = async (page, a, lib) => {
	const monaco = lib.css.monaco;
	const editor = page.locator(`${lib.css.editorGroup.active} ${monaco.editor}`).filter({ visible: true }).first();
	// Positions of the drawn line numbers: Monaco draws only the lines on screen.
	const lineTop = (n: number) => editor.evaluate((ed, { ln, numbers }) => {
		const el = [...ed.querySelectorAll(numbers)].find(x => Number((x.textContent ?? '').trim()) === ln);
		if (!el) { return null; }
		const r = el.getBoundingClientRect();
		return { top: r.top, bottom: r.bottom, left: ed.getBoundingClientRect().left + 120 };
	}, { ln: n, numbers: monaco.lineNumbers });
	const cell = a.cell!;
	// Read this cell's toolbar (the one beside its fence line) and its output (the one under its closing fence).
	const read = () => editor.evaluate((ed, { c, q, numbers, toolbar }) => {
		const clean = (el: Element | null | undefined) => el ? (el.textContent ?? '').replace(/\s+/g, ' ').trim() : '';
		const nums = [...ed.querySelectorAll(numbers)].map(x => ({ n: Number((x.textContent ?? '').trim()), r: x.getBoundingClientRect() }));
		const near = (y: number) => nums.reduce<{ n: number; d: number } | null>((best, l) => { const d = Math.abs(l.r.top - y); return d < (l.r.height / 2 + 1) && (!best || d < best.d) ? { n: l.n, d } : best; }, null)?.n ?? null;
		const above = (y: number) => nums.filter(l => l.r.bottom <= y + 1).sort((p, q) => q.r.top - p.r.top)[0]?.n ?? null;
		const bar = [...ed.querySelectorAll(`[role=toolbar][aria-label="${toolbar}"]`)].find(t => near(t.getBoundingClientRect().top) === c.fenceLine);
		const style = bar ? getComputedStyle(bar) : null;
		const out = [...ed.querySelectorAll(q.output)].find(o => above(o.getBoundingClientRect().top) === c.endLine);
		// Marked, for clear and link to click inside it with real clicks.
		document.querySelectorAll('[data-dp-qmd-output]').forEach(e => e.removeAttribute('data-dp-qmd-output'));
		out?.setAttribute('data-dp-qmd-output', '');
		const wrap = out?.closest(q.outputWrapper) ?? out;
		// The status line is hidden (display: none) between runs, keeping its last
		// words ("Queued"): only a status line on screen counts.
		const drawn = (e: Element | null | undefined) => !!e && e.getClientRects().length > 0;
		const icon = [wrap?.querySelector(q.footerIcon)].find(drawn);
		const footerText = [wrap?.querySelector(q.footerText)].find(drawn);
		return {
			toolbar: bar ? {
				state: bar.getAttribute(q.stateAttr),
				// The last run's id, kept after it ends: a new one means the cell ran,
				// even when it printed nothing and its state reads as before.
				executionId: bar.getAttribute(q.executionIdAttr),
				shown: style!.visibility !== 'hidden' && Number(style!.opacity) > 0.1,
				buttons: [...bar.querySelectorAll('button')].map(b => (b.getAttribute('aria-label') ?? '') + ((b as HTMLButtonElement).disabled ? ' (off)' : '')),
			} : null,
			output: out ? {
				status: icon ? ['running', 'pending', 'success', 'error'].find(s => icon.classList.contains(s)) ?? null : 'none',
				footer: [...(footerText?.children ?? [])].map(clean).filter(Boolean).join(' | ') || null,
				kinds: [...new Set([...out.querySelectorAll(`[class*="${q.outputKindClass}"]`)].flatMap(e => [...e.classList])
					.map(k => (k.match(new RegExp(`^${q.outputKindClass}(stdout|stderr|error|image|html|webview-container|data-explorer|truncation-header)$`)) ?? [])[1]).filter(Boolean))],
				text: ((out.querySelector(q.content) as HTMLElement | null)?.innerText ?? '').replace(/\u00A0/g, ' ').trim().slice(0, 2000),
			} : null,
		};
	}, { c: cell, q: lib.css.qmd, numbers: monaco.lineNumbers, toolbar: lib.names.qmd.cellActions });
	// Cursor into the cell (Go to Line), then the mouse over its fence line, once
	// the line holds still: outputs drawn a moment after a file opens (an image)
	// push the lines down, and a mouse left above them shows no toolbar.
	// With the closing fence (end), the cursor and mouse go there instead: the
	// output sits under it, off screen in a short editor while the cursor is at
	// the cell's top.
	// Outputs drawn above the cell meanwhile (a tall image) can push the line off
	// screen again, and focus in an output's webview takes no shortcut: up to
	// three tries, taking focus out of the page's frames before each again.
	const goTo = async (end = false) => {
		const line = end ? cell.endLine : cell.fenceLine;
		let at: Awaited<ReturnType<typeof lineTop>> = null;
		for (let tries = 0; tries < 3 && !at; tries++) {
			await lib.closeQuickInput();
			if (tries) { await lib.blur(); }
			if (!await lib.openQuickInput(a.mod + '+Shift+p', ':' + (end ? cell.endLine : cell.firstCodeLine))) { continue; }
			await page.keyboard.press('Enter');
			at = await lineTop(line);
			for (let i = 0; i < 10; i++) {
				await lib.sleep(150);
				const now = await lineTop(line);
				if (at && now && Math.abs(now.top - at.top) < 1) { break; }
				at = now;
			}
		}
		if (at) { await page.mouse.move(at.left, (at.top + at.bottom) / 2); await lib.sleep(200); }
		return !!at;
	};
	// A menu left open (button N 'More cell actions') would take the keys and
	// clicks. lib.closeMenu presses Escape only while the menu has focus, which
	// keeps it from Quarto's Interrupt Kernel.
	const closeMenu = lib.closeMenu;
	if (!await closeMenu()) { return { ok: false, error: 'a menu is open and focus is not in it, so no Escape was pressed (it would interrupt a busy kernel); close the menu first' }; }
	if (!await goTo()) { return { ok: false, error: `could not bring cell ${cell.n} (line ${cell.fenceLine}) on screen` }; }
	let now = await read();
	// The toolbars are drawn again after a settings change or a kernel start:
	// wait up to 3 s for this one, moving the mouse over the cell again.
	for (let i = 0; i < 3 && (!now.toolbar || !now.toolbar.shown) && a.cmd !== 'state'; i++) { await lib.sleep(700); await goTo(); now = await read(); }
	// The output is under the closing fence: when that line is off screen, go
	// there to read it (not before a toolbar click, which needs the fence on screen).
	if (!now.output && ['state', 'clear', 'link'].includes(a.cmd)) {
		const bar = now.toolbar;
		await goTo(true);
		now = { ...(await read()), ...(bar ? { toolbar: bar } : {}) };
	}
	if (!now.toolbar) { return { ok: false, error: `no cell toolbar beside line ${cell.fenceLine} after 3 s; is inline output on (quarto.inlineOutput.enabled)?`, cell: cell.n, output: now.output }; }
	const base = { cell: cell.n, fenceLine: cell.fenceLine };
	if (a.cmd === 'state') { return { ok: true, ...base, ...now }; }
	if (a.cmd === 'wait') {
		// Until the cell's toolbar shows its Run button again (it reads Stop while
		// the cell runs, Cancel while it waits), in two reads 500 ms apart: between
		// queued and running it can show Run for a moment. A cell scrolled off by
		// its growing output is brought back and read again.
		const shows = (x: typeof now) => !!x.toolbar?.buttons.includes(a.label);
		const end = Date.now() + a.seconds * 1000;
		let seen = 0;
		while (seen < 2 && Date.now() < end) {
			seen = shows(now) ? seen + 1 : 0;
			if (seen < 2) { await lib.sleep(500); now = await read(); }
			if (!now.toolbar) { await goTo(); now = await read(); }
		}
		// A cell not on screen at the end has no reading: say so, with no output.
		if (!now.toolbar) { return { ok: false, ...base, error: `could not bring cell ${cell.n} (line ${cell.fenceLine}) on screen to read it at the end of the wait; nothing was read` }; }
		const still = seen < 2;
		return { ok: !still, ...base, ...now, ...(still ? { error: `"${a.label}" did not show on cell ${cell.n}'s toolbar within ${a.seconds} s; its buttons: ${now.toolbar.buttons.join(', ')}` } : {}) };
	}
	if (!now.toolbar.shown) { return { ok: false, ...base, ...now, error: 'the cell toolbar did not show after moving the mouse over the cell three times' }; }
	// What opens on top (More cell actions' menu) is a change too.
	const overlays = () => page.locator(lib.css.overlay.any).filter({ visible: true }).and(page.locator(lib.css.overlay.notInToasts)).count();
	const overlaysBefore = await overlays();
	if (a.cmd === 'clear' || a.cmd === 'link') {
		if (!now.output) { return { ok: false, ...base, ...now, error: `cell ${cell.n} has no output under it` }; }
		const out = page.locator('[data-dp-qmd-output]');
		// Monaco scrolls its own content: Playwright's hover and click scroll an
		// element of an output into view by moving the DOM under Monaco, and then
		// miss it ("outside of the viewport"). So the mouse goes only where the
		// element shows inside the editor, and the editor is wheeled to bring it
		// there, as a person scrolls.
		const hoverIn = async (el: typeof out) => {
			const [b, e] = [await el.boundingBox(), await editor.boundingBox()];
			if (!b || !e) { return false; }
			const top = Math.max(b.y, e.y);
			const bottom = Math.min(b.y + b.height, e.y + e.height);
			if (bottom <= top) { return false; }
			await page.mouse.move(b.x + Math.min(b.width / 2, 20), (top + bottom) / 2);
			return true;
		};
		const inView = async (el: typeof out) => {
			for (let i = 0; i < 6; i++) {
				const [b, e] = [await el.boundingBox(), await editor.boundingBox()];
				if (!b || !e) { return false; }
				if (b.y >= e.y && b.y + b.height <= e.y + e.height) { return true; }
				await page.mouse.move(e.x + e.width / 2, e.y + e.height / 2);
				await page.mouse.wheel(0, b.y - (e.y + Math.min(e.height / 3, 60)));
				await lib.sleep(250);
			}
			return false;
		};
		// The output's buttons show while the mouse is over it.
		await hoverIn(out);
		await lib.sleep(150);
		if (a.cmd === 'clear') {
			const clear = out.locator(`[aria-label="${lib.names.qmd.clearOutput}"]`);
			if (!await clear.count()) { return { ok: false, ...base, ...now, error: `the output has no "${lib.names.qmd.clearOutput}" button: while the cell runs it reads Interrupt execution; stop the cell first` }; }
			if (!await inView(clear.first())) { return { ok: false, ...base, ...now, error: `could not scroll "${lib.names.qmd.clearOutput}" into the editor's view; nothing was clicked` }; }
			await hoverIn(out);
			await clear.first().click({ timeout: 3000 });
			for (let i = 0; i < 20 && now.output; i++) { await lib.sleep(150); now = await read(); }
			// The view zones move as the output goes: read the cell again from its place.
			if (!now.output) { await lib.sleep(300); await goTo(); now = await read(); }
			return now.output ? { ok: false, ...base, ...now, cleared: false, error: `the output was still there 3 s after clicking "${lib.names.qmd.clearOutput}"` } : { ok: true, clicked: lib.names.qmd.clearOutput, ...base, ...now, cleared: true, changed: true };
		}
		// A link: the one whose name or text holds the text given ("open in
		// editor"). Quarto draws its links as buttons (an <a role=button>), so
		// links and buttons both count, the ones on screen once the mouse is over.
		const links = out.locator('a, button, [role=link], [role=button]').filter({ visible: true });
		const names = await links.evaluateAll(es => es.map(e => [(e.getAttribute('aria-label') ?? ''), (e.textContent ?? '').replace(/\s+/g, ' ').trim()]));
		const want = a.text.toLowerCase();
		const hits = names.flatMap((n, i) => n.some(x => x.toLowerCase().includes(want)) ? [i] : []);
		const listed = names.map(n => n[1] || n[0]).filter(Boolean);
		if (hits.length !== 1) { return { ok: false, ...base, error: hits.length ? `${hits.length} links or buttons in cell ${cell.n}'s output hold "${a.text}"` : `no link or button in cell ${cell.n}'s output holds "${a.text}"`, links: listed }; }
		const link = links.nth(hits[0]);
		const clicked = listed[hits[0]] ?? a.text;
		if (!await inView(link)) { return { ok: false, ...base, error: `could not scroll "${clicked}" into the editor's view; nothing was clicked` }; }
		const editors = () => page.evaluate(g => ({
			active: (document.querySelector(`${g.active} ${g.activeTab}`)?.getAttribute('aria-label') ?? '').replace(/, Editor Group \d+$/, '') || null,
			tabs: [...document.querySelectorAll(`${g.group} [role=tab]`)].map(t => (t.getAttribute('aria-label') ?? '').replace(/, Editor Group \d+$/, '')),
		}), lib.css.editorGroup);
		const was = await editors();
		await link.click({ timeout: 3000 });
		let is = was;
		for (let i = 0; i < 20; i++) { await lib.sleep(150); is = await editors(); if (JSON.stringify(is) !== JSON.stringify(was) || await overlays() > overlaysBefore) { break; } }
		const opened = await overlays() > overlaysBefore;
		const tabs = [...is.tabs];
		for (const t of was.tabs) { const k = tabs.indexOf(t); if (k >= 0) { tabs.splice(k, 1); } }
		const changed = JSON.stringify(is) !== JSON.stringify(was) || opened;
		return {
			ok: changed, clicked, ...base, changed, activeEditor: is.active, editorTabs: is.tabs.length,
			...(tabs.length ? { newTabs: tabs } : {}), ...(opened ? { opened: 'a dialog, menu or quick pick opened' } : {}),
			...(changed ? {} : { error: `clicking "${clicked}" opened or changed nothing within 3 s` }),
		};
	}
	// The toolbar's run button reads Stop or Cancel while the cell runs or waits.
	const want = a.cmd === 'menu' ? lib.names.qmd.moreActions : a.label;
	const bar = editor.getByRole('toolbar', { name: lib.names.qmd.cellActions }).filter({ visible: true });
	const buttons = bar.getByRole('button', { name: want, exact: true });
	if (!await buttons.count()) {
		return { ok: false, ...base, ...now, error: `no "${want}" button: the toolbar shows ${now.toolbar.buttons.join(', ')}` };
	}
	const was = now;
	const before = JSON.stringify(now);
	// Click only while the button still has that name: a cell that finishes in
	// between turns Stop back into Run.
	try { await buttons.first().click({ timeout: 2000 }); } catch {
		return { ok: false, ...base, ...(await read()), error: `the "${want}" button went away before the click (the cell finished or started); nothing was clicked` };
	}
	if (a.cmd === 'menu') {
		for (let i = 0; i < 20 && !await lib.menu(); i++) { await lib.sleep(150); }
		const m = await lib.menu();
		if (!m) { return { ok: false, ...base, ...now, error: `no menu opened within 3 s of clicking "${want}"` }; }
		const items = m.names.map((n, i) => m.off[i] ? n + ' (off)' : n);
		if (!a.text) {
			const closed = await closeMenu();
			return { ok: true, ...base, items, ...(closed ? {} : { note: 'the menu is still open: focus was not in it, so no Escape was pressed' }) };
		}
		const c = await lib.choose(a.text);
		if (!c.ok) { return { ...c, ...base }; }
		await lib.sleep(300);
		const e = await lib.editor();
		return { ok: true, ...base, chose: c.chose, ...(await read()), dirty: e.dirty };
	}
	// Up to 3 s for the cell to read differently (its toolbar or its output) or
	// for something to open on top, then for it to hold still for 300 ms, as
	// ui.sh waits for a view: the answer is the cell as it reads then, beside
	// how it read before the click.
	let opened = false;
	let last = before;
	let movedAt = 0;
	for (const end = Date.now() + 3000; Date.now() < end;) {
		await lib.sleep(150);
		now = await read();
		opened = await overlays() > overlaysBefore;
		if (opened) { break; }
		const s = JSON.stringify(now);
		if (s !== last) { last = s; movedAt = Date.now(); } else if (movedAt && Date.now() - movedAt >= 300) { break; }
	}
	// A click can scroll the editor or redraw the toolbars: read the cell again
	// from its own place before reporting it, and say so if it is not there.
	if (!now.toolbar) { await goTo(); now = await read(); }
	if (!now.toolbar) { return { ok: false, clicked: want, ...base, ...now, error: `after clicking "${want}", cell ${cell.n}'s toolbar is not beside line ${cell.fenceLine}; read it with qmd.sh state ${cell.n}` }; }
	const menu = opened ? await lib.menu() : null;
	return {
		ok: true, clicked: want, ...base, ...now, changed: JSON.stringify(now) !== before || opened, before: { toolbar: was.toolbar, output: was.output },
		...(opened ? { opened: menu ? 'a menu' : 'a dialog or quick pick', ...(menu ? { menu: menu.names.map((n, i) => menu.off[i] ? n + ' (off)' : n) } : {}) } : {}),
	};
};

/** Every output on screen, under which line, with the visible line range. runs in run-code */
const readScreen: PageFn<Record<string, never>> = async (page, _a, lib) => page.locator(`${lib.css.editorGroup.active} ${lib.css.monaco.editor}`).filter({ visible: true }).first().evaluate((ed, { monaco, q }) => {
	const nums = [...ed.querySelectorAll(monaco.lineNumbers)].map(x => ({ n: Number((x.textContent ?? '').trim()), r: x.getBoundingClientRect() }));
	const above = (y: number) => nums.filter(l => l.r.bottom <= y + 1).sort((p, q) => q.r.top - p.r.top)[0]?.n ?? null;
	const first = nums.length ? Math.min(...nums.map(l => l.r.top)) : 0;
	const outputs = [...ed.querySelectorAll<HTMLElement>(q.output)].filter(o => o.offsetParent !== null).map(o => ({
		afterLine: above(o.getBoundingClientRect().top) ?? (o.getBoundingClientRect().top < first ? 'above view' : null),
		text: (o.querySelector<HTMLElement>(q.content)?.innerText ?? '').replace(/\u00A0/g, ' ').trim().slice(0, 400),
	}));
	// Monaco scrolls past the last line: after a tall output at the end is
	// cleared, the editor can show one line and empty space, which is the truth
	// on screen but reads like a wrong range, so say so.
	const box = ed.getBoundingClientRect();
	const lowest = Math.max(...nums.map(l => l.r.bottom), ...[...ed.querySelectorAll(q.output)].map(o => o.getBoundingClientRect().bottom), box.top);
	const pastEnd = nums.length > 0 && Math.min(...nums.map(l => l.n)) > 1 && lowest - box.top < box.height / 2;
	return {
		ok: true, visible: nums.length ? `${Math.min(...nums.map(l => l.n))}-${Math.max(...nums.map(l => l.n))}` : null, outputs,
		...(pastEnd ? { note: 'the editor is scrolled past the end of the file: these are the last lines, with empty space below them' } : {}),
	};
}, { monaco: lib.css.monaco, q: lib.css.qmd });

export const qmdCommands: Record<string, (argv: string[]) => Json | string> = {
	qmd: argv => {
		const p = parse(argv, ['session', 'file'], { cells: 1, read: 1, state: 2, run: 2, stop: 2, clear: 2, wait: 3, button: 3, menu: 3, link: 3 });
		const [cmd, a1, a2] = p.rest;
		if (p.flags.help || !cmd) { usage('qmd.sh'); }
		// wait N SECS: refused before anything is read or done.
		const waitFor = cmd === 'wait' ? secondsOf(a2, 'SECS', 60) : 60;
		const f = inPage(p.session, activeFile, { want: textFlag(p, 'file') });
		if (!f.ok) { return f; }
		// Refuse to act on another file than the one meant: a failed open leaves the last one active.
		if (p.flags.file && f.name !== p.flags.file) { return { ok: false, error: `the active editor is ${f.name}, not ${p.flags.file}; open it first`, file: f.name }; }
		if (!String(f.name).endsWith('.qmd')) { return { ok: false, error: `the active editor is ${f.name}, not a .qmd`, file: f.name }; }
		const path = String(f.path).replace(/^~(?=\/)/, process.env.HOME ?? '~');
		if (!existsSync(path)) { return { ok: false, error: `cannot find ${path} on disk; save it first`, file: f.name }; }
		const cells = cellsOf(path);
		const file = { file: f.name, ...(f.dirty ? { dirty: true } : {}) };
		if (cmd === 'cells') { return { ok: true, ...file, cells }; }
		if (cmd === 'read') {
			const r = inPage(p.session, readScreen, {});
			// Cells whose closing fence is off screen were not read, but for the
			// nearest ones above whose outputs still reach into view ("above view").
			const [lo, hi] = String(r.visible ?? '0-0').split('-').map(Number);
			const seenAbove = ((r.outputs ?? []) as { afterLine: unknown }[]).filter(o => o.afterLine === 'above view').length;
			const above = cells.filter(c => c.endLine < lo);
			const off = [...above.slice(0, above.length - seenAbove), ...cells.filter(c => c.endLine > hi)].map(c => c.n);
			if (r.ok) { logRead('qmd.sh', p.session, `${f.name} lines ${r.visible}: ${(r.outputs as { afterLine: unknown; text: string }[]).map(o => `after ${o.afterLine} ${JSON.stringify(o.text.slice(0, 60))}`).join(', ') || 'no outputs'}${off.length ? `; cells ${off.join(', ')} off screen, not read` : ''}`); }
			return { ...r, ...(r.ok && off.length ? { notRead: off, notReadNote: `${off.length} of ${cells.length} cells end off screen (cells ${off.join(', ')}): their outputs, if any, were not read; qmd.sh state N reads one cell's` } : {}), ...file };
		}
		if (!['run', 'stop', 'wait', 'state', 'button', 'menu', 'clear', 'link'].includes(cmd)) { throw new Exit(2, { ok: false, error: 'command: cells, read, state, run, wait, stop, button, menu, clear or link' }); }
		const cell = cells.find(c => c.n === Number(a1));
		if (!cell) { return { ok: false, error: `no cell ${a1} in ${f.name}; it has ${cells.length}`, ...file }; }
		// Lines come from the saved file: after unsaved edits they point at the wrong cell.
		if (f.dirty && cmd !== 'wait' && cmd !== 'state') { return { ok: false, error: `${f.name} has unsaved edits, so the saved file's line numbers may not match the editor; save it first (File: Save)`, ...file }; }
		// wait waits for the Run button to show again.
		const label = cmd === 'run' || cmd === 'wait' ? names.qmd.run : cmd === 'stop' ? '' : String(a2 ?? '');
		if (cmd === 'button' && !label) { throw new Exit(2, { ok: false, error: 'give the button label' }); }
		if (cmd === 'link' && !a2) { throw new Exit(2, { ok: false, error: 'give the text of the link, such as "open in editor"' }); }
		const text = ['menu', 'link'].includes(cmd) ? String(a2 ?? '') : '';
		let out: Json;
		if (cmd === 'stop') {
			// Stop while running, Cancel while queued.
			out = inPage(p.session, cellAction, { cell, label: names.qmd.stop, mod, seconds: 0, cmd, text });
			if (!out.ok && String(out.error).includes(`no "${names.qmd.stop}"`)) {
				out = inPage(p.session, cellAction, { cell, label: names.qmd.cancel, mod, seconds: 0, cmd, text });
				const shown = String(out.error).match(/: the toolbar shows (.*)$/);
				if (!out.ok && shown) { out = { ...out, error: `no "${names.qmd.stop}" or "${names.qmd.cancel}" button: the toolbar shows ${shown[1]}` }; }
			}
		} else {
			out = inPage(p.session, cellAction, { cell, label, mod, seconds: waitFor, cmd, text });
		}
		// The cell after the action: its toolbar state and output.
		const t = out.toolbar as { state: string } | null;
		const o = out.output as { status: string; text: string } | null;
		const cellNow = `${t?.state ?? 'no toolbar'}, output ${o ? `${o.status} ${JSON.stringify(o.text)}` : 'none drawn'}`;
		if (out.clicked && out.ok) { log('qmd.sh', p.session, `${f.name} cell ${cell.n}: click ${out.clicked}`, cmd === 'link' ? `active editor ${out.activeEditor}` : cellNow); }
		if (out.chose) { log('qmd.sh', p.session, `${f.name} cell ${cell.n}: More cell actions, ${out.chose}`, cellNow); }
		// A failed state or wait is logged as a failure, with its error, not as a reading.
		if ((cmd === 'state' || cmd === 'wait') && out.ok) {
			const o = out.output as { status: string; footer: string; text: string } | null;
			logRead('qmd.sh', p.session, `${f.name} cell ${cell.n}${cmd === 'wait' ? ' after wait' : ''}: ${t?.state ?? 'no toolbar'}, output ${o ? `${o.status} ${o.footer ?? ''} ${JSON.stringify(o.text)}` : 'none drawn'}`);
		}
		return { ...out, ...file };
	},
};
