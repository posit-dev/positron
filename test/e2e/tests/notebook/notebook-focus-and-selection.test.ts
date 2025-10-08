/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { Application } from '../../infra/index.js';
import { test, tags } from '../_test.setup';
import { expect } from '@playwright/test';

test.use({
	suiteId: __filename
});

/**
 * Get the currently focused cell index
 * Checks if the cell or any of its children contain the active element
 */
async function getFocusedCellIndex(app: Application): Promise<number | null> {
	const cells = app.code.driver.page.locator('[data-testid="notebook-cell"]');
	const cellCount = await cells.count();

	for (let i = 0; i < cellCount; i++) {
		const cell = cells.nth(i);
		const isFocused = await cell.evaluate((element) => {
			// Check if this cell or any descendant has focus
			return element.contains(document.activeElement) ||
				element === document.activeElement;
		});

		if (isFocused) {
			return i;
		}
	}
	return null;
}

/**
 * Check if a cell is selected (has selection styling)
 */
async function isCellSelected(app: Application, index: number): Promise<boolean> {
	const cell = app.code.driver.page.locator('[data-testid="notebook-cell"]').nth(index);
	const ariaSelected = await cell.getAttribute('aria-selected');
	return ariaSelected === 'true';
}

/**
 * Get cell count
 */
async function getCellCount(app: Application): Promise<number> {
	return await app.code.driver.page.locator('[data-testid="notebook-cell"]').count();
}

/**
 * Check if the Monaco editor in a cell is focused
 */
async function isEditorFocused(app: Application, cellIndex: number): Promise<boolean> {
	const cell = app.code.driver.page.locator('[data-testid="notebook-cell"]').nth(cellIndex);
	const editor = cell.locator('.monaco-editor');

	// Check if the monaco editor or any of its children has focus
	return await editor.evaluate((element) => {
		return element.contains(document.activeElement);
	});
}

/**
 * Normalize cell content by replacing non-breaking spaces with regular spaces
 */
function normalizeCellContent(content: string): string {
	// Replace non-breaking spaces (U+00A0) with regular spaces
	return content.replace(/\u00A0/g, ' ').replace(/&nbsp;/g, ' ');
}

/**
 * Create a fresh notebook with 5 pre-populated cells
 * Call this in tests that need a notebook with existing cells
 */
async function createNotebookWith5Cells(app: Application): Promise<void> {
	await app.workbench.notebooks.createNewNotebook();
	await app.workbench.notebooksPositron.expectToBeVisible();

	// Add content to cells
	await app.workbench.notebooksPositron.addCodeToCellAtIndex('print("Cell 0")', 0);
	await app.workbench.notebooksPositron.addCodeToCellAtIndex('print("Cell 1")', 1);
	await app.workbench.notebooksPositron.addCodeToCellAtIndex('print("Cell 2")', 2);
	await app.workbench.notebooksPositron.addCodeToCellAtIndex('print("Cell 3")', 3);
	await app.workbench.notebooksPositron.addCodeToCellAtIndex('print("Cell 4")', 4);

	expect(await getCellCount(app)).toBe(5);

	// After bulk adding cells, select the first cell to simulate proper initial state
	// (In reality, opening an existing notebook selects first cell automatically via invariant)
	await app.workbench.notebooksPositron.selectCellAtIndex(0);
	await app.code.driver.page.waitForTimeout(100);
}

