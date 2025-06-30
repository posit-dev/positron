/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect, tags } from '../_test.setup';
import { Application } from '../../infra/index.js';

test.use({
	suiteId: __filename
});

test.describe('Data Explorer - Python Pandas', {
	tag: [tags.WEB, tags.WIN, tags.CRITICAL, tags.DATA_EXPLORER]
}, () => {

	test.afterEach(async function ({ app, hotKeys }) {
		await app.workbench.dataExplorer.clearAllFilters();
		await hotKeys.closeAllEditors();
		await hotKeys.showSecondarySidebar();
	});

	test('Python Pandas - Verify table data, copy to clipboard, sparkline hover, null percentage hover', async function ({ app, executeCode, hotKeys, python }) {
		const { dataExplorer, variables, editors } = app.workbench;

		// execute code to create a DataFrame
		await executeCode('Python', df);
		await variables.doubleClickVariableRow('df');
		await editors.verifyTab('Data: df', { isVisible: true });
		await hotKeys.hideSecondarySidebar();

		// verify table data, clipboard, sparkline hover, and null percentage hover
		await dataExplorer.verifyTableData([
			{ 'Name': 'Jai', 'Age': '27', 'Address': 'Delhi' },
			{ 'Name': 'Princi', 'Age': '24', 'Address': 'Kanpur' },
			{ 'Name': 'Gaurav', 'Age': '22', 'Address': 'Allahabad' },
			{ 'Name': 'Anuj', 'Age': '32', 'Address': 'Kannauj' }
		]);
		await verifyCanCopyDataToClipboard(app, 'Jai');
		await dataExplorer.verifySparklineHoverDialog(['Value', 'Count']);
		await dataExplorer.verifyNullPercentHoverDialog();
	});

	test('Python Pandas - Verify data explorer functionality with empty fields', async function ({ app, python }) {
		const { dataExplorer, console, variables, editors } = app.workbench;

		// execute code to create a DataFrame with empty fields
		await console.executeCode('Python', emptyFieldsScript);
		await variables.doubleClickVariableRow('emptyFields');
		await editors.verifyTab('Data: emptyFields', { isVisible: true, isSelected: true });
		await dataExplorer.maximizeDataExplorer(true);

		// verify table data with empty fields
		await dataExplorer.verifyTableData([
			{ 'A': '1.00', 'B': 'foo', 'C': 'NaN', 'D': 'NaT', 'E': 'None' },
			{ 'A': '2.00', 'B': 'NaN', 'C': '2.50', 'D': 'NaT', 'E': 'text' },
			{ 'A': 'NaN', 'B': 'bar', 'C': '3.10', 'D': '2023-01-01 00:00:00', 'E': 'more text' },
			{ 'A': '4.00', 'B': 'baz', 'C': 'NaN', 'D': 'NaT', 'E': 'NaN' },
			{ 'A': '5.00', 'B': 'None', 'C': '4.80', 'D': '2023-02-01 00:00:00', 'E': 'even more text' }
		]);

		// verify missing percentages
		await dataExplorer.expandSummary();
		await dataExplorer.verifyMissingPercent([
			{ column: 1, expected: '20%' },
			{ column: 2, expected: '40%' },
			{ column: 3, expected: '40%' },
			{ column: 4, expected: '60%' },
			{ column: 5, expected: '40%' }
		]);

		// verify column profile data
		await dataExplorer.verifyProfileData([
			{ column: 1, expected: { 'Missing': '1', 'Min': '1.00', 'Median': '3.00', 'Mean': '3.00', 'Max': '5.00', 'SD': '1.83' } },
			{ column: 2, expected: { 'Missing': '2', 'Empty': '0', 'Unique': '3' } },
			{ column: 3, expected: { 'Missing': '2', 'Min': '2.50', 'Median': '3.10', 'Mean': '3.47', 'Max': '4.80', 'SD': '1.19' } },
			{ column: 4, expected: { 'Missing': '3', 'Min': '2023-01-01 00:00:00', 'Median': 'NaT', 'Max': '2023-02-01 00:00:00', 'Timezone': 'None' } },
			{ column: 5, expected: { 'Missing': '2', 'Empty': '0', 'Unique': '3' } }
		]);
	});


	test('Python Pandas - Verify can execute cell, open data grid, and data present', async function ({ app, hotKeys, python }) {
		const { dataExplorer, notebooks, variables, editors } = app.workbench;

		// open a notebook and execute a cell to create a DataFrame
		const pythonNotebook = 'pandas-update-dataframe.ipynb';
		await notebooks.openNotebook(join(app.workspacePathOrFolder, 'workspaces', 'data-explorer-update-datasets', pythonNotebook));
		await notebooks.selectInterpreter('Python', process.env.POSITRON_PY_VER_SEL!);
		await notebooks.focusFirstCell();
		await notebooks.executeActiveCell();

		// open the DataFrame in data explorer and verify data
		await variables.doubleClickVariableRow('df');
		await editors.verifyTab('Data: df', { isVisible: true });
		await hotKeys.notebookLayout();
		await dataExplorer.verifyTableDataLength(11);

		// execute the next cell and verify data in the data explorer
		await editors.clickTab(pythonNotebook);
		await notebooks.focusNextCell();
		await notebooks.executeActiveCell();
		await editors.clickTab('Data: df');
		await dataExplorer.verifyTableDataLength(12);

		// execute the next cell to sort the DataFrame and verify sorted data
		await editors.clickTab(pythonNotebook);
		await notebooks.focusNextCell();
		await notebooks.executeActiveCell();
		await editors.clickTab('Data: df');
		await dataExplorer.selectColumnMenuItem(1, 'Sort Descending');
		await dataExplorer.verifyTableDataLength(12);
		await dataExplorer.verifyTableDataRowValue(0, { 'Year': '2025' });

		await dataExplorer.closeDataExplorer();
	});

	test('Python Pandas - Verify opening Data Explorer for the second time brings focus back', async function ({ app, python }) {
		const { dataExplorer, variables, console, editors } = app.workbench;

		// execute code to create a DataFrame
		await console.executeCode('Python', mtcarsDf);
		await variables.focusVariablesView();
		await variables.doubleClickVariableRow('Data_Frame');
		await editors.verifyTab('Data: Data_Frame', { isVisible: true });

		// move focus out of the the data explorer pane and verify focus returns via variable double click
		await editors.newUntitledFile();
		await variables.focusVariablesView();
		await variables.doubleClickVariableRow('Data_Frame');
		await editors.verifyTab('Data: Data_Frame', { isVisible: true });

		await dataExplorer.closeDataExplorer();
	});

	test('Python Pandas - Verify blank spaces in data explorer and disconnect behavior', async function ({ app, sessions, hotKeys }) {
		const { dataExplorer, console, variables, editors } = app.workbench;
		const [session] = await sessions.start(['python']);

		// execute code to create a DataFrame with blank spaces
		await console.executeCode('Python', blankSpacesScript);
		await variables.doubleClickVariableRow('df');
		await editors.verifyTab('Data: df', { isVisible: true });
		await dataExplorer.verifyTableData([
			{ 'x': 'a·' },
			{ 'x': 'a' },
			{ 'x': '···' },
			{ 'x': '<empty>' }
		]);

		await test.step('Verify disconnect dialog', async () => {
			await hotKeys.stackedLayout();
			await sessions.delete(session.id);
			await expect(app.code.driver.page.locator('.dialog-box .message')).toHaveText('Connection Closed');
		});

		await dataExplorer.closeDataExplorer();
	});
});


