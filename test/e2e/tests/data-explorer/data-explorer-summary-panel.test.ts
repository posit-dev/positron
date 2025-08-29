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

test.use({
	suiteId: __filename
});

test.describe('Data Explorer: Summary Panel', { tag: [tags.WIN, tags.WEB, tags.DATA_EXPLORER] }, () => {

	test.beforeAll(async function ({ settings }) {
		await settings.set({
			'dataExplorer.summaryPanelEnhancements': true
		}, { reload: 'web' });
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});


	test('Summary Panel: Search', async function ({ app, openDataFile }) {
		const { dataExplorer } = app.workbench;

		await openDataFile(join('data-files', 'small_file.csv'));

		// view data in data explorer
		await dataExplorer.maximize();
		await dataExplorer.waitForIdle();
		await dataExplorer.summaryPanel.show();
		await dataExplorer.summaryPanel.expectColumnCountToBe(10);
		await dataExplorer.summaryPanel.expectSortToBeBy('Original');
		await dataExplorer.summaryPanel.expectColumnOrderToBe(['column0', 'column1', 'column2', 'column3', 'column4', 'column5', 'column6', 'column7', 'column8', 'column9']);

		// perform basic search
		await dataExplorer.summaryPanel.search('column9');
		await dataExplorer.summaryPanel.expectColumnCountToBe(1);

		// verify collapse and expand retains in search
		await dataExplorer.summaryPanel.expandColumnProfile();
		await dataExplorer.summaryPanel.expectColumnProfileToBeExpanded(0);
		await dataExplorer.summaryPanel.hide()
		await dataExplorer.summaryPanel.show();
		await dataExplorer.summaryPanel.expectColumnProfileToBeExpanded(0);
		await dataExplorer.summaryPanel.expectColumnCountToBe(1);

		// clear search and ensure col profile still expanded
		await dataExplorer.summaryPanel.clearSearch()
		await dataExplorer.summaryPanel.expectColumnCountToBe(10);
		await dataExplorer.summaryPanel.expectColumnProfileToBeCollapsed(0)
		await dataExplorer.summaryPanel.expectColumnProfileToBeExpanded(9);

		// search with no results
		await dataExplorer.summaryPanel.search('snickerdoodle');
		// await dataExplorer.summaryPanel.expectColumnCountToBe(0); <-- NEW: search isn't working
		// await dataExplorer.summaryPanel.expectEmptyState(); // <--- no empty state created in UI yet
	});

	test('Summary Panel: Sort', async function ({ app, openDataFile }) {
		const { dataExplorer } = app.workbench;

		await openDataFile(join('data-files', 'small_file.csv'));

		// view data in data explorer
		await dataExplorer.maximize();
		await dataExplorer.waitForIdle();
		await dataExplorer.summaryPanel.show();
		await dataExplorer.summaryPanel.expectSortToBeBy('Original');
		await dataExplorer.summaryPanel.expectColumnOrderToBe(['column0', 'column1', 'column2', 'column3', 'column4', 'column5', 'column6', 'column7', 'column8', 'column9']);

		// perform sort
		await dataExplorer.summaryPanel.sortBy('Name, Descending');
		await dataExplorer.summaryPanel.expectColumnOrderToBe(['column9', 'column8', 'column7', 'column6', 'column5', 'column4', 'column3', 'column2', 'column1', 'column0']);

		// verify column collapse and expand retains in sort
		await dataExplorer.summaryPanel.expandColumnProfile(0);
		await dataExplorer.summaryPanel.expectColumnToBe({ index: 0, name: 'column9', expanded: true });
		await dataExplorer.summaryPanel.hide();
		await dataExplorer.summaryPanel.show();
		await dataExplorer.summaryPanel.expectColumnToBe({ index: 0, name: 'column9', expanded: true });
		await dataExplorer.summaryPanel.expectColumnOrderToBe(['column9', 'column8', 'column7', 'column6', 'column5', 'column4', 'column3', 'column2', 'column1', 'column0']);

		// verify changing sort retains expansion for correct column
		// await dataExplorer.summaryPanel.clearSort();
		// await dataExplorer.summaryPanel.expectSortToBeBy('Original');
		// await dataExplorer.summaryPanel.expectColumnOrderToBe(['column0', 'column1', 'column2', 'column3', 'column4', 'column5', 'column6', 'column7', 'column8', 'column9']);
		// await dataExplorer.summaryPanel.expectColumnToBe({ index: 0, name: 'column0', expanded: false });
		// await dataExplorer.summaryPanel.expectColumnToBe({ index: 9, name: 'column9', expanded: true });
	});
});
