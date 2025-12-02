/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Simple Test: Files Pane Refresh
// Description: Verify that the Files pane refreshes after creating a file via the console.

import { test, tags, } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Files Pane Refresh', { tag: [tags.WEB, tags.WORKBENCH, tags.CONSOLE] }, () => {

	test.afterAll(async ({ cleanup }) => {
		await cleanup.removeTestFiles(['file.txt']);
	});

	test('Files pane refreshes after creating file.txt via console', async function ({ app, r }) {
		const { console, explorer } = app.workbench;

		await console.createFile('R', 'file.txt');
		await explorer.verifyExplorerFilesExist(['file.txt']);
	});
});

