/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The active text editor: read it, move the cursor, type, press keys, delete
// lines, insert a line, save, and run the current line in the console.
// Every command answers with the editor as it reads after it (lib.editor: tab,
// unsaved edits, cursor, the cursor line's text), and every key or text goes in
// only while focus is in the editor, since keys go wherever focus is.
// editor.sh wraps these.

import { readFileSync } from 'fs';
import { Exit, inPage, log, logRead, mod, notACommand, parse, seconds, usage, type Json, type PageFn } from './dp-lib.ts';

/** The editor as it reads, with the drawn lines from..to when given. runs in run-code */
const read: PageFn<{ from: number; to: number }> = async (_page, a, lib) => lib.editor(a.from ? a : undefined);

/**
 * Go to Line through the quick open, then where the cursor landed, once the
 * line is drawn: Go to Line centres it with a smooth scroll, and an output
 * drawn under a line a moment later (Quarto) can push it off screen again, so
 * it goes once more when the line is not on screen after a second.
 * runs in run-code
 */
const goto: PageFn<{ line: number; column: number; mod: string }> = async (page, a, lib) => {
	const before = await lib.editor();
	if (!before.ok) { return before; }
	// There, drawn, and with focus in the editor, where Go to Line leaves it.
	const done = (x: Awaited<ReturnType<typeof lib.editor>>) => x.ok && x.line === a.line && (!a.column || x.column === a.column) && x.text !== null && !!x.focused;
	let now: Awaited<ReturnType<typeof lib.editor>> = before;
	for (let tries = 0; tries < 2 && !done(now); tries++) {
		await lib.closeQuickInput();
		if (!await lib.openQuickInput(a.mod + '+Shift+p', ':' + a.line + (a.column ? ':' + a.column : ''))) { return { ok: false, error: 'the quick open did not open' }; }
		await page.keyboard.press('Enter');
		now = await lib.editor();
		for (let i = 0; i < 10 && !done(now); i++) { await lib.sleep(100); now = await lib.editor(); }
		// Only a line not drawn is worth a second try.
		if (!now.ok || now.line !== a.line || now.text !== null) { break; }
	}
	if (!now.ok) { return now; }
	const asked = a.line + (a.column ? ':' + a.column : '');
	if (now.line !== a.line) { return { ...now, ok: false, error: `the cursor is at ${now.line}:${now.column}, not ${asked}; the file may have fewer lines` }; }
	// Go to Line puts a column past the line's end at its end.
	if (a.column && now.column !== a.column) {
		const length = now.text?.length;
		return { ...now, ok: false, error: `the cursor is at ${now.line}:${now.column}, not ${asked}${length !== undefined && a.column > length + 1 ? `: line ${a.line} has only ${length} characters, so its last column is ${length + 1}` : ''}` };
	}
	if (now.text === null) { return { ...now, ok: false, error: `the cursor is on line ${a.line}, but the line is not drawn on screen after Go to Line twice` }; }
	return now;
};

/**
 * Pastes text at the cursor, as a person's paste would, and checks its last
 * non-empty line is now on one of the lines it should fill (or in the input
 * that has focus, such as the breakpoint widget).
 * runs in run-code
 */
const type: PageFn<{ text: string }> = async (page, a, lib) => {
	const e = await lib.editor();
	if (!e.ok) { return e; }
	if (!e.focused) { return { ...e, ok: false, error: 'focus is not in the editor; nothing was typed (editor.sh goto LINE puts it there)' }; }
	const actedAt = `${e.line}:${e.column}`;
	await page.evaluate(t => {
		const dt = new DataTransfer();
		dt.setData('text/plain', t);
		document.activeElement?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
	}, a.text);
	const rows = a.text.split('\n');
	const probe = rows.filter(r => r.trim()).pop()?.trim() ?? '';
	// Monaco draws the pasted text a moment later: read until it is there, up to 1 s.
	let now: Awaited<ReturnType<typeof lib.editor>> = e;
	let landed = false;
	for (let i = 0; i < 7 && !landed; i++) {
		await lib.sleep(150);
		const at = await lib.editor();
		if (!at.ok) { return at; }
		now = await lib.editor({ from: at.line - rows.length + 1, to: at.line });
		if (!now.ok) { return now; }
		landed = 'input' in now ? String(now.input).includes(probe) : Object.values(now.lines ?? {}).some(l => l.includes(probe));
	}
	const { lines: _drawn, ...out } = now;
	return landed ? { ...out, typed: a.text, actedAt } : { ...out, actedAt, ok: false, error: `the text is not where the cursor was (${actedAt}) after pasting` };
};

