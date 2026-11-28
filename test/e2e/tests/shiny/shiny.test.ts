/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Shiny Application', { tag: [tags.APPS, tags.VIEWER, tags.WIN, tags.WEB] }, () => {

	// No longer need to install Shiny extension

	test.afterEach(async function ({ app }) {
		await app.workbench.terminal.sendKeysToTerminal('Control+C');
		await app.workbench.viewer.refreshViewer();
	});

	test('Python - Verify Basic Shiny App', { tag: [tags.PYTHON] }, async function ({ app, page, python }) {
		await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'shiny-py-example', 'app.py'));
		await app.workbench.quickaccess.runCommand('shiny.python.runApp');
		await app.workbench.viewer.expectContentVisible(content => content.locator('h1', { hasText: 'Restaurant tipping' }), {
			// Check if "Keep waiting" button appears and click it if present
			onRetry: async () => {
				const keepWaitingButton = app.workbench.toasts.getOptionButton('Keep waiting');
				if (await keepWaitingButton.isVisible().catch(() => false)) {
					await keepWaitingButton.click();
				}
			}
		});

		// Verify the interrupt button is visible and works
		const interruptButton = page.locator('.positron-action-bar').getByRole('button', { name: 'Interrupt execution' });
		await expect(interruptButton).toBeVisible({ timeout: 10000 });
		await interruptButton.click();
		await expect(interruptButton).not.toBeVisible({ timeout: 5000 });
	});

	test('R - Verify Basic Shiny App', {
		tag: [tags.ARK]
	}, async function ({ app, r }) {
		const code = `library(shiny)
runExample("01_hello")`;
		await app.workbench.console.pasteCodeToConsole(code);
		await app.workbench.console.sendEnterKey();
		await app.workbench.viewer.expectContentVisible(content => content.locator('h1', { hasText: 'Hello Shiny!' }));
	});
});

