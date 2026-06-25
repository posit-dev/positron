/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { join } from 'path';
import { test } from '../../tests/_test.setup';
import { captureFullWindow } from '../_helpers/screenshot-utils';
import { overrideWorkspaceName, prepareForScreenshot, setScreenshotWindowSize } from '../_helpers/layout-utils';
import { annotate, clearAnnotations } from '../_helpers/annotate-utils';

const ANNOTATION_COLOR = '#dc2626';

// The Positron notebook editor is enabled by default in the pre-release builds
// these screenshots run against, so no settings override is needed here.
test.use({
	suiteId: __filename,
});

test.afterEach(async ({ page, hotKeys, cleanup }) => {
	await page.keyboard.press('Escape');
	await clearAnnotations(page);
	await hotKeys.closeAllEditors();
	await cleanup.discardAllChanges();
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
			{ selector: 'button[aria-label="Kernel Actions"]', label: '', color: ANNOTATION_COLOR, padding: 6 },
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
	 * Img Path: https://positron.posit.co/images/positron-notebook.png
	 *
	 * Energy-data notebook with bar chart output, assistant chat open on the
	 * left having responded to "Tell me about this notebook", variables on right.
	 */
	test('Release Screenshot - positron-notebook.png', async ({ app, page, settings, python }) => {
		const { notebooksPositron, variables, hotKeys, layouts, plots, quickaccess, quickInput, editors, positAssistant, assistant } = app.workbench;

		await settings.set({
			'positron.assistant.notebook.ghostCellSuggestions.enabled': false,
		}, { keepOpen: false });
		await setScreenshotWindowSize(app);

		// Create notebook and run energy data code.
		await notebooksPositron.createNewNotebook();
		await notebooksPositron.expectToBeVisible();
		await notebooksPositron.kernel.select('Python');

		const code = [
			'import pandas as pd',
			'import numpy as np',
			'import matplotlib.pyplot as plt',
			'',
			'np.random.seed(42)',
			'',
			'dates_hourly = pd.date_range("2024-10-01", periods=9840, freq="h")',
			'energy_df = pd.DataFrame({"Day": dates_hourly, "Daily Total": np.random.uniform(20, 80, 9840)})',
			'gas_df = pd.DataFrame({"Day": pd.date_range("2024-10-01", periods=410, freq="D"), "Daily Total": np.random.uniform(5, 40, 410)})',
			'',
			'daily_energy = energy_df.groupby("Day")["Daily Total"].first().reset_index()',
			'daily_energy["Month"] = daily_energy["Day"].dt.to_period("M")',
			'monthly_kwh = daily_energy.groupby("Month")["Daily Total"].sum()',
			'',
			'monthly_kwh.plot(kind="bar", figsize=(10, 3.5), title="Monthly Electricity Usage (kWh)")',
			'plt.ylabel("kWh")',
			'plt.xticks(rotation=45)',
			'plt.tight_layout()',
			'plt.show()',
		].join('\n');
		await notebooksPositron.addCodeToCell(0, code, { fast: true });

		// Save as explore-energy-data.ipynb (extension added automatically).
		await quickaccess.runCommand('workbench.action.files.saveAs', { keepOpen: true });
		await quickInput.waitForQuickInputOpened();
		await quickInput.type(join(app.workspacePathOrFolder, 'explore-energy-data'));
		await quickInput.clickOkButton();
		await editors.waitForActiveTab('explore-energy-data.ipynb', false);

		// Log in to the model provider and open Posit Assistant chat on the left.
		await assistant.loginModelProvider('anthropic-api');
		await positAssistant.open();
		await positAssistant.waitForReady();
		await positAssistant.sendMessageAndWait('Tell me about this notebook', { timeout: 90_000, newConversation: true });
		await layouts.resizeSidebar({ x: 50 });

		// Run the notebook cell to populate variables and generate the chart output
		await notebooksPositron.runAllCells();
		await expect(page.getByRole('img', { name: 'output image' })).toBeVisible({ timeout: 20_000 });
		await hotKeys.minimizeBottomPanel();
		await hotKeys.showSecondarySidebar();
		await layouts.resizeAuxiliaryBar({ x: -150 });
		await variables.waitForVariableRow('daily_energy');
		await variables.expandVariable('daily_energy');
		await plots.collapsePlotsPane();

		// Move focus out of the notebook editor so the selected cell's blue focus
		// ring dims to the inactive border. Escape won't do this -- it only exits a
		// cell's edit mode; a cell stays selected and focus stays inside the notebook.
		await variables.focusVariablesView();

		// Capture screenshot
		await prepareForScreenshot(app, page);
		await overrideWorkspaceName(page, 'qa-example-content', 'positron-demos-notebooks-2');
		await captureFullWindow(page, 'positron-notebook.png');
	});
});
