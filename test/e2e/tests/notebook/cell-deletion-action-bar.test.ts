/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { expect } from '@playwright/test';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Cell Deletion Action Bar Behavior', {
	tag: [tags.WIN, tags.POSITRON_NOTEBOOKS]
}, () => {

	test.beforeAll(async function ({ app, settings }) {
		await app.workbench.notebooksPositron.enablePositronNotebooks(settings);
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Cell deletion using action bar', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// ========================================
		// Setup: Create 6 cells with distinct content
		// ========================================
		await test.step(' Test Setup: Create notebook', async () => {
			await notebooksPositron.newNotebook(6);
			await notebooksPositron.expectCellCountToBe(6);
		});


		// ========================================
		// Test 1: Delete a selected cell (cell 2)
		// ========================================
		await test.step('Test 1: Delete selected cell (cell 2)', async () => {
			// Select cell 2 explicitly
			await notebooksPositron.selectCellAtIndex(2);

			// Verify cell 2 has correct content before deletion
			expect(await notebooksPositron.getCellContent(2)).toBe('# Cell 2');

			// Delete the selected cell using action bar
			await notebooksPositron.deleteCellWithActionBar(2);

			// Verify cell count decreased
			await notebooksPositron.expectCellCountToBe(5);

			// Verify what was cell 3 is now at index 2
			expect(await notebooksPositron.getCellContent(2)).toBe('# Cell 3');
		});

		// ========================================
		// Test 2: Delete another cell (cell 3, originally cell 4)
		// ========================================
		await test.step('Test 2: Delete another cell (cell 3, originally cell 4)', async () => {
			// Select cell 3 for deletion
			await notebooksPositron.selectCellAtIndex(3);

			// Verify cell 3 has correct content before deletion
			await notebooksPositron.expectCellContentAtIndexToBe(3, '# Cell 4');

			// Delete the selected cell using action bar
			await notebooksPositron.deleteCellWithActionBar(3);

			// Verify cell count decreased
			await notebooksPositron.expectCellCountToBe(4);

			// Verify the remaining cells are correct
			await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 0');
			await notebooksPositron.expectCellContentAtIndexToBe(1, '# Cell 1');
			await notebooksPositron.expectCellContentAtIndexToBe(2, '# Cell 3');
			await notebooksPositron.expectCellContentAtIndexToBe(3, '# Cell 5');
		});

		// ========================================
		// Test 3: Delete last cell (cell 3, contains '# Cell 5')
		// ========================================
		await test.step('Test 3: Delete last cell (cell 3, contains \'# Cell 5\')', async () => {
			// Verify we're at the last cell with correct content
			await notebooksPositron.expectCellContentAtIndexToBe(3, '# Cell 5');

			// Delete the last cell using action bar
			await notebooksPositron.deleteCellWithActionBar(3);

			// Verify cell count decreased
			await notebooksPositron.expectCellCountToBe(3);

			// Verify remaining cells
			await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 0');
			await notebooksPositron.expectCellContentAtIndexToBe(1, '# Cell 1');
			await notebooksPositron.expectCellContentAtIndexToBe(2, '# Cell 3');
		});

		// ========================================
		// Test 4: Delete first cell (cell 0)
		// ========================================
		await test.step('Test 4: Delete first cell (cell 0)', async () => {
			// Verify we're at the first cell with correct content
			expect(await notebooksPositron.getCellContent(0)).toBe('# Cell 0');

			// Delete the first cell using action bar
			await notebooksPositron.deleteCellWithActionBar(0);

			// Verify cell count decreased
			await notebooksPositron.expectCellCountToBe(2);

			// Verify what was cell 1 is now at index 0
			expect(await notebooksPositron.getCellContent(0)).toBe('# Cell 1');
			expect(await notebooksPositron.getCellContent(1)).toBe('# Cell 3');
		});

		// ========================================
		// Test 5: Delete remaining cells
		// ========================================
		await test.step('Test 5: Delete remaining cells', async () => {
			// Delete until only one cell remains
			while (await notebooksPositron.getCellCount() > 1) {
				const currentCount = await notebooksPositron.getCellCount();
				await notebooksPositron.deleteCellWithActionBar(0);

				// Verify count decreased
				await notebooksPositron.expectCellCountToBe(currentCount - 1);
			}

			// Verify we have exactly one cell remaining with the correct content
			await notebooksPositron.expectCellCountToBe(1);
			await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 3');
		});
	});
});
