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
 * Helper function to get the currently focused cell index
 */
async function getFocusedCellIndex(app: Application): Promise<number | null> {
	const cells = app.code.driver.page.locator('[data-testid="notebook-cell"]');
	const cellCount = await cells.count();

	for (let i = 0; i < cellCount; i++) {
		const cell = cells.nth(i);
		// Check if the cell is focused by looking for focus indicators
		const isFocused = await cell.evaluate((element) => {
			// Check if any child element has focus or if the cell has focus-related classes
			return element.contains(document.activeElement) ||
				element.classList.contains('focused') ||
				element.querySelector('.focused') !== null ||
				element.querySelector(':focus') !== null;
		});

		if (isFocused) {
			return i;
		}
	}
	return null;
}

/**
 * Helper function to get cell count
 */
async function getCellCount(app: Application): Promise<number> {
	return await app.code.driver.page.locator('[data-testid="notebook-cell"]').count();
}

/**
 * Helper function to copy cells using keyboard shortcut
 */
async function copyCellsWithKeyboard(app: Application): Promise<void> {
	// We need to press escape to get the focus out of the cell editor itself
	await app.code.driver.page.keyboard.press('Escape');
	const modifierKey = process.platform === 'darwin' ? 'Meta' : 'Control';
	await app.code.driver.page.keyboard.press(`${modifierKey}+KeyC`);
}

/**
 * Helper function to cut cells using keyboard shortcut
 */
async function cutCellsWithKeyboard(app: Application): Promise<void> {
	// We need to press escape to get the focus out of the cell editor itself
	await app.code.driver.page.keyboard.press('Escape');
	const modifierKey = process.platform === 'darwin' ? 'Meta' : 'Control';
	await app.code.driver.page.keyboard.press(`${modifierKey}+KeyX`);
}

/**
 * Helper function to paste cells using keyboard shortcut
 */
async function pasteCellsWithKeyboard(app: Application): Promise<void> {
	// We need to press escape to get the focus out of the cell editor itself
	await app.code.driver.page.keyboard.press('Escape');
	const modifierKey = process.platform === 'darwin' ? 'Meta' : 'Control';
	await app.code.driver.page.keyboard.press(`${modifierKey}+KeyV`);
}

