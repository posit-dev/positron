/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The quick input: palette-run, a Command Palette command by its exact title,
// and open-file, a workspace file through Quick Open. Their .sh files are
// wrappers.

import { basename, dirname } from 'path';
import { Exit, inPage, log, mod, parse, pause, usage, type Json, type PageFn } from './dp-lib.ts';

/**
 * Runs a Command Palette command by its exact title, and nothing else. With
 * watch, it also reports a toast or modal dialog the command raised within a
 * second ("The runtime is busy... interrupt it?"), which otherwise reads as a
 * command that did nothing.
 */
export function paletteRun(session: string, title: string, opts: { dry?: boolean; watch?: boolean } = {}): Json {
	// runs in run-code
	const fn: PageFn<{ title: string; dry: boolean; mod: string; watch: boolean }> = async (page, a, lib) => {
		await lib.closeQuickInput();
		await lib.blur();
		if (!await lib.openQuickInput(a.mod + '+Shift+p', '>' + a.title)) { return { ok: false, error: 'the Command Palette did not open' }; }
		const p = await lib.pick({ exact: a.title });
		if (!p.ok) {
			// With no exact match the palette highlights its best guess, under a
			// "similar commands" heading when the command is hidden: Enter there
			// runs another command. Nothing is pressed but Escape.
			const headings = await page.evaluate(q => [...document.querySelectorAll<HTMLElement>(q.widget)].filter(w => w.offsetParent !== null)
				.flatMap(w => [...w.querySelectorAll(`${q.separator}, ${q.separatorRow}`)].filter(e => e.getBoundingClientRect().height > 0).map(e => (e.textContent ?? '').trim().toLowerCase())), lib.css.quickInput);
			const similar = headings.some(h => h.includes(lib.names.palette.similarCommands));
			await lib.closeQuickInput();
			const none = p.error.startsWith('no row');
			return {
				...p, ...(none ? { error: `the palette lists no command with the exact title "${a.title}"${similar ? ' (only similar commands)' : ''}; nothing was run` } : {}),
				...(similar ? { similar: true } : {}),
				hint: 'not listed: the command may not exist under that title, or its precondition is false right now (a language\'s commands, such as R: Source R File, are listed only while a file of that language is the active editor)',
			};
		}
		if (a.dry) { await lib.closeQuickInput(); return { ok: true, chosen: p.row.label, description: p.row.description, dry: true }; }
		const toastsBefore = a.watch ? await lib.toasts() : [];
		const dialogsBefore = a.watch ? (await lib.dialogs()).map(d => d.message) : [];
		const acted = Date.now();
		await lib.clickRow(p.row);
		await lib.sleep(200);
		const closed = !await lib.quickOpen();
		if (!a.watch) { return { ok: true, chosen: p.row.label, description: p.row.description, closed }; }
		const toasts = await lib.newToasts(toastsBefore, acted + 1000);
		const dialogs = (await lib.dialogs()).filter(d => !dialogsBefore.includes(d.message));
		return {
			ok: true, chosen: p.row.label, description: p.row.description, closed,
			...(toasts.length ? { notification: toasts.join(' | ') } : {}),
			...(dialogs.length ? { dialogs, note: 'the command opened a dialog: answer it with notifications.sh --click BUTTON' } : {}),
		};
	};
	const r = inPage(session, fn, { title, dry: !!opts.dry, mod, watch: !!opts.watch });
	// A command such as Developer: Reload Window tears the page down under the click.
	if (!r.ok && r.cliFailed && /closed|destroyed|navigat/i.test(String(r.error))) {
		log('palette-run.sh', session, title, 'the page went away');
		return { ok: true, chosen: title, description: '', note: 'the page went away under the click: the window reloaded or closed (window.sh waits for a reload and lists the windows)' };
	}
	if (r.ok && !opts.dry) { log('palette-run.sh', session, title, [r.notification ? `toast ${r.notification}` : '', r.dialogs ? `dialog ${(r.dialogs as { message: string }[]).map(d => d.message).join(' | ')}` : ''].filter(Boolean).join('; ')); }
	return r;
}

