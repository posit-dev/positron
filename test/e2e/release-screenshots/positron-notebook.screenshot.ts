/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test as base } from '../tests/_test.setup';
import { applyDropShadow, captureFullWindow } from './helpers/screenshot-utils';
import { prepareForScreenshot, setScreenshotWindowSize } from './helpers/layout-utils';
import { annotate, clearAnnotations } from './helpers/annotate-utils';

const ANNOTATION_COLOR = '#dc2626';

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

test.beforeEach(async ({ app }) => {
	await setScreenshotWindowSize(app, { width: 960, height: 640 });
});

test.afterEach(async ({ app, page }) => {
	await page.keyboard.press('Escape');
	await clearAnnotations(page);
	await app.workbench.hotKeys.closeAllEditors();
});

test.describe('Release Screenshots - Positron Notebook', () => {
	/**
	 * Img Path: https://positron.posit.co/images/positron-notebook-editor-kernel-selector.png
	 */
	test('Release Screenshot - positron-notebook-editor-kernel-selector.png', async ({ app, page, python }) => {
		const { notebooksPositron, hotKeys } = app.workbench;

		await notebooksPositron.createNewNotebook();
		await notebooksPositron.expectToBeVisible();
		await notebooksPositron.kernel.select('Python');

		await hotKeys.closePrimarySidebar();
		await hotKeys.closeSecondarySidebar();
		await hotKeys.toggleBottomPanel();

		await prepareForScreenshot(app, page);
		await annotate(page, [
			{ selector: 'button[aria-label="Kernel Actions"]', label: '', color: ANNOTATION_COLOR, padding: 3 },
		]);
		await captureFullWindow(page, 'positron-notebook-editor-kernel-selector.png');
		await applyDropShadow('positron-notebook-editor-kernel-selector.png');
	});

	/**
	 * Img Path: https://positron.posit.co/images/positron-notebook-assistant-action-bar.png
	 */
	test('Release Screenshot - positron-notebook-assistant-action-bar.png', async ({ app, page, python, settings }) => {
		const { notebooksPositron, hotKeys } = app.workbench;

		await settings.set({ 'positron.assistant.enable': true }, { keepOpen: false });

		await notebooksPositron.createNewNotebook();
		await notebooksPositron.expectToBeVisible();
		await notebooksPositron.kernel.select('Python');

		await hotKeys.closePrimarySidebar();
		await hotKeys.closeSecondarySidebar();
		await hotKeys.toggleBottomPanel();

		// The button is gated on config.positron.assistant.enable; wait for it to render.
		const assistantButton = page.locator('.editor-action-bar-container button[aria-label="Ask Assistant"]');
		await expect(assistantButton).toBeVisible({ timeout: 10000 });

		await prepareForScreenshot(app, page);
		await annotate(page, [
			{ selector: '.editor-action-bar-container button[aria-label="Ask Assistant"]', label: '', color: ANNOTATION_COLOR, padding: 3 },
		]);
		await captureFullWindow(page, 'positron-notebook-assistant-action-bar.png');
		await applyDropShadow('positron-notebook-assistant-action-bar.png');
	});

	/**
	 * Img Path: https://positron.posit.co/images/positron-notebook-assistant-panel.png
	 */
	test('Release Screenshot - positron-notebook-assistant-panel.png', async ({ app, page, python, settings }) => {
		const { notebooksPositron, hotKeys } = app.workbench;

		await settings.set({ 'positron.assistant.enable': true }, { keepOpen: false });

		await notebooksPositron.createNewNotebook();
		await notebooksPositron.expectToBeVisible();
		await notebooksPositron.kernel.select('Python');

		await hotKeys.closePrimarySidebar();
		await hotKeys.closeSecondarySidebar();
		await hotKeys.toggleBottomPanel();

		const assistantButton = page.locator('.editor-action-bar-container button[aria-label="Ask Assistant"]');
		await expect(assistantButton).toBeVisible({ timeout: 10000 });
		await assistantButton.click();

		const panel = page.locator('.positron-modal-dialog-box').filter({ hasText: 'Positron Notebook Assistant' });
		await expect(panel).toBeVisible({ timeout: 10000 });

		await prepareForScreenshot(app, page);
		await captureFullWindow(page, 'positron-notebook-assistant-panel.png');
		await applyDropShadow('positron-notebook-assistant-panel.png');
	});
});
