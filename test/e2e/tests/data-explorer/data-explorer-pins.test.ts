/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * Verifies Data Explorer pinning behavior:
 *   - Column pinning persists across scroll
 *   - Row pinning persists across scroll
 *   - Pinned columns are always visible
 *   - Pinned rows are always visible
 *
 * Note: some pinning functionality (e.g., copy/pasting with pins) is covered by: data-explorer-copy-paste.test.ts
 */

import { join } from 'path';
import { test, tags } from '../_test.setup';

const columnOrder = {
	default: ['column0', 'column1', 'column2', 'column3', 'column4', 'column5', 'column6', 'column7', 'column8', 'column9'],
	pinCol2: ['column2', 'column0', 'column1', 'column3', 'column4', 'column5', 'column6', 'column7', 'column8', 'column9'],
	pinCol4: ['column4', 'column0', 'column1', 'column2', 'column3', 'column5', 'column6', 'column7', 'column8', 'column9'],
	pinCol6: ['column6', 'column0', 'column1', 'column2', 'column3', 'column4', 'column5', 'column7', 'column8', 'column9'],
	pinCol4And6: ['column4', 'column6', 'column0', 'column1', 'column2', 'column3', 'column5', 'column7', 'column8', 'column9'],
};
const rowOrder = {
	default: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
	pinRow5: [5, 0, 1, 2, 3, 4, 6, 7, 8, 9],
	pinRow6: [6, 0, 1, 2, 3, 4, 5, 7, 8, 9],
	pinRow8: [8, 0, 1, 2, 3, 4, 5, 6, 7, 9],
	pinRow8And6: [8, 6, 0, 1, 2, 3, 4, 5, 7, 9]
};

test.use({
	suiteId: __filename
});

const testCases: {
	env: 'Polars' | 'Pandas' | 'R' | 'DuckDB';
	rowIndexOffset: number;
	data: string;
}[] = [
		{ env: 'R', rowIndexOffset: 1, data: 'df <- read.csv("data-files/small_file.csv")' },
		{ env: 'DuckDB', rowIndexOffset: 0, data: 'data-files/small_file.csv' },
		{ env: 'Polars', rowIndexOffset: 0, data: 'import polars as pl; df = pl.read_csv("data-files/small_file.csv")' },
		{ env: 'Pandas', rowIndexOffset: 0, data: 'import pandas as pd; df = pd.read_csv("data-files/small_file.csv")' }
	];

