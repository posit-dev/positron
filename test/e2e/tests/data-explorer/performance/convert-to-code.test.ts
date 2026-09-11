/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/*
Summary:
- This test suite verifies the Copy as Code behavior for Data Explorer tables in both Python and R environments.
- Ensures basic filters (e.g. "is not null", "contains") are applied correctly across supported data frame types.
- Confirms the filtered result is exported in the correct syntax for each language/library combination.

 * |Type/Class        |Language |Variable                                   |Expected Code Style     |
 * |------------------|---------|-------------------------------------------|------------------------|
 * |pandas.DataFrame  |Python   |<class 'pandas.core.frame.DataFrame'>      |Pandas                  |
 * |polars.DataFrame  |Python   |<class 'polars.dataframe.frame.DataFrame'> |Polars                  |
 * |tibble/tibble_df  |R        |c("tbl_df","tbl","data.frame")             |Tidyverse (dplyr)       |
 * |data.frame        |R        |data.frame		                            |Tidyverse (or Base R)   |
 * |data.table        |R        |c("data.table","data.frame")               |data.table              |
 */

import { MetricTargetType } from '../../../utils/metrics/metric-base.js';
import { test, tags, expect } from '../../_test.setup';
import { pandasDataFrameScript, polarsDataFrameScript, dplyrScript, normalizeCodeForDisplay } from '../helpers/convert-to-code-data.js';

const testCases: {
	environment: 'Python' | 'R';
	data: string;
	expectedCodeStyle: 'Pandas' | 'Polars' | 'dplyr';
	dataObjectType: MetricTargetType;
	expectedGeneratedCode: string;
}[] = [
		{
			environment: 'Python',
			data: pandasDataFrameScript,
			expectedCodeStyle: 'Pandas',
			dataObjectType: 'py.pandas.DataFrame',
			expectedGeneratedCode: 'filter_mask = (df[\'status\'] == \'active\') & (df[\'score\'] >= 85) & (df[\'is_student\'] == False)\ndf[filter_mask]'
		},
		{
			environment: 'Python',
			data: polarsDataFrameScript,
			expectedCodeStyle: 'Polars',
			dataObjectType: 'py.polars.DataFrame',
			expectedGeneratedCode: "filter_expr = (pl.col('status') == 'active') & (pl.col('score') >= 85) & (pl.col('is_student') == False)\ndf.filter(filter_expr)"
		},

		{
			environment: 'R',
			data: dplyrScript,
			expectedCodeStyle: 'dplyr',
			dataObjectType: 'r.tibble',
			expectedGeneratedCode: 'library(dplyr)\n\ndf |>\n  filter(\n    status == "active",\n    score >= 85,\n    !is_student\n  )'
		},
		// {
		//   environment: 'R',
		//   data: rDataFrameScript,
		//   expectedCodeStyle: 'Base R',
		//   dataObjectType: 'r.data.frame',
		//   expectedGeneratedCode: 'df[df$status == "active" & df$score >= 85 & !df$is_student, ]'
		// },
		// {
		//   environment: 'R',
		//   data: dataTableScript,
		//   expectedCodeStyle: 'data.table',
		//   dataObjectType: 'r.data.table',
		//   expectedGeneratedCode: 'df[status == "active" & score >= 85 & !is_student]'
		// }
	];

test.use({
	suiteId: __filename
});

test.describe('Data Explorer: Convert to Code', { tag: [tags.WIN, tags.DATA_EXPLORER, tags.PERFORMANCE] }, () => {

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	testCases.forEach(({ environment, data: dataScript, expectedCodeStyle, dataObjectType, expectedGeneratedCode }) => {

		test(`${environment} - ${expectedCodeStyle} (${dataObjectType}) - Verify copy code behavior with basic filters`, async function ({ app, sessions, hotKeys, metric }) {
			const { dataExplorer, variables, modals, console, clipboard, toasts } = app.workbench;

			// execute code to create a data construct
			await sessions.start(environment === 'Python' ? 'python' : 'r');
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
			await dataExplorer.filters.add({ columnName: 'status', condition: 'is equal to', value: 'active' });            // Alice & Charlie
			await dataExplorer.filters.add({ columnName: 'score', condition: 'is greater than or equal to', value: '85' }); // Alice (89.5), Charlie (95.0)
			await dataExplorer.filters.add({ columnName: 'is_student', condition: 'is false', value: '' });					// Charlie only

			await metric.dataExplorer.toCode(async () => {
				// copy code and verify result is accurate
				await dataExplorer.editorActionBar.clickButton('Convert to Code');
				await modals.expectButtonToBeVisible(expectedCodeStyle.toLowerCase());
				await dataExplorer.convertToCodeModal.expectToBeVisible();

				// verify the generated code is correct - use normalized code (no newlines)
				await expect(dataExplorer.convertToCodeModal.codeBox).toContainText(normalizeCodeForDisplay(expectedGeneratedCode));
			}, dataObjectType);

			// verify syntax highlighting
			await dataExplorer.convertToCodeModal.expectSyntaxHighlighting();

			// verify copy to clipboard behavior - use un-normalized code (with newlines)
			await dataExplorer.convertToCodeModal.clickOK();
			await clipboard.expectClipboardTextToBe(expectedGeneratedCode);
			await toasts.expectToastWithTitle('Copied to clipboard');
		});
	});
});
