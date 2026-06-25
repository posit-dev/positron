/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test as base } from '../../tests/_test.setup';
import { captureFullWindow } from '../_helpers/screenshot-utils';
import { overrideWorkspaceName, prepareForScreenshot, setScreenshotWindowSize } from '../_helpers/layout-utils';
import { clearAnnotations } from '../_helpers/annotate-utils';

// The Positron notebook editor is enabled by default in the pre-release builds
// these screenshots run against, so no settings override is needed here.
const test = base;

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
		await setScreenshotWindowSize(app, { width: 960, height: 640 });

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
		await notebooksPositron.expectNotebookAssistantModalVisible();

		// capture screenshot
		await prepareForScreenshot(app, page);
		await overrideWorkspaceName(page, 'qa-example-content', 'positron-demos-notebooks');
		await captureFullWindow(page, 'positron-notebook-assistant-panel.png');
	});
});