/**
 * Pastes text and a line break at the start of a line (goto put the cursor
 * there), then checks the lines read back as exactly the text followed by the
 * line that was there: no blank line added, none lost. Indentation aside, since
 * a paste can re-indent.
 * runs in run-code
 */
const insert: PageFn<{ line: number; text: string }> = async (page, a, lib) => {
	const e = await lib.editor({ from: a.line, to: a.line });
	if (!e.ok) { return e; }
	if (!e.focused || e.line !== a.line || e.column !== 1) { return { ...e, ok: false, error: `the cursor is not at the start of line ${a.line} with focus in the editor; nothing was inserted` }; }
	const old = e.lines?.[a.line] ?? null;
	await page.evaluate(t => {
		const dt = new DataTransfer();
		dt.setData('text/plain', t);
		document.activeElement?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
	}, a.text + '\n');
	const rows = a.text.split('\n');
	const want = [...rows, old];
	// Monaco draws the pasted lines a moment later: read until they are there, up to 1 s.
	let now: Awaited<ReturnType<typeof lib.editor>> = e;
	let got: (string | null)[] = [];
	let exact = false;
	for (let i = 0; i < 7 && !exact; i++) {
		await lib.sleep(150);
		now = await lib.editor({ from: a.line, to: a.line + rows.length });
		if (!now.ok) { return now; }
		const lines = now.lines;
		got = Array.from({ length: rows.length + 1 }, (_, k) => lines?.[a.line + k] ?? null);
		exact = want.every((w, k) => w === null || (got[k] !== null && got[k]!.trim() === w.trim()));
	}
	const { lines: _drawn, ...out } = now;
	return exact ? { ...out, inserted: a.text, actedAt: `${a.line}:1`, at: `${a.line}-${a.line + rows.length - 1}` } : { ...out, ok: false, error: `lines ${a.line}-${a.line + rows.length} do not read as the text then the line that was there`, expected: want, got };
};

/**
 * Presses keys in the editor, then reads it; with until, waits up to 3 s for
 * the file to be saved (clean) or for a console to show more text (console).
 * With check, keys that move the cursor, edit or select (arrows, Home, End,
 * Page keys, Backspace, Delete, Enter, Tab, a character) must change the
 * cursor, the drawn text, the unsaved state or the selection, within 1 s.
 * When none did, one arrow out and back tells a key that had nowhere to go
 * (End at the line's end) from an editor that takes no keys at all; a key
 * with Shift that leaves nothing selected fails either way.
 * runs in run-code
 */
