/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

// Not running on web due to https://github.com/posit-dev/positron/issues/9193
test.describe('Postiron Notebooks: Cell Undo-Redo Behavior', {
	tag: [tags.CRITICAL, tags.WIN, tags.NOTEBOOKS]
}, () => {

	test.beforeAll(async function ({ app, settings }) {
		await app.workbench.notebooksPositron.enableFeature(settings, {
			editor: 'positron',
			reload: true,
		});
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Should correctly undo and redo cell actions', async function ({ app }) {
		const { notebooks, notebooksPositron } = app.workbench;

		await test.step('Test Setup: Create notebook', async () => {
			await notebooks.createNewNotebook();
			await notebooksPositron.expectToBeVisible();
		});

		// ========================================
		// Test 1: Basic add cell and undo/redo
		// ========================================
		await test.step('Test 1: Add cell and undo/redo', async () => {
			// Start with initial cell
			await notebooksPositron.addCodeToCell(0, '# Initial Cell');
			await notebooksPositron.expectCellCountToBe(1);
			await notebooksPositron.expectCellContentAtIndexToBe(0, '# Initial Cell');

			// Add a second cell
			await notebooksPositron.selectCellAtIndex(0);
			await notebooksPositron.performCellAction('addCellBelow');
			await notebooksPositron.addCodeToCell(1, '# Second Cell');
			await notebooksPositron.expectCellCountToBe(2);
			await notebooksPositron.expectCellContentAtIndexToBe(1, '# Second Cell');

			// Undo the add cell operation
			await notebooksPositron.performCellAction('undo');
			await notebooksPositron.expectCellCountToBe(1);
			await notebooksPositron.expectCellContentAtIndexToBe(0, '# Initial Cell');

			// Redo the add cell operation to add back cell
			await notebooksPositron.performCellAction('redo');
			await notebooksPositron.expectCellCountToBe(2);
			await notebooksPositron.expectCellContentAtIndexToBe(1, '# Second Cell');
		});

		// ========================================
		// Test 2: Delete cell and undo/redo
		// ========================================
		await test.step('Test 2: Delete cell and undo/redo', async () => {
			// Add a third cell for deletion test
			await notebooksPositron.selectCellAtIndex(1);
			await notebooksPositron.performCellAction('addCellBelow');
			await notebooksPositron.addCodeToCell(2, '# Cell to Delete');
			await notebooksPositron.expectCellCountToBe(3);

			// Delete the middle cell
			await notebooksPositron.selectCellAtIndex(1);
			await notebooksPositron.performCellAction('delete');
			await notebooksPositron.expectCellCountToBe(2);
			await notebooksPositron.expectCellContentAtIndexToBe(0, '# Initial Cell');
			await notebooksPositron.expectCellContentAtIndexToBe(1, '# Cell to Delete');

			// Undo the delete
			await notebooksPositron.performCellAction('undo');
			await notebooksPositron.expectCellCountToBe(3);
			await notebooksPositron.expectCellContentAtIndexToBe(1, '# Second Cell');
			await notebooksPositron.expectCellContentAtIndexToBe(2, '# Cell to Delete');

			// Redo the delete
			await notebooksPositron.performCellAction('redo');
			await notebooksPositron.expectCellCountToBe(2);
			await notebooksPositron.expectCellContentAtIndexToBe(1, '# Cell to Delete');
		})
	});
});
