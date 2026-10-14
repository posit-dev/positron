/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The app's windows: reload one, open a folder in it, open a new one, and
// choose which one the session drives. A reload or a folder opened
// reloads the page under the session; each command waits for the workbench
// to come back, attaches the session again if it lost the page, and reports
// the window's title and folder. window.sh wraps these.

import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { cliRun, commandWord, count, countOf, Exit, inPage, log, parse, pause, seconds, usage, type Json, type PageFn } from './dp-lib.ts';
import { paletteRun } from './dp-palette.ts';
import { names } from './selectors.ts';

/**
 * The window as it reads now: title, folder, the profile it runs on, whether
 * the workbench is drawn (its status bar), and the dialogs open; with mark,
 * leaves that mark on the page, which a reload clears. The window's
 * configuration (the preload's vscode.context) names the folder and profile.
 * runs in run-code
 */
const probe: PageFn<{ mark: string }> = async (page, a, lib) => {
	const info = await page.evaluate(({ mark, statusbar }) => {
		type Cfg = { workspace?: { uri?: { path?: string }; configPath?: { path?: string } }; userDataDir?: string };
		const w = window as unknown as { dpWindowMark?: string; vscode?: { context?: { configuration?: () => Cfg } } };
		const was = w.dpWindowMark ?? '';
		if (mark) { w.dpWindowMark = mark; }
		const cfg = w.vscode?.context?.configuration?.();
		return { mark: was, title: document.title, folder: cfg?.workspace?.uri?.path ?? cfg?.workspace?.configPath?.path ?? null, userDataDir: cfg?.userDataDir ?? '', drawn: !!document.querySelector(statusbar) };
	}, { mark: a.mark, statusbar: lib.css.part.statusbar });
	return { ok: true, ...info, windows: page.context().pages().length, dialogs: await lib.dialogs() };
};

/** The app's windows, numbered from 1 as the session lists them, and which one it drives. runs in run-code */
const windows: PageFn<Record<string, never>> = async page => ({
	ok: true,
	windows: await Promise.all(page.context().pages().map(async (p, i) => ({ n: i + 1, title: await p.title(), ...(p === page ? { driven: true } : {}) }))),
});

/**
 * Fills Open Folder's path box with the folder and clicks OK (the simple
 * file dialog the launcher turns on, a quick input). The window reloads
 * under the click.
 * runs in run-code
 */
