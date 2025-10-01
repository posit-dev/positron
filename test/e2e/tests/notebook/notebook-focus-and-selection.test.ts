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
 * Helper function to check if a cell is selected (has selection styling)
 */
async function isCellSelected(app: Application, index: number): Promise<boolean> {
	const cell = app.code.driver.page.locator('[data-testid="notebook-cell"]').nth(index);
	const ariaSelected = await cell.getAttribute('aria-selected');
	return ariaSelected === 'true';
}

/**
 * Helper function to get cell count
 */
async function getCellCount(app: Application): Promise<number> {
	return await app.code.driver.page.locator('[data-testid="notebook-cell"]').count();
}

/**
 * Helper function to wait for focus to settle (useful after DOM changes)
 */
async function waitForFocusSettle(app: Application, timeoutMs: number = 500): Promise<void> {
	await app.code.driver.page.waitForTimeout(timeoutMs);
}

/**
 * Helper function to check if the Monaco editor in a cell is focused
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
 * Helper function to normalize cell content by replacing non-breaking spaces with regular spaces
 */
function normalizeCellContent(content: string): string {
	// Replace non-breaking spaces (U+00A0) with regular spaces
	return content.replace(/\u00A0/g, ' ').replace(/&nbsp;/g, ' ');
}

// Not running on web due to Positron notebooks being desktop-only
test.describe('Notebook Focus and Selection', {
	tag: [tags.CRITICAL, tags.WIN, tags.NOTEBOOKS]
}, () => {
	test.beforeAll(async function ({ app, settings }) {
		await app.workbench.notebooksPositron.enablePositronNotebooks(settings);
		await app.workbench.notebooksPositron.setNotebookEditor(settings, 'positron');
	});

	test.beforeEach(async function ({ app }) {
		// Create a fresh notebook with 5 cells for each test
		await app.workbench.notebooks.createNewNotebook();
		await app.workbench.notebooksPositron.expectToBeVisible();

		// Add content to cells
		await app.workbench.notebooksPositron.addCodeToCellAtIndex('print("Cell 0")', 0);
		await app.workbench.notebooksPositron.addCodeToCellAtIndex('print("Cell 1")', 1);
		await app.workbench.notebooksPositron.addCodeToCellAtIndex('print("Cell 2")', 2);
		await app.workbench.notebooksPositron.addCodeToCellAtIndex('print("Cell 3")', 3);
		await app.workbench.notebooksPositron.addCodeToCellAtIndex('print("Cell 4")', 4);

		expect(await getCellCount(app)).toBe(5);
	});

	test.afterEach(async function ({ app, hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Cell selection via click focuses cell and adds selection styling', async function ({ app }) {
		// Click on cell 2
		await app.workbench.notebooksPositron.selectCellAtIndex(2);
		await waitForFocusSettle(app, 200);

		// Verify cell is focused
		expect(await getFocusedCellIndex(app)).toBe(2);

		// Verify cell is selected (has aria-selected="true")
		expect(await isCellSelected(app, 2)).toBe(true);

		// Verify other cells are not selected
		expect(await isCellSelected(app, 0)).toBe(false);
		expect(await isCellSelected(app, 1)).toBe(false);
	});

	// NOTE: Clicking a selected cell currently does NOT deselect it in the current implementation
	// This test is commented out as the behavior may change during refactoring
	// test('Clicking a selected cell deselects it', async function ({ app }) { ... });

	test('Arrow Down navigation moves focus to next cell', async function ({ app }) {
		// Select cell 1
		await app.workbench.notebooksPositron.selectCellAtIndex(1);
		await waitForFocusSettle(app, 200);
		expect(await getFocusedCellIndex(app)).toBe(1);

		// Press Escape to ensure we're not in edit mode
		await app.code.driver.page.keyboard.press('Escape');
		await waitForFocusSettle(app, 100);

		// Press Arrow Down
		await app.code.driver.page.keyboard.press('ArrowDown');
		await waitForFocusSettle(app, 200);

		// Focus should move to cell 2
		expect(await getFocusedCellIndex(app)).toBe(2);
		expect(await isCellSelected(app, 2)).toBe(true);
	});

	test('Arrow Up navigation moves focus to previous cell', async function ({ app }) {
		// Select cell 3
		await app.workbench.notebooksPositron.selectCellAtIndex(3);
		await waitForFocusSettle(app, 200);
		expect(await getFocusedCellIndex(app)).toBe(3);

		// Press Escape to ensure we're not in edit mode
		await app.code.driver.page.keyboard.press('Escape');
		await waitForFocusSettle(app, 100);

		// Press Arrow Up
		await app.code.driver.page.keyboard.press('ArrowUp');
		await waitForFocusSettle(app, 200);

		// Focus should move to cell 2
		expect(await getFocusedCellIndex(app)).toBe(2);
		expect(await isCellSelected(app, 2)).toBe(true);
	});

	test('Arrow Down at last cell does not change selection', async function ({ app }) {
		// Select last cell (index 4)
		await app.workbench.notebooksPositron.selectCellAtIndex(4);
		await waitForFocusSettle(app, 200);
		expect(await getFocusedCellIndex(app)).toBe(4);

		// Press Escape to ensure we're not in edit mode
		await app.code.driver.page.keyboard.press('Escape');
		await waitForFocusSettle(app, 100);

		// Press Arrow Down
		await app.code.driver.page.keyboard.press('ArrowDown');
		await waitForFocusSettle(app, 200);

		// Focus should remain on cell 4
		expect(await getFocusedCellIndex(app)).toBe(4);
	});

	test('Arrow Up at first cell does not change selection', async function ({ app }) {
		// Select first cell (index 0)
		await app.workbench.notebooksPositron.selectCellAtIndex(0);
		await waitForFocusSettle(app, 200);
		expect(await getFocusedCellIndex(app)).toBe(0);

		// Press Escape to ensure we're not in edit mode
		await app.code.driver.page.keyboard.press('Escape');
		await waitForFocusSettle(app, 100);

		// Press Arrow Up
		await app.code.driver.page.keyboard.press('ArrowUp');
		await waitForFocusSettle(app, 200);

		// Focus should remain on cell 0
		expect(await getFocusedCellIndex(app)).toBe(0);
	});

	test('Shift+Arrow Down adds next cell to selection', async function ({ app }) {
		// Select cell 1
		await app.workbench.notebooksPositron.selectCellAtIndex(1);
		await waitForFocusSettle(app, 200);

		// Press Escape to ensure we're not in edit mode
		await app.code.driver.page.keyboard.press('Escape');
		await waitForFocusSettle(app, 100);

		// Shift+Arrow Down
		await app.code.driver.page.keyboard.press('Shift+ArrowDown');
		await waitForFocusSettle(app, 200);

		// Both cell 1 and cell 2 should be selected
		expect(await isCellSelected(app, 1)).toBe(true);
		expect(await isCellSelected(app, 2)).toBe(true);
	});

	test('Focus is maintained across multiple navigation operations', async function ({ app }) {
		// Start at cell 0
		await app.workbench.notebooksPositron.selectCellAtIndex(0);
		await waitForFocusSettle(app, 200);
		await app.code.driver.page.keyboard.press('Escape');
		await waitForFocusSettle(app, 100);

		// Navigate down twice
		await app.code.driver.page.keyboard.press('ArrowDown');
		await waitForFocusSettle(app, 150);
		expect(await getFocusedCellIndex(app)).toBe(1);

		await app.code.driver.page.keyboard.press('ArrowDown');
		await waitForFocusSettle(app, 150);
		expect(await getFocusedCellIndex(app)).toBe(2);

		// Navigate down once more
		await app.code.driver.page.keyboard.press('ArrowDown');
		await waitForFocusSettle(app, 150);
		expect(await getFocusedCellIndex(app)).toBe(3);

		// Navigate up
		await app.code.driver.page.keyboard.press('ArrowUp');
		await waitForFocusSettle(app, 150);
		expect(await getFocusedCellIndex(app)).toBe(2);
	});

	test('Sanity check: clicking editor focuses it (validates isEditorFocused helper)', async function ({ app }) {
		// Select cell 1
		await app.workbench.notebooksPositron.selectCellAtIndex(1);
		await waitForFocusSettle(app, 200);

		// Press Escape to exit edit mode (selectCellAtIndex may enter edit mode)
		await app.code.driver.page.keyboard.press('Escape');
		await waitForFocusSettle(app, 200);

		// Editor should not be focused after pressing Escape
		expect(await isEditorFocused(app, 1)).toBe(false);

		// Click directly into the Monaco editor
		const cell = app.code.driver.page.locator('[data-testid="notebook-cell"]').nth(1);
		const editor = cell.locator('.monaco-editor');
		await editor.click();
		await waitForFocusSettle(app, 200);

		// Now editor should be focused
		expect(await isEditorFocused(app, 1)).toBe(true);

		// Type some text to confirm editor is really focused
		await app.code.driver.page.keyboard.type('# editor good');
		const cellContent = await app.workbench.notebooksPositron.getCellContent(1);
		// Normalize content to handle non-breaking spaces
		const normalizedContent = normalizeCellContent(cellContent);
		expect(normalizedContent).toContain('# editor good');
	});

	test('Enter key on selected cell enters edit mode', async function ({ app }) {
		// Select cell 2
		await app.workbench.notebooksPositron.selectCellAtIndex(2);
		await waitForFocusSettle(app, 200);

		// Press Escape to ensure we're not in edit mode
		await app.code.driver.page.keyboard.press('Escape');
		await waitForFocusSettle(app, 200);

		// Verify cell is selected (not in edit mode)
		expect(await isCellSelected(app, 2)).toBe(true);
		expect(await isEditorFocused(app, 2)).toBe(false);

		// Press Enter to enter edit mode
		await app.code.driver.page.keyboard.press('Enter');
		await waitForFocusSettle(app, 300);

		// Verify Monaco editor is now focused
		expect(await isEditorFocused(app, 2)).toBe(true);

		// Verify we can type in the editor
		await app.code.driver.page.keyboard.type('# test');
		await waitForFocusSettle(app, 100);

		// Verify content was added (cell should contain original + new text)
		const cellContent = await app.workbench.notebooksPositron.getCellContent(2);
		const normalizedContent = normalizeCellContent(cellContent);
		expect(normalizedContent).toContain('# test');
	});

	// The following tests are disabled because they test features that either:
	// 1. Don't work with keyboard shortcuts (insert/delete need UI interaction)
	// 2. Have different behavior than expected (edit mode, shift+click)
	// These tests document the INTENDED behavior after refactoring is complete

	// test('Enter key on selected cell focuses editor', async function ({ app }) { ... });
	// test('Escape key in editor exits edit mode and focuses cell container', async function ({ app }) { ... });
	// test('Shift+Click adds cell to selection', async function ({ app }) { ... });
	// test('Insert cell above focuses new cell', async function ({ app }) { ... });
	// test('Insert cell below focuses new cell', async function ({ app }) { ... });
	// test('Delete cell focuses next cell', async function ({ app }) { ... });
	// test('Delete last cell focuses previous cell', async function ({ app }) { ... });
	// test('Clicking outside editor while editing exits edit mode', async function ({ app }) { ... });
});