for (const { env, data, rowIndexOffset: indexOffset } of testCases) {
	test.describe('Data Explorer: Pins', { tag: [tags.WIN, tags.WEB, tags.DATA_EXPLORER] }, () => {

		test.beforeEach(async function ({ app, openDataFile, hotKeys }) {
			const { dataExplorer, console, sessions, variables } = app.workbench;

			if (env === 'DuckDB') {
				await openDataFile(join(data));
			} else {
				await sessions.start(env === 'R' ? 'r' : 'python');
				await console.pasteCodeToConsole(data, true);
				await hotKeys.showSecondarySidebar();
				await variables.doubleClickVariableRow('df');
			}
			await dataExplorer.waitForIdle();
			await dataExplorer.maximize(false);
		});

		test.afterEach(async function ({ hotKeys }) {
			await hotKeys.closeAllEditors();
		});

		test(`${env} - Rows and columns can be pinned, unpinned and persist with scrolling`, async function ({ app }) {
			const { dataExplorer } = app.workbench;

			// Initial state
			await dataExplorer.grid.expectColumnHeadersToBe(columnOrder.default);
			await dataExplorer.grid.expectRowOrderToBe(rowOrder.default, indexOffset);

			// Pin "column4"
			await dataExplorer.grid.pinColumn(4);
			await dataExplorer.grid.expectColumnsToBePinned(['column4']);
			await dataExplorer.grid.expectColumnHeadersToBe(columnOrder.pinCol4);

			// Pin "column6"
			await dataExplorer.grid.pinColumn(6);
			await dataExplorer.grid.expectColumnsToBePinned(['column4', 'column6']);
			await dataExplorer.grid.expectColumnHeadersToBe(columnOrder.pinCol4And6);

			// Pin row 8
			await dataExplorer.grid.pinRow(8);
			await dataExplorer.grid.expectRowsToBePinned([8], indexOffset);
			await dataExplorer.grid.expectRowOrderToBe(rowOrder.pinRow8, indexOffset);

			// Pin row 6
			await dataExplorer.grid.pinRow(7);
			await dataExplorer.grid.expectRowsToBePinned([8, 6], indexOffset);
			await dataExplorer.grid.expectRowOrderToBe(rowOrder.pinRow8And6, indexOffset);

			// Ensure pins persist with scrolling
			await dataExplorer.grid.clickLowerRightCorner();
			await dataExplorer.grid.expectColumnsToBePinned(['column4', 'column6']);
			await dataExplorer.grid.expectRowsToBePinned([8, 6], indexOffset);

			// Unpin columns
			await dataExplorer.grid.unpinColumn(0);
			await dataExplorer.grid.expectColumnsToBePinned(['column6']);
			await dataExplorer.grid.expectColumnHeadersToBe(columnOrder.pinCol6);

			await dataExplorer.grid.unpinColumn(0);
			await dataExplorer.grid.expectColumnsToBePinned([]);
			await dataExplorer.grid.expectColumnHeadersToBe(columnOrder.default);

			// Unpin rows
			await dataExplorer.grid.unpinRow(0);
			await dataExplorer.grid.expectRowsToBePinned([6], indexOffset);
			await dataExplorer.grid.expectRowOrderToBe(rowOrder.pinRow6, indexOffset);
			await dataExplorer.grid.unpinRow(0);
			await dataExplorer.grid.expectRowsToBePinned([], indexOffset);
			await dataExplorer.grid.expectRowOrderToBe(rowOrder.default, indexOffset);
		});

		test(`${env} - Range selection respects pinned columns (excludes vs includes cases)`, async function ({ app }) {
			const { dataExplorer } = app.workbench;

			// pin column2
			await dataExplorer.grid.pinColumn(2);
			await dataExplorer.grid.expectColumnsToBePinned(['column2']);
			await dataExplorer.grid.expectColumnHeadersToBe(columnOrder.pinCol2);

			// select range that excludes pinned column
			await dataExplorer.grid.selectRange({
				start: { row: 4, col: 4 },
				end: { row: 6, col: 1 }
			});
			await dataExplorer.grid.expectRangeToBeSelected({
				rows: [4, 5, 6],
				cols: [0, 1, 3, 4]
			});

			// select range that includes pinned column
			await dataExplorer.grid.selectRange({
				start: { row: 3, col: 0 },
				end: { row: 5, col: 2 }
			});
			await dataExplorer.grid.expectRangeToBeSelected({
				rows: [3, 4, 5],
				cols: [2, 0, 1]
			});
		});

		test(`${env} - Cell navigation works with pinned columns and rows`, async function ({ app }) {
			const { dataExplorer } = app.workbench;
			const { keyboard } = app.code.driver.page;

			// pin column 2
			await dataExplorer.grid.pinColumn(2);
			await dataExplorer.grid.expectColumnsToBePinned(['column2']);

			// pin row 8
			await dataExplorer.grid.pinRow(8);
			await dataExplorer.grid.expectRowsToBePinned([8], indexOffset);

			// verify navigation with keyboard is in right direction and doesn't skip cells
			await dataExplorer.grid.clickCell(0, 0);

			await keyboard.press('ArrowDown');
			await dataExplorer.grid.expectCellToBeSelected(1, 0);

			await keyboard.press('ArrowRight');
			await dataExplorer.grid.expectCellToBeSelected(1, 1);

			await keyboard.press('ArrowRight');
			await dataExplorer.grid.expectCellToBeSelected(1, 2);
		});

		test(`${env} - Column sorting removes pinned rows`, {
			annotation: [
				{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/9344' },
			],
		}, async function ({ app }) {
			const { dataExplorer } = app.workbench;

			// The Positron window size determines how many columns are visible in the DOM.
			// When verifying the table data, we only check the data for the first 7 columns
			// because those are the only columns that get rendered based off the window size.
			const dataPinRow5 = [
				{ 'column0': 41, 'column1': 42, 'column2': 47, 'column3': 99, 'column4': 50, 'column5': 78, 'column6': 35, 'column7': 13 },
				{ 'column0': 82, 'column1': 69, 'column2': 75, 'column3': 56, 'column4': 9, 'column5': 5, 'column6': 96, 'column7': 80 },
				{ 'column0': 8, 'column1': 79, 'column2': 99, 'column3': 13, 'column4': 8, 'column5': 83, 'column6': 21, 'column7': 76 },
				{ 'column0': 75, 'column1': 71, 'column2': 52, 'column3': 41, 'column4': 98, 'column5': 20, 'column6': 83, 'column7': 82 },
				{ 'column0': 52, 'column1': 48, 'column2': 14, 'column3': 12, 'column4': 37, 'column5': 85, 'column6': 82, 'column7': 36 },
				{ 'column0': 7, 'column1': 3, 'column2': 75, 'column3': 17, 'column4': 54, 'column5': 33, 'column6': 16, 'column7': 15 },
				{ 'column0': 97, 'column1': 79, 'column2': 8, 'column3': 89, 'column4': 80, 'column5': 61, 'column6': 33, 'column7': 21 },
				{ 'column0': 38, 'column1': 91, 'column2': 5, 'column3': 33, 'column4': 85, 'column5': 45, 'column6': 41, 'column7': 39 },
				{ 'column0': 22, 'column1': 9, 'column2': 4, 'column3': 43, 'column4': 40, 'column5': 73, 'column6': 79, 'column7': 98 },
				{ 'column0': 30, 'column1': 8, 'column2': 19, 'column3': 47, 'column4': 46, 'column5': 15, 'column6': 88, 'column7': 15 }
			];
			const dataPinRow5AndCol4 = [
				{ 'column4': 50, 'column0': 41, 'column1': 42, 'column2': 47, 'column3': 99, 'column5': 78, 'column6': 35, 'column7': 13 },
				{ 'column4': 9, 'column0': 82, 'column1': 69, 'column2': 75, 'column3': 56, 'column5': 5, 'column6': 96, 'column7': 80 },
				{ 'column4': 8, 'column0': 8, 'column1': 79, 'column2': 99, 'column3': 13, 'column5': 83, 'column6': 21, 'column7': 76 },
				{ 'column4': 98, 'column0': 75, 'column1': 71, 'column2': 52, 'column3': 41, 'column5': 20, 'column6': 83, 'column7': 82 },
				{ 'column4': 37, 'column0': 52, 'column1': 48, 'column2': 14, 'column3': 12, 'column5': 85, 'column6': 82, 'column7': 36 },
				{ 'column4': 54, 'column0': 7, 'column1': 3, 'column2': 75, 'column3': 17, 'column5': 33, 'column6': 16, 'column7': 15 },
				{ 'column4': 80, 'column0': 97, 'column1': 79, 'column2': 8, 'column3': 89, 'column5': 61, 'column6': 33, 'column7': 21 },
				{ 'column4': 85, 'column0': 38, 'column1': 91, 'column2': 5, 'column3': 33, 'column5': 45, 'column6': 41, 'column7': 39 },
				{ 'column4': 40, 'column0': 22, 'column1': 9, 'column2': 4, 'column3': 43, 'column5': 73, 'column6': 79, 'column7': 98 },
				{ 'column4': 46, 'column0': 30, 'column1': 8, 'column2': 19, 'column3': 47, 'column5': 15, 'column6': 88, 'column7': 15 }
			];
			const dataPinCol4SortCol4 = [
				{ 'column4': 98, 'column0': 75, 'column1': 71, 'column2': 52, 'column3': 41, 'column5': 20, 'column6': 83, 'column7': 82 },
				{ 'column4': 85, 'column0': 38, 'column1': 91, 'column2': 5, 'column3': 33, 'column5': 45, 'column6': 41, 'column7': 39 },
				{ 'column4': 80, 'column0': 97, 'column1': 79, 'column2': 8, 'column3': 89, 'column5': 61, 'column6': 33, 'column7': 21 },
				{ 'column4': 54, 'column0': 7, 'column1': 3, 'column2': 75, 'column3': 17, 'column5': 33, 'column6': 16, 'column7': 15 },
				{ 'column4': 50, 'column0': 41, 'column1': 42, 'column2': 47, 'column3': 99, 'column5': 78, 'column6': 35, 'column7': 13 },
				{ 'column4': 46, 'column0': 30, 'column1': 8, 'column2': 19, 'column3': 47, 'column5': 15, 'column6': 88, 'column7': 15 },
				{ 'column4': 40, 'column0': 22, 'column1': 9, 'column2': 4, 'column3': 43, 'column5': 73, 'column6': 79, 'column7': 98 },
				{ 'column4': 37, 'column0': 52, 'column1': 48, 'column2': 14, 'column3': 12, 'column5': 85, 'column6': 82, 'column7': 36 },
				{ 'column4': 9, 'column0': 82, 'column1': 69, 'column2': 75, 'column3': 56, 'column5': 5, 'column6': 96, 'column7': 80 },
				{ 'column4': 8, 'column0': 8, 'column1': 79, 'column2': 99, 'column3': 13, 'column5': 83, 'column6': 21, 'column7': 76 }
			];
			const dataSortCol4PinRow6 = [
				{ 'column4': 40, 'column0': 22, 'column1': 9, 'column2': 4, 'column3': 43, 'column5': 73, 'column6': 79, 'column7': 98 },
				{ 'column4': 98, 'column0': 75, 'column1': 71, 'column2': 52, 'column3': 41, 'column5': 20, 'column6': 83, 'column7': 82 },
				{ 'column4': 85, 'column0': 38, 'column1': 91, 'column2': 5, 'column3': 33, 'column5': 45, 'column6': 41, 'column7': 39 },
				{ 'column4': 80, 'column0': 97, 'column1': 79, 'column2': 8, 'column3': 89, 'column5': 61, 'column6': 33, 'column7': 21 },
				{ 'column4': 54, 'column0': 7, 'column1': 3, 'column2': 75, 'column3': 17, 'column5': 33, 'column6': 16, 'column7': 15 },
				{ 'column4': 50, 'column0': 41, 'column1': 42, 'column2': 47, 'column3': 99, 'column5': 78, 'column6': 35, 'column7': 13 },
				{ 'column4': 46, 'column0': 30, 'column1': 8, 'column2': 19, 'column3': 47, 'column5': 15, 'column6': 88, 'column7': 15 },
				{ 'column4': 37, 'column0': 52, 'column1': 48, 'column2': 14, 'column3': 12, 'column5': 85, 'column6': 82, 'column7': 36 },
				{ 'column4': 9, 'column0': 82, 'column1': 69, 'column2': 75, 'column3': 56, 'column5': 5, 'column6': 96, 'column7': 80 },
				{ 'column4': 8, 'column0': 8, 'column1': 79, 'column2': 99, 'column3': 13, 'column5': 83, 'column6': 21, 'column7': 76 }
			];
			const dataPinCol4 = [
				{ 'column4': 9, 'column0': 82, 'column1': 69, 'column2': 75, 'column3': 56, 'column5': 5, 'column6': 96, 'column7': 80 },
				{ 'column4': 8, 'column0': 8, 'column1': 79, 'column2': 99, 'column3': 13, 'column5': 83, 'column6': 21, 'column7': 76 },
				{ 'column4': 98, 'column0': 75, 'column1': 71, 'column2': 52, 'column3': 41, 'column5': 20, 'column6': 83, 'column7': 82 },
				{ 'column4': 37, 'column0': 52, 'column1': 48, 'column2': 14, 'column3': 12, 'column5': 85, 'column6': 82, 'column7': 36 },
				{ 'column4': 54, 'column0': 7, 'column1': 3, 'column2': 75, 'column3': 17, 'column5': 33, 'column6': 16, 'column7': 15 },
				{ 'column4': 50, 'column0': 41, 'column1': 42, 'column2': 47, 'column3': 99, 'column5': 78, 'column6': 35, 'column7': 13 },
				{ 'column4': 80, 'column0': 97, 'column1': 79, 'column2': 8, 'column3': 89, 'column5': 61, 'column6': 33, 'column7': 21 },
				{ 'column4': 85, 'column0': 38, 'column1': 91, 'column2': 5, 'column3': 33, 'column5': 45, 'column6': 41, 'column7': 39 },
				{ 'column4': 40, 'column0': 22, 'column1': 9, 'column2': 4, 'column3': 43, 'column5': 73, 'column6': 79, 'column7': 98 },
				{ 'column4': 46, 'column0': 30, 'column1': 8, 'column2': 19, 'column3': 47, 'column5': 15, 'column6': 88, 'column7': 15 }
			];

			// maximize to ensure all rows/columns are rendered and visible
			await dataExplorer.maximize(false);

			// pin row 5
			await dataExplorer.grid.pinRow(5); // pins the 6th row
			await dataExplorer.grid.verifyTableData(dataPinRow5);

			// pin column 4
			await dataExplorer.grid.pinColumn(4); // pins 'column4'
			await dataExplorer.grid.expectColumnsToBePinned(['column4']);
			await dataExplorer.grid.verifyTableData(dataPinRow5AndCol4);

			// sort 'column 4' - this should only clear the pinned rows
			await dataExplorer.grid.sortColumnBy(1, 'Sort Descending');
			await dataExplorer.grid.expectRowsToBePinned([], indexOffset);
			await dataExplorer.grid.expectColumnsToBePinned(['column4']);
			await dataExplorer.grid.verifyTableData(dataPinCol4SortCol4);

			// pin row 6
			await dataExplorer.grid.pinRow(6); // pins the 7th row in the current sort order
			await dataExplorer.grid.verifyTableData(dataSortCol4PinRow6);

			// clear 'column4' sort - this should only clear the pinned rows
			await dataExplorer.grid.sortColumnBy(1, 'Clear Sorting');
			await dataExplorer.grid.expectColumnsToBePinned(['column4']);
			await dataExplorer.grid.expectRowsToBePinned([], indexOffset);
			await dataExplorer.grid.verifyTableData(dataPinCol4);
		});
	});
}
