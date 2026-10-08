/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// terminal-run: a command or a key sent to a terminal, or its text read.
// terminal-run.sh wraps it.

import { readFileSync } from 'fs';
import { count, Exit, inPage, log, mod, parse, usage, type Json, type PageFn } from './dp-lib.ts';
import { paletteRun } from './dp-palette.ts';
import { names } from './selectors.ts';

/**
 * A terminal: runs a command or sends a key, with focus checked before and
 * after, or reads its text. Terminals in the panel and in the editor area are
 * xterm elements; only visible ones count, numbered left to right, then top to
 * bottom, without the sticky-scroll overlay (an xterm of its own). The text is
 * drawn on a canvas, so it is read through the Accessible View (opened from the
 * Command Palette on a focused terminal), the same text a screen reader gets.
 * runs in run-code
 */
const terminal: PageFn<{ index: number; text: string; key: string; read: boolean; tail: number; wait: number; mod: string }> = async (page, a, lib) => {
	const all = page.locator(lib.css.terminal.visible).filter({ visible: true });
	// Just brought forward, the terminal is drawn a moment later.
	for (let i = 0; i < a.wait * 5 && !await all.count(); i++) { await lib.sleep(200); }
	const boxes = await all.evaluateAll(xs => xs.map(x => { const r = x.getBoundingClientRect(); return r.width > 0 ? [r.left, r.top] : null; }));
	const order = boxes.map((b, i) => [b, i] as const).filter(([b]) => b).sort((p, q) => p[0]![0] - q[0]![0] || p[0]![1] - q[0]![1]).map(([, i]) => i);
	if (!order.length) { return { ok: false, noTerminal: true, error: 'no terminal is visible; open one first' }; }
	if (!a.index && order.length > 1) { return { ok: false, error: `${order.length} terminals are visible; pass --index 1 to ${order.length}, numbered left to right` }; }
	const n = a.index || 1;
	if (n < 1 || n > order.length) { return { ok: false, error: `--index ${n} is out of range: ${order.length} visible` }; }
	const term = all.nth(order[n - 1]);
	const input = term.locator(lib.css.terminal.input);
	const focused = () => input.evaluate(el => document.activeElement === el).catch(() => false);
	await term.click({ timeout: 3000 }).catch(() => { });
	await input.focus().catch(() => { });
	if (!await focused()) { return { ok: false, error: 'the terminal did not take focus; nothing was sent' }; }
	const base = { index: n, visible: order.length };
	if (a.read) {
		// The Accessible View shows the text as it was when it opened, and a
		// command run just before may not have printed yet: read until two reads
		// 500 ms apart agree and the last line is not a command still running
		// (the view then ends with the command again, under its prompt line), for up to 5 s.
		// A single line is a command typed before the shell drew its first
		// prompt: it runs once the shell has started, so that is waited for too.
		const running = (t: string) => {
			const ls = t.split('\n').map(l => l.trim()).filter(Boolean);
			const [p, l] = ls.slice(-2);
			return ls.length === 1 || (ls.length >= 2 && p !== l && p.endsWith(' ' + l));
		};
		const read = async () => {
			await input.focus().catch(() => { });
			// From the Command Palette, which returns focus to the terminal before
			// running it. Not by its key (Alt+F2, Shift+Alt+F2 on Linux): the
			// command is not in the terminal's commandsToSkipShell, so xterm sends
			// the key to the shell (a stray "Q" at the prompt) and nothing opens.
			if (!await lib.openQuickInput(a.mod + '+Shift+p', '>' + lib.names.palette.openAccessibleView)) { return null; }
			const p = await lib.pick({ exact: lib.names.palette.openAccessibleView });
			if (!p.ok) { await lib.closeQuickInput(); return null; }
			await lib.clickRow(p.row);
			const view = page.locator(lib.css.terminal.accessibleView).filter({ visible: true }).first();
			try { await view.waitFor({ timeout: 3000 }); } catch { return null; }
			// The view is a Monaco editor, which reuses its line divs and places each
			// by its top: DOM order is not line order, so read them sorted by top.
			const text = (await view.evaluate((el, sel) => [...el.querySelectorAll<HTMLElement>(sel)]
				.map(l => [parseFloat(l.style.top) || 0, l.textContent ?? ''] as const)
				.sort((p, q) => p[0] - q[0])
				.map(([, t]) => t).join('\n'), lib.css.monaco.drawnLine)).replace(/\u00A0/g, ' ');
			// It closes when it loses focus; no Escape, which with a busy .qmd in front interrupts its kernel.
			await lib.blur();
			await view.waitFor({ state: 'hidden', timeout: 2000 }).catch(() => { });
			return text;
		};
		let text = await read();
		if (text === null) { return { ok: false, ...base, error: 'the Accessible View did not open' }; }
		let settled = false;
		for (const end = Date.now() + 5000; !settled && Date.now() < end;) {
			await lib.sleep(500);
			const again = await read();
			if (again === null) { return { ok: false, ...base, error: 'the Accessible View did not open' }; }
			settled = again === text && !running(again);
			text = again;
		}
		const lines = text.split('\n').filter(l => l.trim());
		return { ok: true, ...base, text: (a.tail ? lines.slice(-a.tail) : lines).join('\n'), ...(settled ? {} : { note: running(text) ? 'the last command shows no output after 5 s: it may still be running' : 'the text was still changing after 5 s; this is what it showed last' }) };
	}
	if (a.key) {
		// Playwright checks a key name only as it presses it: in Control+BackSpace
		// it has pressed Control down before it rejects BackSpace, and leaves it
		// down for every later key. Release the modifiers, and report the name.
		try { await page.keyboard.press(a.key); } catch (e) {
			const unknown = String((e as Error)?.message ?? e).match(/Unknown key: "(.*)"/)?.[1];
			if (unknown === undefined) { throw e; }
			for (const k of ['Control', 'Shift', 'Alt', 'Meta']) { await page.keyboard.up(k).catch(() => { }); }
			return { ok: false, ...base, sent: null, unknownKey: unknown };
		}
		if (!await focused()) { return { ok: false, ...base, sent: null, error: 'focus left the terminal; the key may have gone elsewhere' }; }
		return { ok: true, ...base, sent: a.key };
	}
	// Paste into the terminal's own input, then Enter, with focus checked between.
	await input.evaluate((el, t) => {
		const dt = new DataTransfer();
		dt.setData('text/plain', t);
		el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
	}, a.text);
	if (!await focused()) { return { ok: false, ...base, entered: false, error: 'focus left the terminal before Enter; the command was pasted but not run' }; }
	await page.keyboard.press('Enter');
	await lib.sleep(100);
	if (!await focused()) { return { ok: false, ...base, entered: true, error: 'focus left the terminal; Enter may have gone elsewhere' }; }
	return { ok: true, ...base, entered: true };
};

