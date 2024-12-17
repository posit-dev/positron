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
			await app.workbench.positronConsole.barClearButton.click();
			await app.workbench.positronConsole.barPowerButton.click();
			await app.workbench.positronConsole.consoleRestartButton.click();
			await app.workbench.positronConsole.waitForReady('>');
			await app.workbench.positronConsole.waitForConsoleContents('restarted');
			await expect(app.workbench.positronConsole.consoleRestartButton).not.toBeVisible();
		}).toPass();
	});

	test('Verify restart button on console bar [C620636]', async function ({ app, r }) {
		await expect(async () => {
			await app.workbench.positronConsole.barClearButton.click();
			await app.workbench.positronConsole.barRestartButton.click();
			await app.workbench.positronConsole.waitForReady('>');
			await app.workbench.positronConsole.waitForConsoleContents('restarted');
		}).toPass();
	});

	test('Verify cancel button on console bar [C...]', {
	}, async function ({ app, r }) {

		await app.workbench.positronConsole.pasteCodeToConsole('Sys.sleep(10)');
		await app.workbench.positronConsole.sendEnterKey();

		await app.workbench.positronConsole.interruptExecution();

		// nothing appears in console after interrupting execution
	});
});

