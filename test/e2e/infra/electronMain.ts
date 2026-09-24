/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Helpers that run in the Electron main process through `electronApp.evaluate`.
//
// The functions passed to `evaluate` are serialized and run in the main process,
// so they cannot close over anything in this file; state they keep lives on the
// main process's globalThis under `__e2e*` keys (see utils/externalUrl.ts for the
// same pattern).

import type { ElectronApplication } from '@playwright/test';
import type { WindowSample } from './windowTimeline';

/**
 * Runners built on esbuild with `keepNames` (tsx) wrap named functions in
 * `__name(...)` calls; serialized into the main process, those reference a
 * helper that does not exist there. A no-op stand-in makes them harmless.
 * Evaluated from a string so the runner cannot rewrite it.
 */
async function ensureNameShim(electronApp: ElectronApplication): Promise<void> {
	await electronApp.evaluate('void (globalThis.__name ??= (fn => fn))');
}

/** A native window as the main process sees it. */
export interface NativeWindow {
	readonly id: number;
	readonly title: string;
	readonly visible: boolean;
	readonly minimized: boolean;
	readonly focused: boolean;
	readonly url: string;
}

/** Every open BrowserWindow with its native visibility state. */
export async function listNativeWindows(electronApp: ElectronApplication): Promise<NativeWindow[]> {
	return electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
		.filter(w => !w.isDestroyed())
		.map(w => ({
			id: w.id,
			title: w.getTitle(),
			visible: w.isVisible(),
			minimized: w.isMinimized(),
			focused: w.isFocused(),
			url: w.webContents.getURL(),
		}))
		.sort((a, b) => a.id - b.id));
}

/**
 * Starts recording native window state in the main process: every window's
 * show/hide/minimize/restore/close events, plus a poll every `pollMs` that
 * catches changes no event reports (a window created visible, a title change).
 * Samples carry absolute timestamps. Idempotent per app instance.
 *
 * Windows created before this call are picked up with their current state, so
 * start it right after launch; a transition that happened earlier is not seen.
 */
export async function startWindowTimeline(electronApp: ElectronApplication, pollMs = 50): Promise<void> {
	await ensureNameShim(electronApp);
	await electronApp.evaluate(({ app, BrowserWindow }, pollMs) => {
		type Sample = { t: number; id: number; event: string; title: string; visible: boolean; minimized: boolean };
		const g = globalThis as typeof globalThis & { __e2eWindowTimeline?: Sample[] };
		if (g.__e2eWindowTimeline) {
			return;
		}
		const samples: Sample[] = g.__e2eWindowTimeline = [];
		const last = new Map<number, string>();
		const record = (w: Electron.BrowserWindow, event: string) => {
			const destroyed = w.isDestroyed();
			const sample: Sample = {
				t: Date.now(),
				id: w.id,
				event,
				title: destroyed ? '' : w.getTitle(),
				visible: !destroyed && w.isVisible(),
				minimized: !destroyed && w.isMinimized(),
			};
			last.set(w.id, `${sample.visible}|${sample.minimized}|${sample.title}`);
			samples.push(sample);
		};
		const watch = (w: Electron.BrowserWindow) => {
			for (const event of ['show', 'hide', 'minimize', 'restore', 'focus', 'ready-to-show'] as const) {
				w.on(event as 'show', () => record(w, event));
			}
			// Capture the id now: a destroyed window throws on property access.
			const id = w.id;
			w.on('closed', () => {
				last.delete(id);
				samples.push({ t: Date.now(), id, event: 'closed', title: '', visible: false, minimized: false });
			});
			record(w, 'created');
		};
		BrowserWindow.getAllWindows().forEach(watch);
		app.on('browser-window-created', (_event, w) => watch(w));
		setInterval(() => {
			for (const w of BrowserWindow.getAllWindows()) {
				if (w.isDestroyed()) {
					continue;
				}
				const key = `${w.isVisible()}|${w.isMinimized()}|${w.getTitle()}`;
				if (last.get(w.id) !== key) {
					record(w, 'poll');
				}
			}
		}, pollMs).unref();
	}, pollMs);
}

/** Everything {@link startWindowTimeline} recorded so far, oldest first. */
export async function readWindowTimeline(electronApp: ElectronApplication): Promise<WindowSample[]> {
	return electronApp.evaluate(() =>
		[...((globalThis as typeof globalThis & { __e2eWindowTimeline?: WindowSample[] }).__e2eWindowTimeline ?? [])]);
}

/**
 * Asks the app to quit the way the Quit menu item does, so shutdown
 * participants run: hot exit backups, state saves, runtime shutdown. Returns
 * once the request is scheduled; wait for the process to exit separately.
 */
export async function requestQuit(electronApp: ElectronApplication): Promise<void> {
	await electronApp.evaluate(({ app }) => {
		setTimeout(() => app.quit(), 0);
	});
}
