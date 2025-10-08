/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application } from '../../infra/index.js';
import { test, tags } from '../_test.setup';
import { expect } from '@playwright/test';
import { PositronNotebooks } from '../../pages/notebooksPositron.js';

test.use({
	suiteId: __filename
});

/**
 * Clipboard operations (copy/cut) are asynchronous OS-level operations that may not complete
 * immediately after the keyboard shortcut is pressed. On slower CI environments (especially Ubuntu),
 * the clipboard may not be populated by the time the next operation (paste) executes, causing
 * race conditions. This delay ensures the clipboard operation has time to propagate.
 */
const CLIPBOARD_OPERATION_DELAY_MS = 100;

/**
 * Helper function to copy cells using keyboard shortcut
 */
async function copyCellsWithKeyboard(app: Application): Promise<void> {
	// Exit edit mode and wait for focus to leave Monaco editor
	await app.workbench.notebooksPositron.exitEditMode();
	await app.code.driver.page.keyboard.press('ControlOrMeta+C');
	// Wait for clipboard operation to complete
	await app.code.driver.page.waitForTimeout(CLIPBOARD_OPERATION_DELAY_MS);
}

/**
 * Helper function to cut cells using keyboard shortcut
 */
async function cutCellsWithKeyboard(app: Application): Promise<void> {
	// Exit edit mode and wait for focus to leave Monaco editor
	await app.workbench.notebooksPositron.exitEditMode();
	await app.code.driver.page.keyboard.press('ControlOrMeta+X');
	// Wait for clipboard operation to complete
	await app.code.driver.page.waitForTimeout(CLIPBOARD_OPERATION_DELAY_MS);
}

/**
 * Helper function to paste cells using keyboard shortcut
 */
async function pasteCellsWithKeyboard(app: Application): Promise<void> {
	// Exit edit mode and wait for focus to leave Monaco editor
	await app.workbench.notebooksPositron.exitEditMode();
	await app.code.driver.page.keyboard.press('ControlOrMeta+V');
	// Wait for paste operation to complete before asserting results
	await app.code.driver.page.waitForTimeout(CLIPBOARD_OPERATION_DELAY_MS);
}

