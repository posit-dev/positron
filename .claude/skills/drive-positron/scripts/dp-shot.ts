/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// shot: a screenshot of the window, an element or a view, saved and logged;
// --list, the app's windows. shot.sh wraps it.

import { existsSync, mkdirSync, rmSync, statSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { count, failText, inPage, log, parse, textFlag, usage, type Json, type PageFn } from './dp-lib.ts';

/**
 * The app's windows, numbered from 1 in the order the browser lists them; the
 * attached one is the window every other command drives. A plot or an editor
 * opened in a new window is another window here.
 * runs in run-code
 */
const listWindows: PageFn<Record<string, never>> = async page => ({
	ok: true,
	windows: await Promise.all(page.context().browser()!.contexts().flatMap(c => c.pages()).map(async (p, i) => ({ n: i + 1, title: await p.title(), ...(p === page ? { attached: true } : {}) }))),
});

/** The first unused name after `path` in its folder: S03-02.png for S03-01.png, x-2.png for x.png. */
function nextFreeShot(path: string): string {
	const m = /^(.*?)(\d+)?(\.\w+)$/.exec(basename(path))!;
	const width = m[2]?.length ?? 1;
	for (let n = Number(m[2] ?? 1) + 1; ; n++) {
		const name = `${m[1]}${m[2] ? '' : '-'}${String(n).padStart(width, '0')}${m[3]}`;
		if (!existsSync(join(dirname(path), name))) { return name; }
	}
}

/**
 * Why a shot's file name is refused, or '': a run's lint finds the shots a
 * report cites by name, and reads only [A-Za-z0-9._-] in one ("S15-50%.png"
 * would be a check with no screenshot).
 */
export function badShotName(file: string): string {
	const name = basename(file);
	if (/^[A-Za-z0-9._-]+$/.test(name)) { return ''; }
	const fixed = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+(?=\.|$)/g, '').replace(/^-+/, '') || 'shot.png';
	return `take it as ${fixed}: lint reads only A-Z a-z 0-9 . _ - in a shot's name, not ${JSON.stringify(name)}`;
}

function shot(session: string, file: string, target: string, window: number, view = ''): Json {
	const path = file.includes('/') ? resolve(file) : join(process.env.DRIVE_POSITRON_SHOTS ?? '.', file);
	// A cited shot is the moment its check judged, so a run's shot is never
	// replaced: a second capture under one name leaves the first check unproven.
	if (existsSync(path) && process.env.DRIVE_POSITRON_SHOTS && !file.includes('/')) {
		return { ok: false, error: `${file} already exists in ${process.env.DRIVE_POSITRON_SHOTS}; shots are never overwritten, so take this one as ${nextFreeShot(path)}` };
	}
	mkdirSync(dirname(path), { recursive: true });
	rmSync(path, { force: true });
	// runs in run-code
	const fn: PageFn<{ path: string; target: string; window: number; view: string }> = async (attached, a, lib) => {
		const all = attached.context().browser()!.contexts().flatMap(c => c.pages());
		if (a.window && !all[a.window - 1]) { return { ok: false, error: `no window ${a.window}: ${all.length} open; list them with --list` }; }
		const page = a.window ? all[a.window - 1] : attached;
		// A view as ui.sh read names it, or the active console alone: every
		// session's console is laid out, stacked under the active one, so a
		// selector for a console matches them all.
		if (a.view) {
			const sc = a.view.toLowerCase() === 'active console'
				? { loc: page.locator(lib.css.console.active).filter({ visible: true }), name: 'the active console' }
				: await lib.scope(a.view);
			if (!('loc' in sc) || !sc.loc || !await sc.loc.count()) { return { ok: false, ...('error' in sc ? sc : { error: 'no console is on screen' }) }; }
			await sc.loc.first().screenshot({ path: a.path, timeout: 5000, scale: 'css' });
			return { ok: true, title: await page.title(), of: sc.name };
		}
		// CSS pixels, as playwright-cli takes them: a device-pixel shot is about four
		// times the size, and costs that much more to read back.
		if (!a.target) { await page.screenshot({ path: a.path, scale: 'css' }); return { ok: true, title: await page.title() }; }
		// A snapshot ref (e153, f1e12) or a CSS selector that must match one visible element:
		// with two, a screenshot writes nothing and says nothing.
		const ref = /^(f\d+)?e\d+$/.test(a.target);
		const loc = page.locator(ref ? 'aria-ref=' + a.target : a.target);
		const n = ref ? await loc.count() : await loc.filter({ visible: true }).count();
		if (n !== 1) { return { ok: false, error: n === 0 ? `${a.target} matches nothing visible` : `${a.target} matches ${n} visible elements; narrow it to one` }; }
		await (ref ? loc : loc.filter({ visible: true })).screenshot({ path: a.path, timeout: 5000, scale: 'css' });
		return { ok: true, title: await page.title() };
	};
	const r = inPage(session, fn, { path, target, window, view });
	if (!r.ok) { return r; }
	if (!existsSync(path) || statSync(path).size === 0) { return { ok: false, error: `no screenshot written to ${path}` }; }
	log('shot.sh', session, `screenshot ${basename(path)}${target ? ' of ' + target : ''}${r.of ? ' of ' + r.of : ''}${window ? ` of window ${window} (${r.title})` : ''}`);
	return { ok: true, path };
}

export const shotCommands: Record<string, (argv: string[]) => Json | string> = {
	'shot': argv => {
		const p = parse(argv, ['session', 'window', 'view'], 2, ['list']);
		if (p.flags.help) { usage('shot.sh'); }
		if (p.flags.list) { return inPage(p.session, listWindows, {}); }
		if (!p.rest[0]) { failText('shot.sh', 'give the file name', 2); }
		if (badShotName(p.rest[0])) { failText('shot.sh', badShotName(p.rest[0]), 2); }
		if (p.flags.view !== undefined && (p.rest[1] || p.flags.window)) { failText('shot.sh', '--view takes no SELECTOR and no --window', 2); }
		const r = shot(p.session, p.rest[0], p.rest[1] ?? '', count(p, 'window', 0, 1, 'a window number from --list'), textFlag(p, 'view'));
		if (!r.ok) { failText('shot.sh', String(r.error)); }
		return String(r.path);
	},
};
