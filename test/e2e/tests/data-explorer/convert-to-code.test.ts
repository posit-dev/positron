/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/*
Summary:
- This test suite verifies the Copy as Code behavior for Data Explorer tables in both Python and R environments.
- Ensures basic filters (e.g. "is not null", "contains") are applied correctly across supported data frame types.
- Confirms the filtered result is exported in the correct syntax for each language/library combination.

 * |Type              |Language |Variable                                   |Expected Code Style     |
 * |------------------|---------|-------------------------------------------|------------------------|
 * |pandas.DataFrame  |Python   |<class 'pandas.core.frame.DataFrame'>      |Pandas                  |
 * |polars.DataFrame  |Python   |<class 'polars.dataframe.frame.DataFrame'> |Polars                  |
 * |data.frame        |R        |<data.frame>                               |Tidyverse (or Base R)   |
 * |tibble            |R        |<tbl_df>                                   |Tidyverse               |
 * |data.table        |R        |<data.table>                               |data.table              |
 * |dplyr             |R        |<dplyr>                                    |dplyr                   |
 */

import { test, tags } from '../_test.setup';
import { pandasDataFrameScript } from './helpers/convert-to-code-data.js';
import { MetricTargetType } from '../../utils/metrics.js';

const testCases: {
	language: 'Python' | 'R';
	dataScript: string;
	expectedCodeStyle: string;
	dataFrameType: MetricTargetType;
	expectedGeneratedCode: string;
}[] = [
		{
			language: 'Python',
			dataScript: pandasDataFrameScript,
			expectedCodeStyle: 'Pandas',
			dataFrameType: 'py.pandas.DataFrame',
			expectedGeneratedCode: 'filter_mask = (df[\'status\'] == \'active\') & (df[\'score\'] >= 85) & (df[\'is_student\'] == False)'
		},
		// {
		// 	language: 'Python',
		// 	dataScript: polarsDataFrameScript,
		// 	expectedCodeStyle: 'Polars',
		// 	dataFrameType: 'py.polars.DataFrame'
		//   expectedGeneratedCode: 'tbd'
		// },
		// {
		// 	language: 'R',
		// 	dataScript: rDataFrameScript,
		// 	expectedCodeStyle: 'Tidyverse',
		// 	dataFrameType: 'r.data.frame'
		//   expectedGeneratedCode: 'tbd'
		// },
		// {
		// 	language: 'R',
		// 	dataScript: tibbleScript,
		// 	expectedCodeStyle: 'Tidyverse',
		// 	dataFrameType: 'r.tibble',
		// 	expectedGeneratedCode: 'tbd'
		// },
		// {
		// 	language: 'R',
		// 	dataScript: dataTableScript,
		// 	expectedCodeStyle: 'data.table',
		// 	dataFrameType: 'r.data.table',
		// 	expectedGeneratedCode: 'tbd'
		// },
		// {
		// 	language: 'R',
		// 	dataScript: dplyrScript,
		// 	expectedCodeStyle: 'dplyr',
		// 	dataFrameType: 'r.dplyr',
		// 	expectedGeneratedCode: 'tbd'
		// },
	];

test.use({
	suiteId: __filename
});

test.describe('Data Explorer: Convert to Code', { tag: [tags.WIN, tags.DATA_EXPLORER] }, () => {

	test.beforeAll(async function ({ settings }) {
		await settings.set({
			'dataExplorer.convertToCode': true
		});
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	testCases.forEach(({ language, dataScript, expectedCodeStyle, dataFrameType, expectedGeneratedCode }) => {

		test(`${language} - ${expectedCodeStyle} (${dataFrameType}) - Verify copy code behavior with basic filters`, async function ({ app, sessions, hotKeys, metric }) {
			const { dataExplorer, variables, modals, console, clipboard, toasts } = app.workbench;
			await sessions.start(language === 'Python' ? 'python' : 'r');

			// execute code to create a data construct
			await console.pasteCodeToConsole(dataScript, true);
			await variables.doubleClickVariableRow('df');
			await hotKeys.closeSecondarySidebar();

			// verify the data in the table
			await dataExplorer.grid.verifyTableData([
				{ name: 'Alice', age: 25, city: 'Austin' },
				{ name: 'Bob', age: 35, city: 'Dallas' },
				{ name: 'Charlie', age: 40, city: 'Austin' },
				{ name: 'Diana', age: '__MISSING__', city: 'Houston' }
			]);

			// add filters
			await dataExplorer.filters.add('status', 'is equal to', 'active');            // Alice & Charlie
			await dataExplorer.filters.add('score', 'is greater than or equal to', '85'); // Alice (89.5), Charlie (95.0)
			await dataExplorer.filters.add('is_student', 'is false');					  // Charlie only

			metric.start();

			// copy code and verify result is accurate
			await dataExplorer.editorActionBar.clickButton('Convert to Code');
			await modals.expectButtonToBeVisible(expectedCodeStyle.toLowerCase());
			await dataExplorer.convertToCodeModal.expectToBeVisible();

			// verify the generated code is correct and has syntax highlights
			await modals.expectToContainText(expectedGeneratedCode);
			await dataExplorer.convertToCodeModal.expectSyntaxHighlighting();

			await metric.dataExplorer.stopAndSend({
				action: 'to_code',
				target_type: dataFrameType,
				target_description: 'filter_mask',
				context_json: {
					data_rows: await dataExplorer.grid.getRowCount(),
					data_cols: await dataExplorer.grid.getColumnCount()
				}
			});

			// verify copy to clipboard behavior
			await dataExplorer.convertToCodeModal.clickOK();
			await clipboard.expectClipboardTextToBe(expectedGeneratedCode + '\ndf[filter_mask]');
			await toasts.expectToBeVisible('Copied to clipboard');
		});
	});

	// test('Python - Verify copy code with many filters', async function ({ app, r, openDataFile }) {
	// });

	// test('R - Verify copy code with many filters', async function ({ app, r, openDataFile }) {
	// });

	// test('R - Verify copy code with changed default', async function ({ app, r, openDataFile }) {
	// });

});



