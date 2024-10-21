/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { _electron, test, expect } from '@playwright/test';

test.only('should toggle checkbox', async ({ trace }) => {
	console.log('Current Working Directory:', process.cwd());
	console.log('Command Line Arguments:', process.argv);
	console.log('Environment Variables', process.env);
	const env = process.env;
	console.log('****', process.env.VSCODE_CWD);
	const electronApp = await _electron.launch({ args: ['main.js'] });

	// Get the first window that the app opens, wait if necessary.
	const window = await electronApp.firstWindow();

	// TRACE: manually start trace
	if (trace) { await window.context().tracing.start({ screenshots: true, snapshots: true }); }

	// Direct Electron console to Node terminal.
	window.on('console', console.log);
	await window.getByRole('checkbox').check();
	await window.waitForTimeout(5000);
	await window.getByRole('checkbox').uncheck();
	await window.getByRole('checkbox').check();

	await window.goto('https://playwright.dev/');

	// Expect a title "to contain" a substring.
	await expect(window).toHaveTitle(/Playwright/);

	await window.click('text=Get Started');

	await expect(window).toHaveTitle(/Installation/);


	// TRACE: manually stop trace
	const tracePath = test.info().outputPath('electron-trace.zip');
	if (trace) {
		await window.context().tracing.stop({ path: tracePath });
		test.info().attachments.push({ name: 'trace', path: tracePath, contentType: 'application/zip' });
	}

	// Exit app.
	await electronApp.close();
});
