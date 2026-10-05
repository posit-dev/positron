/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The workbench around the views: panel tabs, terminals, console sessions,
// editor tabs, and the size of each part. Tabs and menus by role and name; the
// terminal list, an editor tab's unsaved mark and part sizes are not in the
// accessibility tree and are read from the page. panel.sh wraps these.

import { Exit, inPage, log, logRead, parse, usage, type Json, type PageFn } from './dp-lib.ts';
import { withConsoleView } from './dp-console.ts';
import { notifications } from './dp-notifications.ts';
import { paletteRun } from './dp-palette.ts';
import { names } from './selectors.ts';

interface Args { cmd: string; arg: string; px: number }

// runs in run-code
const panel: PageFn<Args> = async (page, a, lib) => {
	const layout = () => page.evaluate(part => {
		const r = (s: string) => {
			const e = document.querySelector(s);
			if (!e || !e.getClientRects().length || getComputedStyle(e).display === 'none') { return 'hidden'; }
			const b = e.getBoundingClientRect();
			return { left: Math.round(b.left), top: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height) };
		};
		return { window: { width: innerWidth, height: innerHeight }, sidebar: r(part.sidebar), secondary: r(part.secondary), panel: r(part.panel), editor: r(part.editor) };
	}, lib.css.part);
	switch (a.cmd) {
		case 'tab': {
			const bar = page.locator(lib.css.part.panel).getByRole('tablist').first();
			const tabs = bar.getByRole('tab').filter({ visible: true });
			// A tab's name is its label: its text runs on into a badge's count
			// ("Problems4") and its accessible name into the keys and the count.
			const labels = () => tabs.evaluateAll((ts, label) => ts.map(t => ({
				name: (t.querySelector(label)?.textContent || t.getAttribute('aria-label') || t.textContent || '').trim(),
				selected: t.getAttribute('aria-selected') === 'true',
			})), lib.css.workbench.tabLabel);
			const names = (await labels()).map(t => t.name);
			const want = (n: string) => n.trim().toLowerCase().startsWith(a.arg.toLowerCase());
			// Shown: a visible tab of that name reads as selected. By name, not by
			// place: a narrow panel folds and unfolds tabs as the selection moves,
			// so the tab clicked can be at another index, or another tab there, after.
			const shown = async (name: string) => (await labels()).some(t => t.selected && t.name === name);
			const until = async (name: string) => { for (let k = 0; k < 10 && !await shown(name); k++) { await lib.sleep(100); } return shown(name); };
			const i = names.findIndex(want);
			if (i >= 0) {
				// Done when the tab reads as selected, not when the click returned.
				if (await shown(names[i])) { return { ok: true, tab: names[i], already: true }; }
				await tabs.nth(i).click({ timeout: 3000 });
				return await until(names[i]) ? { ok: true, tab: names[i] } : { ok: false, error: `the ${names[i]} tab is not selected 1 s after the click`, tabs: names };
			}
			// A narrow panel folds its tabs into one, Additional Views, whose menu
			// lists every view as a checkbox, the one shown checked.
			const more = bar.getByRole('tab', { name: lib.names.workbench.additionalViews, exact: true }).filter({ visible: true });
			if (!await more.count()) { return { ok: false, error: `no panel tab named ${a.arg}`, tabs: names }; }
			// The menu lists the views, the one shown checked.
			const views = async () => {
				await more.first().click({ timeout: 3000 });
				for (let k = 0; k < 20 && !await lib.menu(); k++) { await lib.sleep(100); }
				const m = await lib.menu();
				if (!m) { return null; }
				const checked = await m.items.evaluateAll(es => es.map(e => e.getAttribute('aria-checked') === 'true'));
				return { names: m.names, shown: m.names[checked.indexOf(true)] ?? null };
			};
			const v = await views();
			if (!v) { return { ok: false, error: `the panel is too narrow to show its tabs, and ${lib.names.workbench.additionalViews} opened no menu` }; }
			const item = v.names.find(want);
			if (!item) { await lib.closeMenu(); return { ok: false, error: `no panel view named ${a.arg}`, tabs: [...names.filter(n => n !== lib.names.workbench.additionalViews), ...v.names] }; }
			const via = `through ${lib.names.workbench.additionalViews}: the panel is too narrow to show all its tabs`;
			if (v.shown === item) { await lib.closeMenu(); return { ok: true, tab: item, already: true, via }; }
			const c = await lib.choose(item);
			if (!c.ok) { return c; }
			// The view chosen usually becomes a tab of its own, selected, in place of
			// another; in a panel too narrow for any tab, the menu shows it checked.
			if (await until(item)) { return { ok: true, tab: item, via }; }
			const after = await views();
			if (after) { await lib.closeMenu(); }
			return after?.shown === item ? { ok: true, tab: item, via } : { ok: false, error: `${after?.shown ?? 'no view'} is shown after choosing ${item}`, via };
		}
		case 'sessions': {
			// The console tabs, or with one session the session the title bar names.
			const c = await lib.consoles();
			if (!c.inPage) { return { ok: false, noConsoleView: true }; }
			const starting = await lib.starting();
			// A session that has printed no status line yet has no name to show.
			const sessions = c.sessions.map(t => ({ name: t.name || (starting.includes(t.id) ? '(starting, not named yet)' : '(no name shown)'), id: t.id, language: t.id.replace(/-[^-]*$/, ''), active: t.id === c.active, ...(starting.includes(t.id) ? { starting: true } : {}) }));
			return { ok: true, count: sessions.length, sessions };
		}
		case 'console': {
			// The console to make active, by language (python, r), part of its
			// name, or its id, as console-run.sh --name matches; never by the tab's
			// whole label, which counts new executions ("R 4.5.1, 2 new executions").
			const c = await lib.consoles();
			if (!c.inPage) { return { ok: false, noConsoleView: true }; }
			const lang = a.arg.toLowerCase();
			const hits = c.sessions.filter(t => ['python', 'r'].includes(lang) ? t.id.startsWith(lang + '-') : lib.namedLike(t, a.arg));
			const list = c.sessions.map(t => `${t.name} (${t.id})`);
			if (hits.length !== 1) { return { ok: false, error: hits.length ? `${hits.length} consoles match "${a.arg}"; pass part of one's name, or its id` : `no console matches "${a.arg}"`, sessions: list }; }
			const id = hits[0].id;
			if (c.active === id) { return { ok: true, console: hits[0].name, id, already: true }; }
			const active = await lib.activateConsole(id);
			return active === id ? { ok: true, console: hits[0].name, id, was: c.active || null } : { ok: false, error: `the ${id} console did not become active within 8 s; ${active || 'no console'} is`, sessions: list };
		}
		case 'terminals': {
			const list = await page.locator(lib.css.terminal.tabEntry).filter({ visible: true }).evaluateAll((es, { label, row }) => es.map((e, i) => ({
				n: i + 1, name: (e.querySelector(label.name)?.textContent ?? e.textContent ?? '').trim(),
				active: e.closest(row.row)?.matches(row.selected) ?? false,
			})), { label: lib.css.label, row: lib.css.list });
			return { ok: true, terminals: list, ...(list.length ? {} : { note: 'no terminal list: with one terminal the panel shows no list' }) };
		}
		case 'delete-session': {
			const c = lib.css.console;
			if (!(await lib.consoles()).inPage) { return { ok: false, noConsoleView: true }; }
			const tabs = page.locator(`[data-testid^="${c.tabTestId}"]`);
			const names = await tabs.evaluateAll(ts => ts.map(t => t.getAttribute('aria-label') ?? ''));
			const ids = await tabs.evaluateAll((ts, prefix) => ts.map(t => (t.getAttribute('data-testid') ?? '').slice(prefix.length)), c.tabTestId);
			// By part of its name, or by its session id when two share a name.
			const hits = names.flatMap((n, i) => n.includes(a.arg) || ids[i] === a.arg || ids[i].endsWith('-' + a.arg) ? [i] : []);
			if (hits.length !== 1) { return { ok: false, error: hits.length ? `${hits.length} sessions match; pass the session id` : `no console session named like ${a.arg}`, sessions: names.map((n, i) => `${n} (${ids[i]})`) }; }
			const tab = tabs.nth(hits[0]);
			const name = names[hits[0]];
			// The tab's trash button hides when the tab list is narrow, so use the
			// context menu, which has Delete at any width.
			await tab.click({ button: 'right', timeout: 3000, force: true });
			const items = page.locator(lib.css.menu.sessionItems).filter({ visible: true });
			try { await items.first().waitFor({ timeout: 3000 }); } catch { return { ok: false, error: 'no context menu opened' }; }
			const labels = await items.evaluateAll(es => es.map(e => (e.getAttribute('aria-label') || e.textContent || '').trim()));
			const del = lib.names.panel.deleteSession;
			const at = labels.findIndex(l => l === del || (l.startsWith(del) && !/[a-z]/.test(l.slice(del.length))));
			if (at < 0) { await lib.closeMenu(); return { ok: false, error: `the menu has no ${del}`, items: labels }; }
			await items.nth(at).hover(); await lib.sleep(100); await items.nth(at).click({ timeout: 3000 });
			// Gone when its tab and its console are: a Python session takes some
			// seconds to shut down, so wait up to 10 s.
			const id = ids[hits[0]];
			const left = page.locator(`[data-testid="${c.tabTestId}${id}"], [data-testid="${c.instanceTestId}${id}"]`);
			let gone = false;
			for (const end = Date.now() + 10_000; !gone && Date.now() < end;) { await lib.sleep(250); gone = !await left.count(); }
			return { ok: true, session: name, id, deleted: gone };
		}
		case 'editors': {
			// Every group, also while the editor area is hidden (the panel
			// maximized): its tabs are still in the page, only not laid out.
			const hidden = (await layout()).editor === 'hidden';
			const groups = await page.locator(lib.css.editorGroup.group).evaluateAll((all, { e, label }) => all
				.filter((g, _i, gs) => g.getClientRects().length > 0 || !gs.some(x => x.getClientRects().length > 0))
				.sort((p, q) => p.getBoundingClientRect().left - q.getBoundingClientRect().left || p.getBoundingClientRect().top - q.getBoundingClientRect().top)
				.map((g, i) => ({
					group: i + 1, active: g.matches(e.active),
					tabs: [...g.querySelectorAll('[role=tab]')].map(t => {
						const clean = (x: Element | null | undefined) => (x?.textContent ?? '').replace(/\s+/g, ' ').trim();
						const folder = clean(t.querySelector(label.description));
						const path = (t.querySelector(label.icon)?.getAttribute('aria-label') ?? '').split(' \u2022 ')[0];
						return {
							title: clean(t.querySelector(label.name)) || (t.getAttribute('aria-label') ?? '').replace(/, Editor Group \d+$/, ''),
							...(folder ? { folder } : {}), ...(path.startsWith('/') || /^[A-Za-z]:/.test(path) ? { path } : {}),
							active: t.getAttribute('aria-selected') === 'true', modified: t.matches(e.dirty),
						};
					}),
				})), { e: lib.css.editorGroup, label: lib.css.label });
			return { ok: true, groups, ...(hidden ? { editorArea: 'hidden', note: 'the editor area is hidden (the panel is maximized, or the editors are closed): these tabs are open but not on screen' } : {}) };
		}
		case 'layout': return { ok: true, ...(await layout()) };
		case 'resize': {
			// The sash on the part's inner edge: right of the sidebar, left of the
			// secondary side bar, top of the panel. Its centre is where to grab.
			const m = await page.evaluate(({ part, px, parts, w }) => {
				const e = document.querySelector((parts as Record<string, string>)[part]);
				if (!e || !e.getClientRects().length) { return { error: `${part} is hidden; show it first` }; }
				const b = e.getBoundingClientRect();
				const sashes = [...document.querySelectorAll(w.sash)].filter(x => x.getClientRects().length && !x.matches(w.sashDisabled)).map(x => ({ x, r: x.getBoundingClientRect() }));
				const near = (p: number, q: number) => Math.abs(p - q) < 5;
				const s = part === 'panel'
					? sashes.find(({ x, r }) => x.matches(w.sashHorizontal) && near(r.top + r.height / 2, b.top) && r.left < b.right && r.right > b.left)
					: sashes.find(({ x, r }) => x.matches(w.sashVertical) && near(r.left + r.width / 2, part === 'sidebar' ? b.right : b.left) && r.height > b.height / 2);
				if (!s) { return { error: `no sash on the edge of ${part}` }; }
				const n = Number(px);
				const from = { x: Math.round(s.r.left + s.r.width / 2), y: Math.round(s.r.top + s.r.height / 2) };
				const to = part === 'sidebar' ? { x: Math.round(b.left + n), y: from.y } : part === 'secondary' ? { x: Math.round(b.right - n), y: from.y } : { x: from.x, y: Math.round(b.bottom - n) };
				return { from, to, before: part === 'panel' ? Math.round(b.height) : Math.round(b.width) };
			}, { part: a.arg, px: a.px, parts: lib.css.part, w: lib.css.workbench });
			if ('error' in m) { return { ok: false, error: m.error }; }
			await page.mouse.move(m.from.x, m.from.y);
			await page.mouse.down();
			await page.mouse.move((m.from.x + m.to.x) / 2, (m.from.y + m.to.y) / 2);
			await page.mouse.move(m.to.x, m.to.y);
			await page.mouse.up();
			await lib.sleep(300);
			const l = await layout() as Record<string, unknown>;
			const part = l[a.arg] as { width: number; height: number } | 'hidden';
			// Dragged below its minimum size, a part closes: it is hidden, not 0 px.
			if (part === 'hidden') { return { ok: true, part: a.arg, before: m.before, asked: a.px, now: 'hidden', note: `dragged below its minimum size, the ${a.arg} closed; show it again with its view or View: Toggle command` }; }
			const now = a.arg === 'panel' ? part.height : part.width;
			return {
				ok: true, part: a.arg, before: m.before, asked: a.px, now,
				...(Math.abs(now - a.px) > 8 ? { note: 'it stopped short of the size asked: the part or its neighbours have a minimum or maximum size' } : {}),
			};
		}
	}
	return { ok: false, error: 'command: tab, sessions, console, terminals, delete-session, editors, layout or resize' };
};

