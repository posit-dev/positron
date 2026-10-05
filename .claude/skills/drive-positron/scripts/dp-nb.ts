/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The Positron notebook editor, for the notebook named: its cells and their
// run state, by the notebook's accessibility tree (each cell an article with a
// status and a "Cell output" region; toolbars of named buttons). Two things are
// not in that tree and are read from the page: a cell's source (Monaco draws
// it without exposing it) and the kernel badge (by its test id). nb.sh wraps
// these.

import { readFileSync } from 'fs';
import { Exit, inPage, log, logRead, mod, parse, pause, usage, type Json, type PageFn } from './dp-lib.ts';
import { notifications } from './dp-notifications.ts';
import { paletteRun } from './dp-palette.ts';
import { names } from './selectors.ts';

interface Args { notebook: string; cmd: string; n: number; arg: string; timeout: number; mod: string; replace?: boolean }

/**
 * Finds the notebook's editor (refusing when another editor is in front), then
 * reads its cells or acts on one.
 * runs in run-code
 */
const nb: PageFn<Args> = async (page, a, lib) => {
	const n$ = lib.names.nb;
	const group = page.locator(lib.css.editorGroup.active);
	const active = await group.getByRole('tab', { selected: true }).first().getAttribute('aria-label').catch(() => null);
	if (active !== a.notebook) { return { ok: false, error: `the active editor is ${active ?? 'none'}, not ${a.notebook}; open it with open-file.sh` }; }
	const cells = group.getByRole('article');
	if (!await cells.count()) { return { ok: false, error: `${a.notebook} is not open in the Positron notebook editor` }; }

	// One cell as the tree reads it: kind (its article's name), count, the
	// status line, and the "Cell output" region's text and kinds.
	const readCell = (c: ReturnType<typeof page.locator>, i: number) => c.evaluate((el, { n, labels, viewLine }) => {
		const clean = (e: Element | null | undefined) => e ? (e.textContent ?? '').replace(/\s+/g, ' ').trim() : '';
		const name = el.getAttribute('aria-label') ?? '';
		const kind = /^code cell/i.test(name) ? 'code' : /^markdown cell/i.test(name) ? 'markdown' : name;
		// The status line's words are its aria-label ("Cell execution succeeded. 31ms. Just now").
		const said = (e: Element) => e.getAttribute('aria-label') || clean(e);
		const statusEl = [...el.querySelectorAll('[role=status]')].find(e => /cell execution|queued|pending|running|executing/i.test(said(e)));
		const status = statusEl ? said(statusEl) : null;
		const state = !status ? '' : /succeeded/i.test(status) ? 'success' : /failed|error/i.test(status) ? 'error' : /queued|pending/i.test(status) ? 'pending' : /running|executing|progress/i.test(status) ? 'running' : status;
		const count = ([...el.querySelectorAll('*')].map(e => clean(e)).find(t => /^\[\s*\d*\s*\]$/.test(t)) ?? '').replace(/[[\]\s]/g, '') || null;
		const out = el.querySelector(`[role=region][aria-label="${labels.cellOutput}"]`) as HTMLElement | null;
		// The source as drawn (Monaco); a rendered markdown cell shows its text instead.
		const lines = [...el.querySelectorAll(viewLine)].map(l => (l.textContent ?? '').replace(/\u00A0/g, ' '));
		const rendered = el.querySelector(`[role=region][aria-label="${labels.renderedMarkdown}"]`) as HTMLElement | null;
		// A rendered markdown cell: its region, or else its own text without the toolbar's.
		const shownText = rendered ? rendered.innerText : kind === 'markdown' ? (el as HTMLElement).innerText : '';
		const src = lines.length ? lines : shownText.split('\n').map(l => l.trim()).filter(l => l && !/^\d+(ms|s)$|^Just now$/.test(l));
		return {
			cell: n, kind, count, state, status,
			source: src.find(l => l.trim()) ?? '', lines: src.length,
			output: out ? out.innerText.replace(/\s+\n/g, '\n').trim().slice(0, 400) : '',
			types: out ? [...new Set([
				out.querySelector('[role=grid]') && 'data-grid',
				out.querySelector('img, canvas, [role=img]') && 'image',
				state === 'error' && 'error',
				out.querySelector('iframe, webview, table') && 'html',
			].filter(Boolean))] : [],
			images: out ? out.querySelectorAll('img').length : 0,
		};
	}, { n: i + 1, labels: n$, viewLine: lib.css.monaco.viewLine });
	const n = await cells.count();
	// The notebook draws a cell's content only near the screen, so bring each into view to read it.
	const readAll = async (scroll = true) => {
		const all = [];
		for (let i = 0; i < n; i++) {
			if (scroll) { await cells.nth(i).scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => { }); }
			all.push(await readCell(cells.nth(i), i));
		}
		return all;
	};
	const kernel = async () => group.evaluate((g, prefix) => {
		const badge = g.querySelector(`[data-testid^="${prefix}"]`);
		const status = (badge?.getAttribute('data-testid') ?? '').slice(prefix.length);
		const box = badge?.closest('button, [role=button]') ?? badge?.parentElement;
		return { status, kernel: (box?.textContent ?? '').replace(/\s+/g, ' ').trim() };
	}, lib.css.nb.kernelTestId);
	const cell = () => {
		if (a.n < 1 || a.n > n) { throw new Error(`the notebook has ${n} cells`); }
		return cells.nth(a.n - 1);
	};
	// A cell's toolbar is hidden (aria-hidden) until the cell is selected, so
	// select it first with a click in its left margin, by the execution count:
	// focus alone does not select a cell.
	const cellButton = async (name: RegExp) => {
		const c = cell();
		await c.scrollIntoViewIfNeeded();
		// A markdown cell has no margin; its rendered text selects it instead.
		const margin = c.locator(lib.css.nb.cellMargin).first();
		await (await margin.count() ? margin : c.getByRole('region').first()).click({ timeout: 3000 });
		await c.hover({ timeout: 3000 });
		await lib.sleep(200);
		const b = c.getByRole('toolbar', { name: n$.cellActions }).getByRole('button', { name });
		if (!await b.count()) { return null; }
		return b.first();
	};
	// The notebook editor's own toolbar, by button name.
	const editorButton = async (name: string) => {
		const b = group.getByRole('button', { name, exact: true }).filter({ visible: true });
		if (await b.count() !== 1) { return { ok: false, error: `the notebook toolbar has ${await b.count() || 'no'} "${name}" button${await b.count() > 1 ? 's' : ''} now` }; }
		await b.click({ timeout: 3000 });
		return { ok: true, clicked: name };
	};

	try {
		switch (a.cmd) {
			case 'read': {
				const modified = await group.locator(lib.css.editorGroup.activeTab + lib.css.editorGroup.dirty).count() > 0;
				return { ok: true, notebook: a.notebook, modified, ...(await kernel()), cells: await readAll() };
			}
			case 'run': {
				const b = await cellButton(new RegExp(n$.runCellPattern, 'i'));
				if (!b) { return { ok: false, error: `cell ${a.n} has no Run Cell button (a markdown cell?)` }; }
				const before = await readCell(cell(), a.n - 1);
				await b.click({ timeout: 3000 });
				// Running, or already finished: either way the status line moves.
				let now = before;
				for (let i = 0; i < 20 && JSON.stringify(now) === JSON.stringify(before); i++) { await lib.sleep(150); now = await readCell(cell(), a.n - 1); }
				return { ok: true, notebook: a.notebook, ran: a.n, cell: now, changed: JSON.stringify(now) !== JSON.stringify(before) };
			}
			case 'wait': {
				// Idle on two reads a second apart: a cell clicked just before can take a moment to show as running.
				const end = Date.now() + a.timeout * 1000;
				let idle = 0;
				let busy: number[] = [];
				while (Date.now() < end) {
					busy = (await readAll(false)).filter(c => c.state === 'running' || c.state === 'pending').map(c => c.cell);
					idle = busy.length ? 0 : idle + 1;
					if (idle >= 2) { return { ok: true, busy: [] }; }
					await lib.sleep(500);
				}
				return { ok: false, busy, error: `cells still running after ${a.timeout} s` };
			}
			case 'ready': {
				const end = Date.now() + a.timeout * 1000;
				let k = await kernel();
				while (Date.now() < end && k.status !== 'idle') { await lib.sleep(500); k = await kernel(); }
				return { ok: k.status === 'idle', ...k, ...(k.status === 'idle' ? {} : { error: `the kernel is not idle after ${a.timeout} s` }) };
			}
			case 'restart': return editorButton(n$.restartKernel);
			case 'interrupt': return editorButton(n$.stopExecution);
			case 'clear': return editorButton(n$.clearAllOutputs);
			case 'move': {
				const more = await cellButton(new RegExp(`^${n$.moreCellActions}$`));
				if (!more) { return { ok: false, error: `cell ${a.n} has no More Cell Actions button` }; }
				await more.click({ timeout: 3000 });
				const want = a.arg === 'up' ? n$.moveUp : n$.moveDown;
				// Positron's context menu items are buttons whose text runs on into
				// the shortcut ("Move Cell Down" then its keys): match the words, and
				// let what follows be a shortcut, with no lowercase letters.
				const items = page.locator(lib.css.menu.cellItems).filter({ visible: true });
				try { await items.first().waitFor({ timeout: 3000 }); } catch { await lib.closeMenu(); return { ok: false, error: 'the cell menu did not open' }; }
				const names = await items.evaluateAll(es => es.map(e => (e.getAttribute('aria-label') || e.textContent || '').trim()));
				const at = names.findIndex(x => x === want || (x.startsWith(want) && !/[a-z]/.test(x.slice(want.length))));
				if (at < 0) { await lib.closeMenu(); return { ok: false, error: `the cell menu has no ${want}`, items: names }; }
				const item = items.nth(at);
				// A menu ignores a click before the pointer rests on the item.
				await item.hover(); await lib.sleep(100); await item.click({ timeout: 3000 });
				return { ok: true, moved: want };
			}
			case 'edit': case 'type': {
				// Focus in the cell's own editor, checked before any key: keys sent to a
				// notebook in command mode edit cells (3 makes one Markdown).
				const c = cell();
				await c.scrollIntoViewIfNeeded();
				const ed = c.locator(lib.css.monaco.editor).first();
				const inCell = () => ed.evaluate(e => e.contains(document.activeElement)).catch(() => false);
				// A rendered Markdown cell shows no editor until it is opened.
				if (!await ed.isVisible().catch(() => false)) { await c.getByRole('region', { name: n$.renderedMarkdown }).dblclick({ timeout: 3000 }).catch(() => { }); await lib.sleep(300); }
				if (!await inCell()) { await ed.locator(lib.css.monaco.viewLines).first().click({ timeout: 3000 }).catch(() => { }); await lib.sleep(150); }
				if (!await inCell()) { return { ok: false, error: `cell ${a.n}'s editor did not take focus; nothing was typed` }; }
				const source = () => ed.locator(lib.css.monaco.viewLine).allTextContents().then(ls => ls.map(l => l.replace(/\u00A0/g, ' ')));
				if (a.cmd === 'edit') { return { ok: true, notebook: a.notebook, editing: a.n, source: await source() }; }
				// At the end of the cell, or over all of it with --replace.
				await page.keyboard.press(a.replace ? a.mod + '+a' : a.mod === 'Meta' ? 'Meta+ArrowDown' : 'Control+End');
				if (!await inCell()) { return { ok: false, error: `focus left cell ${a.n}'s editor; nothing was typed` }; }
				const probe = a.arg.split('\n').map(l => l.trim()).filter(Boolean).pop() ?? '';
				const count = (ls: string[]) => ls.join('\n').split(probe).length - 1;
				const was = a.replace ? 0 : count(await source());
				await page.evaluate(t => {
					const dt = new DataTransfer();
					dt.setData('text/plain', t);
					document.activeElement?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
				}, a.arg);
				let now = await source();
				for (let i = 0; i < 10 && count(now) <= was; i++) { await lib.sleep(100); now = await source(); }
				if (count(now) <= was) { return { ok: false, error: `the text is not in cell ${a.n} after pasting`, source: now }; }
				return { ok: true, notebook: a.notebook, typed: a.arg, cell: a.n, replaced: !!a.replace, source: now };
			}
			case 'pick-kernel': {
				// The picker must be open: keys sent without it would edit the notebook.
				for (let i = 0; i < 10 && !await lib.quickOpen(); i++) { await lib.sleep(300); }
				if (!await lib.quickOpen()) { return { ok: false, error: 'the kernel picker did not open; nothing was typed' }; }
				const p = await lib.pick({ words: a.arg });
				if (!p.ok) { await lib.closeQuickInput(); return p; }
				await lib.clickRow(p.row);
				return { ok: true, kernel: p.row.label, description: p.row.description };
			}
		}
	} catch (e) {
		return { ok: false, error: String((e as Error).message ?? e).split('\n')[0] };
	}
	return { ok: false, error: `unknown command ${a.cmd}` };
};

