/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Plaintext Notebooks', {
	tag: [tags.QUARTO, tags.WEB, tags.WIN]
}, () => {

	test.beforeAll(async function ({ app, settings }) {
		// Enable the experimental plaintext notebook setting
		await settings.set({ 'notebook.plainText.enable': true });
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('parse .qmd command is available when setting enabled', async function ({ app }) {
		const { quickInput } = app.workbench;
		const page = app.code.driver.page;

		// Open command palette
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P');
		await quickInput.waitForQuickInputOpened();

		// Search for the command
		await quickInput.type('>Parse .qmd');

		// Verify the command appears in the results
		await quickInput.expectQuickInputResultsToContain(['Developer: Parse .qmd Content']);

		// Close the quick input
		await quickInput.closeQuickInput();
	});
});
