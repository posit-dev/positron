/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/*
Summary:
- This test suite verifies the functionality of interpreter commands via Interrupt and Clear for both Python and R.
- Tests confirm that each quick input command triggers the expected behavior, verified through console outputs (see Table below).
- After each test, console is cleared and session is fully deleted. Doing both for each test makes the tests more robust indeed.

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
		await app.positron.console.clearButton.click();
		await app.positron.sessions.deleteAll();
	});

	// Skip this test for tags.WIN (e2e-windows) due to Bug #4604
	test('Verify Interrupt Interpreter command works (→ KeyboardInterrupt) - Python', async function ({ app, python }) {
		await app.positron.console.executeCode('Python', 'import time; time.sleep(5)', { waitForReady: false });
		await app.positron.quickaccess.runCommand('workbench.action.languageRuntime.interrupt');
		await app.positron.console.waitForConsoleContents('KeyboardInterrupt');
	});

	test('Verify Interrupt Interpreter command works (→ empty error line) - R', { tag: [tags.WIN] }, async function ({ app, page, r }) {
		await app.positron.console.executeCode('R', 'Sys.sleep(5)', { waitForReady: false });
		await app.positron.quickaccess.runCommand('workbench.action.languageRuntime.interrupt');
		await expect(page.locator('div.activity-error-stream')).toBeVisible();
	});

	test('Verify Clear Saved Interpreter command works (→ interpreter has been cleared) - Python', { tag: [tags.WIN] }, async function ({ app, python, page }) {
		await app.positron.quickaccess.runCommand('workbench.action.languageRuntime.clearAffiliatedRuntime', { keepOpen: true });
		await app.positron.quickInput.waitForQuickInputOpened();
		const anyPythonSession = app.positron.quickInput.quickInputList.getByText(/Python:/);
		await anyPythonSession.waitFor({ state: 'visible' });
		await page.keyboard.press('Enter');
		await app.positron.quickInput.waitForQuickInputClosed();
		await app.positron.toasts.expectToBeVisible(/Python .* interpreter has been cleared/);

	});

	test('Verify Clear Saved Interpreter command works (→ interpreter has been cleared) - R', { tag: [tags.WIN] }, async function ({ app, r, page }) {
		await app.positron.quickaccess.runCommand('workbench.action.languageRuntime.clearAffiliatedRuntime', { keepOpen: true });
		await app.positron.quickInput.waitForQuickInputOpened();
		const anyRSession = app.positron.quickInput.quickInputList.getByText(/R:/);
		await anyRSession.waitFor({ state: 'visible' });
		await page.keyboard.press('Enter');
		await app.positron.quickInput.waitForQuickInputClosed();
		await app.positron.toasts.expectToBeVisible(/R .* interpreter has been cleared/);
	});

});
