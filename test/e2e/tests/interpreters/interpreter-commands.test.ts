/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/*
Summary:
- This test suite verifies the functionality of interpreter commands via Force Quit, Interrupt, and Shutdown for both Python and R.
- Tests confirm that each quick input command triggers the expected behavior, verified through console outputs (see Table below).
- After each test, console is cleared and session is fully deleted. Doing both for each test makes the tests more robust indeed.
- Additional tests, as shown below, have been included for verifying clear interpreter, rename active session, and show interpreter
output for both Python and R.

 * |Command   |Language|Targeted Console Output    |
 * |----------|--------|---------------------------|
 * |Force Quit|Python  |'was forced to quit'       |
 * |Force Quit|R       |'was forced to quit'       |
 * |Interrupt |Python  |'KeyboardInterrupt'        |
 * |Interrupt |R       |Empty error line (visible) |
 * |Shutdown  |Python  |'exited'                   |
 * |Shutdown  |R       |'exited'                   |
 * |Clear     |Python  |'int... has been cleared'  |
 * |Clear     |R       |'int... has been cleared'  |
 * |Rename Act|Python  |'RenamedActive_Python'     |
 * |Rename Act|R       |'RenamedActive_R'          |
 * |ShowOutput|Python  |'[Python]'                 |
 * |ShowOutput|R       |'[R]'                      |
 */

