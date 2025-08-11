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
 */

import { expect } from '@playwright/test';
import { test, tags } from '../_test.setup';
import { pandasDataFrameScript } from './helpers/convert-to-code-data.js';

const testCases: { language: 'Python' | 'R'; dataScript: string; expectedCodeStyle: string; dataFrameType: string }[] = [
	{ language: 'Python', dataScript: pandasDataFrameScript, expectedCodeStyle: 'Pandas', dataFrameType: 'pandas.DataFrame' },
	// { language: 'Python', dataScript: polarsDataFrameScript, expectedCodeStyle: 'Polars', dataFrameType: 'polars.DataFrame' },
	// { language: 'R', dataScript: rDataFrameScript, expectedCodeStyle: 'Tidyverse', dataFrameType: 'data.frame' },
	// { language: 'R', dataScript: tibbleScript, expectedCodeStyle: 'Tidyverse', dataFrameType: 'tibble' },
	// { language: 'R', dataScript: dataTableScript, expectedCodeStyle: 'data.table', dataFrameType: 'data.table' },
];

test.use({
	suiteId: __filename
});

test.describe('Data Explorer: Convert to Code', { tag: [tags.WIN, tags.DATA_EXPLORER, tags.PERFORMANCE] }, () => {

	test.beforeAll(async function ({ settings }) {
		await settings.set({
			'dataExplorer.convertToCode': true
		});
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	testCases.forEach(({ language, dataScript, expectedCodeStyle, dataFrameType }) => {

		test(`${language} - ${expectedCodeStyle} (${dataFrameType}) - Verify copy code behavior with basic filters`, async function ({ app, sessions, hotKeys, metric }) {
			const { dataExplorer, variables, modals, console } = app.workbench;
			await sessions.start(language === 'Python' ? 'python' : 'r');

			// execute code to create a data construct
			await console.pasteCodeToConsole(dataScript, true);
			await variables.doubleClickVariableRow('df');
			await hotKeys.closeSecondarySidebar();

			// verify the data in the table
			await dataExplorer.verifyTableData([
				{ name: 'Alice', age: 25, city: 'Austin' },
				{ name: 'Bob', age: 35, city: 'Dallas' },
				{ name: 'Charlie', age: 40, city: 'Austin' },
				{ name: 'Diana', age: '__MISSING__', city: 'Houston' }
			]);

			// add filters
			await dataExplorer.addFilter('status', 'is equal to', 'active');            // Alice & Charlie
			await dataExplorer.addFilter('score', 'is greater than or equal to', '85'); // Alice (89.5), Charlie (95.0)
			await dataExplorer.addFilter('is_student', 'is false');                     // Charlie only

			// copy code and verify result is accurate
			metric.start();

			await dataExplorer.clickConvertToCodeButton();
			await modals.expectButtonToBeVisible(expectedCodeStyle.toLowerCase());
			await expect(app.code.driver.page.locator('.convert-to-code-editor')).toBeVisible();
			await modals.expectButtonToBeVisible('Copy Code');
			// const expectedGeneratedCode = {
			// 	'Pandas': 'filter_mask = (df[\'status\'] == active) & (df[\'score\'] >= 85) & (df[\'is_student\'] == False)',
			// 	'Polars': 'tbd',
			// 	'Tidyverse': 'tbd',
			// 	'data.table': 'tbd'
			// }[expectedCodeStyle] || '';
			// await modals.expectToContainText(expectedGeneratedCode);
			await metric.dataExplorer.stopAndSend({
				action: 'to_code',
				target_type: 'py.pandas.DataFrame',
				target_description: 'df with filters (pandas)',
				context_json: {
					// sort_applied: false,
					filter_applied: true,
					data_rows: await dataExplorer.getRowCount(),
					data_cols: await dataExplorer.getColumnCount(),
				}
			});
		});
	});
})


// test('Python - Verify copy code with many filters', async function ({ app, r, openDataFile }) {
// });

// test('R - Verify copy code with many filters', async function ({ app, r, openDataFile }) {
// });

// test('R - Verify copy code with changed default', async function ({ app, r, openDataFile }) {
// });