const chooseFolder: PageFn<{ path: string }> = async (page, a, lib) => {
	for (let i = 0; i < 15 && !await lib.quickOpen(); i++) { await lib.sleep(200); }
	if (!await lib.quickOpen()) { return { ok: false, error: 'the Open Folder picker did not open' }; }
	const w = page.locator(lib.css.quickInput.widget).filter({ visible: true });
	await w.locator(lib.css.quickInput.filter).fill(a.path.replace(/\/*$/, '/'));
	await lib.sleep(400);
	const ok = w.getByRole('button', { name: lib.names.window.ok, exact: true });
	if (!await ok.count()) { await lib.closeQuickInput(); return { ok: false, error: `the Open Folder picker has no ${lib.names.window.ok} button; nothing was opened` }; }
	await ok.click({ timeout: 3000 });
	return { ok: true };
};

/** The CDP port launch.sh recorded for this profile's run, in instances.log beside the run directory. */
function cdpPortOf(userDataDir: string): number {
	const runDir = dirname(userDataDir);
	const file = join(dirname(runDir), 'instances.log');
	if (!existsSync(file)) { return 0; }
	const starts = readFileSync(file, 'utf8').split('\n').map(l => l.match(/ start cdp=(\d+) pid=\S+ (.*)$/)).filter(m => m && resolve(m[2]) === resolve(runDir));
	return Number(starts.pop()?.[1] ?? 0);
}

/**
 * Waits for the window to come back after a reload: the mark gone, a title,
 * and the workbench drawn. A session that has lost the page (three failed
 * reads in a row) is attached again, on the CDP port given or the one
 * instances.log names.
 */
function comeBack(session: string, mark: string, seconds: number, port: number): Json {
	const end = Date.now() + seconds * 1000;
	let failed = 0;
	let reattached = false;
	let last: Json = { ok: false, error: 'no read yet' };
	while (Date.now() < end) {
		pause(0.5);
		const r = inPage(session, probe, { mark: '' });
		if (r.ok) {
			failed = 0;
			last = r;
			if (r.mark !== mark && r.title && r.drawn) {
				// A dialog can follow the reload by a second or two (sessions that did not
				// reconnect: "Interpreters Disconnected"): look for one for 2 s before answering.
				let after = r;
				for (const until = Date.now() + 2000; !(after.dialogs as unknown[]).length && Date.now() < until;) { pause(0.5); const x = inPage(session, probe, { mark: '' }); if (x.ok) { after = x; } }
				return { ...after, reattached };
			}
			// A dialog before the reload (unsaved changes?) holds it.
			if (r.mark === mark && (r.dialogs as unknown[]).length) { return { ok: false, error: 'a dialog is waiting for an answer, and the window has not reloaded; answer it with notifications.sh --click', dialogs: r.dialogs }; }
			continue;
		}
		last = r;
		if (++failed >= 3 && !reattached && port) {
			try { cliRun(session, ['attach', `--cdp=http://127.0.0.1:${port}`]); reattached = true; } catch (e) { last = { ok: false, error: `attach failed: ${(e as Error).message}` }; }
		}
	}
	return { ok: false, error: `the window did not come back within ${seconds} s${!port ? ' (and no CDP port to attach again: pass --cdp-port)' : ''}`, last: last.error ?? last.title ?? null };
}

export const windowCommands: Record<string, (argv: string[]) => Json | string> = {
	window: argv => {
		const p = parse(argv, ['session', 'timeout', 'cdp-port'], { reload: 1, 'open-folder': 2, 'new-window': 1, select: 2 });
		const [cmd, arg] = p.rest;
		if (p.flags.help || !cmd) { usage('window.sh'); }
		const s = p.session;
		const timeout = seconds(p, 'timeout', 60);
		// Read as Number(), "abc" or "" would fall back to instances.log's port without a word.
		const cdpPort = count(p, 'cdp-port', 0, 1, 'a CDP port number');
		if (cmd === 'select') {
			countOf(arg, 'select N', undefined, 1, 'the window number shot.sh --list shows');
			const list = inPage(s, windows, {});
			if (!list.ok) { return list; }
			const all = list.windows as { n: number; title: string }[];
			if (!all[Number(arg) - 1]) { return { ok: false, error: `no window ${arg}: ${all.length} open`, windows: all }; }
			try { cliRun(s, ['tab-select', String(Number(arg) - 1)]); } catch (e) { return { ok: false, error: `tab-select failed: ${(e as Error).message}` }; }
			const now = inPage(s, probe, { mark: '' });
			if (!now.ok) { return now; }
			log('window.sh', s, `select window ${arg}`, `${JSON.stringify(now.title)}, folder ${now.folder ?? 'none'}`);
			return { ok: true, window: Number(arg), title: now.title, folder: now.folder };
		}
		commandWord(cmd, ['reload', 'open-folder PATH', 'new-window', 'select N']);
		let folder = '';
		if (cmd === 'open-folder') {
			if (!arg) { throw new Exit(2, { ok: false, error: 'open-folder needs the folder\'s path' }); }
			folder = resolve(arg);
			if (!existsSync(folder) || !statSync(folder).isDirectory()) { return { ok: false, error: `${folder} is not a folder` }; }
		}
		const mark = `dp-${Date.now()}`;
		let before = inPage(s, probe, { mark });
		// A session that lost the page already (a reload done another way) is attached again first.
		if (!before.ok && before.cliFailed && cdpPort) {
			try { cliRun(s, ['attach', `--cdp=http://127.0.0.1:${cdpPort}`]); } catch (e) { return { ok: false, error: `the session has no page, and attach failed: ${(e as Error).message}` }; }
			before = { ...inPage(s, probe, { mark }), reattached: true };
		}
		if (!before.ok) { return { ...before, hint: 'if the session lost the page, pass --cdp-port to attach it again' }; }
		const port = cdpPort || cdpPortOf(String(before.userDataDir));
		const was = { title: before.title, folder: before.folder };
		if (cmd === 'new-window') {
			const opened = paletteRun(s, names.palette.newWindow);
			if (!opened.ok) { return opened; }
			let list: Json = { ok: false };
			for (const end = Date.now() + timeout * 1000; Date.now() < end;) {
				pause(0.5);
				list = inPage(s, windows, {});
				const all = (list.windows ?? []) as { title: string }[];
				if (list.ok && all.length > Number(before.windows) && all.every(w => w.title)) { break; }
			}
			const all = (list.windows ?? []) as { n: number; title: string }[];
			if (all.length <= Number(before.windows)) { return { ok: false, error: `no new window within ${timeout} s`, windows: all }; }
			log('window.sh', s, 'new window', `windows ${all.map(w => JSON.stringify(w.title)).join(', ')}`);
			return { ok: true, windows: all, opened: all.length, note: `the session still drives window ${(all.find(w => (w as { driven?: boolean }).driven) ?? all[0]).n}; window.sh select N drives another, shot.sh --window N shoots one` };
		}
		const acted = cmd === 'reload' ? paletteRun(s, names.palette.reloadWindow) : paletteRun(s, names.palette.openFolder);
		if (!acted.ok) { return acted; }
		if (cmd === 'open-folder') {
			const r = inPage(s, chooseFolder, { path: folder });
			// The click reloads the page under it.
			if (!r.ok && !(r.cliFailed && /closed|destroyed|navigat|detached/i.test(String(r.error)))) { return r; }
		}
		const now = comeBack(s, mark, timeout, port);
		if (!now.ok) { return { ...now, was }; }
		if (cmd === 'open-folder' && now.folder !== folder) { return { ok: false, error: `the window reloaded on ${now.folder ?? 'no folder'}, not ${folder}`, title: now.title, folder: now.folder, was }; }
		log('window.sh', s, cmd === 'reload' ? 'reload window' : `open folder ${folder}`, `${JSON.stringify(now.title)}, folder ${now.folder ?? 'none'}${now.reattached ? ', attached again' : ''}`);
		return { ok: true, did: cmd, title: now.title, folder: now.folder, was, reattached: !!(now.reattached || before.reattached), ...((now.dialogs as unknown[]).length ? { dialogs: now.dialogs, note: 'a dialog opened after the reload: answer it with notifications.sh --click BUTTON' } : {}) };
	},
};
