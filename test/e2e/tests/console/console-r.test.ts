/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Console Pane: R', {
	tag: [tags.WEB, tags.WIN, tags.CONSOLE]
}, () => {
	test.beforeAll(async function ({ app }) {
		// Need to make console bigger to see all bar buttons
		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
	});

	test('Verify restart button inside the console [C377917]', async function ({ app, r }) {
		await expect(async () => {
			await app.workbench.console.barClearButton.click();
			await app.workbench.console.barPowerButton.click();
			await app.workbench.console.consoleRestartButton.click();
			await app.workbench.console.waitForReadyAndRestarted('>');
			await expect(app.workbench.console.consoleRestartButton).not.toBeVisible();
		}).toPass();
	});

	test('Verify restart button on console bar [C620636]', async function ({ app, r }) {
		await expect(async () => {
			await app.workbench.console.barClearButton.click();
			await app.workbench.console.barRestartButton.click();
			await app.workbench.console.waitForReadyAndRestarted('>');
		}).toPass();
	});

	test('Verify cancel button on console bar [C...]', {
	}, async function ({ app, r }) {

		await app.workbench.console.pasteCodeToConsole('Sys.sleep(10)');
		await app.workbench.console.sendEnterKey();

		await app.workbench.console.interruptExecution();

		// nothing appears in console after interrupting execution
	});
});

