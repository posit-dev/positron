/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The helpers every page function gets as `lib`. makeLib runs in the page
// (playwright-cli run-code): inPage sends its source text with the function,
// so it must be self-contained, one unit, using only page and ui; check.ts
// enforces that. Its members, by section:
//
//   registry          css, names: selectors.ts, passed in by inPage
//   waits and focus   sleep, blur
//   scopes and views  scope, snapshot, byRole, unstack
//   overlays          quickOpen, closeQuickInput, openQuickInput, rows, pick,
//                     clickRow
//   dialogs and menus dialogs, explain, toasts, newToast, menu, closeMenu,
//                     choose
//   diff and settling settle, diff
//   editors           editor, focusEditor
//   consoles          consoles, activateConsole, namedLike, starting,
//                     consoleText
//
// A member may call another through lib (lib.snapshot), since they all exist
// by the time any runs.

import type { Page } from 'playwright';
import type { Css, Names } from './selectors.ts';

export type Lib = ReturnType<typeof makeLib>;

/**
 * Helpers the page functions share; runs in run-code, so it is self-contained.
 * ui is selectors.ts's css and names, which inPage passes in as values.
 */
export function makeLib(page: Page, ui: { css: Css; names: Names }) {
	const s = ui.css;
	// The open quick input: closed ones stay in the DOM, hidden.
	const widget = page.locator(s.quickInput.widget).filter({ visible: true });
	const lib = {
		// The registry (selectors.ts), for page functions to read.
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

		// ---- Scopes and views: where a command looks, and what it reads there
		/**
		 * Hides from the accessibility tree the instances stacked under the one on
		 * screen. The Variables and Console views keep one instance per session, all
		 * laid out, the others at an inline z-index of -1 under the active one and
		 * none aria-hidden, so a snapshot or getByRole would read every session's
		 * at once. Marked afresh each call, since the active session changes.
		 */
		unstack: () => page.evaluate(stacked => {
			document.querySelectorAll('[data-dp-stacked]').forEach(e => { e.removeAttribute('aria-hidden'); e.removeAttribute('data-dp-stacked'); });
			for (const e of document.querySelectorAll<HTMLElement>(stacked)) {
				const onTop = [...(e.parentElement?.children ?? [])].some(x => x !== e && x.classList[0] === e.classList[0] && (x as HTMLElement).style.zIndex !== '-1');
				if (onTop && !e.hasAttribute('aria-hidden')) { e.setAttribute('aria-hidden', 'true'); e.setAttribute('data-dp-stacked', ''); }
			}
		}, s.view.stacked),
		/**
		 * The area a ui command works in: a view by its heading ("Plots", "Call
		 * Stack"), a part (sidebar, secondary, panel, editor, statusbar), or what
		 * is open on top (dialog, quickpick, menu, notifications). Empty: the page.
		 */
		scope: async (name: string) => {
			await lib.unstack();
			const visible = (l: ReturnType<typeof page.locator>) => l.filter({ visible: true });
			const special: Record<string, ReturnType<typeof page.locator>> = {
				// A notification toast is a dialog too; it is not the dialog meant.
				dialog: visible(page.locator(s.overlay.dialog).and(page.locator(s.overlay.notInNotifications))).last(),
				quickpick: visible(page.locator(s.quickInput.widget)),
				menu: visible(page.locator(s.overlay.menu)).last(),
				notifications: visible(page.locator(s.overlay.notifications)).first(),
				sidebar: page.locator(s.part.sidebar), secondary: page.locator(s.part.secondary), panel: page.locator(s.part.panel),
				editor: page.locator(s.editorGroup.active), statusbar: page.locator(s.part.statusbar),
			};
			if (!name) { return { loc: page.locator('body'), name: 'page' }; }
			const key = name.toLowerCase();
			if (special[key]) {
				return (await special[key].count()) ? { loc: special[key], name: key } : { error: `no ${key} is open` };
			}
			// A view: the pane whose header heading is the name.
			const pane = visible(page.locator(s.view.pane)).filter({ has: page.getByRole('heading', { name, exact: true }) });
			if (await pane.count() === 1) { return { loc: pane, name }; }
			// A container with one view shows no pane header: the part's own title is
			// the name, or the part's selected tab is (Viewer, Help, Console, Terminal).
			const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const tabName = new RegExp('^\\s*' + esc + '(\\s*\\(.*\\))?\\s*$', 'i');
			// A tab with a badge ("Problems 4") has a longer accessible name; its label is the name alone.
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
		/** An aria snapshot with icon glyphs and empty text lines taken out, cut at max lines. */
		/**
		 * The innermost frame drawn inside loc: a web page (the Viewer, Help) whose
		 * iframe is laid over the view, often outside the view's own DOM, so found by
		 * where it is drawn. Null when there is none.
		 */
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
		snapshot: async (loc: ReturnType<typeof page.locator>, max = 150) => {
			await lib.unstack();
			const raw = await loc.ariaSnapshot({ timeout: 5000 }).catch(() => '');
			const lines = raw.replace(/[\uE000-\uF8FF]/g, '').split('\n')
				.map(l => l.replace(/:\s*$/, ''))
				.filter(l => !/^\s*- (text|img|generic)\s*(""|)$/.test(l) && !/^\s*- text:\s*$/.test(l) && l.trim());
			return lines.length > max ? lines.slice(0, max).join('\n') + `\n... ${lines.length - max} more lines` : lines.join('\n');
		},
		/**
		 * Elements in scope with this role and name: the whole name first, then the
		 * name without a trailing keybinding ("Continue (F5)" for Continue), then
		 * the name before a comma and more (a Breakpoints row "dbg.R 7, Unverified
		 * Breakpoint" for "dbg.R 7", the label the view shows), then, with
		 * partial, any name holding it.
		 */
		byRole: async (scope: ReturnType<typeof page.locator>, role: string, name: string, partial: boolean) => {
			const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const tries = [new RegExp(`^\\s*${esc}\\s*$`, 'i'), new RegExp(`^\\s*${esc}\\s*\\(.*\\)\\s*$`, 'i'), new RegExp(`^\\s*${esc}\\s*,`, 'i'), ...(partial ? [new RegExp(esc, 'i')] : [])];
			for (const re of tries) {
				const all = scope.getByRole(role as Parameters<typeof page.getByRole>[0], { name: re });
				if (await all.count()) { return all; }
			}
			return scope.getByRole(role as Parameters<typeof page.getByRole>[0], { name: tries[0] });
		},

		// ---- Overlays: the quick input (Command Palette, Quick Open, pickers)
		quickOpen: async () => (await widget.count()) > 0,
		/** Closes a quick input left open; Escape only then, since in a running .qmd it interrupts the kernel. */
		closeQuickInput: async () => { if (await lib.quickOpen()) { await page.keyboard.press('Escape'); } },
		/** Presses keys and waits for a quick input; then types text into it, as filtering would. */
		openQuickInput: async (keys: string, text: string) => {
			await page.keyboard.press(keys);
			try { await widget.waitFor({ timeout: 3000 }); } catch { return false; }
			await widget.locator(s.quickInput.filter).fill(text);
			return true;
		},
		/** The quick input's visible rows, without group headings. */
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
		/**
		 * The one row a match picks, waiting up to a second for the list to filter.
		 * With words, each must be a whole word ("R" is not the r in "positron-python");
		 * a word may end at a dot, so "4.5" matches "4.5.1".
		 */
		pick: async (m: { exact?: string; words?: string; folder?: string; preferRoot?: boolean }) => {
			const words = (m.words ?? '').split(/\s+/).filter(Boolean)
				.map(x => new RegExp('(^|[^\\w.-])' + x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^\\w-])', 'i'));
			const hit = (r: { label: string; description: string }) =>
				(m.exact !== undefined ? r.label === m.exact : words.every(x => x.test(r.label + ' ' + r.description)))
				// A folder is the whole description, or its end ("rapp" in "apps/rapp").
				&& (!m.folder || r.description === m.folder || r.description.endsWith('/' + m.folder) || r.description.endsWith(' ' + m.folder));
			// Quick Open lists recent files first and adds search results a moment
			// later, so match only once the rows have stopped changing.
			let all: Awaited<ReturnType<typeof lib.rows>> = [];
			let prev = '';
			for (let i = 0; i < 20; i++) {
				all = await lib.rows();
				const now = JSON.stringify(all);
				if (now === prev && all.length) { break; }
				prev = now;
				await lib.sleep(150);
			}
			let found = all.filter(hit);
			// A bare file name means the one at the workspace root, which has no folder beside it.
			if (found.length > 1 && m.preferRoot && found.filter(r => !r.description).length === 1) { found = found.filter(r => !r.description); }
			const show = (rs: typeof all) => rs.slice(0, 8).map(r => r.label + (r.description ? ' (' + r.description + ')' : ''));
			const want = m.exact ?? m.words;
			if (found.length === 0) { return { ok: false as const, error: `no row matches "${want}"`, shown: show(all) }; }
			if (found.length > 1) { return { ok: false as const, error: `${found.length} rows match "${want}"; be more specific`, shown: show(found) }; }
			return { ok: true as const, row: found[0] };
		},
		/**
		 * A real click, which runs it, on the row with this label (and description),
		 * found at click time: Quick Open re-sorts its rows as results arrive, so an
		 * index read earlier can point at another row by now.
		 */
		clickRow: async (row: { label: string; description: string }) => {
			// Label and description both exact, as rows() reads them: an empty
			// description is the file at the workspace root, not any row of that name.
			const all = widget.locator(s.list.row);
			const at = await all.evaluateAll((rs, { r, label }) => {
				const clean = (el: Element | null | undefined) => el ? (el.textContent ?? '').replace(/\s+/g, ' ').trim() : '';
				return rs.findIndex(x => (x as HTMLElement).offsetParent !== null && clean(x.querySelector(label.name)) === r.label
					&& clean([...x.querySelectorAll(label.description)].find(d => d.getBoundingClientRect().height > 0)) === r.description);
			}, { r: row, label: s.label });
			if (at < 0) { throw new Error(`the row "${row.label}"${row.description ? ` (${row.description})` : ''} is no longer listed`); }
			return all.nth(at).click({ timeout: 3000 });
		},

		// ---- Dialogs
		/** Visible modal dialogs, upstream and Positron's own, with their buttons. */
		dialogs: () => page.evaluate(d => {
			const clean = (el: Element | null | undefined) => el ? (el.textContent ?? '').replace(/\s+/g, ' ').trim() : '';
			return [...document.querySelectorAll<HTMLElement>(d.box)].filter(x => x.offsetParent !== null).map(x => ({
				kind: 'dialog',
				message: clean(x.querySelector(d.message)),
				detail: clean(x.querySelector(d.detail)),
				buttons: [...x.querySelectorAll(d.buttons)].map(b => clean(b)).filter(Boolean),
			}));
		}, s.dialog),
		/**
		 * A failed result with the modal dialog that is open, if any, named in its
		 * error: a dialog takes the keys and clicks a helper sends, so "the Command
		 * Palette did not open" really means "a dialog is in the way". inPage runs
		 * every result through this.
		 */
		explain: async (r: { ok: boolean; error?: unknown; dialogs?: unknown; [key: string]: unknown }) => {
			if (!r || r.ok !== false || r.dialogs) { return r; }
			const d = await lib.dialogs().catch(() => []);
			if (!d.length) { return r; }
			const named = d.map(x => `"${x.message || x.detail || 'untitled'}" (buttons: ${x.buttons.join(', ') || 'none'})`).join('; ');
			return { ...r, error: `${r.error ?? 'failed'}; a modal dialog is open: ${named}. Answer it with notifications.sh --click BUTTON, or ui.sh ... --in dialog`, dialogs: d };
		},
		/** The names of the notification toasts on screen ("Warning: Error rendering plot"). */
		toasts: () => page.locator(s.notification.toasts).getByRole('dialog').filter({ visible: true })
			.evaluateAll(es => es.map(e => (e.getAttribute('aria-label') ?? '').replace(/, (source: .*, )?notification\b.*$/, ''))),
		/**
		 * Toasts not in before, waiting until `until` (a Date.now() time) for one to
		 * appear: an action's toast can come a second after it, and close within
		 * seconds, so a read after the action has returned can miss it.
		 */
		newToasts: async (before: string[], until: number) => {
			for (; ;) {
				const now = (await lib.toasts()).filter(t => !before.includes(t));
				if (now.length || Date.now() >= until) { return now; }
				await page.waitForTimeout(150);
			}
		},
		/**
		 * The open menu and its items, by name. A menu is what ui.sh read menu
		 * reads: a menu of menu items, Positron's context menu (its items are
		 * buttons) or a drop-down list's popup (a dialog of buttons). Null when
		 * none is open.
		 */
		menu: async () => {
			const box = page.locator(s.overlay.menu).filter({ visible: true }).last();
			if (!await box.count()) { return null; }
			let items = box.locator(s.menu.items).filter({ visible: true });
			if (!await items.count()) { items = box.getByRole('button').filter({ visible: true }); }
			const names = (await items.evaluateAll(es => es.map(e => (e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim())))
				.map(x => x.replace(/[\uE000-\uF8FF]/g, '').trim());
			const off = await items.evaluateAll(es => es.map(e => (e as HTMLButtonElement).disabled || e.getAttribute('aria-disabled') === 'true'));
			return { box, items, names, off };
		},
		/**
		 * Closes the open menu, if any, and says whether none is open after.
		 * Escape only while focus is in the menu or the overlay under it, which
		 * take the key: anywhere else, with a .qmd in front and its kernel busy,
		 * Escape is Quarto: Interrupt Kernel, whatever has focus.
		 */
		closeMenu: async () => {
			if (!await lib.menu()) { return true; }
			if (await page.evaluate(sel => !!document.activeElement?.closest(sel), `${s.overlay.menu}, ${s.overlay.modal}`)) { await page.keyboard.press('Escape'); }
			for (let i = 0; i < 10 && await lib.menu(); i++) { await lib.sleep(100); }
			return !await lib.menu();
		},
		/**
		 * Chooses an item of the open menu by name: the whole name; the name
		 * without a "(keys)" suffix; or the name with a shortcut run into it (no
		 * lowercase after it), as Positron's menus draw. Hovers first, since a menu
		 * ignores a click that arrives before the pointer has rested on the item,
		 * then checks the item went away (a click while the menu still draws is
		 * lost, so one retry is safe). closeMenu closes it when nothing was chosen.
		 */
		choose: async (item: string) => {
			const m = await lib.menu();
			if (!m) { return { ok: false as const, error: 'no menu is open' }; }
			const want = item.toLowerCase();
			const pick = [
				m.names.findIndex(x => x.toLowerCase() === want),
				m.names.findIndex(x => x.toLowerCase().replace(/\s*\(.*\)\s*$/, '') === want),
				m.names.findIndex(x => x.toLowerCase().startsWith(want) && !/[a-z]/.test(x.slice(want.length))),
			].find(i => i >= 0) ?? -1;
			if (pick < 0) { await lib.closeMenu(); return { ok: false as const, error: `no menu item "${item}"`, items: m.names }; }
			if (m.off[pick]) { await lib.closeMenu(); return { ok: false as const, error: `the menu item "${m.names[pick]}" is disabled; nothing was chosen`, items: m.names }; }
			const el = m.items.nth(pick);
			const handle = await el.elementHandle();
			const gone = () => page.waitForFunction(e => !e || !e.isConnected || !(e as HTMLElement).offsetParent, handle, { timeout: 1500 }).then(() => true, () => false);
			const press = async () => { await el.hover({ timeout: 3000 }); await lib.sleep(100); await el.click({ timeout: 3000 }); };
			await press();
			if (!await gone()) {
				await press().catch(() => { });
				if (!await gone()) { await lib.closeMenu(); return { ok: false as const, error: `the menu stayed open after clicking "${m.names[pick]}"; nothing was chosen` }; }
			}
			return { ok: true as const, chose: m.names[pick] };
		},

		// ---- Diff and settling: what an action changed
		/**
		 * Waits up to ms for loc's tree to differ from before and then stop changing
		 * (two equal reads 300 ms apart), so a diff is not taken mid-update.
		 */
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
		/**
		 * Lines added (+) and removed (-) between two trees, counting repeats, each
		 * cut to 160 characters. A file R evaluates from a temporary path (Ark's
		 * eval().R, source().R) is labelled with as much of that path as tells it
		 * apart from the others (".../session9/8b29.../print().R"), and the label
		 * changes every step; it is compared by its file name alone.
		 */
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
		 * The active text editor as a person sees it: its tab, unsaved edits, the
		 * cursor and selection (the status bar's "Ln 9, Col 1 (12 selected)"),
		 * whether focus is in it, the text of the cursor's line (and of the drawn
		 * lines in range, when given), the text of an input inside it, such as the
		 * breakpoint widget, when focus is there, and the lines
		 * the debugger marks: its top frame and the frame selected in the Call Stack.
		 * Monaco draws lines and decorations as positioned divs with no roles, so
		 * they are read from the page and matched to the line numbers by height.
		 */
		editor: async (range?: { from: number; to: number }) => {
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

		/**
		 * Puts focus back in the active editor, where it was: the cursor stays
		 * where it was. True when focus is in it after.
		 */
		focusEditor: async () => {
			const ed = page.locator(`${s.editorGroup.active} ${s.monaco.editor}`).filter({ visible: true }).first();
			await ed.locator(s.monaco.editContext).first().focus().catch(() => { });
			return ed.evaluate(e => e.contains(document.activeElement)).catch(() => false);
		},

		// ---- Consoles
		/**
		 * Console sessions: their ids (python-1a2b), names, and which one is active.
		 * With one session the console shows no tabs; `sessions` then holds that one,
		 * named by the console's own last status line ("Python 3.14.6 (uv: x)
		 * started."), else as the title bar's Select Session button names it: that
		 * button names the foreground session, which can be another (a .qmd's
		 * kernel, named after the file) or nothing while one starts.
		 */
		consoles: () => page.evaluate(({ c, n }) => {
			const idOf = (el: Element | null | undefined, prefix: string) => (el?.getAttribute('data-testid') ?? '').slice(prefix.length);
			const activeEl = document.querySelector<HTMLElement>(c.active);
			const active = idOf(activeEl, c.instanceTestId);
			const tabs = [...document.querySelectorAll(`[data-testid^="${c.tabTestId}"]`)].map(t => ({ id: idOf(t, c.tabTestId), name: t.getAttribute('aria-label') ?? '' }));
			const lines = ((activeEl?.querySelector<HTMLElement>(c.container) ?? activeEl)?.innerText ?? '').split('\n').map(l => l.trim());
			const status = lines.map(l => l.match(/^(.+) (starting|started|restarting|restarted|reconnecting|reconnected)\.$/)?.[1]).filter(Boolean).pop() ?? '';
			const picker = (document.querySelector(`[aria-label="${n.selectSession}"]`)?.textContent ?? '').trim();
			const sessions = tabs.length || !active ? tabs : [{ id: active, name: status || picker }];
			// With no session the view shows only its empty message, and no instance.
			return { active, tabs, sessions, inPage: !!document.querySelector(c.instance) || !!document.querySelector<HTMLElement>(c.empty)?.offsetParent };
		}, { c: s.console, n: ui.names.console }),
		/**
		 * Makes a console the active one by clicking its tab, and waits until it
		 * is active and stays so for half a second, up to 8 s: a session that just
		 * started takes the foreground a moment later, and can take it back from a
		 * tab clicked before then. A session tab redraws its live CPU and memory
		 * readings, so it may never hold still for a normal click; once it is
		 * visible, it is clicked anyway. Returns the console active after.
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
		/** Whether a session is the one --name means: part of its name, its id (python-1a2b3c4d), or the id's hex alone. */
		namedLike: (session: { id: string; name: string }, name: string) => !name || session.name.includes(name) || session.id === name || session.id.endsWith('-' + name),
		/**
		 * Console sessions still starting (or restarting): the last status line
		 * the console printed is "X starting." with no "X started." after it.
		 */
		starting: () => page.evaluate(c => [...document.querySelectorAll<HTMLElement>(c.instance)].filter(inst => {
			const lines = (inst.querySelector<HTMLElement>(c.container) ?? inst).innerText.split('\n').map(l => l.trim());
			const last = (re: RegExp) => lines.reduce((at, l, i) => re.test(l) ? i : at, -1);
			return last(/ (starting|restarting|reconnecting)\.$/) > last(/ (started|restarted|reconnected)\.$/);
		}).map(inst => (inst.getAttribute('data-testid') ?? '').slice(c.instanceTestId.length)), s.console),
		/**
		 * A console's output text (without what is typed in its input), its prompt
		 * and its tab name. The text is its rows as drawn: a line is a block with
		 * no block inside it, and a <br> between lines is a blank row. innerText
		 * adds a line break at every block's edge, so its blank rows are wrong
		 * both ways.
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
					if (e.matches(c.input) || !e.getClientRects().length) { continue; }
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
			// The prompt the input shows now: R's is Browse[1]> while debugging, + mid-expression.
			const prompt = (inst.querySelector(c.prompt) ?? inst.querySelector(c.anyPrompt))?.textContent?.trim() || null;
			const tab = document.querySelector(`[data-testid="${c.tabTestId}${i}"]`);
			return { session: tab?.getAttribute('aria-label') ?? i, prompt, text: text.replace(/\u00A0/g, ' ') };
		}, { i: id, c: s.console }),
	};
	return lib;
}
