/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * Verifies Data Explorer Summary Panel behavior for column profiles:
 *   - Sort, search, and expand/collapse functionality
 *   - Retains expanded state across show/hide cycles
 *   - Handles edge cases like empty search results
 */

import { join } from 'path';
import { test, tags } from '../_test.setup';
import { expect } from '@playwright/test';

const columnOrder = {
	default: ['column0', 'column1', 'column2', 'column3', 'column4', 'column5', 'column6', 'column7', 'column8', 'column9'],
	descending: ['column9', 'column8', 'column7', 'column6', 'column5', 'column4', 'column3', 'column2', 'column1', 'column0'],
	pinCol3Col1Col4_ascending: ['column3', 'column1', 'column4', 'column0', 'column2', 'column5', 'column6', 'column7', 'column8', 'column9'],
	pinCol3Col1Col4_descending: ['column3', 'column1', 'column4', 'column9', 'column8', 'column7', 'column6', 'column5', 'column2', 'column0'],
	pinCol3Col4_ascending: ['column3', 'column4', 'column0', 'column1', 'column2', 'column5', 'column6', 'column7', 'column8', 'column9'],
	pinCol3Col4_descending: ['column3', 'column4', 'column9', 'column8', 'column7', 'column6', 'column5', 'column2', 'column1', 'column0'],
};

test.use({
	suiteId: __filename
});

