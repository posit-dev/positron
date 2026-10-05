/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// run-app: the active editor's Run App button. run-app.sh wraps it.

import { execFileSync } from 'child_process';
import { inPage, log, parse, usage, type Json, type PageFn } from './dp-lib.ts';

/**
 * The active editor's Run App button ("Run Shiny App", "Run Flask App in
 * Terminal"), by role and name; clicks it and reports what changed: a new
 * toast, terminal or console, or a session going busy.
 * runs in run-code
 */
const runApp: PageFn<{ label: string; list: boolean }> = async (page, a, lib) => {
	const group = page.locator(lib.css.editorGroup.active);
	// Run buttons, without the drop-down halves of split buttons.
	const all = group.getByRole('button', { name: new RegExp(lib.names.runApp.runPattern) }).filter({ visible: true });
	const labels = (await all.evaluateAll(bs => bs.filter(b => !b.hasAttribute('aria-haspopup')).map(b => b.getAttribute('aria-label') || (b.textContent ?? '').trim()))).filter(Boolean);
	const unique = [...new Set(labels)];
	if (a.list) { return { ok: true, buttons: unique }; }
	const app = new RegExp(lib.names.runApp.appPattern);
	const apps = a.label ? unique.filter(l => l === a.label) : unique.filter(l => app.test(l));
	if (apps.length !== 1) { return { ok: false, error: apps.length ? `${apps.length} run buttons match; pass --label` : 'the active editor has no Run App button', buttons: unique }; }
	const state = () => page.evaluate(s => ({
		toasts: document.querySelectorAll(s.notification.toast).length,
		busy: !!document.querySelector(s.console.busy),
		terminals: document.querySelectorAll(s.terminal.xterm).length,
		consoles: document.querySelectorAll(`[data-testid^="${s.console.tabTestId}"]`).length,
	}), lib.css);
	const before = await state();
	// A real click: Positron's action bar buttons ignore a click() from the page.
	await group.getByRole('button', { name: apps[0], exact: true }).filter({ visible: true }).and(group.locator(':not([aria-haspopup])')).first().click({ timeout: 3000 });
	// Report what changed, not whether the app started: a new terminal can open with
	// nothing run in it. The explorer reads the terminal or the Viewer to know.
	let changes: string[] = [];
	for (let i = 0; i < 10 && !changes.length; i++) {
		await lib.sleep(500);
		const s = await state();
		changes = [
			...(s.toasts > before.toasts ? ['a notification'] : []),
			...(s.terminals > before.terminals ? ['a new terminal'] : []),
			...(s.consoles > before.consoles ? ['a new console'] : []),
			...(s.busy && !before.busy ? ['a session went busy'] : []),
		];
	}
	return { ok: true, clicked: apps[0], changes, buttons: unique, hint: changes.length ? 'whether the app runs: terminal-run.sh --read shows the command and its output, viewer.sh wait-content shows its page' : 'nothing changed on screen within 5 s: check notifications.sh and the App Launcher output' };
};

export const runAppCommands: Record<string, (argv: string[]) => Json | string> = {
	'run-app': argv => {
		const p = parse(argv, ['session', 'label']);
		if (p.flags.help) { usage('run-app.sh'); }
		const r = inPage(p.session, runApp, { label: String(p.flags.label ?? ''), list: !!p.flags.list });
		if (r.clicked) {
			log('run-app.sh', p.session, String(r.clicked));
			// Flask defaults to port 5000, which macOS gives to the AirPlay Receiver.
			if (/Flask/.test(String(r.clicked))) {
				try {
					if (/ControlCenter/.test(execFileSync('lsof', ['-nP', '-iTCP:5000', '-sTCP:LISTEN'], { encoding: 'utf8' }))) {
						return { ...r, port: 'port 5000 is held by the AirPlay Receiver (ControlCenter): a Flask app that keeps the default port gets AirPlay\'s 403 in the Viewer; set another port in the app' };
					}
				} catch { /* nothing listens on 5000 */ }
			}
		}
		return r;
	},
};
