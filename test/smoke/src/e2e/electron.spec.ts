/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { _electron, test, expect } from '@playwright/test';

test('has title', async ({ trace }) => {
	const electronApp = await _electron.launch({ args: ['main.js'] });

	// Get the first window that the app opens, wait if necessary.
	const window = await electronApp.firstWindow();

	// TRACE: manually start trace
	if (trace) { await window.context().tracing.start({ screenshots: true, snapshots: true }); }

	// Direct Electron console to Node terminal.
	window.on('console', console.log);

	await window.goto('https://playwright.dev/');

	// Expect a title "to contain" a substring.
	await expect(window).toHaveTitle(/Playwright/);

	await window.click('text=Get Started');

	await expect(window).toHaveTitle(/Installation/);


	// TRACE: manually stop trace
	const path = test.info().outputPath('electron-trace.zip');
	if (trace) {
		await window.context().tracing.stop({ path });
		test.info().attachments.push({ name: 'trace', path, contentType: 'application/zip' });
	}

	// Exit app.
	await electronApp.close();
});
