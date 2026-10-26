/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The `lib` every page function gets. inPage sends makeLib's source with each
// page function, so it must use only page and ui (check.ts enforces this).

import type { ElementHandle, Locator, Page } from 'playwright';
import type { Css, Names } from './selectors.ts';

export type Lib = ReturnType<typeof makeLib>;

/** A list to choose from; inline when drawn inside the overlay that opened it. */
interface List { box: Locator; items: Locator; names: string[]; off: boolean[]; inline?: boolean }

export function makeLib(page: Page, ui: { css: Css; names: Names }) {
	const s = ui.css;
	// The open quick input: closed ones stay in the DOM, hidden.
	const widget = page.locator(s.quickInput.widget).filter({ visible: true });
	const lib = {
		css: ui.css,
		names: ui.names,

		// ---- Waits and focus
		sleep: (ms: number) => page.waitForTimeout(ms),
		/** Takes focus out of a webview or editor that would swallow a shortcut. */
		blur: () => page.evaluate(root => {
			const a = document.activeElement as HTMLElement | null;
			if (a && a !== document.body) { a.blur(); }
			const wb = document.querySelector<HTMLElement>(root);
			if (wb) { wb.setAttribute('tabindex', '-1'); wb.focus(); }
		}, s.workbench.root),
		/**
		 * Move, press and release with a task turn between each: Playwright's instant click
		 * loses menus that a queued focus closes, and action bar buttons that remount on hover.
		 */
		click: async (el: Locator | ElementHandle, opts: { button?: 'left' | 'right'; timeout?: number } = {}) => {
			await el.click({ trial: true, button: opts.button, timeout: opts.timeout ?? 3000 });
			const box = await el.boundingBox();
			if (!box) { throw new Error('the element went away before the click; nothing was done'); }
			const turn = () => page.evaluate(() => new Promise<void>(r => setTimeout(r, 0)));
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
			await turn();
			await page.mouse.down({ button: opts.button });
			await turn();
			await page.mouse.up({ button: opts.button });
		},

		// ---- Scopes and views
		/**
		 * Hides the per-session instances stacked at z-index -1 under the active one
		 * (Variables, Console), which are not aria-hidden and would otherwise all be read.
		 */
		unstack: () => page.evaluate(stacked => {
			document.querySelectorAll('[data-dp-stacked]').forEach(e => { e.removeAttribute('aria-hidden'); e.removeAttribute('data-dp-stacked'); });
			for (const e of document.querySelectorAll<HTMLElement>(stacked)) {
				const onTop = [...(e.parentElement?.children ?? [])].some(x => x !== e && x.classList[0] === e.classList[0] && (x as HTMLElement).style.zIndex !== '-1');
				if (onTop && !e.hasAttribute('aria-hidden')) { e.setAttribute('aria-hidden', 'true'); e.setAttribute('data-dp-stacked', ''); }
			}
		}, s.view.stacked),
		/** A view by heading, a part, or an overlay (dialog, quickpick, menu, notifications); empty means the page. */
		scope: async (name: string) => {
			await lib.unstack();
			const visible = (l: ReturnType<typeof page.locator>) => l.filter({ visible: true });
			const special: Record<string, ReturnType<typeof page.locator>> = {
				dialog: visible(page.locator(s.overlay.dialog).and(page.locator(s.overlay.notInNotifications))).last(),
				quickpick: visible(page.locator(s.quickInput.widget)),
				menu: visible(page.locator(s.overlay.menu)).last(),
				notifications: visible(page.locator(s.overlay.notifications)).first(),
				sidebar: page.locator(s.part.sidebar), secondary: page.locator(s.part.secondary), panel: page.locator(s.part.panel),
				// A modal editor's active group is drawn over the main one, later in the DOM.
				editor: visible(page.locator(s.editorGroup.active)).last(), statusbar: page.locator(s.part.statusbar),
			};
			if (!name) { return { loc: page.locator('body'), name: 'page' }; }
			const key = name.toLowerCase();
			if (special[key]) {
				return (await special[key].count()) ? { loc: special[key], name: key } : { error: `no ${key} is open` };
			}
			const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			// Match the heading's text too: the Explorer's folder heading is labelled "Explorer Section: ws".
			const heading = page.getByRole('heading', { name, exact: true }).or(page.getByRole('heading').filter({ hasText: new RegExp('^\\s*' + esc + '\\s*$') }));
			const pane = visible(page.locator(s.view.pane)).filter({ has: heading });
			if (await pane.count() === 1) { return { loc: pane, name }; }
			// A container with one view has no pane header: match the part's title or selected tab.
			const tabName = new RegExp('^\\s*' + esc + '(\\s*\\(.*\\))?\\s*$', 'i');
			const labelled = page.locator('[role=tab][aria-selected=true]').filter({ has: page.locator(s.workbench.tabLabel, { hasText: new RegExp('^\\s*' + esc + '\\s*$', 'i') }) });
			for (const part of [s.part.sidebar, s.part.secondary, s.part.panel]) {
				const p = visible(page.locator(part)).filter({ has: page.getByRole('heading', { name, exact: true, level: 2 }) });
				if (await p.count() === 1) { return { loc: p, name }; }
				const t = visible(page.locator(part)).filter({ has: page.getByRole('tab', { name: tabName, selected: true }).or(labelled) });
				if (await t.count() === 1) { return { loc: t, name }; }
			}
			const views = await visible(page.locator(s.view.paneHeader)).getByRole('heading').allTextContents();
			return { error: `no view titled "${name}" on screen`, views: [...new Set(views.map(v => v.trim()).filter(Boolean))] };
		},
		/** The innermost iframe drawn over loc, found by position since it often lives outside the view's DOM. */
		frameIn: async (loc: ReturnType<typeof page.locator>) => {
			const box = await loc.boundingBox();
			if (!box) { return null; }
			let best: { f: ReturnType<typeof page.mainFrame>; depth: number } | null = null;
			for (const f of page.frames()) {
				let depth = 0;
				let top = f;
				while (top.parentFrame() && top.parentFrame() !== page.mainFrame()) { top = top.parentFrame()!; depth++; }
				if (f === page.mainFrame() || /^vscode-webview:/.test(f.url())) { continue; }
				const el = await top.frameElement().catch(() => null);
				const b = el ? await el.boundingBox() : null;
				if (!b || b.x < box.x - 1 || b.y < box.y - 1 || b.x + b.width > box.x + box.width + 1 || b.y + b.height > box.y + box.height + 1) { continue; }
				if (!best || depth > best.depth) { best = { f, depth }; }
			}
			return best?.f ?? null;
		},
		/** An aria snapshot without icon glyphs or empty text lines, cut at max lines. */
		snapshot: async (loc: ReturnType<typeof page.locator>, max = 150) => {
			await lib.unstack();
			const raw = await loc.ariaSnapshot({ timeout: 5000 }).catch(() => '');
			const lines = raw.replace(/[\uE000-\uF8FF]/g, '').split('\n')
				.map(l => l.replace(/:\s*$/, ''))
				.filter(l => !/^\s*- (text|img|generic)\s*(""|)$/.test(l) && !/^\s*- text:\s*$/.test(l) && l.trim());
			return lines.length > max ? lines.slice(0, max).join('\n') + `\n... ${lines.length - max} more lines` : lines.join('\n');
		},
		/**
		 * Tries the exact name, then with a "(keys)" suffix, then before a comma, then (partial)
		 * any name containing it. Icon glyphs at either end are ignored.
		 */
		byRole: async (scope: ReturnType<typeof page.locator>, role: string, name: string, partial: boolean) => {
			const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const lead = '^[\\s\\uE000-\\uF8FF]*';
			const tail = '[\\s\\uE000-\\uF8FF]*$';
			const tries = [new RegExp(`${lead}${esc}${tail}`, 'i'), new RegExp(`${lead}${esc}\\s*\\(.*\\)${tail}`, 'i'), new RegExp(`${lead}${esc}\\s*,`, 'i'), ...(partial ? [new RegExp(esc, 'i')] : [])];
			for (const re of tries) {
				const all = scope.getByRole(role as Parameters<typeof page.getByRole>[0], { name: re });
				if (await all.count()) { return all; }
			}
			return scope.getByRole(role as Parameters<typeof page.getByRole>[0], { name: tries[0] });
		},

		// ---- Quick input (Command Palette, Quick Open, pickers)
		quickOpen: async () => (await widget.count()) > 0,
		/** Escape only when one is open: in a running .qmd, Escape interrupts the kernel. */
		closeQuickInput: async () => { if (await lib.quickOpen()) { await page.keyboard.press('Escape'); } },
		openQuickInput: async (keys: string, text: string) => {
			await page.keyboard.press(keys);
			try { await widget.waitFor({ timeout: 3000 }); } catch { return false; }
			await widget.locator(s.quickInput.filter).fill(text);
			return true;
		},
		/** The drawn rows, without group headings. */
		rows: () => page.evaluate(({ q, label, list }) => {
			const clean = (el: Element | null | undefined) => el ? (el.textContent ?? '').replace(/\s+/g, ' ').trim() : '';
			const w = [...document.querySelectorAll<HTMLElement>(q.widget)].find(x => x.offsetParent !== null);
			if (!w) { return []; }
			return [...w.querySelectorAll<HTMLElement>(q.rows)].filter(r => r.offsetParent !== null)
				.map(r => ({
					index: Number(r.getAttribute(list.indexAttr)), label: clean(r.querySelector(label.name)),
					// A recycled row can keep an earlier pick's description in a hidden element.
					description: clean([...r.querySelectorAll(label.description)].find(d => d.getBoundingClientRect().height > 0)),
					separator: !!r.querySelector(q.separatorRow),
				}))
				.filter(r => Number.isFinite(r.index) && !r.separator);
		}, { q: s.quickInput, label: s.label, list: s.list }),
		/** The focused row's index after the next paint: -1 for none, null when focus is outside the quick input. */
		focusedIndex: () => page.evaluate(({ q, list }) => new Promise<number | null>(done => requestAnimationFrame(() => requestAnimationFrame(() => {
			const w = [...document.querySelectorAll<HTMLElement>(q.widget)].find(x => x.offsetParent !== null);
			const f = w?.contains(document.activeElement) ? w.querySelector(list.focusedRow) : undefined;
			done(f === undefined ? null : f ? Number(f.getAttribute(list.indexAttr)) : -1);
		}))), { q: s.quickInput, list: s.list }),
		/** Whether the virtual list has drawn every row; aria-setsize counts all of them. */
		allDrawn: () => page.evaluate(q => {
			const w = [...document.querySelectorAll<HTMLElement>(q.widget)].find(x => x.offsetParent !== null);
			const drawn = w ? [...w.querySelectorAll<HTMLElement>(q.rows)].filter(r => r.offsetParent !== null) : [];
			return drawn.length >= Number(drawn[0]?.getAttribute('aria-setsize') ?? 0);
		}, s.quickInput),
		/**
		 * Every row, read by walking the virtual list with ArrowDown and putting focus back.
		 * complete is false when focus left the quick input or max steps ran out.
		 */
		allRows: async (max = 100) => {
			const seen = new Map<number, Awaited<ReturnType<typeof lib.rows>>[number]>();
			const read = async () => { for (const r of await lib.rows()) { seen.set(r.index, r); } };
			await read();
			let start = await lib.focusedIndex();
			if (start === -1) { await page.keyboard.press('ArrowDown'); start = await lib.focusedIndex(); await read(); }
			let complete = false;
			if (start !== null && start >= 0) {
				let prev = start;
				for (let i = 0; i < max; i++) {
					await page.keyboard.press('ArrowDown');
					const now = await lib.focusedIndex();
					await read();
					if (now === null || now < 0) { break; }
					if (now === start || now === prev) { complete = true; break; }
					prev = now;
				}
				// A non-looping list leaves focus at its end.
				for (let i = 0; i < max; i++) {
					const now = await lib.focusedIndex();
					if (now === null || now <= start) { break; }
					await page.keyboard.press('ArrowUp');
				}
			}
			return { rows: [...seen.values()].sort((x, y) => x.index - y.index), complete };
		},
		/** Moves focus toward a row until the list draws it, so clickRow can find it. */
		scrollToRow: async (index: number, max = 100) => {
			for (let i = 0; i < max; i++) {
				if ((await lib.rows()).some(r => r.index === index)) { return true; }
				const now = await lib.focusedIndex();
				if (now === null) { return false; }
				await page.keyboard.press(now < index ? 'ArrowDown' : 'ArrowUp');
			}
			return false;
		},
		/** Whole-word match, so "R" skips "positron-python" but "4.5" matches "4.5.1". */
		hasWords: (text: string) => {
			const words = text.split(/\s+/).filter(Boolean)
				.map(x => new RegExp('(^|[^\\w.-])' + x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^\\w-])', 'i'));
			return (r: { label: string; description: string }) => words.every(x => x.test(r.label + ' ' + r.description));
		},
		/**
		 * The one row matching exact (label, or "label (description)") or words; nth picks among several.
		 * walk reads undrawn rows too, when the drawn ones can't settle the match.
		 */
		pick: async (m: { exact?: string; words?: string; folder?: string; preferRoot?: boolean; nth?: number; walk?: boolean }) => {
			const words = lib.hasWords(m.words ?? '');
			const shownAs = (r: { label: string; description: string }) => r.label + (r.description ? ' (' + r.description + ')' : '');
			// Quick Open shows a Windows folder as sub\deep: compare with / for both.
			const inFolder = (r: { label: string; description: string }, d = r.description.replace(/\\/g, '/'), f = (m.folder ?? '').replace(/\\/g, '/')) =>
				!f || d === f || d.endsWith('/' + f) || d.endsWith(' ' + f);
			// Quick Open adds search results after recent files: wait for the rows to settle.
			let all: Awaited<ReturnType<typeof lib.rows>> = [];
			let prev = '';
			for (let i = 0; i < 20; i++) {
				all = await lib.rows();
				const now = JSON.stringify(all);
				if (now === prev && all.length) { break; }
				prev = now;
				await lib.sleep(150);
			}
			const match = (rs: typeof all) => {
				let f = rs.filter(r => (m.exact !== undefined ? r.label === m.exact : words(r)) && inFolder(r));
				if (!f.length && m.exact !== undefined) { f = rs.filter(r => shownAs(r) === m.exact && inFolder(r)); }
				return f.sort((x, y) => x.index - y.index);
			};
			let found = match(all);
			// One drawn match may still be ambiguous with an undrawn row.
			const short = found.length < Math.max(1, m.nth ?? 0) || (!m.nth && found.length === 1);
			const walked = m.walk && short && !await lib.allDrawn() ? await lib.allRows() : undefined;
			if (walked) { all = walked.rows; found = match(all); }
			// A bare file name means the one at the workspace root, which has no folder beside it.
			if (found.length > 1 && m.preferRoot && found.filter(r => !r.description).length === 1) { found = found.filter(r => !r.description); }
			const show = (rs: typeof all) => ({ shown: rs.slice(0, 8).map(shownAs), ...(rs.length > 8 ? { more: `${rs.length - 8} more rows not shown` } : {}) });
			const want = m.exact ?? m.words;
			const how = walked ? { walked: true, ...(walked.complete ? {} : { partial: true }) } : {};
			const part = walked && !walked.complete ? ` in the ${all.length} rows read; the list has more, which could not be read` : '';
			if (found.length === 0) { return { ok: false as const, error: `no row matches "${want}"${part}`, ...how, ...show(all) }; }
			if (m.nth && m.nth > found.length) { return { ok: false as const, error: `${found.length} row${found.length === 1 ? '' : 's'} match "${want}", so there is no row ${m.nth}`, ...how, ...show(found) }; }
			if (found.length > 1 && !m.nth) { return { ok: false as const, error: `${found.length} rows match "${want}"${m.exact === undefined ? '; be more specific' : ''}`, ...how, ...show(found) }; }
			const row = found[(m.nth || 1) - 1];
			if (!walked) { return { ok: true as const, row: { ...row, occurrence: found.slice(0, (m.nth || 1) - 1).filter(r => shownAs(r) === shownAs(row)).length } }; }
			if (!await lib.scrollToRow(row.index)) { return { ok: false as const, error: `the row "${shownAs(row)}" is in the list but could not be scrolled into view`, walked: true, partial: true }; }
			// clickRow counts among drawn rows only.
			return { ok: true as const, walked: true, row: { ...row, occurrence: (await lib.rows()).filter(r => r.index < row.index && shownAs(r) === shownAs(row)).length } };
		},
		/** Finds the row by label at click time: Quick Open re-sorts as results arrive, so an index goes stale. */
		clickRow: async (row: { label: string; description: string; occurrence?: number }) => {
			// An empty description must match exactly: it means the file at the workspace root.
			const all = widget.locator(s.list.row);
			const at = await all.evaluateAll((rs, { r, label, list }) => {
				const clean = (el: Element | null | undefined) => el ? (el.textContent ?? '').replace(/\s+/g, ' ').trim() : '';
				const same = rs.map((x, i) => ({ i, index: Number(x.getAttribute(list.indexAttr)) }))
					.filter(({ i }) => (rs[i] as HTMLElement).offsetParent !== null && clean(rs[i].querySelector(label.name)) === r.label
						&& clean([...rs[i].querySelectorAll(label.description)].find(d => d.getBoundingClientRect().height > 0)) === r.description)
					.sort((x, y) => x.index - y.index);
				return same[r.occurrence ?? 0]?.i ?? -1;
			}, { r: row, label: s.label, list: s.list });
			if (at < 0) { throw new Error(`the row "${row.label}"${row.description ? ` (${row.description})` : ''} is no longer listed`); }
			// The pointer resting on another row (where the last click left it) shows that row's
			// tooltip, which can cover this row's middle. Find a point of this row nothing covers,
			// move the pointer there so no other row's tooltip opens, and click there.
			const el = all.nth(at);
			const free = () => el.evaluate(r => {
				const b = r.getBoundingClientRect();
				const y = b.y + b.height / 2;
				for (let i = 0; i < 20; i++) {
					for (const x of [b.x + b.width * (0.5 + i / 40), b.x + b.width * (0.5 - i / 40)]) {
						if (r.contains(document.elementFromPoint(x, y))) { return { x: x - b.x, y: b.height / 2 }; }
					}
				}
				return null;
			});
			let point = await free();
			const box = point && await el.boundingBox();
			if (point && box) { await page.mouse.move(box.x + point.x, box.y + point.y); point = await free() ?? point; }
			return el.click({ timeout: 3000, ...(point ? { position: point } : {}) });
		},

		// ---- Dialogs
		dialogs: () => page.evaluate(d => {
			const clean = (el: Element | null | undefined) => el ? (el.textContent ?? '').replace(/\s+/g, ' ').trim() : '';
			return [...document.querySelectorAll<HTMLElement>(d.box)].filter(x => x.offsetParent !== null).map(x => ({
				kind: 'dialog',
				message: clean(x.querySelector(d.message)),
				detail: clean(x.querySelector(d.detail)),
				buttons: [...x.querySelectorAll(d.buttons)].map(b => clean(b)).filter(Boolean),
			}));
		}, s.dialog),
		/** Names an open modal dialog in a failure, since it swallows the keys and clicks that failed. */
		explain: async (r: { ok: boolean; error?: unknown; dialogs?: unknown; [key: string]: unknown }) => {
			if (!r || r.ok !== false || r.dialogs) { return r; }
			const d = await lib.dialogs().catch(() => []);
			if (!d.length) { return r; }
			const named = d.map(x => `"${x.message || x.detail || 'untitled'}" (buttons: ${x.buttons.join(', ') || 'none'})`).join('; ');
			return { ...r, error: `${r.error ?? 'failed'}; a modal dialog is open: ${named}. Answer it with notifications.sh --click BUTTON, or ui.sh ... --in dialog`, dialogs: d };
		},
		toasts: () => page.locator(s.notification.toasts).getByRole('dialog').filter({ visible: true })
			.evaluateAll(es => es.map(e => (e.getAttribute('aria-label') ?? '').replace(/, (source: .*, )?notification\b.*$/, ''))),
		/** Polls until `until`: a toast can appear a second after its action and close soon after. */
		newToasts: async (before: string[], until: number) => {
			for (; ;) {
				const now = (await lib.toasts()).filter(t => !before.includes(t));
				if (now.length || Date.now() >= until) { return now; }
				await page.waitForTimeout(150);
			}
		},
		/**
		 * Menu items, else buttons (Positron's context menus draw buttons). innerText keeps a
		 * label and description apart ("uv Use uv", not "uvUse uv").
		 */
		listIn: async (box: Locator): Promise<List> => {
			let items = box.locator(s.menu.items).filter({ visible: true });
			if (!await items.count()) { items = box.getByRole('button').filter({ visible: true }); }
			const names = (await items.evaluateAll(es => es.map(e => (e.getAttribute('aria-label') || (e as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim())))
				.map(x => x.replace(/[\uE000-\uF8FF]/g, '').trim());
			const off = await items.evaluateAll(es => es.map(e => (e as HTMLButtonElement).disabled || e.getAttribute('aria-disabled') === 'true'));
			return { box, items, names, off };
		},
		menu: async (): Promise<List | null> => {
			const box = page.locator(s.overlay.menu).filter({ visible: true }).last();
			return await box.count() ? lib.listIn(box) : null;
		},
		/** Escape only while focus is in the menu: elsewhere, with a busy .qmd in front, it interrupts the kernel. */
		closeMenu: async (box?: Locator): Promise<boolean> => {
			const open = async () => box ? await box.isVisible().catch(() => false) : !!await lib.menu();
			if (!await open()) { return true; }
			if (await page.evaluate(sel => !!document.activeElement?.closest(sel), `${s.overlay.menu}, ${s.overlay.modal}`)) { await page.keyboard.press('Escape'); }
			for (let i = 0; i < 10 && await open(); i++) { await lib.sleep(100); }
			return !await open();
		},
		/**
		 * Hovers before clicking (menus ignore an unrested click), then checks it took and
		 * retries once, since a click while the menu is still drawing is lost.
		 */
		choose: async (item: string, given?: List) => {
			const m = given ?? await lib.menu();
			if (!m) { return { ok: false as const, error: 'no menu is open' }; }
			const close = () => m.inline ? Promise.resolve(true) : lib.closeMenu(given ? m.box : undefined);
			const want = item.toLowerCase();
			const pick = [
				m.names.findIndex(x => x.toLowerCase() === want),
				m.names.findIndex(x => x.toLowerCase().replace(/\s*\(.*\)\s*$/, '') === want),
				m.names.findIndex(x => x.toLowerCase().startsWith(want) && !/[a-z]/.test(x.slice(want.length))),
				// A select box option is named "value. description" ("afterDelay. An editor with ...").
				m.names.findIndex(x => x.toLowerCase().startsWith(`${want}. `)),
			].find(i => i >= 0) ?? -1;
			if (pick < 0) { await close(); return { ok: false as const, error: `no item "${item}" in the ${m.inline ? 'list that opened' : 'menu or popup'}`, items: m.names }; }
			if (m.off[pick]) { await close(); return { ok: false as const, error: `the item "${m.names[pick]}" is disabled; nothing was chosen`, items: m.names }; }
			const el = m.items.nth(pick);
			const handle = await el.elementHandle();
			const before = m.inline ? await lib.snapshot(m.box, 400) : '';
			const gone = async () => await page.waitForFunction(e => !e || !e.isConnected || !(e as HTMLElement).offsetParent, handle, { timeout: 1500 }).then(() => true, () => false)
				|| (m.inline && await lib.snapshot(m.box, 400) !== before);
			const press = async () => { await el.hover({ timeout: 3000 }); await lib.sleep(100); await el.click({ timeout: 3000 }); };
			await press();
			if (!await gone()) {
				await press().catch(() => { });
				if (!await gone()) { await close(); return { ok: false as const, error: `the list stayed as it was after clicking "${m.names[pick]}"; nothing was chosen` }; }
			}
			return { ok: true as const, chose: m.names[pick] };
		},

		// ---- What an action opened, and what is on top
		/**
		 * Marks what is open now so lib.opened can spot what is new; searches shadow roots too.
		 * Each call marks with a new value, kept on <html> and returned: an element detached
		 * while marked keeps its mark out of reach of the clean-up, and a select box draws its
		 * drop-down with the same element every time it opens.
		 */
		markOverlays: (home?: ElementHandle<Element> | null) => page.evaluate(({ sel, dialog, h }) => {
			const all = (q: string, root: ParentNode = document): Element[] => [...root.querySelectorAll(q), ...[...root.querySelectorAll('*')].flatMap(e => e.shadowRoot ? all(q, e.shadowRoot) : [])];
			for (const a of ['data-dp-seen', 'data-dp-home', 'data-dp-list']) { all(`[${a}]`).forEach(e => e.removeAttribute(a)); }
			const mark = String(Date.now());
			document.documentElement.setAttribute('data-dp-mark', mark);
			all(sel).forEach(e => { if (e.getClientRects().length) { e.setAttribute('data-dp-seen', mark); } });
			h?.closest(dialog)?.setAttribute('data-dp-home', '');
			return mark;
		}, { sel: `${s.overlay.menu}, ${s.overlay.dialog}, ${s.quickInput.widget}, [role=grid], [role=listbox], [role=tree]`, dialog: s.overlay.dialog, h: home ?? null }),
		/** The innermost overlay opened since markOverlays, marked [data-dp-list] for listIn. */
		opened: async (inline: boolean): Promise<(List & { kind: string }) | null> => {
			const kind = await page.evaluate(({ menu, dialog, quick, toast, inline }) => {
				const all = (q: string, root: ParentNode = document): Element[] => [...root.querySelectorAll(q), ...[...root.querySelectorAll('*')].flatMap(e => e.shadowRoot ? all(q, e.shadowRoot) : [])];
				all('[data-dp-list]').forEach(e => e.removeAttribute('data-dp-list'));
				const mark = document.documentElement.getAttribute('data-dp-mark');
				const fresh = (sel: string, root: ParentNode = document) => all(sel, root).filter(e => e.getAttribute('data-dp-seen') !== mark && e.getClientRects().length > 0 && e.matches(toast));
				const home = all('[data-dp-home]')[0];
				const found: [Element | undefined, string][] = [
					[fresh(menu).pop(), 'menu'], [fresh(quick).pop(), 'quickpick'], [fresh(dialog).pop(), 'dialog'],
					[inline && home ? fresh('[role=grid], [role=listbox], [role=tree]', home).pop() : undefined, 'list'],
				];
				const [el, k] = found.find(([e]) => e) ?? [];
				el?.setAttribute('data-dp-list', '');
				return k ?? null;
			}, { menu: s.overlay.menu, dialog: s.overlay.dialog, quick: s.quickInput.widget, toast: s.overlay.notInNotifications, inline });
			return kind ? { kind, ...await lib.listIn(page.locator('[data-dp-list]')), inline: kind === 'list' } : null;
		},
		/** Non-modal overlays on top (menus, popups, the quick pick), each with its first items. */
		onTop: async (): Promise<string[]> => {
			const out: string[] = [];
			const quick = page.locator(s.quickInput.widget).filter({ visible: true });
			if (await quick.count()) { out.push('a quickpick'); }
			const menus = page.locator(s.overlay.menu).filter({ visible: true });
			const popups = page.locator(s.overlay.dialog).and(page.locator(s.overlay.notInNotifications)).filter({ visible: true, hasNot: page.locator(s.dialog.box) }).and(page.locator(s.dialog.box.split(',').map(x => `:not(${x.trim()} *)`).join('')));
			for (const [loc, kind] of [[menus, 'menu'], [popups, 'dialog']] as const) {
				for (let i = 0; i < await loc.count(); i++) {
					// A drop-down popup wraps a menu: report it once.
					if (kind === 'dialog' && await loc.nth(i).locator(s.overlay.menu).filter({ visible: true }).count()) { continue; }
					const l = await lib.listIn(loc.nth(i));
					const shown = l.names.filter(Boolean).slice(0, 6).map(n => `"${n}"`).join(', ');
					out.push(`a ${kind}${shown ? ` (${shown})` : ''}`);
				}
			}
			return out;
		},
		/** Turns a Playwright timeout into one sentence: what, where, why, and what may cover it. */
		failure: async (e: unknown): Promise<{ ok: false; error: string; cliFailed?: boolean }> => {
			const msg = String((e as Error)?.message ?? e).replace(/\u001b\[[0-9;]*m/g, '');
			const first = msg.split('\n')[0].trim();
			const t = first.match(/^\w+\.(\w+): Timeout (\d+)ms exceeded/);
			if (!t) { return { ok: false, error: first || 'failed', cliFailed: true }; }
			const waiting = msg.match(/waiting for (.*)/)?.[1] ?? '';
			const css = waiting.match(/^locator\('([^']*)'\)/)?.[1] ?? '';
			const parts: Record<string, string> = { [s.editorGroup.active]: 'editor', [s.part.editor]: 'editor', [s.part.sidebar]: 'sidebar', [s.part.secondary]: 'secondary', [s.part.panel]: 'panel', [s.part.statusbar]: 'statusbar', [s.overlay.dialog]: 'dialog', [s.overlay.menu]: 'menu', [s.quickInput.widget]: 'quickpick' };
			const role = waiting.match(/getByRole\('(\w+)'(?:, \{ name: \/(.*?)\/i? \})?/);
			// Undo lib.byRole's regex to get the plain name back.
			const name = (role?.[2] ?? '').split('[\\s\\uE000-\\uF8FF]*').join('').split('\\s*').join('').replace(/^\^|\$$/g, '').replace(/(\\\(\.\*\\\)|,)$/, '').replace(/\\(.)/g, '$1');
			const target = role ? `${role[1]}${name ? ` "${name}"` : ''}` : 'the element';
			const where = parts[css] ? ` in ${parts[css]}` : css && !/^(body|html)$/.test(css) ? ` in ${css.length > 60 ? 'its view' : css}` : '';
			const why = /intercepts pointer events/.test(msg) ? 'something drawn on top of it took the click'
				: !/locator resolved to/.test(msg) ? 'no such element appeared'
				: /element is not enabled/.test(msg) ? 'it stayed disabled'
				: /element is not visible/.test(msg) ? 'it stayed hidden'
				: /element is not stable/.test(msg) ? 'it kept moving'
				: 'it did not become ready';
			const top = await lib.onTop().catch(() => []);
			const kinds = [...new Set(top.map(x => x.split(/[ (]/)[1]))];
			const open = top.length ? `; open on top: ${top.join('; ')}. Read the top one with ${kinds.map(k => `ui.sh read ${k}`).join(' or ')} and act in it (--in ${kinds[0]}), or close it first` : '';
			return { ok: false, error: `the ${t[1]} on ${target}${where} did not happen within ${Number(t[2]) / 1000} s: ${why}${open}` };
		},

		// ---- Diff and settling
		/** Waits for the tree to change and then hold for 300 ms, so a diff isn't taken mid-update. */
		settle: async (loc: ReturnType<typeof page.locator>, before: string, ms: number, done?: () => Promise<boolean>) => {
			const end = Date.now() + ms;
			let last = before;
			let changedAt = 0;
			while (Date.now() < end) {
				await page.waitForTimeout(150);
				if (done && await done()) { return { tree: last, closed: true }; }
				if (!await loc.count() || !await loc.isVisible().catch(() => false)) { return { tree: last, closed: true }; }
				const now = await lib.snapshot(loc, 400);
				if (now !== last) { last = now; changedAt = Date.now(); continue; }
				if (changedAt && Date.now() - changedAt >= 300) { break; }
			}
			return { tree: last, closed: false };
		},
		/** Added and removed lines. Ark's temp-path labels (".../session9/8b29.../print().R") compare by file name. */
		diff: (before: string, after: string) => {
			const norm = (l: string) => l.replace(/(\.\.\.\/)?(session\d+\/)?([0-9a-f]{8,}\/)?(?=[^\s/"]+\(\)\.R\b)/g, '');
			const count = (t: string) => { const m = new Map<string, number>(); for (const l of t.split('\n')) { m.set(norm(l), (m.get(norm(l)) ?? 0) + 1); } return m; };
			const b = count(before);
			const a = count(after);
			const cut = (l: string) => l.length > 160 ? l.slice(0, 157) + '...' : l;
			const out: string[] = [];
			for (const [l, n] of a) { for (let i = (b.get(l) ?? 0); i < n; i++) { out.push(cut('+ ' + l.trim())); } }
			for (const [l, n] of b) { for (let i = (a.get(l) ?? 0); i < n; i++) { out.push(cut('- ' + l.trim())); } }
			return out;
		},

		// ---- Editors
		/**
		 * The active editor's tab, cursor (from the status bar), line text and debug lines.
		 * Monaco lines have no roles, so they are matched to line numbers by position.
		 */
		editor: async (range?: { from: number; to: number }) => {
			// A modal editor has no status bar cursor; the one shown belongs to the editor behind it.
			const modal = page.locator(s.editorGroup.modal).filter({ visible: true }).last();
			if (await modal.count()) {
				const name = await modal.locator(s.label.icon).first().getAttribute('aria-label', { timeout: 500 }).catch(() => null) ?? '';
				return { ok: false as const, tab: name, error: `a modal editor is in front${name ? ` (${name})` : ''}: the status bar shows no cursor position for it, so it cannot be read or edited here. Move it to the main window with ui.sh click button '${ui.names.editor.moveModalToMain}' --in dialog, then run this again` };
			}
			const cursor = ui.names.editor.cursorStatusPattern;
			const status = page.getByRole('button', { name: new RegExp('^' + cursor) }).first();
			const label = await status.getAttribute('aria-label', { timeout: 1000 }).catch(() => null) ?? await status.textContent({ timeout: 1000 }).catch(() => null);
			const m = (label ?? '').match(new RegExp(cursor));
			const dom = await page.locator(s.editorGroup.active).first().evaluate((g, { monaco, group }) => {
				const tab = g.querySelector('[role=tab][aria-selected=true]');
				const ed = g.querySelector(monaco.editor);
				if (!ed) { return { tab: tab?.getAttribute('aria-label') ?? null, dirty: !!tab?.matches(group.dirty) }; }
				const nums = [...ed.querySelectorAll(monaco.lineNumbers)].map(x => ({ n: Number((x.textContent ?? '').trim()), top: x.getBoundingClientRect().top }));
				const at = (el: Element | null) => { const t = el?.getBoundingClientRect().top; return t === undefined ? null : nums.find(l => Math.abs(l.top - t) <= 1)?.n ?? null; };
				const lines: Record<number, string> = {};
				for (const v of ed.querySelectorAll(monaco.drawnLine)) { const n = at(v); if (n) { lines[n] = (v.textContent ?? '').replace(/\u00A0/g, ' '); } }
				const active = document.activeElement;
				const inner = active?.closest(monaco.editor);
				return {
					tab: tab?.getAttribute('aria-label') ?? null, dirty: !!tab?.matches(group.dirty), focused: !!active && ed.contains(active), lines,
					...(inner && inner !== ed && ed.contains(inner) ? { input: (inner.querySelector(monaco.viewLines)?.textContent ?? '').replace(/\u00A0/g, ' ') } : {}),
					debug: { topFrameLine: at(ed.querySelector(monaco.topFrameLine)), focusedFrameLine: at(ed.querySelector(monaco.focusedFrameLine)) },
				};
			}, { monaco: s.monaco, group: s.editorGroup }).catch(() => null);
			if (!dom) { return { ok: false as const, error: 'no editor is open' }; }
			const tab = (dom.tab ?? '').replace(/, Editor Group \d+$/, '');
			if (!m || !('lines' in dom)) { return { ok: false as const, tab, dirty: dom.dirty, error: 'the active editor is not a text editor (no cursor position in the status bar)' }; }
			const line = Number(m[1]);
			const lines: Record<string, string> | undefined = range ? Object.fromEntries(Object.entries(dom.lines).filter(([n]) => Number(n) >= range.from && Number(n) <= range.to)) : undefined;
			return { ok: true as const, tab, dirty: dom.dirty, focused: dom.focused, line, column: Number(m[2]), ...(m[3] ? { selected: Number(m[3]) } : {}), text: dom.lines[line] ?? null, ...(lines ? { lines } : {}), ...('input' in dom ? { input: dom.input } : {}), ...(dom.debug.topFrameLine || dom.debug.focusedFrameLine ? { debug: dom.debug } : {}) };
		},

		/** Refocuses the active editor without moving its cursor. */
		focusEditor: async () => {
			const ed = page.locator(`${s.editorGroup.active} ${s.monaco.editor}`).filter({ visible: true }).first();
			await ed.locator(s.monaco.editContext).first().focus().catch(() => { });
			return ed.evaluate(e => e.contains(document.activeElement)).catch(() => false);
		},

		// ---- Consoles
		/**
		 * Console sessions and the active one. With a single session there are no tabs, so
		 * its name comes from the console's "X started." line before the title bar picker.
		 */
		consoles: () => page.evaluate(({ c, n }) => {
			const idOf = (el: Element | null | undefined, prefix: string) => (el?.getAttribute('data-testid') ?? '').slice(prefix.length);
			const activeEl = document.querySelector<HTMLElement>(c.active);
			const active = idOf(activeEl, c.instanceTestId);
			// Drop the unread suffix ("R 4.5.2, 1 new execution") from the tab's label.
			const tabName = (t: Element) => { const l = t.getAttribute('aria-label') ?? ''; return t.querySelector(c.unread) ? l.replace(/, \d+ [^,]*$/, '') : l; };
			const tabs = [...document.querySelectorAll(`[data-testid^="${c.tabTestId}"]`)].map(t => ({ id: idOf(t, c.tabTestId), name: tabName(t) }));
			const lines = ((activeEl?.querySelector<HTMLElement>(c.container) ?? activeEl)?.innerText ?? '').split('\n').map(l => l.trim());
			const status = lines.map(l => l.match(/^(.+) (starting|started|restarting|restarted|reconnecting|reconnected)\.$/)?.[1]).filter(Boolean).pop() ?? '';
			const picker = (document.querySelector(`[aria-label="${n.selectSession}"]`)?.textContent ?? '').trim();
			const sessions = tabs.length || !active ? tabs : [{ id: active, name: status || picker }];
			return { active, tabs, sessions, inPage: !!document.querySelector(c.instance) || !!document.querySelector<HTMLElement>(c.empty)?.offsetParent };
		}, { c: s.console, n: ui.names.console }),
		/**
		 * Clicks until the tab stays active for 500 ms: a new session can grab focus back.
		 * Force-clicks if needed, since live CPU/memory readings keep the tab from holding still.
		 */
		activateConsole: async (id: string) => {
			const c = s.console;
			const tab = page.locator(`[data-testid="${c.tabTestId}${id}"]`);
			const end = Date.now() + 8000;
			let active = (await lib.consoles()).active;
			while (active !== id && Date.now() < end) {
				await tab.click({ timeout: 1500 }).catch(async () => { await tab.waitFor({ state: 'visible', timeout: 2000 }); await tab.click({ force: true, timeout: 2000 }); });
				await page.locator(`${c.active}[data-testid="${c.instanceTestId}${id}"]`).waitFor({ timeout: 2000 }).catch(() => { });
				await lib.sleep(500);
				active = (await lib.consoles()).active;
			}
			return active;
		},
		/** --name matches part of the name, the full id, or the id's hex alone. */
		namedLike: (session: { id: string; name: string }, name: string) => !name || session.name.includes(name) || session.id === name || session.id.endsWith('-' + name),
		/** Sessions whose last status line is "starting." with no "started." after it. */
		starting: () => page.evaluate(c => [...document.querySelectorAll<HTMLElement>(c.instance)].filter(inst => {
			const lines = (inst.querySelector<HTMLElement>(c.container) ?? inst).innerText.split('\n').map(l => l.trim());
			const last = (re: RegExp) => lines.reduce((at, l, i) => re.test(l) ? i : at, -1);
			return last(/ (starting|restarting|reconnecting)\.$/) > last(/ (started|restarted|reconnected)\.$/);
		}).map(inst => (inst.getAttribute('data-testid') ?? '').slice(c.instanceTestId.length)), s.console),
		/**
		 * Output text, prompt and any waiting input() question. Rows are rebuilt from blocks
		 * and <br>s because innerText gets blank lines wrong.
		 */
		consoleText: (id: string) => page.evaluate(({ i, c }) => {
			const inst = document.querySelector<HTMLElement>(`[data-testid="${c.instanceTestId}${i}"]`);
			if (!inst) { return null; }
			const box = inst.querySelector<HTMLElement>(c.container) ?? inst;
			const block = /^(DIV|P|PRE|TABLE|TBODY|TR|UL|OL|LI|DETAILS|SUMMARY|SECTION|H\d)$/;
			const rows = (el: Element, out: string[]) => {
				let inline = '';
				for (const n of el.childNodes) {
					if (n.nodeType === Node.TEXT_NODE) { inline += n.textContent ?? ''; continue; }
					if (n.nodeType !== Node.ELEMENT_NODE) { continue; }
					const e = n as HTMLElement;
					if (e.tagName === 'BR') { out.push(inline); inline = ''; continue; }
					if (e.matches(c.input) || e.matches(c.submitting) || !e.getClientRects().length) { continue; }
					if (!block.test(e.tagName)) { inline += e.innerText; continue; }
					if (inline) { out.push(inline); inline = ''; }
					if ([...e.children].some(x => x.tagName === 'BR' || block.test(x.tagName))) { rows(e, out); continue; }
					const t = e.innerText;
					if (t) { out.push(...t.split('\n')); }
				}
				if (inline) { out.push(inline); }
				return out;
			};
			const text = rows(box, []).join('\n');
			// Null while code runs or the input is hidden.
			const prompt = (inst.querySelector(c.prompt) ?? inst.querySelector(c.anyPrompt))?.textContent?.trim() || null;
			const line = [...inst.querySelectorAll<HTMLElement>(c.waitingPrompt)].filter(e => e.getClientRects().length).pop();
			const waiting = line ? [...line.childNodes].filter(n => !(n instanceof Element && n.matches(c.waitingField))).map(n => n.textContent ?? '').join('').replace(/\u00A0/g, ' ').trim() : null;
			const tab = document.querySelector(`[data-testid="${c.tabTestId}${i}"]`);
			return { session: tab?.getAttribute('aria-label') ?? i, prompt, waiting, text: text.replace(/\u00A0/g, ' ') };
		}, { i: id, c: s.console }),
	};
	return lib;
}
