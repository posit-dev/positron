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
 * Helper function to perform undo using keyboard shortcut
 */
async function undoWithKeyboard(app: Application): Promise<void> {
	// We need to press escape to get the focus out of the cell editor itself
	await app.code.driver.page.keyboard.press('Escape');
	const modifierKey = process.platform === 'darwin' ? 'Meta' : 'Control';
	await app.code.driver.page.keyboard.press(`${modifierKey}+KeyZ`);
}

/**
 * Helper function to perform redo using keyboard shortcut
 */
async function redoWithKeyboard(app: Application): Promise<void> {
	// We need to press escape to get the focus out of the cell editor itself
	await app.code.driver.page.keyboard.press('Escape');
	const modifierKey = process.platform === 'darwin' ? 'Meta' : 'Control';
	await app.code.driver.page.keyboard.press(`${modifierKey}+Shift+KeyZ`);
}

/**
 * Helper function to delete a cell using keyboard shortcut
 */
async function deleteCellWithKeyboard(app: Application): Promise<void> {
	// We need to press escape to get the focus out of the cell editor itself
	await app.code.driver.page.keyboard.press('Escape');
	await app.code.driver.page.keyboard.press('Backspace');
}

/**
 * Helper function to add a code cell below using keyboard shortcut
 */
async function addCodeCellBelowWithKeyboard(app: Application): Promise<void> {
	// We need to press escape to get the focus out of the cell editor itself
	await app.code.driver.page.keyboard.press('Escape');
	await app.code.driver.page.keyboard.press('KeyB');
}

/**
 * Helper function to add a code cell above using keyboard shortcut
 */
