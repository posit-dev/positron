/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application } from '../../infra';
import { EditorActionBar } from '../../pages/editorActionBar';
import { test, expect, tags } from '../_test.setup';

let editorActionBar: EditorActionBar;

const testCases = [
	{
		title: 'R - Load data frame via variables pane',
		openFile: 'workspaces/generate-data-frames-r/simple-data-frames.r',
		variable: 'df',
		tabName: 'Data: df',
	},
	{
		title: 'Python - Load data frame via variables pane',
		openFile: 'workspaces/generate-data-frames-py/simple-data-frames.py',
		variable: 'df',
		tabName: 'Data: df',
	},
	{
		title: 'Open parquet file via DuckDB',
		openDataFile: 'data-files/100x100/100x100.parquet',
		tabName: 'Data: 100x100.parquet',
	},
	{
		title: 'Open CSV file via DuckDB',
		openDataFile: 'data-files/flights/flights.csv',
		tabName: 'Data: flights.csv'
	}];

test.use({
	suiteId: __filename
});

test.describe('Editor Action Bar: Data Files', {
	tag: [tags.WEB, tags.WIN, tags.EDITOR_ACTION_BAR, tags.DATA_EXPLORER]
}, () => {

	test.beforeAll(async function ({ app, userSettings }) {
		editorActionBar = app.workbench.editorActionBar;
		await userSettings.set([['editor.actionBar.enabled', 'true']], false);
	});

	test.afterEach(async function ({ runCommand }) {
		await runCommand('workbench.action.closeAllEditors');
		await runCommand('Console: Clear Console');
	});

	for (const testCase of testCases) {
		test(testCase.title, async function ({ app, interpreter, openDataFile, openFile }) {
			// Set interpreter
			const language = testCase.title.startsWith('R') ? 'R' : 'Python';
			await interpreter.set(language);

			// Open file
			testCase.openFile
				? await openFile(testCase.openFile)
				: await openDataFile(testCase.openDataFile!);

			// Open data explorer via variable pane
			if (testCase.variable) {
				await openDataExplorerViaVariablePane(app, testCase.variable, testCase.tabName);
			}

			// Verify action bar behavior
			await editorActionBar.selectSummaryOn(app.web, 'Left');
			await editorActionBar.verifySummaryPosition('Left');

			await editorActionBar.selectSummaryOn(app.web, 'Right');
			await editorActionBar.verifySummaryPosition('Right');

			await editorActionBar.clickSplitEditorButton('right');
			await editorActionBar.verifySplitEditor('right', testCase.tabName);

			await editorActionBar.clickSplitEditorButton('down');
			await editorActionBar.verifySplitEditor('down', testCase.tabName);

			await editorActionBar.verifyOpenInNewWindow(app.web, `${testCase.tabName} — qa-example-content`);
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
