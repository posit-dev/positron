/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags } from '../_test.setup';

const expectedData = {
	'col3': 'column3\n56\n13\n41\n12\n17\n99\n89\n33\n43\n47',
	'col3_sorted_desc': 'column3\n99\n89\n56\n47\n43\n41\n33\n17\n13\n12',
	'col4_col0_col1': 'column4\tcolumn0\tcolumn1\n50\t41\t42\n9\t82\t69\n8\t8\t79',
	'col0_col1': 'column0\tcolumn1\n82\t69\n8\t79',
	'col5': 'column5\n42\n79\n8\n12\n17\n99\n89\n33\n43\n47',
	'row4': 'column0\tcolumn1\tcolumn2\tcolumn3\tcolumn4\tcolumn5\tcolumn6\tcolumn7\tcolumn8\tcolumn9\n22\t9\t4\t43\t40\t73\t79\t98\t80\t24',
	'row9': 'column0\tcolumn1\tcolumn2\tcolumn3\tcolumn4\tcolumn5\tcolumn6\tcolumn7\tcolumn8\tcolumn9\n30\t8\t19\t47\t46\t15\t88\t15\t84\t38',
	'row9_sorted_desc': 'column0\tcolumn1\tcolumn2\tcolumn3\tcolumn4\tcolumn5\tcolumn6\tcolumn7\tcolumn8\tcolumn9\n22\t9\t4\t43\t40\t73\t79\t98\t80\t24'
};

const testCases: {
	env: 'Polars' | 'Pandas' | 'R' | 'DuckDB';
	rowIndexOffset: number;
	data: string;
	tags: string[];
}[] = [
		{ env: 'R', rowIndexOffset: 1, data: 'df <- read.csv("data-files/small_file.csv")', tags: [tags.WIN] },
		{ env: 'DuckDB', rowIndexOffset: 0, data: 'data-files/small_file.csv', tags: [tags.WIN] },
		{ env: 'Polars', rowIndexOffset: 0, data: 'import polars as pl; df = pl.read_csv("data-files/small_file.csv")', tags: [tags.WIN] },
		// Note: Pandas test is problematic on Windows in CI and the clipboard content is incorrect. Jon confirmed manually on his Windows machine that it works.
		{ env: 'Pandas', rowIndexOffset: 0, data: 'import pandas as pd; df = pd.read_csv("data-files/small_file.csv")', tags: [] }
	];

test.use({
	suiteId: __filename
});

for (const { env, data, rowIndexOffset: indexOffset, tags: testTags = [] } of testCases) {
	test.describe('Data Explorer: Copy/Paste', { tag: [tags.WEB, tags.DATA_EXPLORER, ...testTags] }, () => {

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

			// maximize data view
			await dataExplorer.waitForIdle();
			await dataExplorer.maximize(true);
		});

		test.afterEach(async function ({ hotKeys }) {
			await hotKeys.closeAllEditors();
		});

		test(`${env} - Copy and paste works on cells, rows, columns, and ranges of unsorted data`, async function ({ app }) {
			const { dataExplorer, clipboard } = app.workbench;

			// verify copy and paste on columns
			await dataExplorer.grid.clickColumnHeader('column3');
			await clipboard.copy();
			await clipboard.expectClipboardTextToBe(expectedData['col3'], '\n');

			// verify copy and paste on rows
			await dataExplorer.grid.clickRowHeader(9);
			await clipboard.copy();
			await clipboard.expectClipboardTextToBe(expectedData['row9'], '\n');

			// verify copy and paste on cell
			await dataExplorer.grid.clickCell(6, 2);
			await clipboard.copy();
			await clipboard.expectClipboardTextToBe('8');

			// verify copy and paste on range
			await dataExplorer.grid.selectRange({ start: { row: 0, col: 0 }, end: { row: 1, col: 1 } });
			await clipboard.copy();
			await clipboard.expectClipboardTextToBe(expectedData['col0_col1'], '\n');
		});

		test(`${env} - Copy and paste works on cells, rows, columns, and ranges of sorted data`, async function ({ app }) {
			const { dataExplorer, clipboard } = app.workbench;

			// verify copy and paste on columns
			await dataExplorer.grid.selectColumnAction(4, 'Sort Descending');
			await dataExplorer.grid.clickColumnHeader('column3');
			await clipboard.copy();
			await clipboard.expectClipboardTextToBe(expectedData['col3_sorted_desc'], '\n');

			// verify copy and paste on rows
			await dataExplorer.grid.clickRowHeader(4);
			await clipboard.copy();
			await clipboard.expectClipboardTextToBe(expectedData['row4'], '\n');

			// verify copy and paste on cell
			await dataExplorer.grid.clickCell(6, 4);
			await clipboard.copy();
			await clipboard.expectClipboardTextToBe('85');

			// verify copy and paste on range
			await dataExplorer.grid.selectRange({ start: { row: 0, col: 2 }, end: { row: 1, col: 3 } });
			await clipboard.copy();
			await clipboard.expectClipboardTextToBe('column2\tcolumn3\n47\t99\n8\t89', '\n');
		});

		test(`${env} - Copy and paste of ranges works with pinned data`, async function ({ app }) {
			const { dataExplorer, clipboard } = app.workbench;

			// pin column 4
			await dataExplorer.grid.pinColumn(4);
			await dataExplorer.grid.expectColumnsToBePinned(['column4']);

			// pin row 5
			await dataExplorer.grid.pinRow(5);
			await dataExplorer.grid.expectRowsToBePinned([5], indexOffset);

			// select range
			await dataExplorer.grid.selectRange({ start: { row: 0, col: 0 }, end: { row: 2, col: 2 } });
			await dataExplorer.grid.expectRangeToBeSelected({
				rows: [5, 0, 1],
				cols: [4, 0, 1]
			});

			await dataExplorer.grid.clickUpperLeftCorner();
			await clipboard.copy();
			await clipboard.expectClipboardTextToBe(expectedData['col4_col0_col1'], '\n');
		});
	});
}
