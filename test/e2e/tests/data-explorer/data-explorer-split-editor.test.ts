/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Data Explorer: Split Editor Visibility
 *
 * Verifies that a data explorer instance shared across multiple editor
 * panes remains functional when one pane is closed. This guards against
 * regressions where closing a split pane incorrectly hides the shared
 * instance, causing the remaining pane to stop rendering data.
 *
 * Flow:
 * - Open a data file in the data explorer
 * - Split the editor so the same instance appears in two panes
 * - Close one pane
 * - Verify the remaining pane still renders data correctly
 * - Apply a filter and verify the data updates
 */

import { expect } from '@playwright/test';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Data Explorer - Split Editor', {
	tag: [tags.WEB, tags.WIN, tags.DATA_EXPLORER]
}, () => {

	test.afterEach(async function ({ app, hotKeys }) {
		await app.workbench.dataExplorer.filters.clearAll();
		await hotKeys.closeAllEditors();
	});

	test('Data remains visible after closing one split pane', async function ({ app, openDataFile }) {
		const { editors, dataExplorer, editorActionBar } = app.workbench;

		// Open a parquet file in the data explorer.
		await openDataFile('data-files/flights/flights.parquet');
		const tabName = 'flights.parquet';
		await editors.verifyTab(tabName, { isVisible: true, isSelected: true });
		await dataExplorer.waitForIdle();

		// Verify initial data renders.
		await dataExplorer.grid.clickCell(0, 0);
		await dataExplorer.grid.expectCellContentToBe({ rowIndex: 0, colIndex: 0, value: '2013' });

		// Split the editor so the same data explorer shows in two panes.
		await editorActionBar.clickButton('Split Editor Right');
		await editorActionBar.verifySplitEditor('right', tabName);
		// verifySplitEditor closes one of the split tabs, leaving one pane.

		// Verify the remaining pane still renders data after the split
		// pane was closed.
		await dataExplorer.waitForIdle();
		await dataExplorer.grid.clickCell(0, 0);
		await dataExplorer.grid.expectCellContentToBe({ rowIndex: 0, colIndex: 0, value: '2013' });

		// Verify that filtering still works, confirming the instance is
		// fully functional (not in a deferred/hidden state).
		await dataExplorer.filters.add({ columnName: 'month', condition: 'is equal to', value: '1' });
		await dataExplorer.waitForIdle();
		expect(await dataExplorer.grid.getRowCount()).toBe(27004);
	});
});
