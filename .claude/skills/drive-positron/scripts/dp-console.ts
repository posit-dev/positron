/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Console sessions: start-session, console-run and console-read. Their .sh
// files are wrappers.

import { readFileSync } from 'fs';
import { Exit, failText, inPage, language, log, logRead, mod, parse, pause, usage, type Json, type PageFn } from './dp-lib.ts';
import { paletteRun } from './dp-palette.ts';
import { names } from './selectors.ts';

function startSession(session: string, language: 'python' | 'r', name: string, timeout: number, answer = '', fresh = false): Json {
	const word = language === 'r' ? 'R' : 'Python';
	// A session started while another is still starting waits behind it, so
	// wait for those first (bounded by --timeout), and say so if they never finish.
	// runs in run-code
	const idle: PageFn<{ timeout: number }> = async (_page, a, lib) => {
		const end = Date.now() + a.timeout * 1000;
		let starting = await lib.starting();
		while (starting.length && Date.now() < end) { await lib.sleep(500); starting = await lib.starting(); }
		if (starting.length) { return { ok: false, error: `${starting.join(', ')} was still starting after ${a.timeout} s; a new session waits for it`, dialogs: await lib.dialogs() }; }
		// The sessions open are read from the Console view, which another panel tab hides.
		// Right after launch a session can be starting before the Console view shows it
		// or its empty message, so give the view a moment to settle.
		let c = await lib.consoles();
		for (let i = 0; !c.inPage && i < 20; i++) { await lib.sleep(500); c = await lib.consoles(); }
		return c.inPage ? { ok: true, ...c } : { ok: false, noConsoleView: true, error: 'the Console view is not shown, so the open sessions cannot be read' };
	};
	const before = withConsoleView(session, idle, { timeout });
	if (!before.ok) { return before; }
	// A workspace can have started one already (Python for a venv, R for .R
	// files): report those rather than start a second, unless --new.
	const words = name.toLowerCase().split(/\s+/).filter(Boolean);
	const existing = (before.sessions as { id: string; name: string }[])
		.filter(t => t.id.startsWith(language + '-') && words.every(w => t.name.toLowerCase().includes(w)));
	if (existing.length && !fresh) {
		return {
			ok: true, started: false, sessionId: existing.length === 1 ? existing[0].id : null, ...(existing.length === 1 ? { session: existing[0].name } : {}),
			sessions: existing.map(t => `${t.name} (${t.id})`),
			note: `${existing.length} ${word} session${existing.length > 1 ? 's are' : ' is'} already open; none was started. Pass --new to start another`,
		};
	}
	// runs in run-code
	const choose: PageFn<{ words: string; word: string; name: string }> = async (page, a, lib) => {
		for (let i = 0; i < 10 && !await lib.quickOpen(); i++) { await lib.sleep(300); }
		// The picker draws only the rows on screen: filter it by the name first, so
		// a row below them is found too. The filter matches words in the order
		// typed, so when it leaves no matching row, try the whole list again.
		const filter = page.locator(`${lib.css.quickInput.widget} ${lib.css.quickInput.filter}`).filter({ visible: true }).first();
		let p = a.name ? (await filter.fill(a.name), await lib.pick({ words: a.words })) : null;
		if (!p || (!p.ok && p.error.startsWith('no row matches'))) {
			if (a.name) { await filter.fill(''); }
			p = await lib.pick({ words: a.words });
		}
		if (!p.ok) {
			// Interpreter discovery lists languages one by one: say whether this one has any row yet.
			const listed = (await lib.rows()).some(r => r.label.startsWith(a.word + ' '));
			await lib.closeQuickInput();
			return { ...p, listed };
		}
		if (!p.row.label.startsWith(a.word + ' ')) {
			await lib.closeQuickInput();
			return { ok: false, error: `the matching row is not a ${a.word} interpreter: ${p.row.label}` };
		}
		await lib.clickRow(p.row);
		return { ok: true, runtime: p.row.label };
	};
	// Right after launch the picker can list no row of this language yet: wait
	// for discovery (up to 30 s), reopening the picker every 2 s.
	const discoveryEnd = Date.now() + 30_000;
	let chosen: Json;
	for (; ;) {
		const opened = paletteRun(session, names.palette.startConsole);
		if (!opened.ok) { return opened; }
		chosen = inPage(session, choose, { words: `${word} ${name}`.trim(), word, name });
		if (chosen.ok || chosen.listed !== false || Date.now() > discoveryEnd) { break; }
		pause(2);
	}
	if (!chosen.ok) {
		const { listed, ...r } = chosen;
		return listed === false ? { ...r, error: `${r.error}: no ${word} interpreter was listed after waiting 30 s for interpreter discovery` } : r;
	}
	log('start-session.sh', session, String(chosen.runtime));
	// Ready: a new console of this language is active, its input is there, and
	// nothing is running. A dialog (create a virtual environment?) holds start-up.
	// runs in run-code
	const wait: PageFn<{ lang: string; before: string[]; timeout: number; answer: string }> = async (page, a, lib) => {
		const end = Date.now() + a.timeout * 1000;
		const answered: string[] = [];
		let id = '';
		while (Date.now() < end) {
			const c = await lib.consoles();
			const fresh = c.tabs.map(t => t.id).filter(t => t.startsWith(a.lang + '-') && !a.before.includes(t));
			// With one session there are no tabs; the active console is the new one.
			id = fresh[0] ?? (c.tabs.length === 0 && c.active.startsWith(a.lang + '-') && !a.before.includes(c.active) ? c.active : '');
			const ready = !!id && await page.evaluate(({ i, c }) => {
				const inst = document.querySelector(`[data-testid="${c.instanceTestId}${i}"]`);
				return !!inst?.querySelector(c.inputEditContext) && !document.querySelector(c.busy);
			}, { i: id, c: lib.css.console });
			if (ready) { return { ok: true, sessionId: id, session: c.tabs.find(t => t.id === id)?.name ?? null, ...(answered.length ? { answered } : {}) }; }
			const d = await lib.dialogs();
			// With --answer, a dialog that holds start-up (create a virtual
			// environment?) is answered with that button, and the wait goes on.
			const answer = a.answer ? d.find(x => x.buttons.includes(a.answer)) : undefined;
			if (answer) {
				const box = page.locator(lib.css.dialog.box).filter({ visible: true }).filter({ hasText: answer.message });
				await box.locator(lib.css.dialog.anyButton).filter({ hasText: new RegExp('^\\s*' + a.answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$') }).first().click({ timeout: 3000 });
				answered.push(`${answer.message} -> ${a.answer}`);
				await lib.sleep(500);
				continue;
			}
			if (d.length) { return { ok: false, sessionId: id || null, error: 'a dialog is waiting for an answer; answer it with notifications.sh --click, then run this again or wait for the console, or pass --answer BUTTON', dialogs: d }; }
			await lib.sleep(500);
		}
		return { ok: false, sessionId: id || null, error: `the console was not ready within ${a.timeout} s` };
	};
	const ids = [...(before.tabs as { id: string }[]).map(t => t.id), String(before.active)].filter(Boolean);
	const r = inPage(session, wait, { lang: language, before: ids, timeout, answer });
	if (r.answered) { log('start-session.sh', session, `answered ${(r.answered as string[]).join('; ')}`); }
	return { ok: r.ok, started: true, runtime: chosen.runtime, sessionId: r.sessionId ?? null, ...(r.ok ? { session: r.session, ...(r.answered ? { answered: r.answered } : {}) } : { error: r.error, dialogs: r.dialogs }) };
}

/**
 * Runs a console command; when it answers noConsoleView (a console behind another
 * panel tab is not in the page), brings the Console view forward and runs it again.
 */
export function withConsoleView<A>(session: string, fn: PageFn<A>, args: A): Json {
	const r = inPage(session, fn, args);
	if (!r.noConsoleView) { return r; }
	paletteRun(session, names.palette.focusConsole);
	pause(0.5);
	return inPage(session, fn, args);
}

/**
 * One console's text and prompt, picked by language or name (or id), and how
 * many tracebacks in it are collapsed; with expand, it clicks each one's Show
 * Traceback first.
 */
function readConsole(session: string, language: string, name: string, expand = false): Json {
	// runs in run-code
	const fn: PageFn<{ lang: string; name: string; expand: boolean }> = async (page, a, lib) => {
		const c = await lib.consoles();
		if (!c.inPage) { return { ok: false, noConsoleView: true, error: 'the Console view is not shown (another panel tab is in front), so no console can be read' }; }
		const tabs = c.sessions.filter(t => (!a.lang || t.id.startsWith(a.lang + '-')) && lib.namedLike(t, a.name));
		let id = '';
		if (!a.lang && !a.name) { id = c.active; }
		else if (tabs.length === 1) { id = tabs[0].id; }
		else if (tabs.length > 1) { return { ok: false, error: `${tabs.length} consoles match; narrow with --name, by name or id: ` + tabs.map(t => `${t.name} (${t.id})`).join(', ') }; }
		if (!id) { return { ok: false, error: 'no console matches; sessions: ' + (c.sessions.map(t => `${t.name} (${t.id})`).join(', ') || 'none') }; }
		// An error's traceback is collapsed behind Show Traceback, its frames not in the text.
		const collapsed = page.locator(`[data-testid="${lib.css.console.instanceTestId}${id}"]`).getByRole('button', { name: lib.names.console.showTraceback }).filter({ visible: true });
		let expanded = 0;
		for (let n = await collapsed.count(); a.expand && n > 0 && expanded < 20; n = await collapsed.count()) {
			await collapsed.first().click({ timeout: 3000 });
			expanded++;
			for (let k = 0; k < 10 && await collapsed.count() >= n; k++) { await lib.sleep(100); }
		}
		const t = await lib.consoleText(id);
		return t ? { ok: true, sessionId: id, ...t, collapsed: await collapsed.count(), expanded } : { ok: false, error: `console ${id} is not in the page` };
	};
	return withConsoleView(session, fn, { lang: language, name, expand });
}

/**
 * The text after the line holding needle, preferring the echo of a command:
 * a prompt line whose code is exactly needle, then a prompt line holding it,
 * then any line. Of several in that tier it takes the last; "used" says how
 * many matched.
 */
function after(text: string, needle: string): { text: string; used: string } | { error: string } {
	const lines = text.split('\n');
	const prompt = /^\s*(>>>|\.\.\.|Browse\[\d+\]>|>|\+)\s?/;
	const code = (l: string) => l.replace(prompt, '').trim();
	const tiers: [string, (l: string) => boolean][] = [
		['prompt lines whose code is exactly the text', l => prompt.test(l) && code(l) === needle.trim()],
		['prompt lines holding the text', l => prompt.test(l) && l.includes(needle)],
		['lines holding the text (none is a prompt line)', l => l.includes(needle)],
	];
	for (const [kind, test] of tiers) {
		const hits = lines.flatMap((l, i) => test(l) ? [i] : []);
		if (!hits.length) { continue; }
		const i = hits[hits.length - 1];
		return { text: lines.slice(i + 1).join('\n'), used: `${hits.length} line${hits.length === 1 ? '' : 's'} (${kind})${hits.length === 1 ? '' : '; used the last'}: line ${i + 1} of ${lines.length}, ${JSON.stringify(lines[i].trim().slice(0, 80))}` };
	}
	return { error: `--after: no line holds ${JSON.stringify(needle)}` };
}

function consoleRun(session: string, o: { language: 'python' | 'r'; name: string; text: string; timeout: number; capture: boolean; captureTimeout: number }): Json {
	let text = o.text;
	// The Python console runs an indented block only after a blank line, as a
	// person would type it; add one when the code ends inside a block.
	if (o.language === 'python') {
		const last = text.split('\n').filter(l => l.trim()).pop() ?? '';
		if (/^\s/.test(last) && !/\n\s*\n\s*$/.test(text)) { text = text.replace(/\n$/, '') + '\n\n'; }
	}
	const lastLine = text.split('\n').filter(l => l.trim()).pop()?.trim() ?? '';
	// runs in run-code
	const fn: PageFn<{ lang: string; name: string; text: string; lastLine: string; timeout: number; capture: boolean; captureTimeout: number; mod: string }> = async (page, a, lib) => {
		const norm = (s: string) => s.replace(/\u00A0/g, ' ');
		const probe = norm(a.text).split(/\r?\n/).map(l => l.trim()).find(Boolean)?.slice(0, 40) ?? '';
		const count = (hay: string) => probe ? norm(hay).split(probe).length - 1 : 0;
		const c$ = lib.css.console;
		const c = await lib.consoles();
		if (!c.inPage) { return { ok: false, noConsoleView: true, error: 'the Console view is not shown (another panel tab is in front), so no console can be read' }; }
		const tabs = c.sessions.filter(t => t.id.startsWith(a.lang + '-') && lib.namedLike(t, a.name));
		if (tabs.length > 1) { return { ok: false, error: `several ${a.lang} sessions; pass --name with part of one, or its id: ` + tabs.map(t => `${t.name} (${t.id})`).join(', ') }; }
		if (!tabs.length) { return { ok: false, error: `no ${a.lang} session${a.name ? ` named like "${a.name}"` : ''}; sessions: ${c.sessions.map(t => `${t.name} (${t.id})`).join(', ') || 'none, start one first'}` }; }
		const target = tabs[0].id;
		// A starting console already shows its prompt, but code typed then is left
		// at a continuation prompt: wait up to 60 s for it to finish starting.
		for (const end = Date.now() + 60_000; (await lib.starting()).includes(target);) {
			if (Date.now() > end) { return { ok: false, sessionId: target, error: `${target} was still starting after 60 s; nothing was typed` }; }
			await lib.sleep(500);
		}
		const switched = c.active !== target;
		if (switched) {
			const active = await lib.activateConsole(target);
			if (active !== target) { return { ok: false, error: `the ${target} console did not become active within 8 s; ${active || 'no console'} is` }; }
		}
		const inst = page.locator(`[data-testid="${c$.instanceTestId}${target}"]`);
		const input = inst.locator(c$.inputEditContext);
		if (!await input.count()) { return { ok: false, error: `no console input in ${target}` }; }
		const session = (await lib.consoles()).sessions.find(t => t.id === target)?.name ?? null;
		const busy = await page.locator(c$.busy).count() > 0;
		const base = { sessionId: target, switched, session, busy };
		const before = count(await inst.innerText());
		// Clear anything half-typed, through Monaco's own keys, then paste as a person would.
		// Keys go wherever focus is, so press none unless it is in this console's
		// input: during a restart the input can refuse focus, and Select All then
		// Backspace would empty the open editor instead.
		const focused = () => inst.locator(c$.input).evaluate(el => el.contains(document.activeElement)).catch(() => false);
		await input.focus().catch(() => { });
		if (!await focused()) { return { ok: false, ...base, error: 'the console input would not take focus (the session may be starting or restarting); no keys were pressed' }; }
		// Only clear text that is there: with the input empty, Select All selects the
		// whole transcript instead, which then shows highlighted in every screenshot.
		if (norm(await inst.locator(c$.inputLines).innerText().catch(() => ''))) {
			await page.keyboard.press(a.mod + '+a');
			await page.keyboard.press('Backspace');
		}
		await page.evaluate(() => window.getSelection()?.removeAllRanges());
		await input.evaluate((el, t) => {
			const dt = new DataTransfer();
			dt.setData('text/plain', t);
			el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
		}, a.text);
		// A narrow console wraps a long line across several drawn lines, so compare without spaces and breaks.
		// A console that just started can take a moment to draw the paste.
		const flat = (t: string) => t.replace(/\s+/g, '');
		const pasted = async () => flat(norm(await inst.locator(c$.inputLines).innerText().catch(() => ''))).includes(flat(probe.slice(0, 20)));
		let shown = await pasted();
		for (const until = Date.now() + 2000; !shown && Date.now() < until;) { await lib.sleep(100); shown = await pasted(); }
		if (!shown) { return { ok: false, ...base, error: 'the pasted code is not in the console input' }; }
		if (!await focused()) { return { ok: false, ...base, error: 'focus left the console input before Enter; the code was pasted but not run' }; }
		await page.keyboard.press('Enter');
		// The code is echoed above the prompt once the console accepts it; a busy session queues it.
		const end = Date.now() + a.timeout * 1000;
		let echoed = false;
		while (Date.now() < end) {
			if ((await lib.consoles()).active !== target) { return { ok: false, ...base, echoed: false, error: 'another console became active before the code ran' }; }
			if (count(await inst.innerText()) > before) { echoed = true; break; }
			await lib.sleep(150);
		}
		if (!echoed) { return { ok: false, ...base, echoed: false, error: `the code was not echoed in this console within ${a.timeout} s; it may be queued behind running code` }; }
		// An incomplete block leaves the console at its continuation prompt, waiting, with nothing run.
		await lib.sleep(300);
		const now = await lib.consoleText(target);
		if (now?.prompt === '...' || now?.prompt === '+') {
			return { ok: false, ...base, echoed: true, prompt: now.prompt, error: `the console is waiting for more input (prompt ${now.prompt}): the code is incomplete and did not run. End a Python block with a blank line, or close the open bracket; press Escape in the console to clear it` };
		}
		if (!a.capture) { return { ok: true, ...base, echoed: true }; }
		// Done when the session has gone busy and come back, or never went busy within 2 s.
		const cend = Date.now() + a.captureTimeout * 1000;
		const start = Date.now();
		let seen = false;
		let finished = false;
		while (Date.now() < cend) {
			const b = await page.locator(c$.busy).count() > 0;
			if (b) { seen = true; } else if (seen || Date.now() - start >= 2000) { finished = true; break; }
			await lib.sleep(200);
		}
		const out = (await lib.consoleText(target))?.text ?? '';
		const lines = out.split('\n');
		// The echo of the code's last line, after its prompt: a traceback's code
		// frame ("----> 4 f()") holds the same text further down.
		const echo = (l: string) => l.trim().replace(/^(>>>|\.\.\.|>|\+)\s?/, '').trim() === a.lastLine;
		let last = -1;
		lines.forEach((l, i) => { if (echo(l)) { last = i; } });
		if (last < 0) { lines.forEach((l, i) => { if (l.includes(a.lastLine)) { last = i; } }); }
		const output = (last < 0 ? '' : lines.slice(last + 1).join('\n')).replace(/\n+$/, '');
		return { ok: true, ...base, echoed: true, output, ...(finished ? {} : { note: `still running after ${a.captureTimeout} s; output so far` }) };
	};
	const r = withConsoleView(session, fn, { lang: o.language, name: o.name, text, lastLine, timeout: o.timeout, capture: o.capture, captureTimeout: o.captureTimeout, mod });
	if (r.echoed === true) { log('console-run.sh', session, `${o.language}: ${text.split('\n')[0].slice(0, 200)}`, r.output === undefined ? '' : `output ${JSON.stringify(String(r.output).split('\n').slice(-3).join(' | '))}`); }
	return r;
}

export const consoleCommands: Record<string, (argv: string[]) => Json | string> = {
	'start-session': argv => {
		const p = parse(argv, ['session', 'language', 'name', 'timeout', 'answer']);
		if (p.flags.help) { usage('start-session.sh'); }
		return startSession(p.session, language(p), String(p.flags.name ?? ''), Number(p.flags.timeout ?? 60), String(p.flags.answer ?? ''), !!p.flags.new);
	},
	'console-run': argv => {
		const p = parse(argv, ['session', 'language', 'name', 'timeout', 'capture-timeout'], Infinity);
		if (p.flags.help) { usage('console-run.sh'); }
		const lang = language(p);
		// Read stdin whole: a shell's $(cat) would drop the blank line that ends a Python block.
		const text = p.rest.length ? p.rest.join(' ') : readFileSync(0, 'utf8');
		if (!text) { throw new Exit(2, { ok: false, error: 'empty input' }); }
		return consoleRun(p.session, {
			language: lang, name: String(p.flags.name ?? ''), text,
			timeout: Number(p.flags.timeout ?? 10), capture: !!p.flags.capture, captureTimeout: Number(p.flags['capture-timeout'] ?? 60),
		});
	},
	'console-read': argv => {
		const p = parse(argv, ['session', 'language', 'name', 'tail', 'after']);
		if (p.flags.help) { usage('console-read.sh'); }
		const lang = p.flags.language ? language(p) : '';
		const r = readConsole(p.session, lang, String(p.flags.name ?? ''), !!p.flags.expand);
		if (!r.ok) { failText('console-read.sh', String(r.error)); }
		const tracebacks = `${r.expanded ? `; expanded ${r.expanded} traceback${r.expanded === 1 ? '' : 's'}` : ''}${r.collapsed ? `; ${r.collapsed} traceback${r.collapsed === 1 ? ' is' : 's are'} collapsed (Show Traceback): its frames are not in this text, --expand shows them` : ''}`;
		process.stderr.write(`console-read.sh: ${r.session} (${r.sessionId}), prompt ${r.prompt}${tracebacks}\n`);
		if (p.flags.prompt) { logRead('console-read.sh', p.session, `${r.session}: prompt ${r.prompt}`); return String(r.prompt); }
		let text = String(r.text).replace(/\n+$/, '');
		if (p.flags.after) {
			const a = after(text, String(p.flags.after));
			if ('error' in a) { failText('console-read.sh', a.error); }
			process.stderr.write(`console-read.sh: --after matched ${a.used}\n`);
			text = a.text;
		}
		const tail = Number(p.flags.tail ?? 40);
		const shown = tail ? text.split('\n').slice(-tail).join('\n') : text;
		// The last lines are what a reading is usually for.
		logRead('console-read.sh', p.session, `${r.session}, prompt ${r.prompt}${r.collapsed ? `, ${r.collapsed} collapsed` : ''}: ...${shown.split('\n').filter(l => l.trim()).slice(-3).join(' | ')}`);
		return shown;
	},
};