test.describe('Data Explorer: Summary Panel', { tag: [tags.WIN, tags.WEB, tags.DATA_EXPLORER] }, () => {

	test.beforeEach(async function ({ openDataFile }) {
		await openDataFile(join('data-files', 'small_file.csv'));
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Summary Panel: Search', async function ({ app }) {
		const { dataExplorer } = app.workbench;

		// view data in data explorer
		await dataExplorer.maximize();
		await dataExplorer.waitForIdle();
		await dataExplorer.summaryPanel.show();
		await dataExplorer.summaryPanel.expectColumnCountToBe(10);
		await dataExplorer.summaryPanel.expectSortToBeBy('Original');
		await dataExplorer.summaryPanel.expectColumnOrderToBe(columnOrder.default);

		// perform basic search
		await dataExplorer.summaryPanel.search('column9');
		await dataExplorer.summaryPanel.expectColumnCountToBe(1);

		// verify collapse and expand retains in search
		await dataExplorer.summaryPanel.expandColumnProfile();
		await dataExplorer.summaryPanel.expectColumnProfileToBeExpanded(0);
		await dataExplorer.summaryPanel.hide();
		await dataExplorer.summaryPanel.show();
		await dataExplorer.summaryPanel.expectColumnProfileToBeExpanded(0);
		await dataExplorer.summaryPanel.expectColumnCountToBe(1);

		// clear search and ensure col profile still expanded
		await dataExplorer.summaryPanel.clearSearch();
		await dataExplorer.summaryPanel.expectColumnCountToBe(10);
		await dataExplorer.summaryPanel.expectColumnProfileToBeCollapsed(0);
		await dataExplorer.summaryPanel.expectColumnProfileToBeExpanded(9);

		// search with no results
		await dataExplorer.summaryPanel.search('snickerdoodle');
		await dataExplorer.summaryPanel.expectColumnCountToBe(0);
		//await dataExplorer.summaryPanel.expectEmptyState(); // <--- no empty state created in UI yet
	});

	test('Summary Panel: Sort', async function ({ app }) {
		const { dataExplorer } = app.workbench;

		// view data in data explorer
		await dataExplorer.maximize();
		await dataExplorer.waitForIdle();
		await dataExplorer.summaryPanel.show();
		await dataExplorer.summaryPanel.expectSortToBeBy('Original');
		await dataExplorer.summaryPanel.expectColumnOrderToBe(columnOrder.default);

		// perform sort
		await dataExplorer.summaryPanel.sortBy('Name, Descending');
		await dataExplorer.summaryPanel.expectColumnOrderToBe(columnOrder.descending);

		// verify column collapse and expand retains in sort
		await dataExplorer.summaryPanel.expandColumnProfile(0);
		await dataExplorer.summaryPanel.expectColumnToBe({ index: 0, name: 'column9', expanded: true });
		await dataExplorer.summaryPanel.hide();
		await dataExplorer.summaryPanel.show();
		await dataExplorer.summaryPanel.expectColumnToBe({ index: 0, name: 'column9', expanded: true });
		await dataExplorer.summaryPanel.expectColumnOrderToBe(columnOrder.descending);

		// verify changing sort retains expansion for correct column
		await dataExplorer.summaryPanel.clearSort();
		await dataExplorer.summaryPanel.expectSortToBeBy('Original');
		await dataExplorer.summaryPanel.expectColumnOrderToBe(columnOrder.default);
		await dataExplorer.summaryPanel.expectColumnToBe({ index: 0, name: 'column0', expanded: false });
		await dataExplorer.summaryPanel.expectColumnToBe({ index: 9, name: 'column9', expanded: true });
	});

	test('Summary Panel: Behavior with Pins', async function ({ app }) {
		const { dataExplorer } = app.workbench;

		// view data in data explorer
		await dataExplorer.maximize();
		await dataExplorer.waitForIdle();
		await dataExplorer.summaryPanel.show();
		await dataExplorer.summaryPanel.expectColumnCountToBe(10);
		await dataExplorer.summaryPanel.expectSortToBeBy('Original');
		await dataExplorer.summaryPanel.expectColumnOrderToBe(columnOrder.default);

		// verify pinned columns stay at front of summary panel list
		await dataExplorer.grid.pinColumn(3);
		await dataExplorer.grid.pinColumn(2); // position 2: "column1"
		await dataExplorer.grid.pinColumn(4);
		await dataExplorer.summaryPanel.expectColumnOrderToBe(columnOrder.pinCol3Col1Col4_ascending);

		// verify sort behavior with pinned columns
		await dataExplorer.summaryPanel.sortBy('Name, Descending');
		await dataExplorer.summaryPanel.expectColumnOrderToBe(columnOrder.pinCol3Col1Col4_descending);

		// verify unpinning columns returns them to correct location in summary panel list
		await dataExplorer.grid.unpinColumn(1); // unpin index 1: "column1"
		await dataExplorer.summaryPanel.expectColumnOrderToBe(columnOrder.pinCol3Col4_descending);

		// verify search with pinned columns
		await dataExplorer.summaryPanel.search('7');
		await dataExplorer.summaryPanel.expectColumnCountToBe(3); // pinned "column3" and "column4" + "column7"
		await dataExplorer.summaryPanel.expectColumnOrderToBe(['column3', 'column4', 'column7']);

		// verify column order after clearing search with pins and sort applied
		await dataExplorer.summaryPanel.sortBy('Name, Ascending');
		await dataExplorer.summaryPanel.expectColumnOrderToBe(['column3', 'column4', 'column7']);
		await dataExplorer.summaryPanel.clearSearch();
		await dataExplorer.summaryPanel.expectColumnOrderToBe(columnOrder.pinCol3Col4_ascending);
	});

	test('Summary Panel: Behavior on right', async function ({ app }) {
		const { dataExplorer } = app.workbench;

		// view data and show summary panel on right side
		await dataExplorer.maximize();
		await dataExplorer.waitForIdle();
		await dataExplorer.summaryPanel.show('right');
		await expect(dataExplorer.summaryPanel.summaryPanel).toHaveClass(/.*right-column.*/);

		// perform basic actions to ensure panel is functional
		await dataExplorer.summaryPanel.expectColumnCountToBe(10);
		await dataExplorer.summaryPanel.expectColumnOrderToBe(columnOrder.default);
		await dataExplorer.summaryPanel.sortBy('Name, Descending');
		await dataExplorer.summaryPanel.expectColumnOrderToBe(columnOrder.descending);
		await dataExplorer.summaryPanel.search('column9');
		await dataExplorer.summaryPanel.expectColumnCountToBe(1);

		// verify search is above column results
		const searchBarY = await dataExplorer.summaryPanel.sortFilter.boundingBox().then(b => b?.y ?? 0);
		const firstColumnY = await dataExplorer.summaryPanel.columnSummary.nth(0).boundingBox().then(b => b?.y ?? 0);
		expect(searchBarY).toBeLessThan(firstColumnY);
	});
});