// Not running on web due to Positron notebooks being desktop-only
test.describe('Notebook Focus and Selection', {
	tag: [tags.CRITICAL, tags.WIN, tags.NOTEBOOKS, tags.POSITRON_NOTEBOOKS]
}, () => {
	test.beforeAll(async function ({ app, settings }) {
		await app.workbench.notebooksPositron.enablePositronNotebooks(settings);
		await app.workbench.notebooksPositron.setNotebookEditor(settings, 'positron');
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Cell selection via click focuses cell and adds selection styling', async function ({ app }) {
		await createNotebookWith5Cells(app);

		// Click on cell 2
		await app.workbench.notebooksPositron.selectCellAtIndex(2);
		await app.workbench.notebooksPositron.waitForFocusSettle(200);

		// Verify cell is focused
		expect(await getFocusedCellIndex(app)).toBe(2);

		// Verify cell is selected (has aria-selected="true")
		expect(await isCellSelected(app, 2)).toBe(true);

		// Verify other cells are not selected
		expect(await isCellSelected(app, 0)).toBe(false);
		expect(await isCellSelected(app, 1)).toBe(false);
	});

	test('Arrow Down navigation moves focus to next cell', async function ({ app }) {
		await createNotebookWith5Cells(app);

		// Select cell 1
		await app.workbench.notebooksPositron.selectCellAtIndex(1);
		await app.workbench.notebooksPositron.waitForFocusSettle(200);
		expect(await getFocusedCellIndex(app)).toBe(1);

		// Press Escape to ensure we're not in edit mode
		await app.code.driver.page.keyboard.press('Escape');
		await app.workbench.notebooksPositron.waitForFocusSettle(100);

		// Press Arrow Down
		await app.code.driver.page.keyboard.press('ArrowDown');
		await app.workbench.notebooksPositron.waitForFocusSettle(200);

		// Focus should move to cell 2
		expect(await getFocusedCellIndex(app)).toBe(2);
		expect(await isCellSelected(app, 2)).toBe(true);
	});

	test('Arrow Up navigation moves focus to previous cell', async function ({ app }) {
		await createNotebookWith5Cells(app);

		// Select cell 3
		await app.workbench.notebooksPositron.selectCellAtIndex(3);
		await app.workbench.notebooksPositron.waitForFocusSettle(200);
		expect(await getFocusedCellIndex(app)).toBe(3);

		// Press Escape to ensure we're not in edit mode
		await app.code.driver.page.keyboard.press('Escape');
		await app.workbench.notebooksPositron.waitForFocusSettle(100);

		// Press Arrow Up
		await app.code.driver.page.keyboard.press('ArrowUp');
		await app.workbench.notebooksPositron.waitForFocusSettle(200);

		// Focus should move to cell 2
		expect(await getFocusedCellIndex(app)).toBe(2);
		expect(await isCellSelected(app, 2)).toBe(true);
	});

	test('Arrow Down at last cell does not change selection', async function ({ app }) {
		await createNotebookWith5Cells(app);

		// Select last cell (index 4)
		await app.workbench.notebooksPositron.selectCellAtIndex(4);
		await app.workbench.notebooksPositron.waitForFocusSettle(200);
		expect(await getFocusedCellIndex(app)).toBe(4);

		// Press Escape to ensure we're not in edit mode
		await app.code.driver.page.keyboard.press('Escape');
		await app.workbench.notebooksPositron.waitForFocusSettle(100);

		// Press Arrow Down
		await app.code.driver.page.keyboard.press('ArrowDown');
		await app.workbench.notebooksPositron.waitForFocusSettle(200);

		// Focus should remain on cell 4
		expect(await getFocusedCellIndex(app)).toBe(4);
	});

	test('Arrow Up at first cell does not change selection', async function ({ app }) {
		await createNotebookWith5Cells(app);

		// Select first cell (index 0)
		await app.workbench.notebooksPositron.selectCellAtIndex(0);
		await app.workbench.notebooksPositron.waitForFocusSettle(200);
		expect(await getFocusedCellIndex(app)).toBe(0);

		// Press Escape to ensure we're not in edit mode
		await app.code.driver.page.keyboard.press('Escape');
		await app.workbench.notebooksPositron.waitForFocusSettle(100);

		// Press Arrow Up
		await app.code.driver.page.keyboard.press('ArrowUp');
		await app.workbench.notebooksPositron.waitForFocusSettle(200);

		// Focus should remain on cell 0
		expect(await getFocusedCellIndex(app)).toBe(0);
	});

	test('Shift+Arrow Down adds next cell to selection', async function ({ app }) {
		await createNotebookWith5Cells(app);

		// Select cell 1
		await app.workbench.notebooksPositron.selectCellAtIndex(1);
		await app.workbench.notebooksPositron.waitForFocusSettle(200);

		// Press Escape to ensure we're not in edit mode
		await app.code.driver.page.keyboard.press('Escape');
		await app.workbench.notebooksPositron.waitForFocusSettle(100);

		// Shift+Arrow Down
		await app.code.driver.page.keyboard.press('Shift+ArrowDown');
		await app.workbench.notebooksPositron.waitForFocusSettle(200);

		// Both cell 1 and cell 2 should be selected
		expect(await isCellSelected(app, 1)).toBe(true);
		expect(await isCellSelected(app, 2)).toBe(true);
	});

	test('Focus is maintained across multiple navigation operations', async function ({ app }) {
		await createNotebookWith5Cells(app);

		// Start at cell 0
		await app.workbench.notebooksPositron.selectCellAtIndex(0);
		await app.workbench.notebooksPositron.waitForFocusSettle(200);
		await app.code.driver.page.keyboard.press('Escape');
		await app.workbench.notebooksPositron.waitForFocusSettle(100);

		// Navigate down twice
		await app.code.driver.page.keyboard.press('ArrowDown');
		await app.workbench.notebooksPositron.waitForFocusSettle(150);
		expect(await getFocusedCellIndex(app)).toBe(1);

		await app.code.driver.page.keyboard.press('ArrowDown');
		await app.workbench.notebooksPositron.waitForFocusSettle(150);
		expect(await getFocusedCellIndex(app)).toBe(2);

		// Navigate down once more
		await app.code.driver.page.keyboard.press('ArrowDown');
		await app.workbench.notebooksPositron.waitForFocusSettle(150);
		expect(await getFocusedCellIndex(app)).toBe(3);

		// Navigate up
		await app.code.driver.page.keyboard.press('ArrowUp');
		await app.workbench.notebooksPositron.waitForFocusSettle(150);
		expect(await getFocusedCellIndex(app)).toBe(2);
	});

	test('Enter key on selected cell enters edit mode', async function ({ app }) {
		await createNotebookWith5Cells(app);

		// Select cell 2
		await app.workbench.notebooksPositron.selectCellAtIndex(2);
		await app.workbench.notebooksPositron.waitForFocusSettle(200);

		// Press Escape to ensure we're not in edit mode
		await app.code.driver.page.keyboard.press('Escape');
		await app.workbench.notebooksPositron.waitForFocusSettle(200);

		// Verify cell is selected (not in edit mode)
		expect(await isCellSelected(app, 2)).toBe(true);
		expect(await isEditorFocused(app, 2)).toBe(false);

		// Press Enter to enter edit mode
		await app.code.driver.page.keyboard.press('Enter');
		await app.workbench.notebooksPositron.waitForFocusSettle(300);

		// Verify Monaco editor is now focused
		expect(await isEditorFocused(app, 2)).toBe(true);

		// Verify we can type in the editor
		await app.code.driver.page.keyboard.type('# test');
		await app.workbench.notebooksPositron.waitForFocusSettle(100);

		// Verify content was added (cell should contain original + new text)
		const cellContent = await app.workbench.notebooksPositron.getCellContent(2);
		const normalizedContent = normalizeCellContent(cellContent);
		expect(normalizedContent).toContain('# test');

		// Verify no extra newline was added at the beginning (Enter key didn't bleed through)
		// The content should start with the original content, not a newline
		expect(normalizedContent).toMatch(/^print\("Cell 2"\)/);
	});

	test('Shift+Enter on last cell creates new cell and enters edit mode', async function ({ app }) {
		await createNotebookWith5Cells(app);

		// Select last cell (index 4)
		await app.workbench.notebooksPositron.selectCellAtIndex(4);
		await app.workbench.notebooksPositron.waitForFocusSettle(200);

		// Enter edit mode on the last cell
		await app.code.driver.page.keyboard.press('Enter');
		await app.workbench.notebooksPositron.waitForFocusSettle(300);
		expect(await isEditorFocused(app, 4)).toBe(true);

		// Get initial cell count
		const initialCount = await getCellCount(app);
		expect(initialCount).toBe(5);

		// Press Shift+Enter to add a new cell below
		await app.code.driver.page.keyboard.press('Shift+Enter');
		await app.workbench.notebooksPositron.waitForFocusSettle(500);

		// Verify new cell was added
		const newCount = await getCellCount(app);
		expect(newCount).toBe(6);

		// Verify the NEW cell (index 5) is now in edit mode with focus
		expect(await isEditorFocused(app, 5)).toBe(true);
		expect(await isCellSelected(app, 5)).toBe(true);

		// Verify we can type immediately in the new cell
		await app.code.driver.page.keyboard.type('new cell content');
		await app.workbench.notebooksPositron.waitForFocusSettle(100);

		const newCellContent = await app.workbench.notebooksPositron.getCellContent(5);
		const normalizedContent = normalizeCellContent(newCellContent);
		expect(normalizedContent).toContain('new cell content');
	});

	test('Enter key in edit mode adds newline within cell', async function ({ app }) {
		await createNotebookWith5Cells(app);

		// Select cell 1 and enter edit mode
		await app.workbench.notebooksPositron.selectCellAtIndex(1);
		await app.workbench.notebooksPositron.waitForFocusSettle(200);
		await app.code.driver.page.keyboard.press('Enter');
		await app.workbench.notebooksPositron.waitForFocusSettle(300);
		expect(await isEditorFocused(app, 1)).toBe(true);

		// Get initial content
		const initialContent = await app.workbench.notebooksPositron.getCellContent(1);
		const normalizedInitial = normalizeCellContent(initialContent);
		const lineText = 'print("Cell 1")';
		expect(normalizedInitial).toBe(lineText);

		// Get cell and editor locators for line counting
		const cell = app.code.driver.page.locator('[data-testid="notebook-cell"]').nth(1);
		const editor = cell.locator('.positron-cell-editor-monaco-widget');
		const viewLines = editor.locator('.view-line');

		// Position cursor in the middle of the cells contents to avoid any trailing newline trimming issues
		await app.code.driver.page.keyboard.press('Home');
		const middleIndex = Math.floor(lineText.length / 2);
		for (let i = 0; i < middleIndex; i++) { // move to middle of line
			await app.code.driver.page.keyboard.press('ArrowRight');
		}
		await app.workbench.notebooksPositron.waitForFocusSettle(100);

		// Sanity check: Get initial line count before pressing Enter
		const initialLineCount = await viewLines.count();

		// Press Enter to split the line in the middle
		await app.code.driver.page.keyboard.press('Enter');
		await app.workbench.notebooksPositron.waitForFocusSettle(200);

		// Verify the line count increased by counting Monaco's .view-line elements
		// Note: getCellContent uses .textContent() which strips newlines, so we count line elements directly
		const lineCount = await viewLines.count();

		// Line count should have increased by 1 after pressing Enter
		expect(lineCount).toBe(initialLineCount + 1);

		// Verify we're still in the same cell (cell count unchanged)
		expect(await getCellCount(app)).toBe(5);

		// Verify we're still in edit mode in cell 1
		expect(await isEditorFocused(app, 1)).toBe(true);
	});

	test('First cell is automatically selected when notebook loads', async function ({ app }) {
		// Open a real notebook file to test initial load behavior
		const notebookPath = path.join('workspaces', 'bitmap-notebook', 'bitmap-notebook.ipynb');
		await app.workbench.notebooks.openNotebook(notebookPath, false);
		await app.workbench.notebooksPositron.expectToBeVisible();

		// Wait for cells to be in DOM and for initial focus to settle
		await app.workbench.notebooksPositron.waitForCellsInDOM(5000);
		await app.workbench.notebooksPositron.waitForFocusSettle();

		// EXPECTED: First cell should be automatically selected without any user interaction
		const focusedIndex = await getFocusedCellIndex(app);
		expect(focusedIndex).toBe(0);
		expect(await isCellSelected(app, 0)).toBe(true);
	});

	test('Keyboard navigation works immediately without clicking any cell', async function ({ app }) {
		await createNotebookWith5Cells(app);

		// Wait for initial selection to settle
		await app.workbench.notebooksPositron.waitForFocusSettle();

		// Press Escape first to ensure we're not in edit mode
		await app.code.driver.page.keyboard.press('Escape');
		await app.workbench.notebooksPositron.waitForFocusSettle(500);

		// Press Arrow Down - EXPECTED: should move from cell 0 to cell 1
		await app.code.driver.page.keyboard.press('ArrowDown');
		await app.workbench.notebooksPositron.waitForFocusSettle(500);

		expect(await getFocusedCellIndex(app)).toBe(1);
		expect(await isCellSelected(app, 1)).toBe(true);

		// Arrow Down again should move to cell 2
		await app.code.driver.page.keyboard.press('ArrowDown');
		await app.workbench.notebooksPositron.waitForFocusSettle(500);

		expect(await getFocusedCellIndex(app)).toBe(2);
		expect(await isCellSelected(app, 2)).toBe(true);
	});

	test('Selection is preserved when switching between editors', async function ({ app }) {
		await createNotebookWith5Cells(app);

		// Select cell 2 explicitly
		await app.workbench.notebooksPositron.selectCellAtIndex(2);
		await app.workbench.notebooksPositron.waitForFocusSettle(200);
		expect(await getFocusedCellIndex(app)).toBe(2);

		// Press Escape to exit edit mode
		await app.code.driver.page.keyboard.press('Escape');
		await app.workbench.notebooksPositron.waitForFocusSettle(100);

		// Create a new untitled file (switches editor focus away)
		await app.workbench.quickaccess.runCommand('workbench.action.files.newUntitledFile');

		// Switch back to notebook using Ctrl/Cmd+Tab (or keyboard navigation)
		// Use Cmd+Shift+P to open command palette, then navigate back
		await app.workbench.quickaccess.runCommand('workbench.action.previousEditor');

		// EXPECTED: Cell 2 should still be selected and focused
		await app.workbench.notebooksPositron.waitForFocusSettle(1000);
		expect(await getFocusedCellIndex(app)).toBe(2);
		expect(await isCellSelected(app, 2)).toBe(true);

		// Keyboard navigation should still work
		await app.code.driver.page.keyboard.press('ArrowDown');
		await app.workbench.notebooksPositron.waitForFocusSettle(200);
		expect(await getFocusedCellIndex(app)).toBe(3);
	});

});
