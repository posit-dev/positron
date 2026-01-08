/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import * as fs from 'fs';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Reticulate - F1 Help', {
	tag: [tags.RETICULATE, tags.WEB, tags.HELP, tags.SOFT_FAIL],
}, () => {
	let reticulateVersionSupported = false;

	test.beforeAll(async function ({ app, sessions, logger }) {
		try {
			// Start R session and check reticulate version
			const { console, variables } = app.workbench;
			await sessions.start('r');

			await console.pasteCodeToConsole('supported <- packageVersion("reticulate") >= "1.44.1.9000"', true);
			await console.waitForExecutionComplete();

			try {
				await variables.expectVariableToBe('supported', 'TRUE');
				reticulateVersionSupported = true;
			} catch (e) {
				logger.log('Reticulate version < 1.44.1.9000 does not support F1 help for Python objects. Tests will be skipped.');
				reticulateVersionSupported = false;
			}
		} catch (e) {
			await app.code.driver.takeScreenshot('reticulateF1HelpSetup');
			throw e;
		}
	});

	test.afterEach(async function ({ app, cleanup }) {
		await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');
		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		// Clear both the console input and output
		await app.workbench.console.clearInput();
		await app.workbench.console.clearButton.click();
		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		await cleanup.removeTestFiles(['reticulate-help-test.R']);
	});

	test('R - Verify F1 help for reticulate Python object method in console', async function ({ app, page }) {
		test.skip(!reticulateVersionSupported, 'Reticulate version < 1.44.1.9000');

		const { console } = app.workbench;

		// Import numpy via reticulate (R session already started in beforeAll)
		await console.pasteCodeToConsole('np <- reticulate::import("numpy")', true);
		await console.waitForExecutionComplete();

		// Type code that uses numpy in the console (without executing)
		await console.pasteCodeToConsole('np$sum(c(1, 2, 3))');

		// Double-click on 'sum' to select it
		await console.doubleClickConsoleText('sum');

		// Press F1 to trigger help
		await page.keyboard.press('F1');

		// Verify numpy.sum help appears
		const helpFrame = await app.workbench.help.getHelpFrame(0);
		await expect(helpFrame.locator('body')).toContainText('numpy.sum', { timeout: 30000 });
	});

	test('R - Verify F1 help for reticulate Python object method in editor', async function ({ app, page }) {
		test.skip(!reticulateVersionSupported, 'Reticulate version < 1.44.1.9000');

		const { console } = app.workbench;

		// Import numpy via reticulate (R session already started in beforeAll)
		await console.pasteCodeToConsole('np <- reticulate::import("numpy")', true);
		await console.waitForExecutionComplete();

		// Create a test R file with reticulate code
		// Using np$mean() instead of np$sum() to ensure the help page changes from the first test
		const testFilePath = join(app.workspacePathOrFolder, 'reticulate-help-test.R');
		const testFileContent = `# Test file for reticulate F1 help
np <- reticulate::import("numpy")
np$mean(c(1, 2, 3))
`;
		fs.writeFileSync(testFilePath, testFileContent);

		// Open the test file
		await app.workbench.quickaccess.openFile(testFilePath);

		// Wait for the file to be fully loaded and the language server to be ready
		await page.waitForTimeout(1000);

		// Find and double-click on 'mean' within the np$mean expression
		// The editor should have 'mean' as a separate token after the '$' operator
		const editorContent = app.code.driver.page.locator('.monaco-editor .view-lines');
		const meanSpan = editorContent.locator('span').filter({ hasText: /^mean$/ }).first();
		await meanSpan.dblclick();

		// Press F1 to trigger help
		await page.keyboard.press('F1');

		// Verify numpy.mean help appears
		const helpFrame = await app.workbench.help.getHelpFrame(0);
		await expect(helpFrame.locator('body')).toContainText('numpy.mean', { timeout: 30000 });
	});
});
