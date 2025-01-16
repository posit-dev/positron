/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';
import { Application } from '../../infra';
import { verifyOpenInNewWindow, verifySplitEditor } from './helpers';

test.use({
	suiteId: __filename
});

test.describe('Editor Action Bar: Data Explorer', {
	tag: [tags.WEB, tags.WIN, tags.EDITOR_ACTION_BAR, tags.DATA_EXPLORER]
}, () => {

	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['editor.actionBar.enabled', 'true']], false);
	});

	test.afterEach(async function ({ app }) {
		await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');
	});

	test('Python Pandas (Parquet) - Variables Pane [C...]', async function ({ app, page, python }) {
		// load data in data explorer
		const title = 'Data: df';
		await app.workbench.console.executeCode('Python', parquetScript);
		await app.workbench.variables.doubleClickVariableRow('df');
		await expect(app.code.driver.page.getByText(title, { exact: true })).toBeVisible();

		// verify action bar behavior
		await verifySummaryPosition(app, 'Left');
		await verifySummaryPosition(app, 'Right');
		await verifySplitEditor(page, title);
		await verifyOpenInNewWindow(app, `${title} — qa-example-content`);
	});

	test('Python Pandas (CSV Data) - Variables Pane [C...]', async function ({ app, page, python }) {
		// load data in data explorer
		const title = 'Data: df';
		await app.workbench.console.executeCode('Python', csvScript);
		await app.workbench.variables.doubleClickVariableRow('df');
		await expect(app.code.driver.page.getByText(title, { exact: true })).toBeVisible();

		// verify action bar behavior
		await verifySummaryPosition(app, 'Left');
		await verifySummaryPosition(app, 'Right');
		await verifySplitEditor(page, title);
		await verifyOpenInNewWindow(app, `${title} — qa-example-content`);
	});

	test('Python Polars - Variables Pane [C...]', async function ({ app, page, openFile, python }) {
		// load data in data explorer
		const title = 'Data: df';
		await openFile('workspaces/polars-dataframe-py/polars_basic.py');
		await app.workbench.quickaccess.runCommand('python.execInConsole');
		await app.workbench.variables.doubleClickVariableRow('df');
		await page.getByRole('tab', { name: 'polars_basic.py' }).getByLabel('Close').click();
		await expect(page.getByText(title, { exact: true })).toBeVisible();

		// verify action bar behavior
		await verifySummaryPosition(app, 'Left');
		await verifySummaryPosition(app, 'Right');
		await verifySplitEditor(page, title);
		await verifyOpenInNewWindow(app, `${title} — qa-example-content`);
	});

	test('R - Variables Pane [C...]', async function ({ app, page, r }) {
		// load data in data explorer
		const title = 'Data: Data_Frame';
		await app.workbench.console.executeCode('R', rScript);
		await app.workbench.variables.doubleClickVariableRow('Data_Frame');
		await expect(app.code.driver.page.getByText(title, { exact: true })).toBeVisible();

		// verify action bar behavior
		await verifySummaryPosition(app, 'Left');
		await verifySummaryPosition(app, 'Right');
		await verifySplitEditor(page, title);
		await verifyOpenInNewWindow(app, `${title} — qa-example-content`);
	});
});

async function verifySummaryPosition(app: Application, position: 'Left' | 'Right') {
	const page = app.code.driver.page;

	await test.step(`Verify summary position: ${position}`, async () => {
		// Toggle the summary position
		if (app.web) {
			await page.getByLabel('More actions', { exact: true }).click();
			await page.getByRole('menuitemcheckbox', { name: `Summary on ${position}` }).hover();
			await page.keyboard.press('Enter');
		}
		else {
			await app.workbench.quickaccess.runCommand(`workbench.action.positronDataExplorer.summaryOn${position}`);
		}

		// Locator for the summary element
		const summaryLocator = page.locator('div.column-summary').first();
		const tableLocator = page.locator('div.data-grid-column-headers');

		// Ensure both the summary and table elements are visible
		await Promise.all([
			expect(summaryLocator).toBeVisible(),
			expect(tableLocator).toBeVisible(),
		]);

		// Get the bounding boxes for both elements
		const summaryBox = await summaryLocator.boundingBox();
		const tableBox = await tableLocator.boundingBox();

		// Validate bounding boxes are available
		if (!summaryBox || !tableBox) {
			throw new Error('Bounding boxes could not be retrieved for summary or table.');
		}

		// Validate positions based on the expected position
		position === 'Left'
			? expect(summaryBox.x).toBeLessThan(tableBox.x)
			: expect(summaryBox.x).toBeGreaterThan(tableBox.x);
	});
}

const rScript = `Data_Frame <- data.frame (
	Training = c("Strength", "Stamina", "Other"),
	Pulse = c(100, NA, 120),
	Duration = c(60, 30, 45),
	Note = c(NA, NA, "Note")
)`;

const parquetScript = `import pandas as pd
import os

file_path = os.path.join(os.getcwd(), 'data-files', '100x100', '100x100.parquet')

# Read the Parquet file into a pandas DataFrame
df = pd.read_parquet(file_path)

# Display the DataFrame
print(df)`;

const csvScript = `import pandas as pd
import os

file_path = os.path.join(os.getcwd(), 'data-files', 'spotify_data', 'data.csv')

# Read the CSV file into a pandas DataFrame
df = pd.read_csv(file_path)

# Display the DataFrame
print(df)`;
