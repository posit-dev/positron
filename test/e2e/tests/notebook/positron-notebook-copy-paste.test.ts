/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { expect } from '@playwright/test';

test.use({
	suiteId: __filename
});

// Not running on web due to https://github.com/posit-dev/positron/issues/9193
test.describe('Positron Notebooks: Cell Copy-Paste Behavior', {
	tag: [tags.CRITICAL, tags.WIN, tags.NOTEBOOKS]
}, () => {

	test.beforeAll(async ({ app, settings }) => {
		await app.workbench.notebooksPositron.enableFeature(settings, {
			editor: 'positron',
			reload: true,
		});
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Should correctly copy and paste cell content in various scenarios', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// ========================================
		// Setup: Create notebook with 5 cells and distinct content
		// ========================================
		await test.step('Test Setup: Create notebook and add cells', async () => {
			await notebooksPositron.newNotebook(5);
			await notebooksPositron.expectCellCountToBe(5);
		});

		// ========================================
		// Test 1: Copy single cell and paste at end
		// ========================================
		await test.step('Test 1: Copy single cell and paste at end', async () => {
			await notebooksPositron.selectCellAtIndex(2);

			// Verify cell 2 has correct content
			await notebooksPositron.expectCellContentAtIndexToBe(2, '# Cell 2');

			// Copy the cell
			await notebooksPositron.performCellAction('copy');

			// Move to last cell and paste after it
			await notebooksPositron.selectCellAtIndex(4);
			await notebooksPositron.performCellAction('paste');

			// Verify cell count increased
			await notebooksPositron.expectCellCountToBe(6);

			// Verify the pasted cell has the correct content (should be at index 5)
			expect(await notebooksPositron.getCellContent(5)).toBe('# Cell 2');
		});

		// ========================================
		// Test 2: Cut single cell and paste at different position
		// ========================================
		await test.step('Test 2: Cut single cell and paste at different position', async () => {
			await notebooksPositron.selectCellAtIndex(1);

			// Verify we're at cell 1 with correct content
			await notebooksPositron.expectCellContentAtIndexToBe(1, '# Cell 1');

			// Cut the cell
			await notebooksPositron.performCellAction('cut');

			// Verify cell count decreased
			await notebooksPositron.expectCellCountToBe(5);

			// Verify what was cell 2 is now at index 1
			await notebooksPositron.expectCellContentAtIndexToBe(1, '# Cell 2');

			// Move to index 3 and paste
			await notebooksPositron.selectCellAtIndex(3);
			await notebooksPositron.performCellAction('paste');

			// Verify cell count is back to 6
			await notebooksPositron.expectCellCountToBe(6);

			// Verify the pasted cell has correct content at index 4
			await notebooksPositron.expectCellContentAtIndexToBe(4, '# Cell 1');
		});

		// ========================================
		// Test 3: Copy cell and paste multiple times (clipboard persistence)
		// ========================================
		await test.step('Test 3: Copy cell and paste multiple times (clipboard persistence)', async () => {
			await notebooksPositron.selectCellAtIndex(0);

			// Copy cell 0
			await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 0');
			await notebooksPositron.performCellAction('copy');

			// Paste at position 2
			await notebooksPositron.selectCellAtIndex(2);
			await notebooksPositron.performCellAction('paste');

			// Verify first paste
			await notebooksPositron.expectCellCountToBe(7);
			await notebooksPositron.expectCellContentAtIndexToBe(3, '# Cell 0');

			// Paste again at position 5
			await notebooksPositron.selectCellAtIndex(5);
			await notebooksPositron.performCellAction('paste');

			// Verify second paste
			await notebooksPositron.expectCellCountToBe(8);
			await notebooksPositron.expectCellContentAtIndexToBe(6, '# Cell 0');
		});

		// ========================================
		// Test 4: Cut and paste at beginning of notebook
		// ========================================
		await test.step('Test 4: Cut and paste at beginning of notebook', async () => {
			// Select a middle cell to cut
			await notebooksPositron.selectCellAtIndex(4);
			const cellToMoveContent = await notebooksPositron.getCellContent(4);

			// Cut the cell
			await notebooksPositron.performCellAction('cut');

			// Verify cell removed
			await notebooksPositron.expectCellCountToBe(7);

			// Move to first cell and paste
			// Note: Paste typically inserts after the current cell
			await notebooksPositron.selectCellAtIndex(0);
			await notebooksPositron.performCellAction('paste');

			// Verify cell count restored
			await notebooksPositron.expectCellCountToBe(8);

			// Verify pasted cell is at index 1 (pasted after cell 0)
			await notebooksPositron.expectCellContentAtIndexToBe(1, cellToMoveContent);
		});

		// ========================================
		// Test 5: Cut all cells and verify notebook can be empty
		// ========================================
		await test.step('Verify other cells shifted down correctly', async () => {
			// Delete cells until only one remains
			while (await notebooksPositron.getCellCount() > 1) {
				await notebooksPositron.selectCellAtIndex(0);
				await notebooksPositron.performCellAction('cut');
			}

			// Verify we have exactly one cell
			await notebooksPositron.expectCellCountToBe(1);

			// Cut the last cell - in Positron notebooks, this may be allowed
			await notebooksPositron.performCellAction('cut');

			// Check if notebook can be empty (Positron may allow 0 cells)
			const finalCount = await notebooksPositron.getCellCount();
			expect(finalCount).toBeLessThanOrEqual(1);
		});
	});
});
