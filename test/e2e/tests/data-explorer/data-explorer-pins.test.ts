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

test.describe('Data Explorer: Pins', { tag: [tags.WIN, tags.WEB, tags.DATA_EXPLORER] }, () => {

	test.beforeEach(async function ({ app, openDataFile }) {
		const { dataExplorer } = app.workbench;

		await openDataFile(join('data-files', 'small_file.csv'));
		await dataExplorer.maximize(true);
		await dataExplorer.waitForIdle();
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Rows and columns can be pinned, unpinned and persist with scrolling', async function ({ app }) {
		const { dataExplorer } = app.workbench;

		// Initial state
		await dataExplorer.grid.expectColumnHeadersToBe(columnOrder.default);
		await dataExplorer.grid.expectRowOrderToBe(rowOrder.default);

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
		await dataExplorer.grid.expectRowsToBePinned([8]);
		await dataExplorer.grid.expectRowOrderToBe(rowOrder.pinRow8);

		// Pin row 6
		await dataExplorer.grid.pinRow(7); // after pinning row 8, row 6 is now at index 7
		await dataExplorer.grid.expectRowsToBePinned([8, 6]);
		await dataExplorer.grid.expectRowOrderToBe(rowOrder.pinRow8And6);

		// Ensure pins persist with scrolling
		await dataExplorer.grid.clickLowerRightCorner();
		await dataExplorer.grid.expectColumnsToBePinned(['column4', 'column6']);
		await dataExplorer.grid.expectRowsToBePinned([8, 6]);

		// Unpin columns
		await dataExplorer.grid.unpinColumn(0);
		await dataExplorer.grid.expectColumnsToBePinned(['column6']);
		await dataExplorer.grid.expectColumnHeadersToBe(columnOrder.pinCol6);

		await dataExplorer.grid.unpinColumn(0);
		await dataExplorer.grid.expectColumnsToBePinned([]);
		await dataExplorer.grid.expectColumnHeadersToBe(columnOrder.default);

		// Unpin rows
		await dataExplorer.grid.unpinRow(0);
		await dataExplorer.grid.expectRowsToBePinned([6]);
		await dataExplorer.grid.expectRowOrderToBe(rowOrder.pinRow6);
		await dataExplorer.grid.unpinRow(0);
		await dataExplorer.grid.expectRowsToBePinned([]);
		await dataExplorer.grid.expectRowOrderToBe(rowOrder.default);
	});

	test('Range selection respects pinned columns (excludes vs includes cases)', async function ({ app }) {
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

	test('Cell navigation works with pinned columns and rows', async function ({ app }) {
		const { dataExplorer } = app.workbench;
		const { keyboard } = app.code.driver.page;

		// pin column 2
		await dataExplorer.grid.pinColumn(2);
		await dataExplorer.grid.expectColumnsToBePinned(['column2']);

		// pin row 8
		await dataExplorer.grid.pinRow(8);
		await dataExplorer.grid.expectRowsToBePinned([8]);

		// verify navigation with keyboard is in right direction and doesn't skip cells
		await dataExplorer.grid.clickCell(0, 0);

		await keyboard.press('ArrowDown');
		await dataExplorer.grid.expectCellToBeSelected(1, 0);

		await keyboard.press('ArrowRight');
		await dataExplorer.grid.expectCellToBeSelected(1, 1);

		await keyboard.press('ArrowRight');
		await dataExplorer.grid.expectCellToBeSelected(1, 2);
	});

	test("Column sorting doesn't impact pin locations", async function ({ app }) {
		const { dataExplorer } = app.workbench;

		// pin column 4
		await dataExplorer.grid.pinColumn(4);
		await dataExplorer.grid.expectColumnsToBePinned(['column4']);
		await dataExplorer.grid.expectColumnHeadersToBe(columnOrder.pinCol4);

		// pin row 5
		await dataExplorer.grid.pinRow(5);
		await dataExplorer.grid.expectRowsToBePinned([5]);
		await dataExplorer.grid.expectRowOrderToBe(rowOrder.pinRow5);

		// sort by column 4
		await dataExplorer.grid.sortColumnBy(4, 'Sort Descending');
		await dataExplorer.grid.expectRowsToBePinned([5]);
		await dataExplorer.grid.expectColumnsToBePinned(['column4']);
		await dataExplorer.grid.expectRowOrderToBe(rowOrder.pinRow5);
		await dataExplorer.grid.expectColumnHeadersToBe(columnOrder.pinCol4);
	});
})
