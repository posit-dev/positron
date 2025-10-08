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

/**
 * Helper function to perform undo using keyboard shortcut
 */
async function undoWithKeyboard(app: Application): Promise<void> {
	// Exit edit mode and wait for focus to leave Monaco editor
	await app.workbench.notebooksPositron.exitEditMode();
	const modifierKey = process.platform === 'darwin' ? 'Meta' : 'Control';
	await app.code.driver.page.keyboard.press(`${modifierKey}+KeyZ`);
}

/**
 * Helper function to perform redo using keyboard shortcut
 */
async function redoWithKeyboard(app: Application): Promise<void> {
	// Exit edit mode and wait for focus to leave Monaco editor
	await app.workbench.notebooksPositron.exitEditMode();
	const modifierKey = process.platform === 'darwin' ? 'Meta' : 'Control';
	await app.code.driver.page.keyboard.press(`${modifierKey}+Shift+KeyZ`);
}

/**
 * Helper function to delete a cell using keyboard shortcut
 */
async function deleteCellWithKeyboard(app: Application): Promise<void> {
	// Exit edit mode and wait for focus to leave Monaco editor
	await app.workbench.notebooksPositron.exitEditMode();
	await app.code.driver.page.keyboard.press('Backspace');
}

/**
 * Helper function to add a code cell below using keyboard shortcut
 */
async function addCodeCellBelowWithKeyboard(app: Application): Promise<void> {
	// Exit edit mode and wait for focus to leave Monaco editor
	await app.workbench.notebooksPositron.exitEditMode();
	await app.code.driver.page.keyboard.press('KeyB');
}

// Not running on web due to https://github.com/posit-dev/positron/issues/9193
test.describe('Notebook Cell Undo-Redo Behavior', {
	tag: [tags.CRITICAL, tags.WIN, tags.NOTEBOOKS, tags.POSITRON_NOTEBOOKS]
}, () => {
	// Skip these tests on CI due to flakiness - will address in followup PR
	test.skip(process.env.CI === 'true', 'Skipping undo-redo tests on CI due to flakiness');

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

		// Redo the add cell operation to add back cell
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
		// Cleanup
		// ========================================
		// Close the notebook without saving
		await app.workbench.notebooks.closeNotebookWithoutSaving();
	});
});