function openFile(session: string, file: string): Json {
	const name = basename(file);
	const folder = dirname(file) === '.' ? '' : dirname(file);
	// runs in run-code
	const fn: PageFn<{ file: string; name: string; folder: string; mod: string }> = async (page, a, lib) => {
		await lib.closeQuickInput();
		await lib.blur();
		if (!await lib.openQuickInput(a.mod + '+p', a.file)) { return { ok: false, error: 'Quick Open did not open' }; }
		// The folder narrows the rows: with b/report.qmd and report.qmd both open,
		// the name alone matches several.
		const p = await lib.pick({ exact: a.name, preferRoot: !a.folder, ...(a.folder ? { folder: a.folder } : {}) });
		if (!p.ok) { await lib.closeQuickInput(); return { ...p, hint: 'pass the file with its folder, such as rapp/app.R, when several share the name' }; }
		await lib.clickRow(p.row);
		// The active tab must be this file, by its path when the tab has one (two
		// tabs can share a name), else by its title: a custom editor (a .parquet
		// or .csv viewer) may title its tab differently.
		const want = (p.row.description ? p.row.description.replace(/^.* /, '') + '/' : '') + a.name;
		const read = () => page.evaluate(({ n, group, label }) => {
			const t = document.querySelector(`${group.active} ${group.activeTab}`);
			const shown = t?.querySelector(label.name)?.textContent ?? '';
			const path = (t?.querySelector(label.icon)?.getAttribute('aria-label') ?? '').split(' \u2022 ')[0];
			const named = [shown, t?.getAttribute('title') ?? '', t?.getAttribute('aria-label') ?? ''].some(x => x === n || x.includes(n));
			const cfg = (window as unknown as { vscode?: { context?: { configuration?: () => { workspace?: { uri?: { path?: string } } } } } }).vscode?.context?.configuration?.();
			return { tab: named ? n : shown, path: /^(\/|[A-Za-z]:)/.test(path) ? path : '', root: cfg?.workspace?.uri?.path ?? '' };
		}, { n: a.name, group: lib.css.editorGroup, label: lib.css.label });
		const right = (x: Awaited<ReturnType<typeof read>>) => x.tab === a.name && (!x.path || (x.root && !p.row.description ? x.path === x.root + '/' + a.name : x.path.endsWith('/' + want)));
		let now = await read();
		for (let i = 0; i < 10 && !right(now); i++) { await lib.sleep(300); now = await read(); }
		return {
			ok: right(now), opened: p.row.label, folder: p.row.description, activeTab: now.tab, ...(now.path ? { path: now.path } : {}),
			...(right(now) ? {} : { error: now.tab === a.name ? `the active ${a.name} is ${now.path}, not the one asked for` : `the active tab is ${now.tab || 'none'}, not ${a.name}` }),
		};
	};
	let r = inPage(session, fn, { file, name, folder, mod });
	// A file made since the app started can be missing from Quick Open until it
	// indexes it, a second or two later; try once more before saying so.
	if (!r.ok && /^no row matches/.test(String(r.error))) {
		pause(2);
		r = inPage(session, fn, { file, name, folder, mod });
	}
	if (r.opened) { log('open-file.sh', session, file); }
	return r;
}

export const paletteCommands: Record<string, (argv: string[]) => Json | string> = {
	'palette-run': argv => {
		const p = parse(argv, ['session'], 1);
		if (p.flags.help) { usage('palette-run.sh'); }
		const title = p.rest[0];
		if (!title) { throw new Exit(2, { ok: false, error: 'give the command title' }); }
		return paletteRun(p.session, title, { dry: !!p.flags['dry-run'], watch: true });
	},
	'open-file': argv => {
		const p = parse(argv, ['session'], 1);
		if (p.flags.help) { usage('open-file.sh'); }
		if (!p.rest[0]) { throw new Exit(2, { ok: false, error: 'give the file' }); }
		return openFile(p.session, p.rest[0]);
	},
};
