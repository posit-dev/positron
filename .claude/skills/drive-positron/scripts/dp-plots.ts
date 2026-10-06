/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The Plots pane's own reads: what the accessibility tree does not carry
// (whether the drawn image is blank, its size) and the filmstrip, whose
// thumbnails are buttons holding an image. Found by roles and accessible
// names, not classes. The pane's buttons and menus are ui.sh calls in plots.sh.

import { Exit, inPage, log, logRead, parse, usage, type Json, type PageFn } from './dp-lib.ts';

/**
 * The plot shown (name, sizes, a pixel check), the zoom, the toolbar and the
 * filmstrip; with select or remove, clicks a thumbnail first and reports the
 * pane after it.
 * runs in run-code
 */
const plots: PageFn<{ cmd: string; n: number; editor: boolean }> = async (page, a, lib) => {
	// With editor, the plot open in the active editor tab (plots.sh open editor), read the same way.
	const sc = await lib.scope(a.editor ? 'editor' : lib.names.views.plots);
	if (!('loc' in sc) || !sc.loc) { return { ok: false, ...sc, hint: a.editor ? 'open the plot with plots.sh open editor' : 'the Plots view is not on screen; run Session: Focus on Plots View' }; }
	const pane = sc.loc;
	// Thumbnails: buttons that hold an image. The plot shown is the image outside them.
	const thumbs = pane.getByRole('button').filter({ has: page.getByRole('img') }).filter({ visible: true });
	const read = () => pane.evaluate(async (el, { s, n, editor }) => {
		const shown = (e: Element) => (e as HTMLElement).offsetParent !== null;
		const name = (e: Element) => (e.getAttribute('aria-label') ?? e.textContent ?? '').trim();
		const main = [...el.querySelectorAll('img')].filter(shown).find(i => !i.closest('button'));
		const sample = async (im: HTMLImageElement) => {
			try {
				const c = document.createElement('canvas');
				c.width = im.naturalWidth; c.height = im.naturalHeight;
				const x = c.getContext('2d')!;
				const i = new Image(); i.src = im.src; await i.decode(); x.drawImage(i, 0, 0);
				const px = (p: number, q: number) => { const d = x.getImageData(p, q, 1, 1).data; return `rgb(${d[0]},${d[1]},${d[2]})`; };
				// Every pixel, up to 64 colours: a grid of samples misses a sparse plot's
				// thin lines and points (under 1% of a large image) and reads it as blank.
				const d = x.getImageData(0, 0, c.width, c.height).data;
				const seen = new Set<number>();
				for (let k = 0; k < d.length && seen.size < 64; k += 4) { seen.add((d[k] << 16) | (d[k + 1] << 8) | d[k + 2]); }
				return { topLeft: px(3, 3), colours: seen.size };
			} catch (e) { return { error: String(e) }; }
		};
		// The pane's buttons are in toolbars; an editor tab's plot buttons (Save Plot
		// From Active Editor) are in the editor's action bar, which has no toolbar
		// role: there, every button but the tabs' and the thumbnails'.
		const toolbars = editor ? [...el.querySelectorAll('button, [role=button]')].filter(b => !b.closest('[role=tablist]') && !b.querySelector('img'))
			: [...el.querySelectorAll('[role=toolbar] button')];
		const buttons = [...new Set(toolbars.filter(shown))].map(b => ({
			label: b.getAttribute('aria-label') ?? '', off: (b as HTMLButtonElement).disabled || b.getAttribute('aria-disabled') === 'true',
		})).filter(b => b.label && b.label !== n.overflow);
		// A thumbnail not drawn yet holds a placeholder, an element of role img.
		const thumbEls = [...el.querySelectorAll('button')].filter(b => shown(b) && b.querySelector('img, [role=img]'));
		// A thumbnail's name as drawn under it; its image's alt is an interactive plot's id ("Plot 8959...").
		const thumbName = (t: Element) => (t.querySelector(s.thumbnailName)?.textContent ?? '').trim() || t.querySelector('img')?.alt || name(t);
		const selectedThumb = thumbEls.find(t => t.getAttribute('aria-pressed') === 'true' || !!t.closest(s.selected));
		const r = main?.getBoundingClientRect();
		// The picture as drawn inside the img element, in CSS pixels: under Fit the
		// element fills the pane and object-fit: contain draws the image smaller.
		const drawn = (() => {
			if (!main || !r || !main.naturalWidth || !main.naturalHeight) { return null; }
			const [nw, nh] = [main.naturalWidth, main.naturalHeight];
			const fit = getComputedStyle(main).objectFit;
			const contain = Math.min(r.width / nw, r.height / nh);
			const k = fit === 'contain' ? contain : fit === 'scale-down' ? Math.min(1, contain) : fit === 'none' ? 1 : null;
			return k === null ? `${Math.round(r.width)}x${Math.round(r.height)}` : `${Math.round(nw * k)}x${Math.round(nh * k)}`;
		})();
		// The plot's name as the header above it shows it ("interactive 1"). The
		// header text has no role, so it is read from the page; an image's alt is
		// its code, not its name.
		const header = (el.querySelector(s.name)?.textContent ?? '').trim();
		// An interactive plot (plotly, bokeh) is a webview: an iframe the workbench
		// lays over the plot's place, outside the pane, so it is found by position.
		const place = [...el.querySelectorAll(s.instance)].find(shown)?.getBoundingClientRect();
		const web = !main && place ? [...document.querySelectorAll<HTMLIFrameElement>(s.webview)].map(f => f.getBoundingClientRect())
			.find(f => f.width > 0 && Math.abs(f.left - place.left) < 2 && Math.abs(f.top - place.top) < 2) : undefined;
		return {
			// natural is the image's own pixels, which Positron renders at the
			// display's scale (device pixels); drawn and box are CSS pixels.
			devicePixelRatio: window.devicePixelRatio,
			plot: main ? {
				name: header || (selectedThumb ? thumbName(selectedThumb) : '') || main.alt, drawn, natural: `${main.naturalWidth}x${main.naturalHeight}`,
				naturalCss: `${Math.round(main.naturalWidth / window.devicePixelRatio)}x${Math.round(main.naturalHeight / window.devicePixelRatio)}`,
				box: `${Math.round(r!.width)}x${Math.round(r!.height)}`, pixels: await sample(main),
			}
				: web ? { name: header || (selectedThumb ? thumbName(selectedThumb) : ''), webview: true, box: `${Math.round(web.width)}x${Math.round(web.height)}` } : null,
			// The pane's zoom button is named after the zoom; an editor's ("Set the plot zoom") shows only an icon.
			zoom: buttons.map(b => b.label).find(l => new RegExp(n.zoomPattern).test(l)),
			toolbar: [...new Set(buttons.map(b => b.off ? b.label + ' (off)' : b.label))],
			filmstrip: thumbEls.map((t, i) => ({
				n: i + 1, name: thumbName(t),
				// aria-pressed once the product sets it; until then the thumbnail's own selected state.
				selected: t.getAttribute('aria-pressed') === 'true' || !!t.closest(s.selected),
			})),
		};
	}, { s: lib.css.plots, n: lib.names.plots, editor: a.editor });
	// No editor buttons: a compact window shows none, or the helper found no action bar.
	const why = async () => await page.getByRole('button', { name: lib.names.workbench.compactModeOff, exact: true }).filter({ visible: true }).count()
		? `this window is in compact mode (its title bar has "${lib.names.workbench.compactModeOff}"), which shows no tabs or editor buttons: no toolbar here`
		: await pane.locator(lib.css.editorGroup.actions).count() ? 'the editor\'s action bar holds no buttons'
			: 'found no editor action bar in this editor: the plot may have no toolbar here, or the helper does not know where it is; read the window with ui.sh read editor';
	const state = async () => {
		const s = await read();
		const clearOff = s.toolbar.includes(lib.names.plots.clearAll + ' (off)');
		return {
			ok: true, ...s, ...(a.editor && !s.toolbar.length ? { toolbarNote: await why() } : {}),
			// No plot drawn: an empty pane (nothing to clear), or plots in the history with none shown.
			blank: !s.plot, ...(!s.plot && s.filmstrip.length ? { note: 'plots are in the history but none is shown' } : {}), ...(!s.plot && clearOff ? { empty: true } : {}),
		};
	};
	if (a.cmd === 'read') { return state(); }
	const t = thumbs.nth(a.n - 1);
	if (!await t.count()) { return { ok: false, error: `no thumbnail ${a.n}: the filmstrip shows only with several plots and room, or plots.historyPolicy set to always`, filmstrip: (await read()).filmstrip }; }
	const before = await state();
	if (a.cmd === 'select') {
		await t.click({ timeout: 3000 });
	} else {
		// The thumbnail's other button, beside it, removes it; it shows on hover.
		const box = t.locator('xpath=..');
		await box.hover({ timeout: 3000 });
		const remove = box.getByRole('button').filter({ hasNot: page.getByRole('img') }).first();
		await remove.click({ timeout: 3000 });
	}
	let after = before;
	for (let i = 0; i < 20; i++) {
		await lib.sleep(150);
		after = await state();
		if (JSON.stringify(after) !== JSON.stringify(before)) { break; }
	}
	const changed = JSON.stringify(after) !== JSON.stringify(before);
	const shrank = after.filmstrip.length < before.filmstrip.length;
	if (a.cmd === 'remove' && !shrank) { return { ...after, ok: false, error: 'the filmstrip did not shrink: the click did not land' }; }
	return { ...after, changed };
};