import { test, tags, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Interpreter Commands (Force Quit, Interrupt, Shutdown, Clear Interpreter, and Rename Active Session', {
	tag: [tags.WEB, tags.INTERPRETER]
}, () => {

	test.afterEach(async ({ app }) => {
		await app.workbench.console.clearButton.click();
		await app.workbench.sessions.deleteAll();
	});

	test('Verify Force Quit Interpreter command works (→ was forced to quit) - Python', { tag: [tags.WIN] }, async function ({ app, python }) {
		await app.workbench.quickaccess.runCommand('workbench.action.languageRuntime.forceQuit');
		await app.workbench.console.waitForConsoleContents('was forced to quit');
	});

	test('Verify Force Quit Interpreter command works (→ was forced to quit) - R', { tag: [tags.WIN] }, async function ({ app, r }) {
		await app.workbench.quickaccess.runCommand('workbench.action.languageRuntime.forceQuit');
		await app.workbench.console.waitForConsoleContents('was forced to quit');
	});

	// Skip this test for tags.WIN (e2e-windows) due to Bug #4604
	test('Verify Interrupt Interpreter command works (→ KeyboardInterrupt) - Python', async function ({ app, python }) {
		await app.workbench.console.executeCode('Python', 'import time; time.sleep(5)', { waitForReady: false });
		await app.workbench.quickaccess.runCommand('workbench.action.languageRuntime.interrupt');
		await app.workbench.console.waitForConsoleContents('KeyboardInterrupt');
	});

	test('Verify Interrupt Interpreter command works (→ empty error line) - R', { tag: [tags.WIN] }, async function ({ app, page, r }) {
		await app.workbench.console.executeCode('R', 'Sys.sleep(5)', { waitForReady: false });
		await app.workbench.quickaccess.runCommand('workbench.action.languageRuntime.interrupt');
		await expect(page.locator('div.activity-error-stream')).toBeVisible();
	});

	test('Verify Shutdown Interpreter command works (→ exited) - Python', { tag: [tags.WIN] }, async function ({ app, python, page }) {
		await app.workbench.console.pasteCodeToConsole('exit()');
		await page.keyboard.press('Enter');
		await app.workbench.console.waitForConsoleContents('exited');
	});

	test('Verify Shutdown Interpreter command works (→ exited) - R', { tag: [tags.WIN] }, async function ({ app, r, page }) {
		await app.workbench.console.pasteCodeToConsole('q()');
		await page.keyboard.press('Enter');
		await app.workbench.console.waitForConsoleContents('exited');
	});

	test('Verify Clear Saved Interpreter command works (→ interpreter has been cleared) - Python', { tag: [tags.WIN] }, async function ({ app, python, page }) {
		await app.workbench.quickaccess.runCommand('workbench.action.languageRuntime.clearAffiliatedRuntime', { keepOpen: true });
		await app.workbench.quickInput.waitForQuickInputOpened();
		const anyPythonSession = app.workbench.quickInput.quickInputList.getByText(/Python:/);
		await anyPythonSession.waitFor({ state: 'visible' });
		await page.keyboard.press('Enter');
		await app.workbench.quickInput.waitForQuickInputClosed();
		await app.workbench.popups.toastLocator
			.locator('span', { hasText: /(Python|interpreter has been cleared)/ })
			.waitFor({ state: 'visible', timeout: 2000 });
	});

	test('Verify Clear Saved Interpreter command works (→ interpreter has been cleared) - R', { tag: [tags.WIN] }, async function ({ app, r, page }) {
		await app.workbench.quickaccess.runCommand('workbench.action.languageRuntime.clearAffiliatedRuntime', { keepOpen: true });
		await app.workbench.quickInput.waitForQuickInputOpened();
		const anyRSession = app.workbench.quickInput.quickInputList.getByText(/R:/);
		await anyRSession.waitFor({ state: 'visible' });
		await page.keyboard.press('Enter');
		await app.workbench.quickInput.waitForQuickInputClosed();
		await app.workbench.popups.toastLocator
			.locator('span', { hasText: /(R|interpreter has been cleared)/ })
			.waitFor({ state: 'visible', timeout: 2000 });
	});

	test('Verify Rename Active Session command works (→ RenamedActive_Python) - Python', { tag: [tags.WIN] }, async function ({ app, python, page }) {
		await app.workbench.quickaccess.runCommand('workbench.action.language.runtime.renameActiveSession', { keepOpen: true });
		await app.workbench.quickInput.waitForQuickInputOpened();
		await app.workbench.quickInput.type('RenamedActive_Python');
		await page.keyboard.press('Enter');
		await app.workbench.quickInput.waitForQuickInputClosed();
		const renamedInterpreter = page.getByRole('button', {
			name: 'Select Interpreter Session'
		}).locator('.action-bar-button-label', { hasText: 'RenamedActive_Python' });
		await renamedInterpreter.waitFor({ state: 'visible' });
	});

	test('Verify Rename Active Session command works (→ RenamedActive_R) - R', { tag: [tags.WIN] }, async function ({ app, r, page }) {
		await app.workbench.quickaccess.runCommand('workbench.action.language.runtime.renameActiveSession', { keepOpen: true });
		await app.workbench.quickInput.waitForQuickInputOpened();
		await app.workbench.quickInput.type('RenamedActive_R');
		await page.keyboard.press('Enter');
		await app.workbench.quickInput.waitForQuickInputClosed();
		const renamedInterpreter = page.getByRole('button', {
			name: 'Select Interpreter Session'
		}).locator('.action-bar-button-label', { hasText: 'RenamedActive_R' });
		await renamedInterpreter.waitFor({ state: 'visible' });
	});
});

test.describe('Interpreter Commands: Show Active Interpreter Session Output', {
	tag: [tags.WEB, tags.INTERPRETER, tags.WIN]
}, () => {

	test('Verify Show Active Interpreter Session Output command works (→ [Python]) - Python', async function ({ app, python, page }) {
		await app.workbench.quickaccess.runCommand('workbench.action.languageRuntime.showOutput', { keepOpen: false });
		await expect(page.getByText('[Python] [', { exact: false }).first()).toBeVisible();
	});

	test('Verify Show Active Interpreter Session Output command works (→ [R]) - R', async function ({ app, r, page }) {
		await app.workbench.quickaccess.runCommand('workbench.action.languageRuntime.showOutput', { keepOpen: false });
		await expect(page.getByText('[R] [', { exact: false }).first()).toBeVisible();
	});

});

/*
A couple questions for next week:
1. What would be relevant to add to the POM here? Any suggestions are welcome. Or anything I used that I could have adopted from the codebase?
*/
