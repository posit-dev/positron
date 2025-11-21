/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Cell Undo-Redo Behavior', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test.beforeAll(async function ({ app, settings }) {
		await app.workbench.notebooksPositron.enablePositronNotebooks(settings);
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Should correctly undo and redo cell actions', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		await notebooksPositron.newNotebook({ codeCells: 2 });

		// ========================================
		// Test 1: Basic add cell and undo/redo
		// ========================================
		await test.step('Test 1: Add cell and undo/redo', async () => {
			// Undo the last cell operation
			await notebooksPositron.selectCellAtIndex(1, { editMode: false });
			await notebooksPositron.performCellAction('undo');
			await notebooksPositron.expectCellCountToBe(1);
			await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 0');

			// Redo the add cell operation to add back cell
			await notebooksPositron.performCellAction('redo');
			await notebooksPositron.expectCellCountToBe(2);
			await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1']);
		});

		// ========================================
		// Test 2: Delete cell and undo/redo
		// ========================================
		await test.step('Test 2: Delete cell and undo/redo', async () => {
			// Add a third cell for deletion test
			await notebooksPositron.selectCellAtIndex(1, { editMode: false });
			await notebooksPositron.performCellAction('addCellBelow');
			await notebooksPositron.addCodeToCell(2, '# Cell to Delete');
			await notebooksPositron.expectCellCountToBe(3);

			// Delete the middle cell
			await notebooksPositron.selectCellAtIndex(1, { editMode: false });
			await notebooksPositron.performCellAction('delete');
			await notebooksPositron.expectCellCountToBe(2);
			await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell to Delete']);

			// Undo the delete
			await notebooksPositron.performCellAction('undo');
			await notebooksPositron.expectCellCountToBe(3);
			await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell to Delete']);

			// Redo the delete
			await notebooksPositron.performCellAction('redo');
			await notebooksPositron.expectCellCountToBe(2);
			await notebooksPositron.expectCellContentAtIndexToBe(1, '# Cell to Delete');
		});
	});
});
