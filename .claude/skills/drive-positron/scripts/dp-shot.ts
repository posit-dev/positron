/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// shot: a screenshot of the window, an element or a view, saved and logged;
// --list, the app's windows. shot.sh wraps it.

import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { count, failText, inPage, log, parse, usage, type Json, type PageFn } from './dp-lib.ts';

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

/** A PNG's width and height from its header, or null when it is not a PNG. */
export function pngSize(path: string): { width: number; height: number } | null {
	const head = readFileSync(path).subarray(0, 24);
	return head.length === 24 && head.toString('latin1', 12, 16) === 'IHDR' ? { width: head.readUInt32BE(16), height: head.readUInt32BE(20) } : null;
}

/** The crop beside a shot: S03-01.png's is S03-01.crop.png. */
export const cropName = (file: string) => file.replace(/\.png$/i, '') + '.crop.png';

function shot(session: string, file: string, target: string, window: number, view = '', crop = false): Json {
	const path = file.includes('/') ? resolve(file) : join(process.env.DRIVE_POSITRON_SHOTS ?? '.', file);
	const cropPath = crop ? cropName(path) : '';
	// A cited shot is the moment its check judged, so a run's shot is never
	// replaced: a second capture under one name leaves the first check unproven.
	if (existsSync(path) && process.env.DRIVE_POSITRON_SHOTS && !file.includes('/')) {
		return { ok: false, error: `${file} already exists in ${process.env.DRIVE_POSITRON_SHOTS}; shots are never overwritten, so take this one as ${nextFreeShot(path)}` };
	}
	mkdirSync(dirname(path), { recursive: true });
	rmSync(path, { force: true });
	if (cropPath) { rmSync(cropPath, { force: true }); }
	// runs in run-code
	const fn: PageFn<{ path: string; crop: string; target: string; window: number; view: string }> = async (attached, a, lib) => {
		const all = attached.context().browser()!.contexts().flatMap(c => c.pages());
		if (a.window && !all[a.window - 1]) { return { ok: false, error: `no window ${a.window}: ${all.length} open; list them with --list` }; }
		const page = a.window ? all[a.window - 1] : attached;
		// The region: a view as ui.sh read names it, or the active console alone,
		// since every session's console is laid out, stacked under the active one,
		// and a selector for a console matches them all. Or a snapshot ref (e153,
		// f1e12) or a CSS selector that must match one visible element: with two,
		// a screenshot writes nothing and says nothing.
		let region = null;
		let of = '';
		if (a.view) {
			const sc = a.view.toLowerCase() === 'active console'
				? { loc: page.locator(lib.css.console.active).filter({ visible: true }), name: 'the active console' }
				: await lib.scope(a.view);
			if (!('loc' in sc) || !sc.loc || !await sc.loc.count()) { return { ok: false, ...('error' in sc ? sc : { error: 'no console is on screen' }) }; }
			region = sc.loc.first();
			of = sc.name;
		} else if (a.target) {
			const ref = /^(f\d+)?e\d+$/.test(a.target);
			const loc = page.locator(ref ? 'aria-ref=' + a.target : a.target);
			const n = ref ? await loc.count() : await loc.filter({ visible: true }).count();
			if (n !== 1) { return { ok: false, error: n === 0 ? `${a.target} matches nothing visible` : `${a.target} matches ${n} visible elements; narrow it to one` }; }
			region = ref ? loc : loc.filter({ visible: true });
		}
		// CSS pixels, as playwright-cli takes them: a device-pixel shot is about four
		// times the size, and costs that much more to read back.
		if (!region || a.crop) { await page.screenshot({ path: a.path, scale: 'css' }); }
		if (region && !a.crop) { await region.screenshot({ path: a.path, timeout: 5000, scale: 'css' }); }
		if (region && a.crop) {
			// The region with 16px around it, kept inside the window, so its
			// header and edges show: the preview a report shows on hover.
			const box = await region.boundingBox({ timeout: 5000 });
			if (!box) { return { ok: false, error: 'the region to crop is not on screen' }; }
			const [w, h] = await page.evaluate(() => [innerWidth, innerHeight]);
			const x = Math.max(0, Math.floor(box.x - 16)), y = Math.max(0, Math.floor(box.y - 16));
			const clip = { x, y, width: Math.min(w, Math.ceil(box.x + box.width + 16)) - x, height: Math.min(h, Math.ceil(box.y + box.height + 16)) - y };
			await page.screenshot({ path: a.crop, clip, scale: 'css' });
		}
		return { ok: true, title: await page.title(), of };
	};
	const r = inPage(session, fn, { path, crop: cropPath, target, window, view });
	if (!r.ok) { return r; }
	if (!existsSync(path) || statSync(path).size === 0) { return { ok: false, error: `no screenshot written to ${path}` }; }
	const size = (p: string) => { const s = pngSize(p); return s ? ` ${s.width}x${s.height}` : ''; };
	// Both files and their CSS sizes, so the report knows the crop is there and how big.
	const region = `${target ? ' of ' + target : ''}${r.of ? ' of ' + r.of : ''}`;
	const cropped = cropPath && existsSync(cropPath) ? `, crop ${basename(cropPath)}${size(cropPath)}${region}` : '';
	log('shot.sh', session, `screenshot ${basename(path)}${cropPath ? size(path) : region}${cropped}${window ? ` of window ${window} (${r.title})` : ''}`);
	// Wider than 1000 CSS px, a crop no longer fits a preview at full size.
	const wide = cropPath ? pngSize(cropPath) : null;
	return { ok: true, path, ...(cropPath ? { crop: cropPath } : {}), ...(wide && wide.width > 1000 ? { warning: `the crop is ${wide.width}px wide; pick a smaller region, under 1000px` } : {}) };
}

export const shotCommands: Record<string, (argv: string[]) => Json | string> = {
	'shot': argv => {
		const p = parse(argv, ['session', 'window', 'view'], 2, ['list', 'crop']);
		if (p.flags.help) { usage('shot.sh'); }
		if (p.flags.list) { return inPage(p.session, listWindows, {}); }
		if (!p.rest[0]) { failText('shot.sh', 'give the file name', 2); }
		if (badShotName(p.rest[0])) { failText('shot.sh', badShotName(p.rest[0]), 2); }
		if (p.flags.view !== undefined && (p.rest[1] || p.flags.window)) { failText('shot.sh', '--view takes no SELECTOR and no --window', 2); }
		if (p.flags.crop && !p.rest[1] && p.flags.view === undefined) { failText('shot.sh', '--crop needs the region to crop: a SELECTOR or --view', 2); }
		const r = shot(p.session, p.rest[0], p.rest[1] ?? '', count(p, 'window', 0, 1, 'a window number from --list'), String(p.flags.view ?? ''), Boolean(p.flags.crop));
		if (!r.ok) { failText('shot.sh', String(r.error)); }
		if (r.warning) { console.error(`shot.sh: ${r.warning}`); }
		return [r.path, r.crop].filter(Boolean).join('\n');
	},
};