/**
 * The session picker's rows (Interpreter: Select Session, open), by the group
 * heading each sits under: Console, Notebook or Quarto Sessions. A session row
 * has its interpreter's path as its detail; the actions under them have none.
 * Closes the picker (Escape is safe in a quick input).
 * runs in run-code
 */
const sessionPicker: PageFn<Record<string, never>> = async (page, _a, lib) => {
	for (let i = 0; i < 10 && !await lib.quickOpen(); i++) { await lib.sleep(200); }
	if (!await lib.quickOpen()) { return { ok: false, error: `${lib.names.palette.selectSession} opened no picker` }; }
	await lib.sleep(300);
	const rows = await page.evaluate(({ q, label, list }) => {
		const clean = (el: Element | null | undefined) => el ? (el.textContent ?? '').replace(/\s+/g, ' ').trim() : '';
		const w = [...document.querySelectorAll<HTMLElement>(q.widget)].find(x => x.offsetParent !== null);
		const all = [...(w?.querySelectorAll<HTMLElement>(q.rows) ?? [])].filter(r => r.offsetParent !== null)
			.sort((p, q2) => Number(p.getAttribute(list.indexAttr)) - Number(q2.getAttribute(list.indexAttr)));
		let heading = '';
		return all.map(r => {
			// A heading is drawn on the first row of its group; recycled rows keep a hidden one.
			const h = [...r.querySelectorAll(`${q.separator}, ${q.separatorRow}`)].find(x => x.getBoundingClientRect().height > 0);
			if (h) { heading = clean(h); }
			return { heading, name: clean(r.querySelector(label.name)), description: clean(r.querySelector(label.description)), detail: clean(r.querySelector(q.meta)) };
		}).filter(r => r.detail);
	}, { q: lib.css.quickInput, label: lib.css.label, list: lib.css.list });
	await lib.closeQuickInput();
	const n = lib.names.sessions;
	const kinds: Record<string, string> = { [n.consoleHeading]: 'console', [n.notebookHeading]: 'notebook', [n.quartoHeading]: 'quarto' };
	return {
		ok: true, sessions: rows.map(r => {
			const kind = kinds[r.heading] ?? r.heading;
			// A notebook's or .qmd's row is "<file> - <interpreter>".
			const [document, ...rest] = kind === 'console' ? [''] : r.name.split(' - ');
			return { kind, name: kind === 'console' ? r.name : rest.join(' - ') || r.name, ...(document ? { document } : {}), interpreter: r.detail, ...(r.description === n.currentlySelected ? { foreground: true } : {}) };
		}),
	};
};

