/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The Viewer: its toolbar by accessible name, and the web page it shows, which
// lives in nested frames that the window's own accessibility tree does not
// reach. The page is found as the innermost frame drawn inside the Viewer, then
// read and driven by role and name. viewer.sh and view-read.sh wrap these.

import { existsSync, mkdirSync, rmSync, statSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { Exit, failText, inPage, log, logRead, parse, treeLine, usage, type Json, type PageFn } from './dp-lib.ts';
import { badShotName } from './dp-shot.ts';

interface Args { cmd: string; name: string; text: string; seconds: number; path: string; view: string }

// runs in run-code
const viewer: PageFn<Args> = async (page, a, lib) => {
	const n = lib.names.viewer;
	// The Viewer by default; another view that shows a web page in a frame (Help) by --view.
	let sc = await lib.scope(a.view || lib.names.views.viewer);
	// An app that is still starting shows the Viewer only when it serves: wait-content waits for that too.
	for (const end = Date.now() + a.seconds * 1000; a.cmd === 'wait-content' && !('loc' in sc && sc.loc) && Date.now() < end;) { await lib.sleep(500); sc = await lib.scope(a.view || lib.names.views.viewer); }
	if (!('loc' in sc) || !sc.loc) { return { ok: false, error: `the ${a.view || 'Viewer'} view is not on screen; run ${a.view || 'Viewer'}: Focus on ${a.view || 'Viewer'} View` }; }
	const pane = sc.loc;
	// The page: the innermost frame drawn inside the view.
	const findFrame = () => lib.frameIn(pane);
	const url = async () => pane.getByRole('textbox', { name: n.url }).inputValue({ timeout: 1000 }).catch(() => null);
	// URL content and HTML content name reload and clear differently: either will do.
	const toolbar: Record<string, string[]> = { reload: [n.reload, n.reloadContent], back: [n.back], forward: [n.forward], clear: [n.clear, n.clearContent], interrupt: [n.interrupt] };
	const pageTree = async (f: Awaited<ReturnType<typeof findFrame>>) => f ? (await f.locator('body').ariaSnapshot({ timeout: 3000 }).catch(() => '')).trim() : '';

	switch (a.cmd) {
		case 'read': {
			const f = await findFrame();
			return { ok: true, url: await url(), page: f ? await pageTree(f) : null, ...(f ? {} : { note: 'no page is shown in the Viewer' }) };
		}
		case 'buttons': {
			const names = await pane.getByRole('button').filter({ visible: true }).evaluateAll(bs => bs.map(b => {
				const n = b.getAttribute('aria-label') || (b.textContent ?? '').trim();
				return (b as HTMLButtonElement).disabled || b.getAttribute('aria-disabled') === 'true' ? n + ' (off)' : n;
			}).filter(Boolean));
			return { ok: true, buttons: [...new Set(names)] };
		}
		case 'wait-content': {
			const end = Date.now() + a.seconds * 1000;
			while (Date.now() < end) {
				const f = await findFrame();
				const text = f ? (await f.locator('body').innerText({ timeout: 1000 }).catch(() => '')).trim() : '';
				if (text) { return { ok: true, url: await url(), shown: text.slice(0, 200) }; }
				await lib.sleep(500);
			}
			const f = await findFrame();
			return { ok: false, url: await url(), blank: true, error: f ? `the page is still blank after ${a.seconds} s` : `no page in the Viewer after ${a.seconds} s` };
		}
		case 'click': case 'fill': {
			const f = await findFrame();
			if (!f) { return { ok: false, error: 'no page is shown in the Viewer' }; }
			const roles = a.cmd === 'click' ? ['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'option'] : ['textbox', 'searchbox', 'spinbutton', 'combobox'];
			let target = null;
			for (const r of roles) {
				const l = f.getByRole(r as Parameters<typeof f.getByRole>[0], { name: a.name, exact: true }).filter({ visible: true });
				if (await l.count() === 1) { target = l; break; }
			}
			if (!target && a.cmd === 'fill') {
				for (const l of [f.getByLabel(a.name, { exact: true }), f.getByPlaceholder(a.name, { exact: true })]) {
					if (await l.filter({ visible: true }).count() === 1) { target = l.filter({ visible: true }); break; }
				}
			}
			if (!target && a.cmd === 'click') {
				const t = f.getByText(a.name, { exact: true }).filter({ visible: true });
				if (await t.count() === 1) { target = t; }
			}
			if (!target) { return { ok: false, error: `no single "${a.name}" to ${a.cmd} in the page`, page: await pageTree(f) }; }
			const before = await pageTree(f);
			if (a.cmd === 'click') { await target.click({ timeout: 3000 }); } else { await target.fill(a.text, { timeout: 3000 }); }
			// The page may navigate: read whatever frame shows now.
			let after = before;
			for (let i = 0; i < 15; i++) { await lib.sleep(200); const g = await findFrame(); after = await pageTree(g); if (after !== before) { break; } }
			return { ok: true, did: `${a.cmd} "${a.name}"`, url: await url(), changed: after !== before, diff: lib.diff(before, after).slice(0, 20) };
		}
		case 'shot': {
			await pane.screenshot({ path: a.path, timeout: 5000, scale: 'css' });
			return { ok: true, path: a.path };
		}
		default: {
			const names = toolbar[a.cmd];
			if (!names) { return { ok: false, error: `unknown command ${a.cmd}` }; }
			const byName = (name: string) => pane.getByRole('button', { name, exact: true }).filter({ visible: true });
			let name = names[0];
			for (const each of names) { if (await byName(each).count()) { name = each; break; } }
			const b = byName(name);
			if (!await b.count()) { return { ok: false, error: `the Viewer has no ${names.map(x => `"${x}"`).join(' or ')} button now` }; }
			if (await b.first().isDisabled()) { return { ok: false, error: `"${name}" is disabled` }; }
			const before = await url();
			await b.first().click({ timeout: 3000 });
			await lib.sleep(500);
			return { ok: true, clicked: name, url: await url(), urlBefore: before };
		}
	}
};

export const viewerCommands: Record<string, (argv: string[]) => Json | string> = {
	viewer: argv => {
		const p = parse(argv, ['session', 'view'], { read: 1, buttons: 1, reload: 1, back: 1, forward: 1, clear: 1, interrupt: 1, open: 2, shot: 2, click: 2, fill: 3, 'wait-content': 2 });
		const [cmd, a1, a2] = p.rest;
		if (p.flags.help || !cmd) { usage('viewer.sh'); }
		const base: Args = { cmd, name: '', text: '', seconds: 15, path: '', view: String(p.flags.view ?? '') };
		switch (cmd) {
			case 'click': if (!a1) { throw new Exit(2, { ok: false, error: 'give the name to click' }); } base.name = a1; break;
			case 'fill': if (!a1 || a2 === undefined) { throw new Exit(2, { ok: false, error: 'give the field name and the text' }); } base.name = a1; base.text = a2; break;
			case 'wait-content': base.seconds = Number(a1 ?? 15); break;
			case 'shot': {
				if (!a1) { throw new Exit(2, { ok: false, error: 'give the file name' }); }
				if (badShotName(a1)) { throw new Exit(2, { ok: false, error: badShotName(a1) }); }
				base.path = a1.includes('/') ? resolve(a1) : join(process.env.DRIVE_POSITRON_SHOTS ?? '.', a1);
				mkdirSync(dirname(base.path), { recursive: true });
				rmSync(base.path, { force: true });
				break;
			}
		}
		const out = inPage(p.session, viewer, base);
		if (cmd === 'shot') {
			if (!out.ok || !existsSync(base.path) || statSync(base.path).size === 0) { failText('viewer.sh', String(out.error ?? 'no screenshot written')); }
			log('shot.sh', p.session, `screenshot ${basename(base.path)} of the Viewer`);
			return base.path;
		}
		if (out.ok && cmd === 'read') { logRead('viewer.sh', p.session, `Viewer ${out.url ?? ''}: ${out.page ? treeLine(out.page) : 'no page'}`); }
		if (out.ok && !['read', 'buttons', 'wait-content'].includes(cmd)) { log('viewer.sh', p.session, `${cmd}${a1 ? ' ' + JSON.stringify(a1) : ''}`, out.changed === undefined ? '' : `changed ${out.changed}`); }
		return out;
	},
};
