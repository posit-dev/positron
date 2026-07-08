/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

// These tests exercise the native Excel (.xlsx) viewer in the Data Explorer, which
// reads workbooks directly through the DuckDB backend (no Python/R interpreter
// required). For dataframe-based XLSX loading via pandas/readxl, see
// xlsx-data-frame.test.ts.
test.describe('Data Explorer - XLSX Viewer', {
	tag: [tags.WEB, tags.WIN, tags.DATA_EXPLORER, tags.DUCK_DB]
}, () => {

	test.beforeEach(async function ({ hotKeys }) {
		// Give the data explorer more room.
		await hotKeys.notebookLayout();
		await hotKeys.closeSecondarySidebar();
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
		await hotKeys.stackedLayout();
	});

	test('Basic - Verify reading a single-sheet XLSX file (supermarket sales)', async function ({ app, openDataFile }) {
		const { dataExplorer, editors } = app.workbench;

		await openDataFile(join('data-files', 'supermarkt_sales', 'supermarkt_sales.xlsx'));
		await editors.verifyTab('supermarkt_sales.xlsx', { isVisible: true, isSelected: true });
		await dataExplorer.waitForIdle();

		// A single-sheet workbook should not show the worksheet picker.
		await dataExplorer.editorActionBar.expectWorksheetSelectorVisible(false);

		// Verify the workbook's contents are read into the grid: the title row, the
		// column-label row, and a known invoice id from the data should all appear.
		await dataExplorer.grid.expectCellWithTextToBeVisible('Sales 2021');
		await dataExplorer.grid.expectCellWithTextToBeVisible('Invoice ID');
		await dataExplorer.grid.expectCellWithTextToBeVisible('750-67-8428');
	});

	test('Advanced - Verify switching worksheets in a multi-sheet XLSX file (AP math enrollment)', async function ({ app, openDataFile }) {
		const { dataExplorer, editors } = app.workbench;

		await openDataFile(join('data-files', 'ap-math-enrollment', 'ap-math-enrollment.xlsx'));
		await editors.verifyTab('ap-math-enrollment.xlsx', { isVisible: true, isSelected: true });
		await dataExplorer.waitForIdle();

		// A multi-sheet workbook shows the worksheet picker, defaulting to the first sheet.
		await dataExplorer.editorActionBar.expectWorksheetSelectorVisible(true);
		await dataExplorer.editorActionBar.expectSelectedWorksheetToBe('Total');

		// Each sheet's title row differs ("...public school <gender> students..."), which
		// proves the grid reloads against the chosen worksheet. The "Total" sheet's title
		// names neither gender.
		await dataExplorer.grid.expectColumnHeaderToContainText('public school students enrolled');

		// Switching to the "Male" sheet reloads the grid with that sheet's data.
		await dataExplorer.editorActionBar.selectWorksheet('Male');
		await dataExplorer.waitForIdle();
		await dataExplorer.editorActionBar.expectSelectedWorksheetToBe('Male');
		await dataExplorer.grid.expectColumnHeaderToContainText('public school male students');

		// Switching to the "Female" sheet reloads the grid again.
		await dataExplorer.editorActionBar.selectWorksheet('Female');
		await dataExplorer.waitForIdle();
		await dataExplorer.editorActionBar.expectSelectedWorksheetToBe('Female');
		await dataExplorer.grid.expectColumnHeaderToContainText('public school female students');
	});
});
