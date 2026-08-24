/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, ElectronApplication } from '@playwright/test';

// Captures the URLs Positron hands to the system browser.
//
// `vscode.env.openExternal` ends up at `shell.openExternal` in the Electron main process
// (nativeHostMainService.ts), which launches the OS default browser -- a process Playwright
// has no handle on. A test that needs to *drive* what opens there (an OAuth authorize URL
// carrying state and a PKCE challenge it cannot reconstruct) has to intercept the call
// instead. Patching the main process is an established pattern in this suite; see
// dialog-contextMenu.ts, which reaches into `app` the same way.
//
// Swallowing the call is deliberate: nothing should spawn a real browser on a CI machine.

/** Key on the main process's globalThis where intercepted URLs accumulate. */
type UrlStore = typeof globalThis & { __e2eExternalUrls?: string[] };

/**
 * Starts recording (and suppressing) `shell.openExternal` calls, clearing anything a
 * previous arm captured. Call this *before* the action that triggers the open.
 *
 * The patch is not reverted: it stays in place for the life of the app instance, so any
 * later external open in the same suite is swallowed too. That is the intended trade --
 * restoring it would race with an in-flight sign-in, and nothing in the suite wants a real
 * browser window anyway.
 */
export async function armExternalUrlCapture(electronApp: ElectronApplication): Promise<void> {
	await electronApp.evaluate(({ shell }) => {
		const store = globalThis as UrlStore;
		if (store.__e2eExternalUrls) {
			// Already patched by an earlier arm; just reset the buffer. Re-patching would
			// stack wrappers and leak the previous one for the life of the app.
			store.__e2eExternalUrls.length = 0;
			return;
		}
		store.__e2eExternalUrls = [];
		shell.openExternal = async (url: string) => {
			(globalThis as UrlStore).__e2eExternalUrls?.push(url);
		};
	});
}

/**
 * Waits for a captured URL matching `pattern` and returns it.
 *
 * @param pattern Matched against each captured URL.
 * @param timeout How long to wait for a match (default 30s).
 */
export async function waitForExternalUrl(
	electronApp: ElectronApplication,
	pattern: RegExp,
	timeout = 30000
): Promise<string> {
	let match: string | undefined;

	await expect.poll(async () => {
		const urls = await electronApp.evaluate(() => (globalThis as UrlStore).__e2eExternalUrls ?? []);
		match = urls.find(url => pattern.test(url));
		return match !== undefined;
	}, {
		timeout,
		// Do not report the captured URLs on failure: they can carry auth state.
		message: `Timed out waiting for an external URL matching ${pattern}`,
	}).toBe(true);

	return match!;
}
