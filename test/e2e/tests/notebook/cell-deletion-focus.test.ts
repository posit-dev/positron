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
 * Helper function to get cell content for identification
 */
async function getCellContent(app: Application, cellIndex: number): Promise<string> {
	const cell = app.code.driver.page.locator('[data-testid="notebook-cell"]').nth(cellIndex);
	const editor = cell.locator('.positron-cell-editor-monaco-widget textarea');
	return await editor.inputValue();
}

/**
 * Helper function to delete cell using keyboard shortcut
 */
async function deleteCellWithKeyboard(app: Application): Promise<void> {
	// Use the dd keyboard shortcut (press d twice)
	// We need to press escape to get the focus out of the cell editor itself
	await app.code.driver.page.keyboard.press('Escape');
	await app.code.driver.page.keyboard.press('d');
	await app.code.driver.page.keyboard.press('d');
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

test.describe('Cell Deletion Focus Behavior', {
	tag: [tags.CRITICAL, tags.WEB, tags.WIN, tags.NOTEBOOKS]
}, () => {
	test.beforeAll(async function ({ app, settings }) {
		await app.workbench.notebooks.enablePositronNotebooks(settings);
		// Configure Positron as the notebook editor
		await app.workbench.notebooks.setNotebookEditor(settings, 'positron');
		// Enable screen reader support so we can programmatically get cell content
		await settings.set({ 'editor.accessibilitySupport': 'on' });
	});

	test('Cell deletion focus behavior - comprehensive test', async function ({ app }) {
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
		expect(await getCellCount(app)).toBe(5);
		// ========================================
		// Test 1: Delete middle cell (cell 2)
		// ========================================
		await app.workbench.notebooksPositron.selectCellAtIndex(2);

		const focusedIndex = await getFocusedCellIndex(app);
		// Verify the focused cell is the one we expect
		expect(focusedIndex).toBe(2);

		const cell2Content = await getCellContent(app, 2);

		// Verify cell 2 is selected and has correct content
		expect(cell2Content).toBe('# Cell 2');

		// Delete the cell using keyboard shortcut
		await deleteCellWithKeyboard(app);

		// Verify cell count decreased
		expect(await getCellCount(app)).toBe(4);

		// Verify focus moved to what was cell 3 (now at index 2)
		const focusedIndex1 = await getFocusedCellIndex(app);
		expect(focusedIndex1).toBe(2);
		expect(await getCellContent(app, 2)).toBe('# Cell 3');

		// ========================================
		// Test 2: Delete last cell (now cell 3, previously cell 4)
		// ========================================
		await app.workbench.notebooksPositron.selectCellAtIndex(3);

		// Verify we're at the last cell with correct content
		expect(await getCellContent(app, 3)).toBe('# Cell 4');

		// Delete the last cell
		await deleteCellWithKeyboard(app);

		// Verify cell count decreased
		expect(await getCellCount(app)).toBe(3);

		// Verify focus moved to new last cell (index 2)
		const focusedIndex2 = await getFocusedCellIndex(app);
		expect(focusedIndex2).toBe(2);
		expect(await getCellContent(app, 2)).toBe('# Cell 3');

		// ========================================
		// Test 3: Delete first cell (cell 0)
		// ========================================
		await app.workbench.notebooksPositron.selectCellAtIndex(0);

		// Verify we're at the first cell with correct content
		expect(await getCellContent(app, 0)).toBe('# Cell 0');

		// Delete the first cell
		await deleteCellWithKeyboard(app);

		// Verify cell count decreased
		expect(await getCellCount(app)).toBe(2);

		// Verify focus stayed at index 0 but content changed (what was cell 1 is now at index 0)
		const focusedIndex3 = await getFocusedCellIndex(app);
		expect(focusedIndex3).toBe(0);
		expect(await getCellContent(app, 0)).toBe('# Cell 1');

		// ========================================
		// Test 4: Test cut operation (add more cells first)
		// ========================================
		// Add two more cells for cut testing
		await app.workbench.notebooksPositron.addCodeToCellAtIndex('# Cut Test 1', 2);
		await app.workbench.notebooksPositron.addCodeToCellAtIndex('# Cut Test 2', 3);

		// Verify we have 4 cells now
		expect(await getCellCount(app)).toBe(4);

		// Select cell at index 1 and cut it
		await app.workbench.notebooksPositron.selectCellAtIndex(1);
		expect(await getCellContent(app, 1)).toBe('# Cell 3');

		// Cut the cell
		await cutCellsWithKeyboard(app);

		// Verify cell count decreased
		expect(await getCellCount(app)).toBe(3);

		// Verify focus moved to cell at same index (what was index 2 is now index 1)
		const focusedIndex4 = await getFocusedCellIndex(app);
		expect(focusedIndex4).toBe(1);
		expect(await getCellContent(app, 1)).toBe('# Cut Test 1');

		// ========================================
		// Test 5: Delete when only few cells remain
		// ========================================
		// Delete until only one cell remains and ensure graceful handling
		while (await getCellCount(app) > 1) {
			const currentCount = await getCellCount(app);
			await app.workbench.notebooksPositron.selectCellAtIndex(0);
			await deleteCellWithKeyboard(app);

			// Verify count decreased
			expect(await getCellCount(app)).toBe(currentCount - 1);

			// Verify focus is still valid
			const focusedIndex = await getFocusedCellIndex(app);
			expect(focusedIndex).not.toBeNull();
			expect(focusedIndex).toBeGreaterThanOrEqual(0);
			expect(focusedIndex).toBeLessThan(await getCellCount(app));
		}

		// Verify we still have at least one cell
		expect(await getCellCount(app)).toBeGreaterThanOrEqual(1);

		// ========================================
		// Cleanup
		// ========================================
		// Close the notebook without saving
		await app.workbench.notebooks.closeNotebookWithoutSaving();
	});
});
