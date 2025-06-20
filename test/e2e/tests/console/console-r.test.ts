/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Console Pane: R', {
	tag: [tags.WEB, tags.CONSOLE, tags.WIN]
}, () => {
	test.beforeAll(async function ({ app }) {
		// Need to make console bigger to see all bar buttons
		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
	});

	test('R - Verify cat from .Rprofile', async function ({ app, r }) {
		await expect(async () => {
			await app.workbench.console.waitForConsoleContents('cat from .Rprofile');
		}).toPass();
	});

	test('R - Verify cancel button on console bar', async function ({ app, r }) {

		await app.workbench.console.pasteCodeToConsole('Sys.sleep(10)');
		await app.workbench.console.sendEnterKey();
		await app.workbench.console.interruptExecution();
		// nothing appears in console after interrupting execution
	});

	test('R - Verify password prompt', async function ({ app, r }) {

		await app.workbench.console.pasteCodeToConsole('out <- rstudioapi::askForPassword("enter password")', true);

		await app.workbench.quickInput.type('password');
		await app.code.driver.page.keyboard.press('Enter');

		await app.workbench.layouts.enterLayout('stacked');
		await app.workbench.layouts.enterLayout('fullSizedAuxBar');

		await expect(async () => {
			const variablesMap = await app.workbench.variables.getFlatVariables();
			expect(variablesMap.get('out')?.value).toBe('"password"');
		}).toPass({ timeout: 20000 });

		await app.workbench.layouts.enterLayout('stacked');
	});

	test('R - Verify console commands are queued during execution', async function ({ app, r }) {
		await app.workbench.console.pasteCodeToConsole('123 + 123');
		await app.workbench.console.executeCode('R', '456 + 456');

		await app.workbench.console.waitForConsoleContents('912', { expectedCount: 1, timeout: 10000 });
		await app.workbench.console.waitForConsoleContents('123 + 123', { expectedCount: 1, timeout: 10000 });
		await app.workbench.console.waitForConsoleContents('246', { expectedCount: 0, timeout: 5000 });

	});
});

