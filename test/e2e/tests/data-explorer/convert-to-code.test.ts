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

import { MetricTargetType } from '../../utils/metrics/metric-base.js';
import { test, tags, expect } from '../_test.setup';
import { pandasDataFrameScript, polarsDataFrameScript } from './helpers/convert-to-code-data.js';

/**
 * Helper function to normalize code for UI text comparison
 * @param code The code string to normalize
 * @returns The normalized code with consistent whitespace
 */
const normalizeCodeForDisplay = (code: string): string => {
	// Replace newlines with spaces for UI component text comparison
	return code.replace(/\n/g, '');
};

const testCases: {
	environment: 'Python' | 'R' | 'DuckDB';
	data: string;
	expectedCodeStyle: string;
	dataFrameType: MetricTargetType;
	expectedGeneratedCode: string;
}[] = [
		{
			environment: 'Python',
			data: pandasDataFrameScript,
			expectedCodeStyle: 'Pandas',
			dataFrameType: 'py.pandas.DataFrame',
			expectedGeneratedCode: 'filter_mask = (df[\'status\'] == \'active\') & (df[\'score\'] >= 85) & (df[\'is_student\'] == False)\ndf[filter_mask]'
		},
		{
			environment: 'Python',
			data: polarsDataFrameScript,
			expectedCodeStyle: 'Polars',
			dataFrameType: 'py.polars.DataFrame',
			expectedGeneratedCode: "filter_expr = (pl.col('status') == 'active') & (pl.col('score') >= 85) & (pl.col('is_student') == False)\ndf.filter(filter_expr)"
		},
		{
			environment: 'DuckDB',
			data: 'data-files/convert-to-code/simple-student-data.csv',
			expectedCodeStyle: 'SQL',
			dataFrameType: 'file.csv',
			expectedGeneratedCode: 'SELECT * \nFROM "simple-student-data"\nWHERE "status" = \'active\' AND "score" >= 85 AND "is_student" = false'
		},
		// {
		// 	environment: 'R',
		// 	dataScript: rDataFrameScript,
		// 	expectedCodeStyle: 'Tidyverse',
		// 	dataFrameType: 'r.data.frame'
		//   expectedGeneratedCode: 'tbd'
		// },
		// {
		// 	environment: 'R',
		// 	dataScript: tibbleScript,
		// 	expectedCodeStyle: 'Tidyverse',
		// 	dataFrameType: 'r.tibble',
		// 	expectedGeneratedCode: 'tbd'
		// },
		// {
		// 	environment: 'R',
		// 	dataScript: dataTableScript,
		// 	expectedCodeStyle: 'data.table',
		// 	dataFrameType: 'r.data.table',
		// 	expectedGeneratedCode: 'tbd'
		// },
		// {
		// 	environment: 'R',
		// 	dataScript: dplyrScript,
		// 	expectedCodeStyle: 'dplyr',
		// 	dataFrameType: 'r.dplyr',
		// 	expectedGeneratedCode: 'tbd'
		// },
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

	testCases.forEach(({ environment, data: dataScript, expectedCodeStyle, dataFrameType, expectedGeneratedCode }) => {

		test(`${environment} - ${expectedCodeStyle} (${dataFrameType}) - Verify copy code behavior with basic filters`, async function ({ app, sessions, hotKeys, metric, openDataFile }) {
			const { dataExplorer, variables, modals, console, clipboard, toasts } = app.workbench;

			if (environment === 'DuckDB') {
				// open a data file via DuckDB
				await openDataFile(dataScript);
			} else {
				// execute code to create a data construct
				await sessions.start(environment === 'Python' ? 'python' : 'r');
				await console.pasteCodeToConsole(dataScript, true);
				await variables.doubleClickVariableRow('df');
			}

			await hotKeys.closeSecondarySidebar();

			// verify the data in the table
			await dataExplorer.grid.verifyTableData([
				{ name: 'Alice', age: 25, city: 'Austin' },
				{ name: 'Bob', age: 35, city: 'Dallas' },
				{ name: 'Charlie', age: 40, city: 'Austin' },
				{ name: 'Diana', age: '__MISSING__', city: 'Houston' }
			]);

			// add filters
			await dataExplorer.filters.add({ columnName: 'status', condition: 'is equal to', value: 'active' });            // Alice & Charlie
			await dataExplorer.filters.add({ columnName: 'score', condition: 'is greater than or equal to', value: '85' }); // Alice (89.5), Charlie (95.0)
			await dataExplorer.filters.add({ columnName: 'is_student', condition: 'is false', value: '' });					// Charlie only

			await metric.dataExplorer.toCode(async () => {
				// copy code and verify result is accurate
				await dataExplorer.editorActionBar.clickButton('Convert to Code');
				await modals.expectButtonToBeVisible(expectedCodeStyle.toLowerCase());
				await dataExplorer.convertToCodeModal.expectToBeVisible();

				// verify the generated code is correct and has syntax highlights
				// Use normalized code for UI text comparison (no newlines)
				await expect(dataExplorer.convertToCodeModal.codeBox).toContainText(normalizeCodeForDisplay(expectedGeneratedCode));
				if (environment !== 'DuckDB') { await dataExplorer.convertToCodeModal.expectSyntaxHighlighting(); }

				// verify copy to clipboard behavior
				await dataExplorer.convertToCodeModal.clickOK();
				// When checking clipboard text, use the original expected code with newlines
				await clipboard.expectClipboardTextToBe(expectedGeneratedCode);
				await toasts.expectToBeVisible('Copied to clipboard');
			}, dataFrameType);
		});
	});


	// test('Python - Verify copy code with many filters', async function ({ app, r, openDataFile }) {
	// });

	// test('R - Verify copy code with many filters', async function ({ app, r, openDataFile }) {
	// });

	// test('R - Verify copy code with changed default', async function ({ app, r, openDataFile }) {
	// });
});