async function addCodeCellAboveWithKeyboard(app: Application): Promise<void> {
	// We need to press escape to get the focus out of the cell editor itself
	await app.code.driver.page.keyboard.press('Escape');
	await app.code.driver.page.keyboard.press('KeyA');
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
test.describe('Notebook Cell Undo-Redo Behavior', {
	tag: [tags.CRITICAL, tags.WIN, tags.NOTEBOOKS]
}, () => {
	test.beforeAll(async function ({ app, settings }) {
		await app.workbench.notebooksPositron.enablePositronNotebooks(settings);
		// Configure Positron as the notebook editor
		await app.workbench.notebooksPositron.setNotebookEditor(settings, 'positron');
	});

	test('Cell undo-redo behavior - comprehensive test', async function ({ app }) {
		// Setup: Create notebook
		await app.workbench.notebooks.createNewNotebook();
		await app.workbench.notebooksPositron.expectToBeVisible();

		// ========================================
		// Test 1: Basic add cell and undo/redo
		// ========================================
		// Start with initial cell
		await app.workbench.notebooksPositron.addCodeToCellAtIndex('# Initial Cell', 0);
		expect(await getCellCount(app)).toBe(1);
		expect(await app.workbench.notebooksPositron.getCellContent(0)).toBe('# Initial Cell');

		// Add a second cell
		await app.workbench.notebooksPositron.selectCellAtIndex(0);
		await addCodeCellBelowWithKeyboard(app);
		await app.workbench.notebooksPositron.addCodeToCellAtIndex('# Second Cell', 1);
		expect(await getCellCount(app)).toBe(2);
		expect(await app.workbench.notebooksPositron.getCellContent(1)).toBe('# Second Cell');

		// Undo the add cell operation
		await undoWithKeyboard(app);
		expect(await getCellCount(app)).toBe(1);
		expect(await app.workbench.notebooksPositron.getCellContent(0)).toBe('# Initial Cell');

		// Redo the add cell operation
		await redoWithKeyboard(app);
		expect(await getCellCount(app)).toBe(2);
		expect(await app.workbench.notebooksPositron.getCellContent(1)).toBe('# Second Cell');

		// ========================================
		// Test 2: Delete cell and undo/redo
		// ========================================
		// Add a third cell for deletion test
		await app.workbench.notebooksPositron.selectCellAtIndex(1);
		await addCodeCellBelowWithKeyboard(app);
		await app.workbench.notebooksPositron.addCodeToCellAtIndex('# Cell to Delete', 2);
		expect(await getCellCount(app)).toBe(3);

		// Delete the middle cell
		await app.workbench.notebooksPositron.selectCellAtIndex(1);
		await deleteCellWithKeyboard(app);
		expect(await getCellCount(app)).toBe(2);
		expect(await app.workbench.notebooksPositron.getCellContent(0)).toBe('# Initial Cell');
		expect(await app.workbench.notebooksPositron.getCellContent(1)).toBe('# Cell to Delete');

		// Undo the delete
		await undoWithKeyboard(app);
		expect(await getCellCount(app)).toBe(3);
		expect(await app.workbench.notebooksPositron.getCellContent(1)).toBe('# Second Cell');
		expect(await app.workbench.notebooksPositron.getCellContent(2)).toBe('# Cell to Delete');

		// Redo the delete
		await redoWithKeyboard(app);
		expect(await getCellCount(app)).toBe(2);
		expect(await app.workbench.notebooksPositron.getCellContent(1)).toBe('# Cell to Delete');

		// ========================================
		// Test 3: Multiple undo operations in sequence
		// ========================================
		// Add several cells
		await app.workbench.notebooksPositron.selectCellAtIndex(1);
		await addCodeCellBelowWithKeyboard(app);
		await app.workbench.notebooksPositron.addCodeToCellAtIndex('# Cell 3', 2);

		await app.workbench.notebooksPositron.selectCellAtIndex(2);
		await addCodeCellBelowWithKeyboard(app);
		await app.workbench.notebooksPositron.addCodeToCellAtIndex('# Cell 4', 3);

		await app.workbench.notebooksPositron.selectCellAtIndex(3);
		await addCodeCellBelowWithKeyboard(app);
		await app.workbench.notebooksPositron.addCodeToCellAtIndex('# Cell 5', 4);

		expect(await getCellCount(app)).toBe(5);

		// Undo three times
		await undoWithKeyboard(app);
		expect(await getCellCount(app)).toBe(4);

		await undoWithKeyboard(app);
		expect(await getCellCount(app)).toBe(3);

		await undoWithKeyboard(app);
		expect(await getCellCount(app)).toBe(2);

		// Redo twice
		await redoWithKeyboard(app);
		expect(await getCellCount(app)).toBe(3);
		expect(await app.workbench.notebooksPositron.getCellContent(2)).toBe('# Cell 3');

		await redoWithKeyboard(app);
		expect(await getCellCount(app)).toBe(4);
		expect(await app.workbench.notebooksPositron.getCellContent(3)).toBe('# Cell 4');

		// ========================================
		// Test 4: Cut/paste with undo/redo
		// ========================================
		// Cut a cell
		await app.workbench.notebooksPositron.selectCellAtIndex(1);
		const cellToCutContent = await app.workbench.notebooksPositron.getCellContent(1);
		await cutCellsWithKeyboard(app);
		const countAfterCut = await getCellCount(app);
		expect(countAfterCut).toBe(3);

		// Paste it at a different location
		await app.workbench.notebooksPositron.selectCellAtIndex(2);
		await pasteCellsWithKeyboard(app);
		expect(await getCellCount(app)).toBe(4);
		expect(await app.workbench.notebooksPositron.getCellContent(3)).toBe(cellToCutContent);

		// Undo the paste
		await undoWithKeyboard(app);
		expect(await getCellCount(app)).toBe(3);

		// Undo the cut
		await undoWithKeyboard(app);
		expect(await getCellCount(app)).toBe(4);
		expect(await app.workbench.notebooksPositron.getCellContent(1)).toBe(cellToCutContent);

		// Redo the cut
		await redoWithKeyboard(app);
		expect(await getCellCount(app)).toBe(3);

		// Redo the paste
		await redoWithKeyboard(app);
		expect(await getCellCount(app)).toBe(4);

		// ========================================
		// Test 5: Redo stack clearing on new operation
		// ========================================
		// Perform some operations and undo them
		await app.workbench.notebooksPositron.selectCellAtIndex(0);
		await addCodeCellBelowWithKeyboard(app);
		await app.workbench.notebooksPositron.addCodeToCellAtIndex('# New Cell', 1);
		expect(await getCellCount(app)).toBe(5);

		await undoWithKeyboard(app);
		expect(await getCellCount(app)).toBe(4);

		// Now perform a new operation (this should clear the redo stack)
		await app.workbench.notebooksPositron.selectCellAtIndex(0);
		await addCodeCellAboveWithKeyboard(app);
		await app.workbench.notebooksPositron.addCodeToCellAtIndex('# Cell Added Above', 0);
		expect(await getCellCount(app)).toBe(5);

		// Try to redo - nothing should happen as redo stack was cleared
		const countBeforeRedo = await getCellCount(app);
		await redoWithKeyboard(app);
		expect(await getCellCount(app)).toBe(countBeforeRedo);

		// ========================================
		// Test 6: Copy/paste with undo
		// ========================================
		// Copy a cell
		await app.workbench.notebooksPositron.selectCellAtIndex(2);
		const cellToCopyContent = await app.workbench.notebooksPositron.getCellContent(2);
		await copyCellsWithKeyboard(app);

		// Paste it multiple times
		await app.workbench.notebooksPositron.selectCellAtIndex(4);
		await pasteCellsWithKeyboard(app);
		expect(await getCellCount(app)).toBe(6);
		expect(await app.workbench.notebooksPositron.getCellContent(5)).toBe(cellToCopyContent);

		await pasteCellsWithKeyboard(app);
		expect(await getCellCount(app)).toBe(7);
		expect(await app.workbench.notebooksPositron.getCellContent(6)).toBe(cellToCopyContent);

		// Undo both pastes
		await undoWithKeyboard(app);
		expect(await getCellCount(app)).toBe(6);

		await undoWithKeyboard(app);
		expect(await getCellCount(app)).toBe(5);

		// ========================================
		// Test 7: Focus preservation during undo/redo
		// ========================================
		// Add a cell at a specific position
		await app.workbench.notebooksPositron.selectCellAtIndex(2);
		await addCodeCellBelowWithKeyboard(app);
		await app.workbench.notebooksPositron.addCodeToCellAtIndex('# Focus Test Cell', 3);

		// Verify focus is on the new cell
		expect(await getFocusedCellIndex(app)).toBe(3);

		// Undo and check focus moves appropriately
		await undoWithKeyboard(app);
		const focusAfterUndo = await getFocusedCellIndex(app);
		expect(focusAfterUndo).toBeLessThanOrEqual(2); // Focus should be at or before position 2

		// Redo and check focus returns to the added cell
		await redoWithKeyboard(app);
		expect(await getFocusedCellIndex(app)).toBe(3);

		// ========================================
		// Test 8: Delete multiple cells with undo
		// ========================================
		// Select and delete multiple cells
		const initialCount = await getCellCount(app);

		// Delete first cell
		await app.workbench.notebooksPositron.selectCellAtIndex(0);
		await deleteCellWithKeyboard(app);

		// Delete another cell
		await app.workbench.notebooksPositron.selectCellAtIndex(0);
		await deleteCellWithKeyboard(app);

		expect(await getCellCount(app)).toBe(initialCount - 2);

		// Undo both deletes
		await undoWithKeyboard(app);
		expect(await getCellCount(app)).toBe(initialCount - 1);

		await undoWithKeyboard(app);
		expect(await getCellCount(app)).toBe(initialCount);

		// ========================================
		// Cleanup
		// ========================================
		// Close the notebook without saving
		await app.workbench.notebooks.closeNotebookWithoutSaving();
	});

	test('Cell content modification undo-redo', async function ({ app }) {
		// Setup: Create notebook
		await app.workbench.notebooks.createNewNotebook();
		await app.workbench.notebooksPositron.expectToBeVisible();

		// ========================================
		// Test content modification undo/redo
		// ========================================
		// Add initial content to a cell
		await app.workbench.notebooksPositron.addCodeToCellAtIndex('print("Original")', 0);
		expect(await app.workbench.notebooksPositron.getCellContent(0)).toBe('print("Original")');

		// Modify the content
		await app.workbench.notebooksPositron.selectCellAtIndex(0);
		await app.code.driver.page.keyboard.press('Enter'); // Enter edit mode
		await app.code.driver.page.keyboard.press('Control+A'); // Select all
		await app.code.driver.page.keyboard.type('print("Modified")');
		await app.code.driver.page.keyboard.press('Escape'); // Exit edit mode

		// Verify content was modified
		expect(await app.workbench.notebooksPositron.getCellContent(0)).toBe('print("Modified")');

		// Undo the content modification
		await undoWithKeyboard(app);
		expect(await app.workbench.notebooksPositron.getCellContent(0)).toBe('print("Original")');

		// Redo the content modification
		await redoWithKeyboard(app);
		expect(await app.workbench.notebooksPositron.getCellContent(0)).toBe('print("Modified")');

		// ========================================
		// Cleanup
		// ========================================
		// Close the notebook without saving
		await app.workbench.notebooks.closeNotebookWithoutSaving();
	});

});