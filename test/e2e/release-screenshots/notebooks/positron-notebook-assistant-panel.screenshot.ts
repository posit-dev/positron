/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { join } from 'path';
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

// Energy data analysis notebook — matches the reference screenshot.
const NOTEBOOK_CODE = [
	'import pandas as pd',
	'import numpy as np',
	'import matplotlib.pyplot as plt',
	'',
	'np.random.seed(42)',
	'',
	'# Hourly energy readings for ~410 days',
	'dates_hourly = pd.date_range("2024-10-01", periods=9840, freq="h")',
	'energy_df = pd.DataFrame({',
	'    "Day": dates_hourly,',
	'    "Daily Total": np.random.uniform(20, 80, 9840)',
	'})',
	'',
	'# Daily gas readings',
	'gas_df = pd.DataFrame({',
	'    "Day": pd.date_range("2024-10-01", periods=410, freq="D"),',
	'    "Daily Total": np.random.uniform(5, 40, 410)',
	'})',
	'',
	'daily_energy = energy_df.groupby("Day")["Daily Total"].first().reset_index()',
	'daily_energy["Month"] = daily_energy["Day"].dt.to_period("M")',
	'monthly_kwh = daily_energy.groupby("Month")["Daily Total"].sum()',
	'',
	'monthly_kwh.plot(kind="bar", figsize=(10, 4), title="Monthly Electricity Usage (kWh)")',
	'plt.ylabel("kWh")',
	'plt.xticks(rotation=45)',
	'plt.tight_layout()',
	'plt.show()',
].join('\n');

test.describe('Release Screenshots - Positron Notebook Assistant Panel', () => {
	/**
	 * Img Path: https://positron.posit.co/images/positron-notebook-assistant-panel.png
	 *
	 * Notebook with energy data analysis open alongside the assistant chat panel.
	 * The assistant has responded to "Tell me about this notebook".
	 */
	test('Release Screenshot - positron-notebook-assistant-panel.png', async ({ app, page, python, settings }) => {
		const { notebooksPositron, hotKeys, layouts, quickaccess, quickInput, editors, assistant, variables } = app.workbench;

		await settings.set({ 'positron.assistant.enable': true }, { keepOpen: false });

		// Create a new notebook and run the energy data code.
		await notebooksPositron.createNewNotebook();
		await notebooksPositron.expectToBeVisible();
		await notebooksPositron.kernel.select('Python');
		await notebooksPositron.addCodeToCell(0, NOTEBOOK_CODE, { fast: true });

		const cell = page.locator('[data-testid="notebook-cell"]').first();
		await cell.getByRole('button', { name: 'Run Cell', exact: true }).click();
		await expect(cell.getByTestId('cell-output').locator('img, canvas').first()).toBeVisible({ timeout: 60_000 });

		// Save the notebook as explore-energy-data.ipynb (extension is added automatically).
		await quickaccess.runCommand('workbench.action.files.saveAs', { keepOpen: true });
		await quickInput.waitForQuickInputOpened();
		await quickInput.type(join(app.workspacePathOrFolder, 'explore-energy-data'));
		await quickInput.clickOkButton();
		await editors.waitForActiveTab('explore-energy-data.ipynb', false);

		// Show the variables panel on the right.
		await hotKeys.showSecondarySidebar();
		await variables.focusVariablesView();

		// Open the assistant chat in the left sidebar and ask about the notebook.
		await assistant.openPositronAssistantChat();
		await assistant.sendChatMessageAndWait('Tell me about this notebook', { timeout: 120_000 });

		// capture screenshot
		await prepareForScreenshot(app, page);
		await overrideWorkspaceName(page, 'qa-example-content', 'positron-demos-notebooks-2');
		await captureFullWindow(page, 'positron-notebook-assistant-panel.png');
	});
});