export const nbCommands: Record<string, (argv: string[]) => Json | string> = {
	nb: argv => {
		const p = parse(argv, ['session', 'notebook', 'timeout'], { read: 1, wait: 1, ready: 1, restart: 1, interrupt: 1, clear: 1, run: 2, edit: 2, move: 3, kernel: 3 });
		const [cmd, arg, arg2] = p.rest;
		if (p.flags.help) { usage('nb.sh'); }
		const notebook = String(p.flags.notebook ?? '').split('/').pop() ?? '';
		if (!notebook || !cmd) { throw new Exit(2, { ok: false, error: 'give --notebook NAME and a command: read, run N or wait' }); }
		const base = { notebook, timeout: Number(p.flags.timeout ?? 60), mod };
		const needN = () => { if (!/^\d+$/.test(arg ?? '')) { throw new Exit(2, { ok: false, error: `${cmd} needs a cell number` }); } return Number(arg); };
		let out: Json;
		switch (cmd) {
			case 'read': case 'wait': case 'ready': case 'restart': case 'interrupt': case 'clear':
				out = inPage(p.session, nb, { ...base, cmd, n: 0, arg: '' });
				break;
			case 'run': case 'edit':
				out = inPage(p.session, nb, { ...base, cmd, n: needN(), arg: '' });
				break;
			case 'type': {
				const text = p.rest.length > 2 ? p.rest.slice(2).join(' ') : readFileSync(0, 'utf8').replace(/\n$/, '');
				if (!text) { throw new Exit(2, { ok: false, error: 'type N TEXT (or the text on stdin)' }); }
				out = inPage(p.session, nb, { ...base, cmd, n: needN(), arg: text, replace: !!p.flags.replace });
				break;
			}
			case 'move':
				if (arg2 !== 'up' && arg2 !== 'down') { throw new Exit(2, { ok: false, error: 'move N up|down' }); }
				out = inPage(p.session, nb, { ...base, cmd, n: needN(), arg: arg2 });
				break;
			case 'kernel': {
				if (!arg) { throw new Exit(2, { ok: false, error: 'kernel needs the words of the picker row, such as "R 4.5.1"' }); }
				// Check the notebook is in front before opening the picker for it.
				const g = inPage(p.session, nb, { ...base, cmd: 'ready', n: 0, arg: '', timeout: 0 });
				if (!g.ok && /active editor|not open/.test(String(g.error))) { return g; }
				let opened: Json = { ok: false };
				for (const t of [names.palette.positronChangeKernel, names.palette.changeKernel, names.palette.selectKernel]) {
					opened = paletteRun(p.session, t);
					if (opened.ok) { break; }
				}
				if (!opened.ok) { return { ok: false, error: 'no Change Kernel command is listed' }; }
				out = inPage(p.session, nb, { ...base, cmd: 'pick-kernel', n: 0, arg: [arg, arg2].filter(Boolean).join(' ') });
				break;
			}
			default:
				throw new Exit(2, { ok: false, error: `unknown command ${cmd}` });
		}
		if (out.ok && cmd === 'read') {
			const cells = out.cells as { cell: number; state: string; output: string }[];
			logRead('nb.sh', p.session, `${notebook}: ${out.kernel || 'no kernel'} ${out.status}, ${cells.length} cells; ${cells.filter(c => c.output || c.state).map(c => `${c.cell} ${c.state}: ${c.output}`).join(' | ')}`);
		}
		if (out.ok && ['edit', 'type'].includes(cmd)) {
			log('nb.sh', p.session, cmd === 'edit' ? `edit cell ${arg} in ${notebook}` : `type ${JSON.stringify(String(out.typed).slice(0, 120))} into cell ${arg} in ${notebook}${out.replaced ? ', replacing its text' : ''}`, `cell ${JSON.stringify((out.source as string[]).join(' | '))}`);
		} else if (out.ok && !['read', 'wait', 'ready'].includes(cmd)) {
			const cell = out.cell as { state?: string; output?: string } | undefined;
			log('nb.sh', p.session, `${cmd}${arg ? ' ' + arg : ''}${arg2 ? ' ' + arg2 : ''} in ${notebook}`, cell ? `cell ${cell.state ?? ''}: ${JSON.stringify(cell.output ?? '')}` : '');
		}
		if (cmd === 'restart' && out.ok) {
			// A busy kernel asks first, in a toast that can come and go quickly.
			pause(1);
			const t = notifications(p.session, { click: '', match: '', clear: false });
			out = { ...out, prompts: ((t.notifications ?? []) as { message: string; buttons: string[] }[]).map(x => ({ message: x.message, buttons: x.buttons })) };
		}
		return out;
	},
};