/** The plot shown, the zoom and the filmstrip in one line, for the log. */
function plotLine(out: Json, editor: boolean): string {
	const plot = out.plot as { name: string; drawn?: string; natural?: string; box: string; webview?: boolean; pixels?: { colours?: number; topLeft?: string } } | null;
	const strip = out.filmstrip as { name: string; selected: boolean }[];
	const sizes = plot && !plot.webview ? `drawn ${plot.drawn} CSS px, natural ${plot.natural} device px (devicePixelRatio ${out.devicePixelRatio})` : '';
	return `${editor ? 'editor plot' : 'Plots'}: ${plot ? `"${plot.name}" ${plot.webview ? 'webview ' + plot.box + ' CSS px' : `${sizes}, ${plot.pixels?.colours} colours, top-left ${plot.pixels?.topLeft}`}` : 'blank'}; zoom ${out.zoom ?? 'none'}; filmstrip ${strip.length}${strip.length ? ` (selected ${strip.findIndex(t => t.selected) + 1})` : ''}`;
}

export const plotsCommands: Record<string, (argv: string[]) => Json | string> = {
	plots: argv => {
		const p = parse(argv, ['session', 'did'], { read: 1, select: 2, remove: 2 });
		const [cmd, n] = p.rest;
		const editor = !!p.flags.editor;
		if (p.flags.help || !cmd) { usage('plots.sh'); }
		if (cmd !== 'read' && cmd !== 'select' && cmd !== 'remove') { throw new Exit(2, { ok: false, error: 'dp plots: read, select N or remove N' }); }
		if (cmd !== 'read' && !/^\d+$/.test(n ?? '')) { throw new Exit(2, { ok: false, error: 'give the thumbnail number, 1 = first' }); }
		if (editor && cmd !== 'read') { throw new Exit(2, { ok: false, error: '--editor goes with read' }); }
		const out = inPage(p.session, plots, { cmd, n: Number(n ?? 0), editor });
		if (cmd !== 'read' && (out.ok || out.changed)) { log('plots.sh', p.session, `${cmd === 'select' ? 'select' : 'remove'} plot thumbnail ${n}`, plotLine(out, false)); }
		// --did: plots.sh's own action, logged with the pane it left.
		if (cmd === 'read' && out.ok && p.flags.did) { log('plots.sh', p.session, String(p.flags.did), plotLine(out, editor)); }
		if (cmd === 'read' && out.ok && !p.flags.did) { logRead('plots.sh', p.session, plotLine(out, editor)); }
		return out;
	},
};