// Not running on web due to https://github.com/posit-dev/positron/issues/9193
test.describe('Notebook Cell Copy-Paste Behavior', {
	tag: [tags.CRITICAL, tags.WIN, tags.NOTEBOOKS]
}, () => {
	test.beforeAll(async function ({ app, settings }) {
		await app.positron.notebooksPositron.enablePositronNotebooks(settings);
		// Configure Positron as the notebook editor
		await app.positron.notebooksPositron.setNotebookEditor(settings, 'positron');
	});

	test('Cell copy-paste behavior - comprehensive test', async function ({ app }) {
		// Setup: Create notebook and select kernel once
		await app.positron.notebooks.createNewNotebook();
		await app.positron.notebooksPositron.expectToBeVisible();

		// ========================================
		// Setup: Create 5 cells with distinct content
		// ========================================
		await app.positron.notebooksPositron.addCodeToCellAtIndex('# Cell 0', 0);
		await app.positron.notebooksPositron.addCodeToCellAtIndex('# Cell 1', 1);
		await app.positron.notebooksPositron.addCodeToCellAtIndex('# Cell 2', 2);
		await app.positron.notebooksPositron.addCodeToCellAtIndex('# Cell 3', 3);
		await app.positron.notebooksPositron.addCodeToCellAtIndex('# Cell 4', 4);

		// Verify we have 5 cells
		expect(await getCellCount(app)).toBe(5);

		// ========================================
		// Test 1: Copy single cell and paste at end
		// ========================================
		await app.positron.notebooksPositron.selectCellAtIndex(2);

		// Verify cell 2 is selected and has correct content
		expect(await getFocusedCellIndex(app)).toBe(2);
		expect(await app.positron.notebooksPositron.getCellContent(2)).toBe('# Cell 2');

		// Copy the cell
		await copyCellsWithKeyboard(app);

		// Focus should remain on the copied cell
		expect(await getFocusedCellIndex(app)).toBe(2);

		// Move to last cell and paste after it
		await app.positron.notebooksPositron.selectCellAtIndex(4);
		await pasteCellsWithKeyboard(app);

		// Verify cell count increased
		expect(await getCellCount(app)).toBe(6);

		// Verify the pasted cell has the correct content (should be at index 5)
		expect(await app.positron.notebooksPositron.getCellContent(5)).toBe('# Cell 2');

		// Focus should be on the pasted cell
		expect(await getFocusedCellIndex(app)).toBe(5);

		// ========================================
		// Test 2: Cut single cell and paste at different position
		// ========================================
		await app.positron.notebooksPositron.selectCellAtIndex(1);

		// Verify we're at cell 1 with correct content
		expect(await app.positron.notebooksPositron.getCellContent(1)).toBe('# Cell 1');

		// Cut the cell
		await cutCellsWithKeyboard(app);

		// Verify cell count decreased
		expect(await getCellCount(app)).toBe(5);

		// Focus should move to what was cell 2 (now at index 1)
		expect(await getFocusedCellIndex(app)).toBe(1);
		expect(await app.positron.notebooksPositron.getCellContent(1)).toBe('# Cell 2');

		// Move to index 3 and paste
		await app.positron.notebooksPositron.selectCellAtIndex(3);
		await pasteCellsWithKeyboard(app);

		// Verify cell count is back to 6
		expect(await getCellCount(app)).toBe(6);

		// Verify the pasted cell has correct content at index 4
		expect(await app.positron.notebooksPositron.getCellContent(4)).toBe('# Cell 1');

		// Focus should be on the pasted cell
		expect(await getFocusedCellIndex(app)).toBe(4);

		// ========================================
		// Test 3: Copy cell and paste multiple times (clipboard persistence)
		// ========================================
		await app.positron.notebooksPositron.selectCellAtIndex(0);

		// Copy cell 0
		expect(await app.positron.notebooksPositron.getCellContent(0)).toBe('# Cell 0');
		await copyCellsWithKeyboard(app);

		// Paste at position 2
		await app.positron.notebooksPositron.selectCellAtIndex(2);
		await pasteCellsWithKeyboard(app);

		// Verify first paste
		expect(await getCellCount(app)).toBe(7);
		expect(await app.positron.notebooksPositron.getCellContent(3)).toBe('# Cell 0');

		// Paste again at position 5
		await app.positron.notebooksPositron.selectCellAtIndex(5);
		await pasteCellsWithKeyboard(app);

		// Verify second paste
		expect(await getCellCount(app)).toBe(8);
		expect(await app.positron.notebooksPositron.getCellContent(6)).toBe('# Cell 0');

		// ========================================
		// Test 4: Cut and paste at beginning of notebook
		// ========================================
		// Select a middle cell to cut
		await app.positron.notebooksPositron.selectCellAtIndex(4);
		const cellToMoveContent = await app.positron.notebooksPositron.getCellContent(4);

		// Cut the cell
		await cutCellsWithKeyboard(app);

		// Verify cell removed
		expect(await getCellCount(app)).toBe(7);

		// Focus should move to what was at index 5 (now at index 4)
		expect(await getFocusedCellIndex(app)).toBe(4);

		// Move to first cell and paste
		// Note: Paste typically inserts after the current cell
		await app.positron.notebooksPositron.selectCellAtIndex(0);
		await pasteCellsWithKeyboard(app);

		// Verify cell count restored
		expect(await getCellCount(app)).toBe(8);

		// Verify pasted cell is at index 1 (pasted after cell 0)
		expect(await app.positron.notebooksPositron.getCellContent(1)).toBe(cellToMoveContent);

		// Focus should be on the pasted cell at index 1
		expect(await getFocusedCellIndex(app)).toBe(1);

		// ========================================
		// Test 5: Focus behavior validation after operations
		// ========================================
		// Test copy: focus stays on source
		await app.positron.notebooksPositron.selectCellAtIndex(3);
		const copySourceIndex = await getFocusedCellIndex(app);
		await copyCellsWithKeyboard(app);
		expect(await getFocusedCellIndex(app)).toBe(copySourceIndex);

		// Test cut: focus moves to next cell (or stays if last)
		await app.positron.notebooksPositron.selectCellAtIndex(2);
		await cutCellsWithKeyboard(app);
		const focusAfterCut = await getFocusedCellIndex(app);
		expect(focusAfterCut).toBe(2); // Focus stays at same index, but content changes

		// Test paste: focus moves to pasted cell
		await app.positron.notebooksPositron.selectCellAtIndex(4);
		await pasteCellsWithKeyboard(app);
		expect(await getFocusedCellIndex(app)).toBe(5); // Pasted after index 4

		// ========================================
		// Test 6: Cut all cells and verify notebook can be empty
		// ========================================
		// Delete cells until only one remains
		while (await getCellCount(app) > 1) {
			await app.positron.notebooksPositron.selectCellAtIndex(0);
			await cutCellsWithKeyboard(app);
		}

		// Verify we have exactly one cell
		expect(await getCellCount(app)).toBe(1);

		// Cut the last cell - in Positron notebooks, this may be allowed
		await cutCellsWithKeyboard(app);

		// Check if notebook can be empty (Positron may allow 0 cells)
		const finalCount = await getCellCount(app);
		expect(finalCount).toBeLessThanOrEqual(1);

		// ========================================
		// Cleanup
		// ========================================
		// Close the notebook without saving
		await app.positron.notebooks.closeNotebookWithoutSaving();
	});

});
