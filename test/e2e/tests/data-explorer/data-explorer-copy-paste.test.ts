/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * Verifies Data Explorer copy and paste behavior:
 *   - Copying and pasting works with unsorted data
 *   - Copying and pasting works with sorted data
 *   - Copying and pasting works with pinned rows and columns
 */

// import { join } from 'path';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

// const openFileWith = ['DuckDB', 'Code'];


test.describe('Data Explorer: Copy/Paste', { tag: [tags.WIN, tags.WEB, tags.DATA_EXPLORER] }, () => {

	test.beforeEach(async function ({ app, openDataFile }) {
		// const { dataExplorer, } = app.workbench;
		// await openDataFile(join('data-files', 'small_file.csv'));

		const { dataExplorer, console, variables, sessions } = app.workbench;
		await sessions.start('r');
		await console.pasteCodeToConsole('df <- read.csv("data-files/small_file.csv")', true)
		await variables.doubleClickVariableRow('df');



		// maximize data view
		await dataExplorer.maximize();
		await dataExplorer.waitForIdle();
		await dataExplorer.summaryPanel.hide();
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test("Copy and Paste with unsorted data", async function ({ app }) {
		const { dataExplorer, clipboard } = app.workbench;

		// verify copy and paste on columns
		await dataExplorer.grid.clickColumnHeader('column3');
		await clipboard.copy();
		await clipboard.expectClipboardTextToBe('column3\n56\n13\n41\n12\n17\n99\n89\n33\n43\n47');

		// verify copy and paste on rows
		await dataExplorer.grid.clickRowHeader(9);
		await clipboard.copy();
		// TODO: bug
		// await clipboard.expectClipboardTextToBe('column0\tcolumn1\tcolumn2\tcolumn3\tcolumn4\tcolumn5\tcolumn6\tcolumn7\tcolumn8\tcolumn9\n22\t9\t4\t43\t40\t73\t79\t98\t80\t24');

		// verify copy and paste on cell
		await dataExplorer.grid.clickCell(6, 2);
		await clipboard.copy();
		await clipboard.expectClipboardTextToBe('8');

		// TODO: bug - for data frame case
		// verify copy and paste on range
		// await dataExplorer.grid.selectRange({ startCell: { row: 0, col: 0 }, endCell: { row: 1, col: 1 } });
		// await clipboard.copy();
		// await clipboard.expectClipboardTextToBe('column0\tcolumn1\n82\t69\n8\t79');
	})

	test("Copy and Paste with sorted data", async function ({ app }) {
		const { dataExplorer, clipboard } = app.workbench;

		// verify copy and paste on columns
		await dataExplorer.grid.selectColumnAction(4, 'Sort Descending');
		await dataExplorer.grid.clickColumnHeader('column3');
		await clipboard.copy();
		await clipboard.expectClipboardTextToBe('column3\n99\n89\n56\n47\n43\n41\n33\n17\n13\n12');

		// verify copy and paste on rows
		await dataExplorer.grid.clickRowHeader(4);
		// await clipboard.copy();
		// await clipboard.expectClipboardTextToBe('column0\tcolumn1\tcolumn2\tcolumn3\tcolumn4\tcolumn5\tcolumn6\tcolumn7\tcolumn8\tcolumn9\n22\t9\t4\t43\t40\t73\t79\t98\t80\t24');

		// verify copy and paste on cell
		await dataExplorer.grid.clickCell(6, 4);
		await clipboard.copy();
		await clipboard.expectClipboardTextToBe('33');

		// verify copy and paste on range
		// await dataExplorer.grid.selectRange({ startCell: { row: 0, col: 2 }, endCell: { row: 1, col: 3 } });
		// await clipboard.copy();
		// await clipboard.expectClipboardTextToBe('column2\tcolumn3\n47\t99\n8\t89');
	});

	test.skip("Copy and Paste with pinned data", async function ({ app }) {
		const { dataExplorer, clipboard } = app.workbench;

		// pin column 4
		await dataExplorer.grid.pinColumn(4);
		await dataExplorer.grid.expectColumnsToBePinned(['column4']);

		// pin row 5
		await dataExplorer.grid.pinRow(5);
		await dataExplorer.grid.expectRowsToBePinned([5]);

		// select range
		await dataExplorer.grid.selectRange({ startCell: { row: 0, col: 0 }, endCell: { row: 2, col: 2 } });
		await dataExplorer.grid.expectRangeToBeSelected({
			rows: [5, 0, 1],
			cols: [4, 0, 1]
		});

		await dataExplorer.grid.clickUpperLeftCorner()
		await clipboard.copy();
		await clipboard.expectClipboardTextToBe('column4\tcolumn0\tcolumn1\n50\t41\t42\n9\t82\t69\n8\t8\t79');
	});
	// test("Column sorting works with row and column pins", async function ({ app }) {
	// 	const { dataExplorer } = app.workbench;

	// 	// pin column 4
	// 	await dataExplorer.grid.pinColumn(4);
	// 	await dataExplorer.grid.expectColumnsToBePinned(['column4']);

	// 	// pin row 5
	// 	await dataExplorer.grid.pinRow(5);
	// 	await dataExplorer.grid.expectRowsToBePinned([5]);

	// 	// sort by column 4
	// 	await dataExplorer.grid.sortColumn(4);
	// 	await dataExplorer.grid.expectRowOrderToBe([5, 6, 7, 8, 9, 0, 1, 2, 3, 4]);
	// });

	test.skip("Copy and Paste works with pinned rows and cols", async function ({ app }) {
		const { dataExplorer, clipboard } = app.workbench;

		// pin column 4
		await dataExplorer.grid.pinColumn(4);
		await dataExplorer.grid.expectColumnsToBePinned(['column4']);

		// pin row 5
		await dataExplorer.grid.pinRow(5);
		await dataExplorer.grid.expectRowsToBePinned([5]);

		// select range
		await dataExplorer.grid.selectRange({ startCell: { row: 0, col: 0 }, endCell: { row: 2, col: 2 } });
		await dataExplorer.grid.expectRangeToBeSelected({
			rows: [5, 0, 1],
			cols: [4, 0, 1]
		});

		await dataExplorer.grid.clickUpperLeftCorner()
		await clipboard.copy();
		await clipboard.expectClipboardTextToBe('column4\tcolumn0\tcolumn1\n50\t41\t42\n9\t82\t69\n8\t8\t79');
	});

	test("Copy and Paste works with sorted data", async function ({ app }) {
		const { dataExplorer, clipboard } = app.workbench;

		// verify basic copy paste works on sorted data
		await clipboard.expectClipboardTextToBe('column3\n56\n13\n41\n12\n17\n99\n89\n33\n43\n47');
		await dataExplorer.grid.selectColumnAction(3, 'Sort Descending');
		await dataExplorer.grid.clickColumnHeader('column3');
		await clipboard.copy();
		await clipboard.expectClipboardTextToBe('column3\n99\n89\n56\n47\n43\n41\n33\n17\n13\n12');

		// pin column and confirm still sorted
		await dataExplorer.grid.pinColumn(3);
		await dataExplorer.grid.expectColumnsToBePinned(['column3']);
		await clipboard.copy();
		await clipboard.expectClipboardTextToBe('column3\n99\n89\n56\n47\n43\n41\n33\n17\n13\n12');

		// pin row and confirm new sort order
		await dataExplorer.grid.pinRow(5);
		await dataExplorer.grid.expectRowsToBePinned([5]);
		await clipboard.expectClipboardTextToBe('column3\n41\n99\n89\n56\n47\n43\n33\n17\n13\n12');
	});
})
