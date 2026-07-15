/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { join } from 'path';
import { test } from '../../tests/_test.setup';
import { captureFullWindow } from '../_helpers/screenshot-utils';
import { prepareForScreenshot, setScreenshotWindowSize } from '../_helpers/layout-utils';
import { annotate, clearAnnotations } from '../_helpers/annotate-utils';

const ANNOTATION_COLOR = '#dc2626';

test.use({
	suiteId: __filename,
});

test.afterEach(async ({ page, hotKeys }) => {
	await clearAnnotations(page);
	await hotKeys.closeAllEditors();
});

test.describe('Release Screenshots - Run App Button', () => {
	/**
	 * Img Path: https://positron.posit.co/images/run-app-button.png
	 *
	 * A Streamlit app file open in the editor with the "Run app" button in the
	 * editor action bar called out.
	 */
	test('Release Screenshot - run-app-button.png', async ({ app, page, openFile, python, hotKeys, runCommand }) => {
		const { editor, sessions, layouts } = app.workbench;

		await setScreenshotWindowSize(app, { width: 960, height: 640 });
		await sessions.expectAllSessionsToBeReady();

		// Open the Streamlit app file
		await openFile(join('workspaces', 'python_apps', 'streamlit_example', 'streamlit_example.py'));
		await expect(editor.playButton).toBeVisible();

		// customize layout
		await hotKeys.focusPreviewPanel();
		await hotKeys.closePrimarySidebar();
		await layouts.resizePanel({ y: -50 });
		await page.getByRole('tab', { name: 'streamlit_example.py' }).click();

		// capture screenshot
		await prepareForScreenshot(app, page);
		await annotate(page, [
			{ selector: '.action-bar-button:has(.codicon-play)', label: '', color: ANNOTATION_COLOR, padding: 4 },
		]);
		await captureFullWindow(page, 'run-app-button.png');
	});
});
