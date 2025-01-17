/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';
import { verifyOpenInNewWindow, verifySplitEditor, verifySummaryPosition } from './helpers';

const testCases = [
	{
		title: 'R - Load data frame via variables pane',
		openFile: 'workspaces/generate-data-frames-r/simple-data-frames.r',
		variable: 'df',
		tabTitle: 'Data: df',
	},
	{
		title: 'Python - Load data frame via variables pane',
		openFile: 'workspaces/generate-data-frames-py/simple-data-frames.py',
		variable: 'df',
		tabTitle: 'Data: df',
	},
	{
		title: 'Python - Open parquet file via DuckDB',
		openDataFile: 'data-files/100x100/100x100.parquet',
		tabTitle: 'Data: 100x100.parquet',
	}];

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
		await app.workbench.quickaccess.runCommand('Console: Clear Console');
	});

	for (const testCase of testCases) {
		test(testCase.title, async function ({ app, page, interpreter, openDataFile, openFile }) {
			// Set interpreter
			const language = testCase.title.startsWith('Python') ? 'Python' : 'R';
			await interpreter.set(language);

			// Open file
			testCase.openFile
				? await openFile(testCase.openFile)
				: await openDataFile(testCase.openDataFile!);

			// Open data explorer via variable pane
			if (testCase.variable) {
				await test.step('Open data explorer via variable pane', async () => {
					await app.workbench.editor.playButton.click();
					await app.workbench.variables.doubleClickVariableRow(testCase.variable);
					await app.code.driver.page.getByRole('tablist').locator('.tab').first().click();
					await app.code.driver.page.getByLabel('Close').first().click();
					await expect(app.code.driver.page.getByText(testCase.tabTitle, { exact: true })).toBeVisible();
				});
			}

			// Verify action bar behavior
			await verifySummaryPosition(app, 'Left');
			await verifySummaryPosition(app, 'Right');
			await verifySplitEditor(page, testCase.tabTitle);
			await verifyOpenInNewWindow(app, `${testCase.tabTitle} — qa-example-content`);
		});
	}
});