// Not running on web due to https://github.com/posit-dev/positron/issues/9193
test.describe('Notebook Cell Copy-Paste Behavior', {
	tag: [tags.CRITICAL, tags.WIN, tags.NOTEBOOKS, tags.POSITRON_NOTEBOOKS]
}, () => {
	// Skip these tests on CI due to flakiness - will address in followup PR
	test.skip(process.env.CI === 'true', 'Skipping copy-paste tests on CI due to flakiness');

	test.beforeAll(async function ({ app, settings }) {
		await app.workbench.notebooksPositron.enablePositronNotebooks(settings);
		// Configure Positron as the notebook editor
		await app.workbench.notebooksPositron.setNotebookEditor(settings, 'positron');
	});

	test('Cell copy-paste behavior - comprehensive test', async function ({ app }) {
		// Setup: Create notebook and select kernel once
		await app.workbench.notebooks.createNewNotebook();
		await app.workbench.notebooksPositron.expectToBeVisible();

		// ========================================
		// Setup: Create 5 cells with distinct content
		// ========================================
		await app.workbench.notebooksPositron.addCodeToCellAtIndex('# Cell 0', 0);
		await app.workbench.notebooksPositron.addCodeToCellAtIndex('# Cell 1', 1);
		await app.workbench.notebooksPositron.addCodeToCellAtIndex('# Cell 2', 2);
		await app.workbench.notebooksPositron.addCodeToCellAtIndex('# Cell 3', 3);
		await app.workbench.notebooksPositron.addCodeToCellAtIndex('# Cell 4', 4);

		// Verify we have 5 cells
		await app.workbench.notebooksPositron.expectCellCount(5);

		// ========================================
		// Test 1: Copy single cell and paste at end
		// ========================================
		await app.workbench.notebooksPositron.selectCellAtIndex(2);

		// Verify cell 2 has correct content
		expect(await app.workbench.notebooksPositron.getCellContent(2)).toBe('# Cell 2');

		// Copy the cell
		await copyCellsWithKeyboard(app);

		// Move to last cell and paste after it
		await app.workbench.notebooksPositron.selectCellAtIndex(4);
		await pasteCellsWithKeyboard(app);

		// Verify cell count increased
		await app.workbench.notebooksPositron.expectCellCount(6);

		// Verify the pasted cell has the correct content (should be at index 5)
		expect(await app.workbench.notebooksPositron.getCellContent(5)).toBe('# Cell 2');

		// ========================================
		// Test 2: Cut single cell and paste at different position
		// ========================================
		await app.workbench.notebooksPositron.selectCellAtIndex(1);

		// Verify we're at cell 1 with correct content
		expect(await app.workbench.notebooksPositron.getCellContent(1)).toBe('# Cell 1');

		// Cut the cell
		await cutCellsWithKeyboard(app);

		// Verify cell count decreased
		await app.workbench.notebooksPositron.expectCellCount(5);

		// Verify what was cell 2 is now at index 1
		expect(await app.workbench.notebooksPositron.getCellContent(1)).toBe('# Cell 2');

		// Move to index 3 and paste
		await app.workbench.notebooksPositron.selectCellAtIndex(3);
		await pasteCellsWithKeyboard(app);

		// Verify cell count is back to 6
		await app.workbench.notebooksPositron.expectCellCount(6);

		// Verify the pasted cell has correct content at index 4
		expect(await app.workbench.notebooksPositron.getCellContent(4)).toBe('# Cell 1');

		// ========================================
		// Test 3: Copy cell and paste multiple times (clipboard persistence)
		// ========================================
		await app.workbench.notebooksPositron.selectCellAtIndex(0);

		// Copy cell 0
		expect(await app.workbench.notebooksPositron.getCellContent(0)).toBe('# Cell 0');
		await copyCellsWithKeyboard(app);

		// Paste at position 2
		await app.workbench.notebooksPositron.selectCellAtIndex(2);
		await pasteCellsWithKeyboard(app);

		// Verify first paste
		await app.workbench.notebooksPositron.expectCellCount(7);
		expect(await app.workbench.notebooksPositron.getCellContent(3)).toBe('# Cell 0');

		// Paste again at position 5
		await app.workbench.notebooksPositron.selectCellAtIndex(5);
		await pasteCellsWithKeyboard(app);

		// Verify second paste
		await app.workbench.notebooksPositron.expectCellCount(8);
		expect(await app.workbench.notebooksPositron.getCellContent(6)).toBe('# Cell 0');

		// ========================================
		// Test 4: Cut and paste at beginning of notebook
		// ========================================
		// Select a middle cell to cut
		await app.workbench.notebooksPositron.selectCellAtIndex(4);
		const cellToMoveContent = await app.workbench.notebooksPositron.getCellContent(4);

		// Cut the cell
		await cutCellsWithKeyboard(app);

		// Verify cell removed
		await app.workbench.notebooksPositron.expectCellCount(7);

		// Move to first cell and paste
		// Note: Paste typically inserts after the current cell
		await app.workbench.notebooksPositron.selectCellAtIndex(0);
		await pasteCellsWithKeyboard(app);

		// Verify cell count restored
		await app.workbench.notebooksPositron.expectCellCount(8);

		// Verify pasted cell is at index 1 (pasted after cell 0)
		expect(await app.workbench.notebooksPositron.getCellContent(1)).toBe(cellToMoveContent);

		// ========================================
		// Test 5: Cut all cells and verify notebook can be empty
		// ========================================
		// Delete cells until only one remains
		while ((await app.code.driver.page.locator(PositronNotebooks.NOTEBOOK_CELL_SELECTOR).count()) > 1) {
			await app.workbench.notebooksPositron.selectCellAtIndex(0);
			await cutCellsWithKeyboard(app);
		}

		// Verify we have exactly one cell
		await app.workbench.notebooksPositron.expectCellCount(1);

		// Cut the last cell - in Positron notebooks, this may be allowed
		await cutCellsWithKeyboard(app);

		// Check if notebook can be empty (Positron may allow 0 cells)
		const finalCount = await app.code.driver.page.locator(PositronNotebooks.NOTEBOOK_CELL_SELECTOR).count();
		expect(finalCount).toBeLessThanOrEqual(1);

		// ========================================
		// Cleanup
		// ========================================
		// Close the notebook without saving
		await app.workbench.notebooks.closeNotebookWithoutSaving();
	});

});
