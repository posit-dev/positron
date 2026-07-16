/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../../tests/_test.setup';
import { captureFullWindow } from '../_helpers/screenshot-utils';
import { overrideWorkspaceName, prepareForScreenshot, setScreenshotWindowSize } from '../_helpers/layout-utils';
import { annotate, clearAnnotations } from '../_helpers/annotate-utils';

const ANNOTATION_COLOR = '#dc2626';

test.use({
	suiteId: __filename,
});

test.beforeEach(async ({ app }) => {
	await setScreenshotWindowSize(app, { width: 960, height: 640 });
});

test.afterEach(async ({ page, hotKeys }) => {
	await page.keyboard.press('Escape');
	await clearAnnotations(page);
	await hotKeys.closeAllEditors();
});

test.describe('Release Screenshots - Jupyter Notebooks', () => {
	/**
	 * Img Path: https://positron.posit.co/images/jupyter-notebooks-kernel-selector.png
	 */
	test('Release Screenshot - jupyter-notebooks-kernel-selector.png', async ({ app, page, python }) => {
		const { notebooksPositron, hotKeys, sessions, layouts } = app.workbench;

		// Open a new notebook and select the Python interpreter
		await notebooksPositron.createNewNotebook();
		await notebooksPositron.expectToBeVisible();
		// await notebooksPositron.selectInterpreter('Python');
		await sessions.expectSessionPickerToBe('Untitled-1.ipynb');

		// customize the layout
		await hotKeys.closePrimarySidebar();
		await hotKeys.closeSecondarySidebar();
		await hotKeys.toggleBottomPanel();
		await layouts.expectBottomPanelToBeVisible(false);

		// capture screenshot
		await prepareForScreenshot(app, page);
		await overrideWorkspaceName(page, 'test-files', 'positron-demos-notebooks');
		await annotate(page, [
			{ selector: '.positron-notebook-kernel-status-badge', label: '', color: ANNOTATION_COLOR, padding: 4 },
		]);
		await captureFullWindow(page, 'jupyter-notebooks-kernel-selector.png');
	});
});
