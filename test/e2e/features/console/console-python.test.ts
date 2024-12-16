/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Console Pane: Python', { tag: [tags.WEB, tags.WIN, tags.CONSOLE] }, () => {

	test('Verify restart button inside the console [C377918]', async function ({ app, python }) {
		await expect(async () => {
			await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
			await app.workbench.positronConsole.barClearButton.click();

			// workaround issue where power button click fails
			await app.code.wait(1000);
			await app.workbench.positronConsole.barPowerButton.click();
			await app.workbench.positronConsole.consoleRestartButton.click();

			await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
			await app.workbench.positronConsole.waitForReady('>>>');
			await app.workbench.positronConsole.waitForConsoleContents('restarted');
			await expect(app.workbench.positronConsole.consoleRestartButton).not.toBeVisible();
		}).toPass();
	});

	test('Verify restart button on console bar [C617464]', {
	}, async function ({ app, python }) {
		// Need to make console bigger to see all bar buttons
		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		await app.workbench.positronConsole.barClearButton.click();

		// workaround issue where "started" text never appears post restart
		await app.code.wait(1000);
		await app.workbench.positronConsole.barRestartButton.click();

		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		await app.workbench.positronConsole.waitForReady('>>>');
		await app.workbench.positronConsole.waitForConsoleContents('restarted');
	});
});
