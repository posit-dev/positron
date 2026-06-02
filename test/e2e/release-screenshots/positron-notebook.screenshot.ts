/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test as base } from '../tests/_test.setup';
import { captureFullWindow } from './helpers/screenshot-utils';
import { overrideWorkspaceName, prepareForScreenshot, setScreenshotWindowSize } from './helpers/layout-utils';
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

test.afterEach(async ({ page, hotKeys }) => {
	await page.keyboard.press('Escape');
	await clearAnnotations(page);
	await hotKeys.closeAllEditors();
});

test.describe('Release Screenshots - Positron Notebook', () => {
	/**
	 * Img Path: https://positron.posit.co/images/positron-notebook-editor-kernel-selector.png
	 */
	test('Release Screenshot - positron-notebook-editor-kernel-selector.png', async ({ app, page, python }) => {
		const { notebooksPositron, hotKeys, layouts } = app.workbench;
		await setScreenshotWindowSize(app, { width: 960, height: 640 });

		// Open a new notebook and select the Python interpreter
		await notebooksPositron.createNewNotebook();
		await notebooksPositron.expectToBeVisible();
		await notebooksPositron.kernel.select('Python');

		// customize the layout
		await hotKeys.closePrimarySidebar();
		await hotKeys.closeSecondarySidebar();
		// toggleBottomPanel is a toggle, not an idempotent close — assert the
		// post-condition so the test fails loudly if a prior step left the
		// panel already closed and the toggle re-opened it.
		await hotKeys.toggleBottomPanel();
		await layouts.expectBottomPanelToBeVisible(false);

		// capture screenshot
		await prepareForScreenshot(app, page);
		await overrideWorkspaceName(page, 'qa-example-content', 'positron-demos-notebooks');
		await annotate(page, [
			{ selector: 'button[aria-label="Kernel Actions"]', label: '', color: ANNOTATION_COLOR, padding: 3 },
		]);
		await captureFullWindow(page, 'positron-notebook-editor-kernel-selector.png');
	});

	/**
	 * Img Path: https://positron.posit.co/images/positron-notebook-assistant-action-bar.png
	 */
	test('Release Screenshot - positron-notebook-assistant-action-bar.png', async ({ app, page, python, settings }) => {
		const { notebooksPositron, hotKeys, layouts } = app.workbench;
		await setScreenshotWindowSize(app, { width: 960, height: 640 });

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

		// button is gated on config.positron.assistant.enable; wait for it to render.
		await notebooksPositron.expectAssistantButtonsVisible();

		// capture screenshot
		await prepareForScreenshot(app, page);
		await overrideWorkspaceName(page, 'qa-example-content', 'positron-demos-notebooks');
		await annotate(page, [
			{ selector: '.editor-action-bar-container button[aria-label="Ask Assistant"]', label: '', color: ANNOTATION_COLOR, padding: 3 },
		]);
		await captureFullWindow(page, 'positron-notebook-assistant-action-bar.png');
	});

	/**
	 * Img Path: https://positron.posit.co/images/positron-notebook-assistant-panel.png
	 */
	test('Release Screenshot - positron-notebook-assistant-panel.png', async ({ app, page, python, settings }) => {
		const { notebooksPositron, hotKeys, layouts } = app.workbench;
		await setScreenshotWindowSize(app, { width: 960, height: 640 });

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

	/**
	 * Img Path: https://positron.posit.co/images/positron-notebook.png
	 *
	 * Full notebook view: code cell + matplotlib chart output, assistant
	 * panel visible on the left, variables panel on the right.
	 */
	test('Release Screenshot - positron-notebook.png', async ({ app, page, settings, python }) => {
		const { notebooksPositron, variables, hotKeys, layouts } = app.workbench;

		await settings.set({ 'positron.assistant.enable': true }, { keepOpen: false });

		// Open a new notebook and select the Python interpreter
		await notebooksPositron.createNewNotebook();
		await notebooksPositron.expectToBeVisible();
		await notebooksPositron.kernel.select('Python');

		// Build a small chart-producing cell. Inline string instead of split-and-join
		// because each line starts in column 0 (no leading-space hygiene issue).
		const code = [
			'import matplotlib.pyplot as plt',
			'import pandas as pd',
			'',
			'months = ["2024-11", "2024-12", "2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08"]',
			'daily_energy = pd.DataFrame({"month": months, "kwh": [1100, 1450, 1800, 1900, 1700, 1300, 1150, 1200, 1850, 1300]})',
			'monthly_avg = daily_energy.set_index("month")',
			'',
			'fig, ax = plt.subplots(figsize=(8, 4))',
			'ax.bar(monthly_avg.index, monthly_avg["kwh"], color="#5b8def")',
			'ax.set_title("Monthly Electricity Usage (kWh)")',
			'ax.set_xlabel("Month")',
			'ax.set_ylabel("kWh")',
			'plt.tight_layout()',
			'plt.show()',
		].join('\n');
		await notebooksPositron.addCodeToCell(0, code, { fast: true });

		// Run manually + wait for the rendered chart instead of the spinner.
		// matplotlib + pandas cold-start can exceed runCodeAtIndex's 10s
		// DEFAULT_TIMEOUT on CI, and asserting on the image is a stronger check.
		// Scope to the cell-output testid so Monaco's overview-ruler canvas
		// inside the cell editor doesn't match first.
		const cell = page.locator('[data-testid="notebook-cell"]').first();
		await cell.getByRole('button', { name: 'Run Cell', exact: true }).click();
		await expect(cell.getByTestId('cell-output').locator('img, canvas').first()).toBeVisible({ timeout: 60_000 });

		// Customize layout: close primary sidebar (file explorer), keep secondary
		// side bar visible (variables), close bottom panel.
		await hotKeys.closePrimarySidebar();
		await hotKeys.toggleBottomPanel();
		await layouts.expectBottomPanelToBeVisible(false);

		// Make sure variables view is visible on the right.
		await variables.focusVariablesView();

		// capture screenshot
		await prepareForScreenshot(app, page);
		await overrideWorkspaceName(page, 'qa-example-content', 'positron-demos-notebooks');
		await captureFullWindow(page, 'positron-notebook.png');
	});
});
