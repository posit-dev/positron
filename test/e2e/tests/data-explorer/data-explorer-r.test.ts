/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.beforeEach(async function ({ app }) {
	await app.workbench.layouts.enterLayout('stacked');
	await app.workbench.variables.focusVariablesView();
});

test.afterEach(async function ({ hotKeys }) {
	await hotKeys.closeAllEditors();
});

test.describe('Data Explorer - R ', {
	tag: [tags.WEB, tags.WIN, tags.DATA_EXPLORER, tags.WORKBENCH]
}, () => {
	test('R - Verify basic data explorer functionality', { tag: [tags.CRITICAL] }, async function ({ app, r, openFile }) {
		const { dataExplorer, editor, editors, variables, clipboard } = app.workbench;

		// Execute code to generate data frames
		await openFile('workspaces/generate-data-frames-r/simple-data-frames.r');
		await editor.playButton.click();

		// Open Data Explorer
		await variables.doubleClickVariableRow('df');
		await editors.verifyTab('Data: df', { isVisible: true, isSelected: true });

		// Verify the data in the table
		await dataExplorer.maximize(true);
		await dataExplorer.grid.verifyTableDataLength(3);
		await dataExplorer.grid.verifyTableData([
			{ 'Training': 'Strength', 'Pulse': '100.00', 'Duration': '60.00', 'Note': 'NA' },
			{ 'Training': 'Stamina', 'Pulse': 'NA', 'Duration': '30.00', 'Note': 'NA' },
			{ 'Training': 'Other', 'Pulse': '120.00', 'Duration': '45.00', 'Note': 'Note' }
		]);

		// Verify the summary column data
		await dataExplorer.summaryPanel.show();
		await dataExplorer.summaryPanel.verifyColumnData([
			{ column: 1, expected: { 'Missing': '0', 'Empty': '0', 'Unique': '3' } },
			{ column: 2, expected: { 'Missing': '1', 'Min': '100.00', 'Median': '110.00', 'Mean': '110.00', 'Max': '120.00', 'SD': '14.14' } },
			{ column: 3, expected: { 'Missing': '0', 'Min': '30.00', 'Median': '45.00', 'Mean': '45.00', 'Max': '60.00', 'SD': '15.00' } },
			{ column: 4, expected: { 'Missing': '2', 'Empty': '0', 'Unique': '2' } }
		]);

		// verify can copy data to clipboard
		await dataExplorer.grid.clickCell(0, 0);
		await clipboard.copy();
		await clipboard.expectClipboardTextToBe('Strength');

		// verify sparkline hover dialog
		await dataExplorer.summaryPanel.verifySparklineHoverDialog(['Value', 'Count']);

		// verify null percentage hover dialog
		await dataExplorer.summaryPanel.verifyNullPercentHoverDialog();
	});

	test('R - Verify opening Data Explorer for the second time brings focus back', {
		annotation: [
			{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/5714' },
			{ type: 'regression', description: 'https://github.com/posit-dev/positron/issues/4197' }]
	}, async function ({ app, r, executeCode }) {
		const { variables, editors } = app.workbench;

		// Execute code to generate data frames
		await executeCode('R', `Data_Frame <- mtcars`);
		await variables.focusVariablesView();

		// Open Data Explorer
		await variables.doubleClickVariableRow('Data_Frame');
		await editors.verifyTab('Data: Data_Frame', { isVisible: true, isSelected: true });

		// Now move focus out of the the data explorer pane
		await editors.newUntitledFile();
		await variables.focusVariablesView();
		await editors.verifyTab('Data: Data_Frame', { isVisible: true, isSelected: false });
		await variables.doubleClickVariableRow('Data_Frame');
		await editors.verifyTab('Data: Data_Frame', { isVisible: true, isSelected: true });
	});

	test('R - Verify blank spaces in data explorer and disconnect behavior', async function ({ app, r, executeCode, hotKeys }) {
		const { variables, editors, dataExplorer, console, modals } = app.workbench;

		// Execute code to generate data frames
		await executeCode('R', `df = data.frame(x = c("a ", "a", "   ", ""))`);

		// Open Data Explorer
		await variables.doubleClickVariableRow('df');
		await editors.verifyTab('Data: df', { isVisible: true, isSelected: true });

		// Verify blank spaces in the table
		await dataExplorer.grid.verifyTableDataLength(4);
		await dataExplorer.grid.verifyTableData([
			{ 'x': 'a·' },
			{ 'x': 'a' },
			{ 'x': '···' },
			{ 'x': '<empty>' }
		]);

		// Verify disconnect modal dialog box when session is closed
		await hotKeys.stackedLayout();
		await console.trashButton.click();
		await modals.expectMessageToContain('Connection Closed');
	});
});

