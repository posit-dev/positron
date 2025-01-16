/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';
import { verifyOpenInNewWindow, verifySplitEditor, verifySummaryPosition } from './helpers';
import { pandasCsvScript, pandasParquetScript, polarsTsvScript, rScript } from './scripts';

const testCases = [
	{
		title: 'Python Pandas (Parquet) - access via variables',
		script: pandasParquetScript,
	},
	{
		title: 'Python Pandas (CSV Data) - access via variables',
		script: pandasCsvScript,
	}, {
		title: 'Python Polars - access via variables',
		script: polarsTsvScript,
	}, {
		title: 'R - access via variables',
		script: rScript,
	},
];

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
		test(testCase.title, async function ({ app, page, interpreter }) {
			// Set interpreter
			const language = testCase.title.startsWith('Python') ? 'Python' : 'R';
			await interpreter.set(language);

			// View data in data explorer via variables pane
			await app.workbench.console.executeCode(language, testCase.script);
			await app.workbench.variables.doubleClickVariableRow('df');
			await expect(app.code.driver.page.getByText('Data: df', { exact: true })).toBeVisible();

			// Verify action bar behavior
			await verifySummaryPosition(app, 'Left');
			await verifySummaryPosition(app, 'Right');
			await verifySplitEditor(page, 'Data: df');
			await verifyOpenInNewWindow(app, 'Data: df — qa-example-content');
		});
	}
});
