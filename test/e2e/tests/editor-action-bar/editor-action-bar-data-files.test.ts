/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Editor Action Bar: Data Files
 *
 * Summary:
 * This test suite validates the functionality of the Editor Action Bar when interacting with
 * various types of data based files (e.g., data frames in R/Python, Parquet, CSV).
 *
 * Flow:
 *  - Open a file containing data frames or a standalone data file directly (e.g., Parquet, CSV via DuckDB)
 *  - Use the Variables pane to open a data frame in the Data Explorer (when applicable)
 *  - Verify the Editor Action Bar functionality:
 */

import { Application, DataExplorer } from '../../infra';
import { EditorActionBar } from '../../pages/editorActionBar';
import { test, expect, tags } from '../_test.setup';

let editorActionBar: EditorActionBar;
let dataExplorer: DataExplorer;

const testCases = [
	{
		title: 'R - Can load data frame via variables pane',
		openFile: 'workspaces/generate-data-frames-r/simple-data-frames.r',
		variable: 'df',
		tabName: 'Data: df',
	},
	{
		title: 'Python - Can load data frame via variables pane',
		openFile: 'workspaces/generate-data-frames-py/simple-data-frames.py',
		variable: 'df',
		tabName: 'Data: df',
	},
	{
		title: 'Can open parquet file via DuckDB',
		openDataFile: 'data-files/100x100/100x100.parquet',
		tabName: 'Data: 100x100.parquet',
	},
	{
		title: 'Can open CSV file via DuckDB',
		openDataFile: 'data-files/flights/flights.csv',
		tabName: 'Data: flights.csv'
	}];

test.use({
	suiteId: __filename
});

test.describe('Editor Action Bar: Data Files', {
	tag: [tags.WEB, tags.WIN, tags.EDITOR_ACTION_BAR, tags.DATA_EXPLORER]
}, () => {

	test.beforeAll(async function ({ app }) {
		editorActionBar = app.workbench.editorActionBar;
		dataExplorer = app.workbench.dataExplorer;
	});

	test.afterEach(async function ({ runCommand }) {
		await runCommand('workbench.action.closeAllEditors');
		await runCommand('Console: Clear Console');
	});

	for (const testCase of testCases) {
		test(testCase.title, async function ({ app, sessions, openDataFile, openFile }) {
			// Set interpreter
			const language = testCase.title.startsWith('R') ? 'r' : 'python';
			await sessions.start(language);

			// Open file
			testCase.openFile
				? await openFile(testCase.openFile)
				: await openDataFile(testCase.openDataFile!);

			// Open data explorer via variable pane
			if (testCase.variable) {
				await openDataExplorerViaVariablePane(app, testCase.variable, testCase.tabName);
			}

			// Ensure the summary panel is visible
			await dataExplorer.summaryPanel.show();

			// Verify action bar behavior
			await editorActionBar.selectSummaryOn(app.web, 'Left');
			await editorActionBar.verifySummaryPosition('Left');

			await editorActionBar.selectSummaryOn(app.web, 'Right');
			await editorActionBar.verifySummaryPosition('Right');

			await editorActionBar.clickButton('Split Editor Right');
			await editorActionBar.verifySplitEditor('right', testCase.tabName);

			await editorActionBar.clickButton('Split Editor Down');
			await editorActionBar.verifySplitEditor('down', testCase.tabName);

			await editorActionBar.verifyOpenInNewWindow(app.web, testCase.tabName);
		});
	}
});


async function openDataExplorerViaVariablePane(app: Application, variable: string, tabName: string) {
	await test.step('Open data explorer via variable pane', async () => {
		await app.workbench.editor.playButton.click();
		await app.workbench.variables.doubleClickVariableRow(variable);
		await app.code.driver.page.getByRole('tablist').locator('.tab').first().click();
		await app.code.driver.page.getByLabel('Close').first().click();
		await expect(app.code.driver.page.getByText(tabName, { exact: true })).toBeVisible();
	});
}