export const panelCommands: Record<string, (argv: string[]) => Json | string> = {
	panel: argv => {
		const p = parse(argv, ['session'], { tab: 2, sessions: 1, console: 2, terminals: 1, 'delete-session': 2, editors: 1, layout: 1, resize: 3 });
		const [cmd, arg, a2] = p.rest;
		if (p.flags.help || !cmd) { usage('panel.sh'); }
		if (['tab', 'console', 'delete-session'].includes(cmd) && !arg) { throw new Exit(2, { ok: false, error: `${cmd} needs an argument` }); }
		if (cmd === 'resize' && (!['sidebar', 'secondary', 'panel'].includes(arg) || !/^\d+$/.test(a2 ?? ''))) { throw new Exit(2, { ok: false, error: 'give sidebar, secondary or panel, and the size in pixels' }); }
		// The console tabs are in the page only while the Console view is: these bring it forward.
		if (cmd === 'sessions' && p.flags.all) {
			// The console tabs miss notebook and Quarto sessions: the session picker lists them all.
			const c = withConsoleView(p.session, panel, { cmd, arg: '', px: 0 });
			if (!c.ok) { return c; }
			const opened = paletteRun(p.session, names.palette.selectSession);
			if (!opened.ok) { return opened; }
			const picked = inPage(p.session, sessionPicker, {});
			if (!picked.ok) { return picked; }
			const consoles = c.sessions as { name: string; id: string }[];
			const all = (picked.sessions as { kind: string; name: string }[]).map(x => {
				const tab = x.kind === 'console' ? consoles.find(t => t.name === x.name) : undefined;
				return tab ? { ...tab, ...x } : x;
			});
			logRead('panel.sh', p.session, `sessions --all: ${all.map(x => `${x.kind} ${'document' in x ? x.document + ' ' : ''}${x.name}`).join(', ')}`);
			return { ok: true, count: all.length, sessions: all };
		}
		let out = ['sessions', 'console', 'delete-session'].includes(cmd) ? withConsoleView(p.session, panel, { cmd, arg: arg ?? '', px: 0 }) : inPage(p.session, panel, { cmd, arg: arg ?? '', px: Number(a2 ?? 0) });
		if (out.ok && !out.already) {
			if (cmd === 'tab') { log('panel.sh', p.session, `panel tab ${out.tab}`, out.via ? 'through Additional Views' : ''); }
			if (cmd === 'console') { log('panel.sh', p.session, `console ${arg}`, `active ${out.console} (${out.id})`); }
			if (cmd === 'resize') { log('panel.sh', p.session, `resize ${arg} to ${a2} px`, `now ${out.now}`); }
			if (cmd === 'delete-session') { log('panel.sh', p.session, `delete session ${out.session}`, out.deleted ? 'deleted' : 'still there'); }
		}
		if (cmd === 'layout' && out.ok) {
			const size = (v: unknown) => typeof v === 'object' && v ? `${(v as { width: number }).width}x${(v as { height: number }).height}` : String(v);
			logRead('panel.sh', p.session, `layout: ${['window', 'sidebar', 'secondary', 'panel', 'editor'].map(k => `${k} ${size(out[k])}`).join(', ')}`);
		}
		if (cmd === 'sessions' && out.ok) {
			logRead('panel.sh', p.session, `sessions: ${(out.sessions as { name: string; id: string; active: boolean; starting?: boolean }[]).map(t => `${t.name} (${t.id})${t.active ? ' active' : ''}${t.starting ? ' starting' : ''}`).join(', ')}`);
		}
		if (cmd === 'delete-session' && out.ok && !out.deleted) {
			// A busy session can ask first: report a question that is showing, if any.
			const t = notifications(p.session, { click: '', match: '', clear: false });
			const prompts = ((t.notifications ?? []) as { message: string; buttons: string[] }[]).filter(x => x.buttons.length).map(x => ({ message: x.message, buttons: x.buttons }));
			out = { ...out, ...(prompts.length ? { prompts, hint: 'not deleted yet: answer the prompt with notifications.sh' } : { hint: 'its tab and console were still there 10 s after Delete, and no prompt is showing' }) };
		}
		return out;
	},
};
