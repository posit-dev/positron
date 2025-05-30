/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/*
Summary:
- This test suite verifies the functionality of interpreter commands via Force Quit, Interrupt, and Shutdown for both Python and R.
- Tests confirm that each quick input command triggers the expected behavior, verified through console outputs (see Table below).
- After each test, console is cleared and session is fully deleted. Doing both for each test makes the tests more robust indeed.

 * |Command   |Language|Targeted Console Output    |
 * |----------|--------|---------------------------|
 * |Force Quit|Python  |'was forced to quit'       |
 * |Force Quit|R       |'was forced to quit'       |
 * |Interrupt |Python  |'KeyboardInterrupt'        |
 * |Interrupt |R       |Empty error line (visible) |
 * |Shutdown  |Python  |'exited'                   |
 * |Shutdown  |R       |'exited'                   |
 */

import { test, tags, expect } from '../_test.setup';
import type { TestInfo } from '@playwright/test'; // remove test.skip and TestInfo import after bug #4604 is fixed

test.use({
	suiteId: __filename
});

test.describe('Interpreter Commands (Force Quit, Interrupt, and Shutdown', { tag: [tags.WEB, tags.WIN, tags.INTERPRETER] }, () => {
	test('Verify Force Quit Interpreter command works (→ was forced to quit) - Python', async function ({ app, python }) {
		await app.workbench.quickaccess.runCommand('workbench.action.languageRuntime.forceQuit');
		await app.workbench.console.waitForConsoleContents('was forced to quit');
		await app.workbench.console.clearButton.click();
		await app.workbench.sessions.deleteAll();
	});

	test('Verify Force Quit Interpreter command works (→ was forced to quit) - R', async function ({ app, r }) {
		await app.workbench.quickaccess.runCommand('workbench.action.languageRuntime.forceQuit');
		await app.workbench.console.waitForConsoleContents('was forced to quit');
		await app.workbench.console.clearButton.click();
		await app.workbench.sessions.deleteAll();
	});

	test('Verify Interrupt Interpreter command works (→ KeyboardInterrupt) - Python', async function ({ app, python }, testInfo: TestInfo) {
		// This if statement is to skip e2e-windows due to bug #4604. Once it's fixed, remove if statement (and testInfo parameter)
		if (testInfo.project.name === 'e2e-windows') {
			test.skip();
			return;
		}
		await app.workbench.console.executeCode('Python', 'import time; time.sleep(5)', { waitForReady: false });
		await app.workbench.quickaccess.runCommand('workbench.action.languageRuntime.interrupt');
		await app.workbench.console.waitForConsoleContents('KeyboardInterrupt');
		await app.workbench.console.clearButton.click();
		await app.workbench.sessions.deleteAll();
	});

	test('Verify Interrupt Interpreter command works (→ empty error line) - R', async function ({ app, page, r }) {
		await app.workbench.console.executeCode('R', 'Sys.sleep(5)', { waitForReady: false });
		await app.workbench.quickaccess.runCommand('workbench.action.languageRuntime.interrupt');
		await expect(page.locator('div.activity-error-stream')).toBeVisible();
		await app.workbench.console.clearButton.click();
		await app.workbench.sessions.deleteAll();
	});

	test('Verify Shutdown Interpreter command works (→ sexited) - Python', async function ({ app, python, page }) {
		await app.workbench.console.pasteCodeToConsole('exit()');
		await page.keyboard.press('Enter');
		await app.workbench.console.waitForConsoleContents('exited');
		await app.workbench.console.clearButton.click();
		await app.workbench.sessions.deleteAll();

	});

	test('Verify Shutdown Interpreter command works (→ exited) - R', async function ({ app, r, page }) {
		await app.workbench.console.pasteCodeToConsole('q()');
		await page.keyboard.press('Enter');
		await app.workbench.console.waitForConsoleContents('exited');
		await app.workbench.console.clearButton.click();
		await app.workbench.sessions.deleteAll();
	});
});
