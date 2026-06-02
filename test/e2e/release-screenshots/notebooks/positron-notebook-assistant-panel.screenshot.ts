/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test as base } from '../../tests/_test.setup';
import { captureFullWindow } from '../_helpers/screenshot-utils';
import { overrideWorkspaceName, prepareForScreenshot } from '../_helpers/layout-utils';
import { clearAnnotations } from '../_helpers/annotate-utils';

const test = base.extend({
	beforeApp: [
		async ({ settingsFile }, use) => {
			settingsFile.append({ 'positron.notebook.enabled': true });
			await use();
		},
		{ scope: 'worker' }
	],
});

test.use({
	suiteId: __filename,
});

test.afterEach(async ({ page, hotKeys }) => {
	await page.keyboard.press('Escape');
	await clearAnnotations(page);
	await hotKeys.closeAllEditors();
});

test.describe('Release Screenshots - Positron Notebook Assistant Panel', () => {
	/**
	 * Img Path: https://positron.posit.co/images/positron-notebook-assistant-panel.png
	 */
	test('Release Screenshot - positron-notebook-assistant-panel.png', async ({ app, page, python, settings }) => {
		const { notebooksPositron, hotKeys, layouts } = app.workbench;

		await settings.set({ 'positron.assistant.enable': true }, { keepOpen: false });

		// Open a new notebook and select the Python interpreter
		await notebooksPositron.createNewNotebook();
		await notebooksPositron.expectToBeVisible();
		await notebooksPositron.kernel.select('Python');

		// customize the layout
		await hotKeys.closePrimarySidebar();
		await hotKeys.closeSecondarySidebar();
		await hotKeys.toggleBottomPanel();
		await layouts.expectBottomPanelToBeVisible(false);

		// click the "Ask Assistant" button to open the assistant panel
		await notebooksPositron.clickAskAssistantButton();
		const panel = page.locator('.positron-modal-dialog-box').filter({ hasText: 'Positron Notebook Assistant' });
		await expect(panel).toBeVisible({ timeout: 10000 });

		// capture screenshot
		await prepareForScreenshot(app, page);
		await overrideWorkspaceName(page, 'qa-example-content', 'positron-demos-notebooks');
		await captureFullWindow(page, 'positron-notebook-assistant-panel.png');
	});
});
