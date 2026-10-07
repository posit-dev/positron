/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// notifications: the toasts and modal dialogs on screen, and their buttons.
// notifications.sh wraps it.

import { Exit, inPage, log, parse, usage, type Json, type PageFn } from './dp-lib.ts';

export function notifications(session: string, o: { click: string; match: string; clear: boolean }): Json {
	// runs in run-code
	const fn: PageFn<{ click: string; match: string; clear: boolean }> = async (page, a, lib) => {
		const n = lib.css.notification;
		const read = () => page.evaluate(sel => {
			const clean = (el: Element | null | undefined) => el ? (el.textContent ?? '').replace(/\s+/g, ' ').trim() : '';
			document.querySelectorAll('[data-dp-row]').forEach(e => e.removeAttribute('data-dp-row'));
			return [...document.querySelectorAll<HTMLElement>(sel.rows)].filter(r => r.offsetParent !== null).map((r, i) => {
				r.setAttribute('data-dp-row', String(i));
				const icon = r.querySelector(sel.icon);
				return {
					kind: 'notification', row: i,
					severity: icon ? (['error', 'warning', 'info'].find(s => icon.className.includes(s)) ?? 'unknown') : 'unknown',
					message: clean(r.querySelector(sel.message)),
					source: clean(r.querySelector(sel.source)),
					buttons: [...r.querySelectorAll(sel.buttons)].map(b => clean(b)).filter(Boolean),
					inCenter: !!r.closest(sel.center),
				};
			});
		}, n);
		let dialogs = await lib.dialogs();
		let toasts = await read();
		// A prompt can be on its way, a moment after the action that raised it:
		// wait up to 3 s for a button of that name before saying there is none.
		const has = () => dialogs.some(d => d.buttons.includes(a.click)) || toasts.some(t => t.buttons.includes(a.click));
		for (let i = 0; a.click && !has() && i < 15; i++) { await lib.sleep(200); dialogs = await lib.dialogs(); toasts = await read(); }
		const list = () => [...dialogs, ...toasts.map(({ row, ...t }) => t)];
		if (a.click) {
			const d = dialogs.find(x => x.buttons.includes(a.click) && (!a.match || (x.message + ' ' + x.detail).includes(a.match)));
			if (d) {
				// Positron's dialog buttons ignore a click() from page script, so click for
				// real, on the topmost of the dialogs that match: one shown twice (a
				// runtime "is not responding" prompt raised again) stacks a second copy
				// over the first, whose buttons then take no click.
				const box = page.locator(lib.css.dialog.box).filter({ visible: true }).filter({ hasText: d.message }).last();
				const handle = await box.elementHandle({ timeout: 2000 });
				const button = box.locator(lib.css.dialog.buttons).filter({ hasText: new RegExp('^\\s*' + a.click.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$') }).first();
				await button.click({ timeout: 3000 });
				const closed = await page.waitForFunction(e => !e || !e.isConnected || !(e as HTMLElement).offsetParent, handle, { timeout: 2000 }).then(() => true, () => false);
				const left = await lib.dialogs();
				return { ok: true, clicked: a.click, message: d.message, kind: 'dialog', closed, ...(left.length ? { dialogs: left, note: `${left.length} dialog${left.length > 1 ? 's are' : ' is'} still open` } : {}) };
			}
			const hits = toasts.filter(t => t.buttons.includes(a.click) && (!a.match || t.message.includes(a.match)));
			if (hits.length > 1) { return { ok: false, error: `${hits.length} notifications have a "${a.click}" button; pass --match`, notifications: list() }; }
			if (!hits.length) { return { ok: false, error: `no notification has a "${a.click}" button`, notifications: list() }; }
			await page.locator(`[data-dp-row="${hits[0].row}"] ${n.buttons}`).filter({ hasText: a.click }).first().click({ timeout: 3000 });
			await lib.sleep(200);
			toasts = await read();
			return { ok: true, clicked: a.click, message: hits[0].message, notifications: toasts.filter(t => !t.inCenter).map(({ row, ...t }) => t) };
		}
		if (a.clear) {
			const clears = page.locator(n.clear).filter({ visible: true });
			for (let n = await clears.count(); n > 0; n--) { await clears.first().click({ timeout: 2000 }).catch(() => { }); await lib.sleep(100); }
			toasts = await read();
			return { ok: true, notifications: list(), remaining: toasts.filter(t => !t.inCenter).length };
		}
		return { ok: true, notifications: list() };
	};
	const r = inPage(session, fn, o);
	if (o.click && r.ok) { log('notifications.sh', session, `clicked "${o.click}" on "${String(r.message ?? '').slice(0, 80)}"`); }
	if (o.clear) { log('notifications.sh', session, 'cleared toasts'); }
	return r;
}

export const notificationsCommands: Record<string, (argv: string[]) => Json | string> = {
	'notifications': argv => {
		const p = parse(argv, ['session', 'click', 'match'], 0, ['clear', 'help']);
		if (p.flags.help) { usage('notifications.sh'); }
		// --match narrows a --click; alone it would be dropped and the list read as an answer.
		if (p.flags.match !== undefined && p.flags.click === undefined) { throw new Exit(2, { ok: false, error: '--match goes with --click BUTTON; it picks which notification to click' }); }
		if (p.flags.click !== undefined && p.flags.clear) { throw new Exit(2, { ok: false, error: '--click or --clear, not both' }); }
		return notifications(p.session, { click: String(p.flags.click ?? ''), match: String(p.flags.match ?? ''), clear: !!p.flags.clear });
	},
};
