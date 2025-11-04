/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { expect } from '@playwright/test';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Cell Copy-Paste Behavior', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test.beforeAll(async ({ app, settings }) => {
		await app.workbench.notebooksPositron.enablePositronNotebooks(settings);
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Should correctly copy and paste cell content in various scenarios', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// ========================================
		// Setup: Create 5 cells with distinct content
		// ========================================
		await test.step('Test Setup: Create notebook and add cells', async () => {
			await notebooksPositron.newNotebook(5);
			await notebooksPositron.expectCellCountToBe(5);
		});

		// ========================================
		// Test 1: Copy single cell and paste at end
		// ========================================
		await test.step('Test 1: Copy single cell and paste at end', async () => {
			// Perform copy on cell 2
			await notebooksPositron.selectCellAtIndex(2, { editMode: false });
			await notebooksPositron.expectCellContentAtIndexToBe(2, '# Cell 2');
			await notebooksPositron.performCellAction('copy');

			// Move to last cell and perform paste
			await notebooksPositron.selectCellAtIndex(4, { editMode: false });
			await notebooksPositron.performCellAction('paste');
			await notebooksPositron.expectCellCountToBe(6);

			// Verify pasted contents are correct at new index 5
			expect(await notebooksPositron.getCellContent(5)).toBe('# Cell 2');
		});

		// ========================================
		// Test 2: Cut single cell and paste at different position
		// ========================================
		await test.step('Test 2: Cut single cell and paste at different position', async () => {
			// Perform cut on cell 1
			await notebooksPositron.selectCellAtIndex(1, { editMode: false });
			await notebooksPositron.expectCellContentAtIndexToBe(1, '# Cell 1');
			await notebooksPositron.performCellAction('cut');

			// Verify cell count decreased and cell 1 is removed
			await notebooksPositron.expectCellCountToBe(5);
			await notebooksPositron.expectCellContentAtIndexToBe(1, '# Cell 2');

			// Move to index 3 and paste
			await notebooksPositron.selectCellAtIndex(3, { editMode: false });
			await notebooksPositron.performCellAction('paste');

			// Verify cell count restored and cell content is correct
			await notebooksPositron.expectCellCountToBe(6);
			await notebooksPositron.expectCellContentAtIndexToBe(4, '# Cell 1');
		});

		// ========================================
		// Test 3: Copy cell and paste multiple times (clipboard persistence)
		// ========================================
		await test.step('Test 3: Copy cell and paste multiple times (clipboard persistence)', async () => {
			await notebooksPositron.expectCellCountToBe(6);

			// Copy cell 0
			await notebooksPositron.selectCellAtIndex(0, { editMode: false });
			await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 0');
			await notebooksPositron.performCellAction('copy');

			// Paste at position 2
			await notebooksPositron.selectCellAtIndex(2, { editMode: false });
			await notebooksPositron.performCellAction('paste');

			// Verify first paste
			await notebooksPositron.expectCellCountToBe(7);
			await notebooksPositron.expectCellContentAtIndexToBe(3, '# Cell 0');

			// Paste again at position 5
			await notebooksPositron.selectCellAtIndex(5, { editMode: false });
			await notebooksPositron.performCellAction('paste');

			// Verify second paste
			await notebooksPositron.expectCellCountToBe(8);
			await notebooksPositron.expectCellContentAtIndexToBe(6, '# Cell 0');
		});

		// ========================================
		// Test 4: Cut and paste at beginning of notebook
		// ========================================
		await test.step('Test 4: Cut and paste at beginning of notebook', async () => {
			// Cut cell 4 (from the middle of the notebook)
			await notebooksPositron.selectCellAtIndex(4, { editMode: false });
			const cellToMoveContent = await notebooksPositron.getCellContent(4);
			await notebooksPositron.performCellAction('cut');
			await notebooksPositron.expectCellCountToBe(7);

			// Move to first cell and paste
			await notebooksPositron.selectCellAtIndex(0, { editMode: false });
			await notebooksPositron.performCellAction('paste');

			// Verify cell count restored and content is correct
			await notebooksPositron.expectCellCountToBe(8);
			await notebooksPositron.expectCellContentAtIndexToBe(1, cellToMoveContent);
		});

		// ========================================
		// Test 5: Cut all cells and verify notebook can be empty
		// ========================================
		await test.step('Verify other cells shifted down correctly', async () => {
			while (await notebooksPositron.getCellCount() > 0) {
				await notebooksPositron.selectCellAtIndex(0, { editMode: false });
				await notebooksPositron.performCellAction('cut');
			}

			await notebooksPositron.expectCellCountToBe(0);
		});
	});
});
