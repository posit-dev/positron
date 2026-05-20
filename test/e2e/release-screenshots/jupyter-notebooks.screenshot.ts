/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../tests/_test.setup';
import { captureFullWindow } from './helpers/screenshot-utils';
import { prepareForScreenshot, setScreenshotWindowSize } from './helpers/layout-utils';
import { annotate, clearAnnotations } from './helpers/annotate-utils';

const ANNOTATION_COLOR = '#dc2626';

test.use({
	suiteId: __filename,
});

test.beforeEach(async ({ app }) => {
	await setScreenshotWindowSize(app, { width: 1104, height: 744 });
});

test.afterEach(async ({ app, page }) => {
	await page.keyboard.press('Escape');
	await clearAnnotations(page);
	await app.workbench.hotKeys.closeAllEditors();
});

test.describe('Release Screenshots - Jupyter Notebooks', () => {
	/**
	 * Img Path: https://positron.posit.co/images/jupyter-notebooks-kernel-selector.png
	 */
	test('Release Screenshot - jupyter-notebooks-kernel-selector.png', async ({ app, page, python }) => {
		const { notebooksVscode, hotKeys } = app.workbench;

		await notebooksVscode.createNewNotebook();
		await notebooksVscode.expectToBeVisible();
		await notebooksVscode.selectInterpreter('Python');

		await hotKeys.closePrimarySidebar();
		await hotKeys.closeSecondarySidebar();
		await hotKeys.toggleBottomPanel();

		await prepareForScreenshot(app, page);
		await annotate(page, [
			// Wrap the whole kernel-action-view-item so the icon stays inside the box.
			{ selector: '.kernel-action-view-item', label: '', color: ANNOTATION_COLOR, padding: 3 },
		]);
		await captureFullWindow(page, 'jupyter-notebooks-kernel-selector.png');
	});
});