const keys: PageFn<{ keys: string[]; until: string; check: boolean }> = async (page, a, lib) => {
	type Ed = Awaited<ReturnType<typeof lib.editor>>;
	const all = { from: 1, to: 1e9 };
	// The answer leaves out the drawn lines, read only to see a change.
	const strip = (x: Ed) => { const { lines: _drawn, ...o } = x as Ed & { lines?: unknown }; return o; };
	const e = await lib.editor(all);
	if (!e.ok) { return e; }
	if (!e.focused) { return { ...e, ok: false, error: `focus is not in the editor; ${a.keys.join(' ')} was not pressed (editor.sh goto LINE puts it there)` }; }
	const actedAt = `${e.line}:${e.column}`;
	const pressed = a.keys.join(' ');
	// All consoles' text: the code may go to another language's console than the one shown.
	const consoles = () => page.evaluate(sel => [...document.querySelectorAll<HTMLElement>(sel)].reduce((n, c) => n + c.innerText.length, 0), lib.css.console.instance);
	const before = await consoles();
	for (const k of a.keys) { await page.keyboard.press(k); }
	await lib.sleep(100);
	let now = await lib.editor(all);
	const done = async () => a.until === 'clean' ? now.ok && !now.dirty : a.until === 'console' ? await consoles() > before : true;
	for (let i = 0; i < 20 && !await done(); i++) { await lib.sleep(150); now = await lib.editor(all); }
	const out = strip(now);
	if (!await done()) { return { ...out, actedAt, ok: false, error: a.until === 'clean' ? 'the file still has unsaved edits' : 'no console showed the code within 3 s; nothing ran' }; }
	// A key that moves, edits or selects; Enter and Tab only bare (Cmd+Enter runs the line).
	const base = (k: string) => k.split('+').pop() ?? '';
	const acts = (k: string) => /^(Arrow(Up|Down|Left|Right)|Home|End|PageUp|PageDown|Backspace|Delete)$/.test(base(k)) || /^(Enter|Tab)$/.test(k) || /^(Shift\+)?.$/.test(k);
	// Keys sent into an input inside the editor (the breakpoint widget) move only that input.
	if (!a.check || !now.ok || !a.keys.some(acts) || 'input' in e) { return { ...out, pressed, actedAt }; }
	const state = (x: Ed) => JSON.stringify(x.ok ? [x.line, x.column, x.selected ?? 0, x.dirty, x.lines] : x);
	for (let i = 0; i < 6 && state(now) === state(e); i++) { await lib.sleep(150); now = await lib.editor(all); }
	const last = a.keys[a.keys.length - 1];
	const selecting = /(^|\+)Shift\+/.test(last) && /^(Arrow|Home|End|Page)/.test(base(last));
	const changed = state(now) !== state(e);
	if (changed && (!selecting || (now.ok && now.selected))) { return { ...strip(now), pressed, actedAt }; }
	// One arrow out and back: does the editor take keys at all?
	let alive: boolean | null = null;
	if (now.ok) {
		const shift = now.selected ? 'Shift+' : '';
		const there = now.column > 1 ? 'ArrowLeft' : (now.text ?? '').length ? 'ArrowRight' : now.line > 1 ? 'ArrowUp' : 'ArrowDown';
		const back = { ArrowLeft: 'ArrowRight', ArrowRight: 'ArrowLeft', ArrowUp: 'ArrowDown', ArrowDown: 'ArrowUp' }[there]!;
		const at = `${now.line}:${now.column}`;
		await page.keyboard.press(shift + there);
		let moved = await lib.editor();
		for (let i = 0; i < 5 && moved.ok && `${moved.line}:${moved.column}` === at; i++) { await lib.sleep(150); moved = await lib.editor(); }
		alive = moved.ok && `${moved.line}:${moved.column}` !== at;
		if (alive) { await page.keyboard.press(shift + back); await lib.sleep(150); }
		now = await lib.editor(all);
	}
	const o = strip(now);
	const dead = 'the key changed nothing (cursor, text and selection are as before); the editor may not be taking keys: try window.sh reload';
	if (alive === false || alive === null) { return { ...o, pressed, actedAt, ok: false, error: `${pressed}: ${dead}`, probe: alive === null ? 'could not read the editor to test it' : 'an arrow key did not move the cursor either' }; }
	if (selecting) { return { ...o, pressed, actedAt, ok: false, error: `${pressed} selected nothing: the cursor at ${actedAt} is already where it moves to, or the selection was undone (the editor does take keys: an arrow moved the cursor and back)` }; }
	return { ...o, pressed, actedAt, changed: false, note: `${pressed} changed nothing: the cursor at ${actedAt} is already where it moves to (the editor does take keys: an arrow moved the cursor and back)` };
};

/**
 * A language feature at the cursor: completions (suggest), the hover, or Go
 * to Definition (definition), read once it has settled. What opened is closed
 * without Escape, which in a .qmd interrupts a busy kernel whatever has focus:
 * focus goes to the workbench (the suggest widget and the hover close on
 * blur) and back into the editor, the cursor where it was.
 * runs in run-code
 */
