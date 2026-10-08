/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Generic commands for any view, by accessible role and name rather than CSS
// classes, so a renamed class does not break them: read a view, click,
// choose from a menu, pick from a quick pick, fill a field, tick a box. Every
// action finds exactly one target, acts once, and reports what changed in the
// view's accessibility tree, so a click that did nothing says so. ui.sh wraps
// these.

import { Exit, inPage, log, logRead, parse, seconds, treeLine, textFlag, usage, type Json, type PageFn, type Parsed } from './dp-lib.ts';

interface Target { scope: string; role: string; name: string; partial: boolean; nth: number; watch: string; right?: boolean }

/**
 * Finds one target in its scope, runs act on it, then reports whether the
 * scope's accessibility tree changed within the wait, with the lines that did.
 * runs in run-code (as the body of each action below).
 */
const action: PageFn<Target & { kind: string; text: string; want: string; wait: number }> = async (page, a, lib) => {
	const sc = await lib.scope(a.scope);
	if (!('loc' in sc) || !sc.loc) { return { ok: false, ...sc }; }
	const scope = sc.loc;
	// In a menu, an item is whatever is clickable there: a menu item, an option, or
	// a button (Positron's context menu and a drop-down list's popup draw buttons),
	// so `click menuitem SVG --in menu` reaches what `read menu` showed.
	const roles = a.scope.toLowerCase() === 'menu' && /^(menuitem|option)/.test(a.role) ? [a.role, 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'button'] : [a.role];
	const find = async () => {
		for (const role of roles) {
			const l = await lib.byRole(scope, role, a.name, a.partial);
			if (await l.filter({ visible: true }).count()) { return l; }
		}
		return lib.byRole(scope, a.role, a.name, a.partial);
	};
	let all = await find();
	let shown = all.filter({ visible: true });
	// Some buttons exist, or show, only while their view is hovered (a pane header's actions).
	if (!await shown.count()) {
		await scope.hover({ timeout: 2000 }).catch(() => { });
		await lib.sleep(150);
		all = await find();
		shown = all.filter({ visible: true });
	}
	const n = await shown.count();
	const label = `${a.role} "${a.name}"${a.scope ? ' in ' + a.scope : ''}`;
	if (n === 0) {
		const roles = await lib.snapshot(scope, 40);
		return { ok: false, error: `no visible ${label}`, hint: 'the view as it reads now is in "view"', view: roles };
	}
	if (n > 1 && !a.nth) {
		const names = await shown.evaluateAll(es => es.map(e => (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 60)));
		return { ok: false, error: `${n} visible ${label}; pass --nth (1 = first) or a longer name`, matches: names };
	}
	let el = shown.nth(Math.max(0, (a.nth || 1) - 1));
	// The view whose change is reported: --watch, else the one searched.
	let watched = scope;
	if (a.watch) {
		const w = await lib.scope(a.watch);
		if (!('loc' in w) || !w.loc) { return { ok: false, ...w }; }
		watched = w.loc;
	}
	// Playwright would wait out its timeout on a disabled control and fail with its own message.
	if (await el.isDisabled().catch(() => false)) { return { ok: false, error: `${label} is disabled; nothing was done` }; }
	if (a.kind === 'fill' && !await el.isEditable().catch(() => true)) { return { ok: false, error: `${label} is read-only; nothing was filled` }; }
	// The name of the element acted on, for "did": with --partial or --nth it is
	// not the name given (debug.sh frame clicks row "" --nth 2). A field has no
	// text of its own: its name is its label's (Save Plot's Width, a checkbox's).
	const actual = (await el.evaluate(e => {
		const text = (x: Element | null | undefined) => (x?.textContent ?? '').replace(/\s+/g, ' ').trim();
		const by = (e.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean).map(id => text(document.getElementById(id))).join(' ');
		const field = e as HTMLInputElement;
		return (e.getAttribute('aria-label') || by || text(field.labels?.[0]) || text(e.closest('label')) || e.getAttribute('title') || field.placeholder || text(e)).replace(/\s+/g, ' ').trim();
	}).catch(() => '') || a.name).slice(0, 100);
	const before = await lib.snapshot(watched, 400);
	// What opens on top counts as a change too: a dialog, a menu, a quick pick.
	// A notification toast is a dialog by role but not an overlay: it is reported
	// on its own, by its name ("Info: Plot copied, notification").
	const overlays = () => page.locator(lib.css.overlay.any).filter({ visible: true }).and(page.locator(lib.css.overlay.notInToasts)).count();
	const overlaysBefore = await overlays();
	await lib.markOverlays();
	const toastsBefore = await lib.toasts();
	const acted = Date.now();
	let checked: Record<string, unknown> = {};
	if (a.kind === 'click') {
		// A menu ignores a click that arrives before the pointer rests on the item.
		if (a.scope.toLowerCase() === 'menu') { await el.hover({ timeout: 3000 }); await lib.sleep(100); }
		await el.click({ timeout: 3000, ...(a.right ? { button: 'right' as const } : {}) });
	} else if (a.kind === 'fill') {
		await el.fill(a.text, { timeout: 3000 });
		const now = await el.inputValue().catch(() => null);
		if (now !== a.text) { return { ok: false, error: `${label} reads "${now}" after filling "${a.text}"` }; }
	} else if (a.kind === 'check') {
		// The element, not its name: a checkbox row can be renamed by the click
		// itself (a breakpoint's "dbg.R 7" row becomes "dbg.R 7, Disabled
		// Breakpoint"), and a locator by the old name would then find nothing.
		// A named row can wrap the real, unnamed checkbox (the Breakpoints
		// view's Errors); the control is the innermost one.
		const row = await el.elementHandle({ timeout: 3000 });
		if (!row) { return { ok: false, error: `${label} went away before the click; nothing was done` }; }
		const box = await row.$('[role=checkbox], input[type=checkbox]') ?? row;
		const nameOf = () => row.evaluate(e => e.isConnected ? (e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim() : null);
		// What is drawn decides: Positron's modal checkbox draws a check mark and
		// leaves aria-checked false, so a state read from ARIA alone is wrong there.
		const state = () => box.evaluate((e, mark) => {
			const drawn = e.getAttribute('role') === 'checkbox' && e.tagName !== 'INPUT' && !!e.querySelector(mark);
			const aria = e.getAttribute('aria-checked') === 'true' || (e as HTMLInputElement).checked === true;
			return drawn || aria;
		}, lib.css.checkbox.checkMark);
		const was = await state();
		const want = a.want === 'on';
		if (was === want) { return { ok: true, [a.role]: actual, already: true, checked: was }; }
		await box.click({ timeout: 3000 });
		let now = was;
		for (let i = 0; i < 10 && now !== want; i++) { await lib.sleep(100); now = await state().catch(() => now); }
		const renamed = await nameOf().catch(() => null);
		if (now !== want) { return { ok: false, error: `${label} is still ${now ? 'checked' : 'clear'} after the click` }; }
		checked = { checked: now, ...(renamed && renamed !== actual ? { renamed: `${actual} -> ${renamed}` } : {}) };
	}
	// Wait for the view to change and settle: its tree, something opening on
	// top, or the view closing (a dialog's Save).
	const settled = await lib.settle(watched, before, a.wait, async () => await overlays() > overlaysBefore);
	const opened = await overlays() > overlaysBefore;
	const closed = settled.closed && !opened;
	// Which kind opened, and the one command that reads it.
	const openedText = async () => {
		const o = await lib.opened(false);
		return o ? `a ${o.kind === 'quickpick' ? 'quick pick' : o.kind}: read it with ui.sh read ${o.kind}` : 'a dialog, menu or quick pick opened; read it with ui.sh read dialog, read menu or read quickpick';
	};
	const diff = closed ? [] : lib.diff(before, settled.tree);
	// A toast can come a second after the action: wait for one up to 1.5 s after it.
	const toasts = await lib.newToasts(toastsBefore, acted + 1500);
	return {
		ok: true, did: `${a.kind} ${a.role} "${actual}"${a.scope ? ' in ' + a.scope : ''}`, changed: closed || opened || diff.length > 0 || toasts.length > 0, ...checked,
		...(closed ? { note: `the ${a.watch || a.scope || 'view'} closed` } : {}),
		...(opened ? { opened: await openedText() } : {}),
		...(toasts.length ? { notification: toasts.join(' | ') } : {}),
		...(diff.length ? { diff: diff.slice(0, 20), ...(diff.length > 20 ? { more: diff.length - 20 } : {}) } : {}),
	};
};

// One view, or several in one call (each by name, missing ones listed).
// runs in run-code
const readView: PageFn<{ scopes: string[] }> = async (_page, a, lib) => {
	if (a.scopes.length <= 1) {
		const sc = await lib.scope(a.scopes[0] ?? '');
		if (!('loc' in sc) || !sc.loc) { return { ok: false, ...sc }; }
		// A web page in a frame (Help, the Viewer) is not in this tree: say so rather than return half the view.
		const framed = !!await lib.frameIn(sc.loc);
		return { ok: true, view: sc.name, tree: await lib.snapshot(sc.loc), ...(framed ? { note: `this view shows a web page in a frame, which this tree does not include; view-read.sh --view ${sc.name} reads the page` } : {}) };
	}
	const trees: Record<string, string> = {};
	const missing: string[] = [];
	for (const name of a.scopes) {
		const sc = await lib.scope(name);
		if ('loc' in sc && sc.loc) { trees[name] = await lib.snapshot(sc.loc); } else { missing.push(name); }
	}
	return { ok: Object.keys(trees).length > 0, trees, ...(missing.length ? { missing } : {}) };
};

/**
 * Opens a menu with its trigger and chooses an item by name (lib.choose): from
 * what the click opened (lib.opened), a menu, a popup of its own, or a list
 * drawn inside the overlay the trigger is in. Then reports what the choice changed, as a click does: the view's diff, the
 * trigger's name after (a menu button is often named after its value: Auto
 * becomes Square), and a toast the choice raised.
 * runs in run-code
 */
const choose: PageFn<Target & { item: string; wait: number }> = async (page, a, lib) => {
	const sc = await lib.scope(a.scope);
	if (!('loc' in sc) || !sc.loc) { return { ok: false, ...sc }; }
	let trig = (await lib.byRole(sc.loc, a.role, a.name, a.partial)).filter({ visible: true });
	// A split button has two halves of one name; the menu is the one with a popup.
	if (await trig.count() > 1 && !a.nth) {
		const popup = trig.and(sc.loc.locator('[aria-haspopup]'));
		if (await popup.count() === 1) { trig = popup; }
	}
	const n = await trig.count();
	if (n !== 1 && !a.nth) { return { ok: false, error: n ? `${n} visible ${a.role} "${a.name}"; pass --nth` : `no visible ${a.role} "${a.name}"` }; }
	const t = trig.nth(Math.max(0, (a.nth || 1) - 1));
	const handle = await t.elementHandle();
	if (await t.isDisabled().catch(() => false)) { return { ok: false, error: `${a.role} "${a.name}"${a.scope ? ' in ' + a.scope : ''} is disabled; nothing was done` }; }
	const triggerBefore = await t.evaluate(e => (e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim());
	const before = await lib.snapshot(sc.loc, 400);
	const toastsBefore = await lib.toasts();
	await lib.markOverlays(handle);
	await t.click({ timeout: 3000 });
	const end = Date.now() + 3000;
	// A popup can draw its box before its rows: wait for an item too.
	let list = await lib.opened(true);
	while (!list?.names.length && Date.now() < end) {
		await lib.sleep(100);
		list = await lib.opened(true);
	}
	if (!list?.names.length) {
		// Say what is there instead: what opened, else the overlay the trigger is in, else the view.
		const home = page.locator('[data-dp-home]');
		const where = list ? list.box : await home.count() ? home : sc.loc;
		const error = list ? `a ${list.kind} opened after clicking ${a.role} "${triggerBefore}", with nothing in it to choose` : `no menu, popup or list opened after clicking ${a.role} "${triggerBefore}"`;
		return { ok: false, error, hint: `the ${list ? list.kind : await home.count() ? 'overlay' : 'view'} as it reads now is in "view"`, view: await lib.snapshot(where, 40) };
	}
	const c = await lib.choose(a.item, list);
	if (!c.ok) { return c; }
	const acted = Date.now();
	const settled = await lib.settle(sc.loc, before, a.wait);
	const diff = lib.diff(before, settled.tree);
	const triggerAfter = await handle?.evaluate(e => e.isConnected ? (e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim() : null).catch(() => null) ?? null;
	const toasts = await lib.newToasts(toastsBefore, acted + 1500);
	const renamed = triggerAfter !== null && triggerAfter !== triggerBefore;
	return {
		ok: true, chose: c.chose, changed: diff.length > 0 || renamed || toasts.length > 0,
		...(renamed ? { trigger: `${triggerBefore} -> ${triggerAfter}` } : {}),
		...(toasts.length ? { notification: toasts.join(' | ') } : {}),
		...(diff.length ? { diff: diff.slice(0, 20), ...(diff.length > 20 ? { more: diff.length - 20 } : {}) } : {}),
	};
};

/**
 * Types into the focused element, only when focus is inside the view: keys go
 * wherever focus is, and a field that did not take focus would send them to
 * an editor instead.
 * runs in run-code
 */
const typeText: PageFn<{ scope: string; text: string; enter: boolean }> = async (page, a, lib) => {
	// Enter in a quick pick runs the row it highlights, which need not be the one
	// typed: pick matches a row exactly.
	if (a.enter && a.scope.toLowerCase() === 'quickpick') { return { ok: false, error: 'Enter in a quick pick runs whatever row is highlighted; nothing was typed. Filter with type (no --enter), then choose the row with ui.sh pick' }; }
	const sc = await lib.scope(a.scope);
	if (!('loc' in sc) || !sc.loc) { return { ok: false, ...sc }; }
	const inside = await sc.loc.evaluate(el => el.contains(document.activeElement) && document.activeElement !== el);
	if (!inside) { return { ok: false, error: `focus is not in ${a.scope || 'the page'}; nothing was typed`, focused: await page.evaluate(() => (document.activeElement?.getAttribute('aria-label') || document.activeElement?.className || '').toString().slice(0, 80)) }; }
	const before = await lib.snapshot(sc.loc, 400);
	await page.keyboard.type(a.text);
	if (a.enter) { await page.keyboard.press('Enter'); }
	const after = await lib.settle(sc.loc, before, 3000);
	return { ok: true, typed: a.text, enter: a.enter, diff: lib.diff(before, after.tree).slice(0, 20) };
};

// runs in run-code
const pickRow: PageFn<{ text: string }> = async (page, a, lib) => {
	if (!await lib.quickOpen()) { return { ok: false, error: 'no quick pick is open' }; }
	const p = await lib.pick({ exact: a.text });
	if (!p.ok) { return p; }
	await lib.clickRow(p.row);
	await lib.sleep(200);
	return { ok: true, chose: p.row.label, description: p.row.description, closed: !await lib.quickOpen() };
};

/**
 * Samples a view's text in the page every `every` ms for `seconds`, and
 * returns its distinct states in order, each with its time from the start and
 * how long it lasted: the first in full, then each change as the lines it
 * added and removed. Sampling runs inside the page (one evaluate), so a state
 * that lasts half a second is caught; the instances stacked under the active
 * one (lib.unstack) are left out of the text, as they are not on screen.
 * runs in run-code
 */
const watch: PageFn<{ scope: string; seconds: number; every: number }> = async (_page, a, lib) => {
	const sc = await lib.scope(a.scope);
	if (!('loc' in sc) || !sc.loc) { return { ok: false, ...sc }; }
	const handle = await sc.loc.first().elementHandle({ timeout: 2000 });
	if (!handle) { return { ok: false, error: `${a.scope} went away before the watch started` }; }
	const seen = await handle.evaluate((root, o) => new Promise<{ at: number; text: string | null }[]>(resolve => {
		const text = (e: Element): string => {
			if (e.matches(o.stacked)) { return ''; }
			if (!e.querySelector(o.stacked)) { return (e as HTMLElement).innerText; }
			return [...e.children].map(text).filter(Boolean).join('\n');
		};
		const out: { at: number; text: string | null }[] = [];
		const t0 = performance.now();
		let last: string | null | undefined;
		const tick = () => {
			const shown = root.isConnected && root.getClientRects().length > 0;
			const now = shown ? text(root).replace(/\u00A0/g, ' ').split('\n').map(l => l.trim()).filter(Boolean).join('\n') : null;
			if (now !== last) { out.push({ at: Math.round(performance.now() - t0), text: now }); last = now; }
			if (performance.now() - t0 >= o.ms) { clearInterval(id); resolve(out); }
		};
		const id = setInterval(tick, o.every);
		tick();
	}), { ms: a.seconds * 1000, every: a.every, stacked: lib.css.view.stacked });
	const total = a.seconds * 1000;
	const states = seen.map((x, i) => {
		const lasted = (seen[i + 1]?.at ?? total) - x.at;
		if (i === 0) { return { at: x.at, lasted, ...(x.text === null ? { shown: false } : { text: x.text.length > 2000 ? x.text.slice(0, 1997) + '...' : x.text }) }; }
		if (x.text === null) { return { at: x.at, lasted, shown: false }; }
		const d = lib.diff(seen[i - 1].text ?? '', x.text);
		return { at: x.at, lasted, diff: d.slice(0, 20), ...(d.length > 20 ? { more: d.length - 20 } : {}) };
	});
	return { ok: true, view: sc.name, seconds: a.seconds, every: a.every, changes: states.length - 1, states };
};

/** What an action changed, for its log line: the view closing, what opened, a toast, the first lines of the diff. */
function readout(out: Json): string {
	const diff = (out.diff as string[] | undefined) ?? [];
	return [out.trigger ? `trigger ${out.trigger}` : '', out.checked !== undefined ? `checked ${out.checked}` : '', String(out.note ?? ''), out.opened ? 'opened an overlay' : '', out.notification ? `toast ${out.notification}` : '', diff.slice(0, 3).join(' ')]
		.filter(Boolean).join('; ') || (out.changed === false ? 'nothing changed' : '');
}

const target = (p: Parsed, role: string, name: string): Target =>
	({ scope: textFlag(p, 'in'), role, name, partial: !!p.flags.partial, nth: Number(p.flags.nth ?? 0), watch: textFlag(p, 'watch') });

export const uiCommands: Record<string, (argv: string[]) => Json | string> = {
	ui: argv => {
		const p = parse(argv, ['session', 'in', 'nth', 'wait', 'watch', 'for', 'every'], { click: 3, fill: 3, check: 3, choose: 4, watch: 2 }, ['partial', 'right', 'enter']);
		if (p.flags.help || !p.rest[0]) { usage('ui.sh'); }
		const [cmd, ...r] = p.rest;
		const wait = seconds(p, 'wait', 2) * 1000;
		const need = (k: number, what: string) => { if (r.length < k) { throw new Exit(2, { ok: false, error: `give ${what}` }); } };
		let out: Json;
		switch (cmd) {
			case 'read':
				out = inPage(p.session, readView, { scopes: r });
				if (out.ok) { logRead('ui.sh', p.session, out.trees ? Object.entries(out.trees as Record<string, string>).map(([v, t]) => `${v}: ${treeLine(t)}`).join('; ') : `${out.view}: ${treeLine(out.tree)}`); }
				return out;
			case 'click':
				need(2, 'the role and the name, such as button "Save"');
				out = inPage(p.session, action, { ...target(p, r[0], r[1]), right: !!p.flags.right, kind: 'click', text: '', want: '', wait });
				break;
			case 'fill':
				need(2, 'the field name and the text');
				// A field can be a textbox, a spinbutton (a number), or a combobox; take the first that matches.
				out = { ok: false, error: `no field named "${r[0]}"` };
				for (const role of ['textbox', 'spinbutton', 'combobox', 'searchbox']) {
					out = inPage(p.session, action, { ...target(p, role, r[0]), kind: 'fill', text: r[1], want: '', wait });
					if (out.ok || !/^no visible /.test(String(out.error))) { break; }
				}
				break;
			case 'check':
				need(2, 'the checkbox name and on or off');
				if (r[1] !== 'on' && r[1] !== 'off') { throw new Exit(2, { ok: false, error: 'on or off' }); }
				out = inPage(p.session, action, { ...target(p, 'checkbox', r[0]), kind: 'check', text: '', want: r[1], wait });
				break;
			case 'choose':
				need(3, 'the trigger role and name, then the menu item');
				out = inPage(p.session, choose, { ...target(p, r[0], r[1]), item: r[2], wait });
				break;
			case 'type':
				need(1, 'the text');
				out = inPage(p.session, typeText, { scope: textFlag(p, 'in'), text: r.join(' '), enter: !!p.flags.enter });
				break;
			case 'watch': {
				const seconds = Number(p.flags.for ?? 5);
				const every = Number(p.flags.every ?? 100);
				if (!(seconds > 0 && seconds <= 120) || !(every >= 20 && every <= 5000)) { throw new Exit(2, { ok: false, error: '--for takes 0 to 120 seconds, --every 20 to 5000 ms' }); }
				need(1, 'the view, as read takes it');
				out = inPage(p.session, watch, { scope: r[0], seconds, every });
				if (out.ok) {
					const st = out.states as { at: number; lasted: number; diff?: string[]; shown?: boolean }[];
					logRead('ui.sh', p.session, `watch ${out.view} for ${seconds} s: ${out.changes} change${out.changes === 1 ? '' : 's'}${st.slice(1).map(x => `; at ${x.at} ms for ${x.lasted} ms ${x.shown === false ? 'not shown' : (x.diff ?? []).slice(0, 2).join(' ')}`).join('')}`);
				}
				return out;
			}
			case 'pick':
				need(1, 'the row');
				out = inPage(p.session, pickRow, { text: r.join(' ') });
				break;
			default:
				throw new Exit(2, { ok: false, error: 'command: read, watch, click, fill, check, choose, type or pick' });
		}
		if (out.ok && !out.already) { log('ui.sh', p.session, `${cmd} ${r.map(x => JSON.stringify(x)).join(' ')}${p.flags.in ? ' in ' + p.flags.in : ''}${out.renamed ? ` (renamed ${out.renamed})` : ''}`, readout(out)); }
		return out;
	},
};
