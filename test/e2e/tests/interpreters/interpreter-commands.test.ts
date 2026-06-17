/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/*
Summary:
- This test suite verifies the functionality of interpreter commands via Interrupt and Clear for both Python and R.
- Tests confirm that each quick input command triggers the expected behavior, verified through console outputs (see Table below).
- After each test, the session is fully deleted.

 * |Command   |Language|Targeted Console Output    |
 * |----------|--------|---------------------------|
 * |Interrupt |Python  |'KeyboardInterrupt'        |
 * |Interrupt |R       |Empty error line (visible) |
 * |Clear     |Python  |'int... has been cleared'  |
 * |Clear     |R       |'int... has been cleared'  |
 */

import { test, tags, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Interpreter Commands (Force Quit, Interrupt, Shutdown, Clear Interpreter, and Rename Active Session', {
	tag: [tags.WEB, tags.INTERPRETER]
}, () => {

	test.afterEach(async ({ app }) => {
		await app.workbench.sessions.deleteAll();
	});

	test('R - Verify Clear Saved Interpreter command works', { tag: [tags.WIN] }, async function ({ app, page, runCommand, sessions }) {
		const { quickInput, toasts } = app.workbench;

		await sessions.start('r');
		await runCommand('workbench.action.languageRuntime.clearAffiliatedRuntime', { keepOpen: true });
		await quickInput.waitForQuickInputOpened();
		const anyRSession = app.workbench.quickInput.quickInputList.getByText(/R:/);
		await anyRSession.waitFor({ state: 'visible' });
		await page.keyboard.press('Enter');
		await quickInput.waitForQuickInputClosed();
		await toasts.expectToastWithTitle(/R .* interpreter has been cleared/);
	});

	test('R - Verify Interrupt Interpreter command works', { tag: [tags.WIN] }, async function ({ app, page, runCommand, sessions }) {
		const { console } = app.workbench;

		await sessions.start('r');
		await console.executeCode('R', 'Sys.sleep(5)', { waitForReady: false });
		await runCommand('workbench.action.languageRuntime.interrupt');
		await expect(page.locator('div.activity-error-stream')).toBeVisible();
	});

	// Skip this test for tags.WIN (e2e-windows) due to Bug #4604
	test('Python - Verify Interrupt Interpreter command works', async function ({ app, runCommand, sessions }) {
		const { console } = app.workbench;

		await sessions.start('python');
		await console.executeCode('Python', 'import time; time.sleep(5)', { waitForReady: false });
		await runCommand('workbench.action.languageRuntime.interrupt');
		await console.waitForConsoleContents('KeyboardInterrupt');
	});

	test('Python - Verify Clear Saved Interpreter command works', { tag: [tags.WIN] }, async function ({ app, page, runCommand, sessions }) {
		const { quickInput, toasts } = app.workbench;

		await sessions.start('python');
		await runCommand('workbench.action.languageRuntime.clearAffiliatedRuntime', { keepOpen: true });
		await quickInput.waitForQuickInputOpened();
		const anyPythonSession = app.workbench.quickInput.quickInputList.getByText(/Python:/);
		await anyPythonSession.waitFor({ state: 'visible' });
		await page.keyboard.press('Enter');
		await quickInput.waitForQuickInputClosed();
		await toasts.expectToastWithTitle(/Python .* interpreter has been cleared/);
	});
});