export const terminalCommands: Record<string, (argv: string[]) => Json | string> = {
	'terminal-run': argv => {
		const p = parse(argv, ['session', 'index', 'key', 'tail'], Infinity, ['read']);
		if (p.flags.help) { usage('terminal-run.sh'); }
		const read = !!p.flags.read;
		const key = String(p.flags.key ?? '');
		// The command is one argument (quoted), and --read and --key take none: a
		// stray word would be typed into the shell. "read" alone is the --read
		// it looks like (other helpers have a read command), not the shell builtin.
		const most = read || key ? 0 : 1;
		if (p.rest.length > most) { throw new Exit(2, { ok: false, error: `unexpected argument ${JSON.stringify(p.rest[most])}: ${most ? 'give the command as one quoted argument' : `--${read ? 'read' : 'key'} takes no command`}` }); }
		if (!read && !key && p.rest[0] === 'read') { throw new Exit(2, { ok: false, error: 'to read the terminal pass --read; "read" alone is not typed into the shell' }); }
		if (p.flags.tail !== undefined && !read) { throw new Exit(2, { ok: false, error: '--tail goes with --read' }); }
		// count() refuses "abc", "", "0" and "-2" for --index, which Number() would read as
		// "no --index" (terminal 1), and a negative --tail, which would reach slice(N).
		const index = count(p, 'index', 0, 1, 'a terminal number'), tail = count(p, 'tail', 0, 0, 'how many lines to read');
		const text = read || key ? '' : (p.rest.length ? p.rest.join(' ') : readFileSync(0, 'utf8').replace(/\n$/, ''));
		if (!read && !key && !text) { throw new Exit(2, { ok: false, error: 'empty input' }); }
		const args = { index, text, key, read, tail, wait: 0, mod };
		let r = inPage(p.session, terminal, args);
		// Another panel tab (the Console, after a console run) hides the terminals:
		// bring the Terminal view forward, as console-run does the Console.
		if (r.noTerminal) {
			const f = paletteRun(p.session, names.palette.focusTerminal);
			if (!f.ok) { return { ...r, error: `${r.error}; ${names.palette.focusTerminal} failed: ${f.error}` }; }
			r = { ...inPage(p.session, terminal, { ...args, wait: 3 }), broughtForward: names.palette.focusTerminal };
		}
		delete r.noTerminal;
		if (r.unknownKey !== undefined) {
			throw new Exit(2, { ok: false, index: r.index, visible: r.visible, sent: null, error: `${JSON.stringify(r.unknownKey)} is not a Playwright key name; nothing was sent. Names are case-sensitive, such as Backspace, Enter, Escape, ArrowUp, Control+c` });
		}
		if (r.ok && key) { log('terminal-run.sh', p.session, `key ${key} in terminal ${r.index}`); }
		if (r.ok && text) { log('terminal-run.sh', p.session, text.split('\n')[0].slice(0, 200)); }
		return r;
	},
};
