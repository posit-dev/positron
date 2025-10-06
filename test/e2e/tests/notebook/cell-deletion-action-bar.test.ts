/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application } from '../../infra/index.js';
import { test, tags } from '../_test.setup';
import { expect } from '@playwright/test';

test.use({
	suiteId: __filename
});

/**
 * Helper function to get cell count
 */
async function getCellCount(app: Application): Promise<number> {
	return await app.code.driver.page.locator('[data-testid="notebook-cell"]').count();
}




test.describe('Cell Deletion Action Bar Behavior', {
	tag: [tags.CRITICAL, tags.WIN, tags.NOTEBOOKS, tags.POSITRON_NOTEBOOKS]
}, () => {

	test('Cell deletion using action bar', async function ({ app, settings }) {
		// Enable Positron notebooks
		await app.workbench.notebooksPositron.enablePositronNotebooks(settings);
		await app.workbench.notebooksPositron.setNotebookEditor(settings, 'positron');

		await app.workbench.notebooks.createNewNotebook();
		await app.workbench.notebooksPositron.expectToBeVisible();

		// ========================================
		// Setup: Create 6 cells with distinct content
		// ========================================
		await app.workbench.notebooksPositron.addCodeToCellAtIndex('# Cell 0', 0);
		await app.workbench.notebooksPositron.addCodeToCellAtIndex('# Cell 1', 1);
		await app.workbench.notebooksPositron.addCodeToCellAtIndex('# Cell 2', 2);
		await app.workbench.notebooksPositron.addCodeToCellAtIndex('# Cell 3', 3);
		await app.workbench.notebooksPositron.addCodeToCellAtIndex('# Cell 4', 4);
		await app.workbench.notebooksPositron.addCodeToCellAtIndex('# Cell 5', 5);

		// Verify we have 6 cells
		expect(await getCellCount(app)).toBe(6);

		// ========================================
		// Test 1: Delete a selected cell (cell 2)
		// ========================================
		// Select cell 2 explicitly
		await app.workbench.notebooksPositron.selectCellAtIndex(2);

		// Verify cell 2 has correct content before deletion
		expect(await app.workbench.notebooksPositron.getCellContent(2)).toBe('# Cell 2');

		// Delete the selected cell using action bar
		await app.workbench.notebooksPositron.deleteCellWithActionBar(2);

		// Verify cell count decreased
		expect(await getCellCount(app)).toBe(5);

		// Verify what was cell 3 is now at index 2
		expect(await app.workbench.notebooksPositron.getCellContent(2)).toBe('# Cell 3');

		// ========================================
		// Test 2: Delete another cell (cell 3, originally cell 4)
		// ========================================
		// Select cell 3 for deletion
		await app.workbench.notebooksPositron.selectCellAtIndex(3);

		// Verify cell 3 has correct content before deletion
		expect(await app.workbench.notebooksPositron.getCellContent(3)).toBe('# Cell 4');

		// Delete the selected cell using action bar
		await app.workbench.notebooksPositron.deleteCellWithActionBar(3);

		// Verify cell count decreased
		expect(await getCellCount(app)).toBe(4);

		// Verify the remaining cells are correct
		expect(await app.workbench.notebooksPositron.getCellContent(0)).toBe('# Cell 0');
		expect(await app.workbench.notebooksPositron.getCellContent(1)).toBe('# Cell 1');
		expect(await app.workbench.notebooksPositron.getCellContent(2)).toBe('# Cell 3');
		expect(await app.workbench.notebooksPositron.getCellContent(3)).toBe('# Cell 5');

		// ========================================
		// Test 3: Delete last cell (cell 3, contains '# Cell 5')
		// ========================================
		// Verify we're at the last cell with correct content
		expect(await app.workbench.notebooksPositron.getCellContent(3)).toBe('# Cell 5');

		// Delete the last cell using action bar
		await app.workbench.notebooksPositron.deleteCellWithActionBar(3);

		// Verify cell count decreased
		expect(await getCellCount(app)).toBe(3);

		// Verify remaining cells
		expect(await app.workbench.notebooksPositron.getCellContent(0)).toBe('# Cell 0');
		expect(await app.workbench.notebooksPositron.getCellContent(1)).toBe('# Cell 1');
		expect(await app.workbench.notebooksPositron.getCellContent(2)).toBe('# Cell 3');

		// ========================================
		// Test 4: Delete first cell (cell 0)
		// ========================================
		// Verify we're at the first cell with correct content
		expect(await app.workbench.notebooksPositron.getCellContent(0)).toBe('# Cell 0');

		// Delete the first cell using action bar
		await app.workbench.notebooksPositron.deleteCellWithActionBar(0);

		// Verify cell count decreased
		expect(await getCellCount(app)).toBe(2);

		// Verify what was cell 1 is now at index 0
		expect(await app.workbench.notebooksPositron.getCellContent(0)).toBe('# Cell 1');
		expect(await app.workbench.notebooksPositron.getCellContent(1)).toBe('# Cell 3');

		// ========================================
		// Test 5: Delete remaining cells
		// ========================================
		// Delete until only one cell remains
		while (await getCellCount(app) > 1) {
			const currentCount = await getCellCount(app);
			await app.workbench.notebooksPositron.deleteCellWithActionBar(0);

			// Verify count decreased
			expect(await getCellCount(app)).toBe(currentCount - 1);
		}

		// Verify we have exactly one cell remaining with the correct content
		expect(await getCellCount(app)).toBe(1);
		expect(await app.workbench.notebooksPositron.getCellContent(0)).toBe('# Cell 3');

		// ========================================
		// Cleanup
		// ========================================
		// Close the notebook without saving
		await app.workbench.notebooks.closeNotebookWithoutSaving();
	});
});