async function verifyCanCopyDataToClipboard(app: Application, expectedText?: string) {
	await test.step('Verify can copy data to clipboard', async () => {
		await expect(async () => {
			await app.code.driver.page.locator('#data-grid-row-cell-content-0-0 .text-container .text-value').click();
			await app.workbench.hotKeys.copy();
			const clipboardText = await app.workbench.clipboard.getClipboardText();
			expect(clipboardText).toBe(expectedText || 'Jai');
		}).toPass({ timeout: 20000 });
	});
}

// modified snippet from https://www.geeksforgeeks.org/python-pandas-dataframe/
const df = `import pandas as pd
data = {'Name':['Jai', 'Princi', 'Gaurav', 'Anuj'],
		'Age':[27, 24, 22, 32],
		'Address':['Delhi', 'Kanpur', 'Allahabad', 'Kannauj']}
df = pd.DataFrame(data)`;

const mtcarsDf = `import pandas as pd
Data_Frame = pd.DataFrame({
	"mpg": [21.0, 21.0, 22.8, 21.4, 18.7],
	"cyl": [6, 6, 4, 6, 8],
	"disp": [160.0, 160.0, 108.0, 258.0, 360.0],
	"hp": [110, 110, 93, 110, 175],
	"drat": [3.90, 3.90, 3.85, 3.08, 3.15],
	"wt": [2.62, 2.875, 2.32, 3.215, 3.44],
	"qsec": [16.46, 17.02, 18.61, 19.44, 17.02],
	"vs": [0, 0, 1, 1, 0],
	"am": [1, 1, 1, 0, 0],
	"gear": [4, 4, 4, 3, 3],
	"carb": [4, 4, 1, 1, 2]
})`;

const blankSpacesScript = `import pandas as pd
df = pd.DataFrame({'x': ["a ", "a", "   ", ""]})`;

const emptyFieldsScript = `import numpy as np
import pandas as pd

data = {
		'A': [1, 2, np.nan, 4, 5],
		'B': ['foo', np.nan, 'bar', 'baz', None],
		'C': [np.nan, 2.5, 3.1, None, 4.8],
		'D': [np.nan, pd.NaT, pd.Timestamp('2023-01-01'), pd.NaT, pd.Timestamp('2023-02-01')],
		'E': [None, 'text', 'more text', np.nan, 'even more text']
}
emptyFields = pd.DataFrame(data)`;
