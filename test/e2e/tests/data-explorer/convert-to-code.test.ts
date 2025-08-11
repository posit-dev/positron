/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/*
Summary:
- This test suite verifies the Copy as Code behavior for Data Explorer tables in both Python and R environments.
- Ensures basic filters (e.g. "is not null", "contains") are applied correctly across supported data frame types.
- Confirms the filtered result is exported in the correct syntax for each language/library combination.

 * |Type              |Language |Construct                         |Expected Code Style     |
 * |------------------|---------|----------------------------------|------------------------|
 * |pandas.DataFrame  |Python   |pd.DataFrame(...)                 |Pandas                  |
 * |polars.DataFrame  |Python   |pl.DataFrame(...)                 |Polars                  |
 * |data.frame        |R        |data.frame(...)                   |Tidyverse (or Base R)   |
 * |tibble            |R        |tibble::tibble(...)               |Tidyverse               |
 * |data.table        |R        |data.table::data.table(...)       |data.table              |
 */

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

test.describe('Data Explorer: Convert to Code', { tag: [tags.WIN, tags.DATA_EXPLORER] }, () => {

	test.beforeAll(async function ({ settings }) {
		await settings.set({
			'dataExplorer.convertToCode': true
		});
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	testCases.forEach(({ language, dataScript, expectedCodeStyle, dataFrameType }) => {

		test(`${language} - ${expectedCodeStyle} (${dataFrameType}) - Verify copy code behavior with basic filters`, async function ({ app, sessions, hotKeys }) {
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
			await dataExplorer.clickConvertToCodeButton();
			await modals.expectButtonToBeVisible(expectedCodeStyle.toLowerCase());
			await modals.expectToContainText(
				'filter_mask = (df[\'status\'] == \'active\') & (df[\'score\'] >= 85) & (df[\'is_student\'] == False)'
			);

			const expectedGeneratedCode = {
				'Pandas': 'filter_mask = (df[\'status\'] == \'active\') & (df[\'score\'] >= 85) & (df[\'is_student\'] == False)',
				// 'Polars': 'tbd',
				// 'Tidyverse': 'tbd',
				// 'data.table': 'tbd'
			}[expectedCodeStyle] || '';
			await modals.expectToContainText(expectedGeneratedCode);
		});
	});
});


// test('Python - Verify copy code with many filters', async function ({ app, r, openDataFile }) {
// });

// test('R - Verify copy code with many filters', async function ({ app, r, openDataFile }) {
// });

// test('R - Verify copy code with changed default', async function ({ app, r, openDataFile }) {
// });