const feature: PageFn<{ kind: string; mod: string; timeout: number }> = async (page, a, lib) => {
	const e = await lib.editor();
	if (!e.ok) { return e; }
	if (!e.focused) { return { ...e, ok: false, error: `focus is not in the editor; nothing was triggered (editor.sh goto LINE, or --at, puts it there)` }; }
	const base = { tab: e.tab, at: `${e.line}:${e.column}`, text: e.text };
	// The mouse out of the editor: resting on a word or a squiggle, it shows a
	// hover of its own, which would be read with this one, and stay after.
	await page.mouse.move(1, 1);
	const lf = lib.css.languageFeatures;
	const end = Date.now() + a.timeout * 1000;
	const close = async () => { await lib.blur(); await lib.sleep(150); return lib.focusEditor(); };
	// Reads until two reads 300 ms apart agree and done says the read is an answer.
	const settle = async <T>(read: () => Promise<T>, done: (x: T) => boolean) => {
		let last = await read();
		let same = 0;
		while (Date.now() < end && (!done(last) || same < 1)) {
			await lib.sleep(300);
			const now = await read();
			same = JSON.stringify(now) === JSON.stringify(last) ? same + 1 : 0;
			last = now;
		}
		return { value: last, settled: done(last) };
	};
	if (a.kind === 'suggest') {
		const list = page.getByRole('listbox', { name: lib.names.editor.suggest }).filter({ visible: true });
		const read = async () => ({
			rows: await list.getByRole('option').evaluateAll(es => es.map(x => ({ label: x.getAttribute('aria-label') ?? '', total: Number(x.getAttribute('aria-setsize') ?? 0), focused: x.id === x.closest('[role=listbox]')?.getAttribute('aria-activedescendant') }))).catch(() => []),
			message: ((await page.locator(lf.suggestMessage).filter({ visible: true }).first().textContent({ timeout: 200 }).catch(() => null)) ?? '').trim(),
		});
		await page.keyboard.press('Control+Space');
		const r = await settle(read, x => x.rows.length > 0 || (!!x.message && !/^Loading/i.test(x.message)));
		const closed = await close();
		const open = await list.count() > 0;
		if (!r.settled) { return { ok: false, ...base, error: `no completion list or message within ${a.timeout} s${r.value.message ? ` (it said "${r.value.message}")` : ''}`, closed: !open }; }
		const rows = r.value.rows;
		return {
			ok: true, ...base, rows: rows.map(x => x.label), shown: rows.length, total: rows[0]?.total ?? 0,
			...(rows.find(x => x.focused) ? { selected: rows.find(x => x.focused)!.label } : {}), ...(rows.length ? {} : { message: r.value.message }),
			closed: !open, focused: closed,
		};
	}
	if (a.kind === 'hover') {
		const tips = page.getByRole('tooltip').filter({ visible: true });
		const read = () => tips.evaluateAll(es => es.map(x => (x as HTMLElement).innerText.replace(/\u00A0/g, ' ').trim()).filter(Boolean)).catch(() => [] as string[]);
		await page.keyboard.press(a.mod + '+k');
		await page.keyboard.press(a.mod + '+i');
		const r = await settle(read, x => x.length > 0 && !x.every(t => /^Loading/i.test(t)));
		const closed = await close();
		// The hover read, still shown: another tooltip (a toolbar's, under the mouse) does not count.
		const still = async () => (await read()).some(t => r.value.includes(t));
		for (let i = 0; i < 5 && await still(); i++) { await lib.sleep(100); }
		// A hover shown from the keyboard stays through a blur; moving the cursor
		// away and back closes it, the cursor where it was.
		if (await still() && closed) {
			await page.keyboard.press(e.line === 1 && e.column === 1 ? 'ArrowRight' : 'ArrowLeft');
			await page.keyboard.press(e.line === 1 && e.column === 1 ? 'ArrowLeft' : 'ArrowRight');
			for (let i = 0; i < 10 && await still(); i++) { await lib.sleep(100); }
		}
		const open = await still();
		// A key can land while the hover still holds it: put the cursor back.
		let after = await lib.editor();
		for (let i = 0; i < 3 && after.ok && after.focused && after.line === e.line && after.column !== e.column; i++) {
			await page.keyboard.press(after.column < e.column ? 'ArrowRight' : 'ArrowLeft');
			await lib.sleep(100);
			after = await lib.editor();
		}
		if (after.ok && (after.line !== e.line || after.column !== e.column)) { return { ok: false, ...base, hover: r.value.join('\n---\n').slice(0, 3000), error: `closing the hover left the cursor at ${after.line}:${after.column}, not ${base.at}` }; }
		if (!r.settled) { return { ok: false, ...base, error: `no hover showed within ${a.timeout} s: nothing to show here, or no language server answered`, closed: !open }; }
		return { ok: true, ...base, hover: r.value.join('\n---\n').slice(0, 3000), closed: !open, focused: closed };
	}
	// Go to Definition: the cursor or the active editor moves, a peek opens
	// (several definitions), or Monaco says it found none.
	const message = page.locator(lf.overlayMessage).filter({ visible: true });
	const peek = page.locator(lf.peek).filter({ visible: true });
	const before = await message.allInnerTexts();
	await page.keyboard.press('F12');
	let now: Awaited<ReturnType<typeof lib.editor>> = e;
	for (; ;) {
		await lib.sleep(150);
		const said = (await message.allInnerTexts()).filter(t => !before.includes(t));
		if (said.length) { return { ok: true, ...base, found: false, message: said.join(' | ').trim() }; }
		if (await peek.count()) {
			const title = ((await peek.first().locator(lf.peekTitle).textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
			const rows = await peek.first().getByRole('treeitem').evaluateAll(es => es.slice(0, 10).map(x => (x.getAttribute('aria-label') ?? '').trim())).catch(() => [] as string[]);
			await peek.first().getByRole('button', { name: lib.names.editor.closePeek, exact: true }).click({ timeout: 2000 }).catch(() => { });
			const shut = !await peek.count();
			return { ok: true, ...base, found: true, peek: title, rows, closed: shut, note: `several definitions: a peek opened${shut ? ' and was closed' : ' and is still open'}` };
		}
		const n = await lib.editor();
		if (n.ok && (n.tab !== e.tab || n.line !== e.line || n.column !== e.column)) { now = n; break; }
		if (Date.now() > end) { return { ok: false, ...base, error: `Go to Definition did nothing within ${a.timeout} s: the cursor did not move, and no peek or message showed` }; }
	}
	// The new editor draws its lines a moment after it opens.
	for (let i = 0; i < 10 && now.ok && now.text === null; i++) { await lib.sleep(150); now = await lib.editor(); }
	return { ...now, found: true, from: `${e.tab} ${base.at}` };
};

/** LINE or LINE:COL as two numbers, COL 0 when not given. */
function position(s: string | undefined): [number, number] {
	if (!/^\d+(:\d+)?$/.test(s ?? '')) { throw new Exit(2, { ok: false, error: 'give LINE or LINE:COL' }); }
	const [line, column] = s!.split(':').map(Number);
	return [line, column ?? 0];
}

/** FROM:TO as two numbers, TO at least FROM. */
function range(s: string | undefined): { from: number; to: number } {
	const m = (s ?? '').match(/^(\d+):(\d+)$/);
	if (!m || Number(m[2]) < Number(m[1])) { throw new Exit(2, { ok: false, error: 'give the lines as FROM:TO, such as 3:5' }); }
	return { from: Number(m[1]), to: Number(m[2]) };
}

/** Whole lines from..to selected: the cursor at the start of from, then Shift+Down past to. */
function select(session: string, from: number, to: number): Json {
	const g = inPage(session, goto, { line: from, column: 1, mod });
	if (!g.ok) { return g; }
	const r = inPage(session, keys, { keys: Array(to - from + 1).fill('Shift+ArrowDown'), until: '', check: false });
	if (r.ok && !r.selected) { return { ...r, ok: false, error: 'nothing is selected after Shift+Down' }; }
	return { ...r, from, to };
}

export const editorCommands: Record<string, (argv: string[]) => Json | string> = {
	editor: argv => {
		const p = parse(argv, ['session', 'at', 'timeout'], { read: 2, cursor: 1, goto: 2, delete: 2, save: 1, run: 1, suggest: 1, hover: 1, definition: 1 });
		if (p.flags.help || !p.rest[0]) { usage('editor.sh'); }
		const [cmd, ...r] = p.rest;
		const s = p.session;
		let out: Json;
		let did = '';
		switch (cmd) {
			case 'cursor': case 'read':
				out = inPage(s, read, cmd === 'read' && r[0] ? range(r[0]) : { from: 0, to: 0 });
				if (out.ok) {
					const lines = out.lines as Record<string, string> | undefined;
					logRead('editor.sh', s, `${out.tab} ${out.line}:${out.column}${out.dirty ? ' (unsaved)' : ''} ${JSON.stringify(out.text)}${lines ? '; lines ' + Object.entries(lines).map(([n, t]) => `${n}: ${t.trim()}`).join(' | ') : ''}`);
				}
				return out;
			case 'goto': {
				const [line, column] = position(r[0]);
				out = inPage(s, goto, { line, column, mod });
				did = `go to line ${r[0]}`;
				break;
			}
			case 'type': {
				const text = r.length ? r.join(' ') : readFileSync(0, 'utf8');
				if (!text) { throw new Exit(2, { ok: false, error: 'give the text' }); }
				// --at LINE[:COL]: go there first, so the text cannot land where another helper left the cursor.
				if (p.flags.at !== undefined) {
					const [line, column] = position(String(p.flags.at));
					out = inPage(s, goto, { line, column, mod });
					if (!out.ok) { return out; }
				}
				out = inPage(s, type, { text });
				did = `type ${JSON.stringify(text.slice(0, 120))} at ${out.actedAt}`;
				break;
			}
			case 'key':
				if (!r.length) { throw new Exit(2, { ok: false, error: 'give the key, such as Enter or Meta+z' }); }
				out = inPage(s, keys, { keys: r, until: '', check: true });
				did = `press ${r.join(' ')} at ${out.actedAt}`;
				break;
			case 'delete': {
				const { from, to } = range(r[0]);
				out = select(s, from, to);
				if (out.ok) { out = { ...inPage(s, keys, { keys: ['Backspace'], until: '', check: true }), deleted: `${from}-${to}` }; }
				did = `delete lines ${from}-${to}`;
				break;
			}
			case 'insert': {
				if (!/^\d+$/.test(r[0] ?? '') || r.length < 2) { throw new Exit(2, { ok: false, error: 'give LINE and the text' }); }
				// The text as given: one line break ends it, whether or not it came with one.
				const text = r.slice(1).join(' ').replace(/\r?\n$/, '');
				out = inPage(s, goto, { line: Number(r[0]), column: 1, mod });
				if (out.ok) { out = inPage(s, insert, { line: Number(r[0]), text }); }
				did = `insert at line ${r[0]}: ${JSON.stringify(r.slice(1).join(' ').slice(0, 120))}`;
				break;
			}
			case 'suggest': case 'hover': case 'definition': {
				// Read before moving the cursor, so a bad value is refused with nothing done.
				const timeout = seconds(p, 'timeout', 5);
				if (p.flags.at !== undefined) {
					const [line, column] = position(String(p.flags.at));
					const g = inPage(s, goto, { line, column, mod });
					if (!g.ok) { return g; }
				}
				out = inPage(s, feature, { kind: cmd, mod, timeout });
				if (out.ok) {
					const what = cmd === 'suggest' ? `${out.shown} of ${out.total} rows: ${(out.rows as string[]).slice(0, 5).join(' | ')}${out.message ? String(out.message) : ''}`
						: cmd === 'hover' ? JSON.stringify(String(out.hover).slice(0, 120))
							: out.found === false ? String(out.message) : out.peek ? `peek ${out.peek}` : `${out.tab} ${out.line}:${out.column} ${JSON.stringify(out.text ?? '')}`;
					log('editor.sh', s, `${cmd} at ${out.from ?? `${out.tab} ${out.at}`}`, what);
				}
				return out;
			}
			case 'save':
				out = inPage(s, keys, { keys: [mod + '+s'], until: 'clean', check: false });
				did = 'save';
				break;
			case 'run':
				out = inPage(s, keys, { keys: [mod + '+Enter'], until: 'console', check: false });
				did = 'run the line or selection';
				break;
			default:
				notACommand(cmd, ['read', 'cursor', 'goto', 'type', 'key', 'delete', 'insert', 'save', 'run', 'suggest', 'hover', 'definition']);
		}
		if (out.ok) { log('editor.sh', s, `${did} in ${out.tab}`, (out.line ? `cursor ${out.line}:${out.column}${out.dirty ? ' (unsaved)' : ''} ${JSON.stringify(out.text ?? '')}` : '') + (out.changed === false ? '; changed nothing' : '')); }
		return out;
	},
};
