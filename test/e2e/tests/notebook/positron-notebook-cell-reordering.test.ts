/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { test, tags } from '../_test.setup';
import { expect } from '@playwright/test';

test.use({
	suiteId: __filename
});

test.describe('Notebook Cell Reordering', {
	tag: [tags.CRITICAL, tags.WIN, tags.NOTEBOOKS]
}, () => {
	test.beforeAll(async function ({ app, settings }) {
		await app.workbench.notebooksPositron.enablePositronNotebooks(settings);
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Move first cell down using action bar button - should swap with second cell', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// Open an existing notebook to match manual testing scenario
		const notebookPath = path.join('workspaces', 'bitmap-notebook', 'bitmap-notebook.ipynb');
		await notebooksPositron.openNotebook(notebookPath);

		// Get initial cell count
		const initialCount = await notebooksPositron.getCellCount();
		expect(initialCount).toBeGreaterThan(2); // Need at least 3 cells to test moving

		// Get the content of the first three cells to verify order
		const cell0Content = await notebooksPositron.getCellContent(0);
		const cell1Content = await notebooksPositron.getCellContent(1);
		const cell2Content = await notebooksPositron.getCellContent(2);

		// Select first cell
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });

		// Find and click the "More Actions" button in the action bar
		const cell = app.code.driver.page.locator('[data-testid="notebook-cell"]').nth(0);
		const moreActionsButton = cell.getByRole('button', { name: /more actions/i });
		await expect(moreActionsButton).toBeVisible({ timeout: 5000 });
		await moreActionsButton.click();

		// Wait for the menu to open and find "Move cell down" option
		const moveDownOption = app.code.driver.page.locator('button.custom-context-menu-item', { hasText: /move cell down/i });
		await expect(moveDownOption).toBeVisible({ timeout: 5000 });
		await moveDownOption.click();

		// Verify cell moved down by EXACTLY ONE position
		await notebooksPositron.expectCellContentAtIndexToBe(0, cell1Content); // Former cell 1 is now at position 0
		await notebooksPositron.expectCellContentAtIndexToBe(1, cell0Content); // Former cell 0 is now at position 1
		await notebooksPositron.expectCellContentAtIndexToBe(2, cell2Content); // Cell 2 should be unchanged

		// Verify cell count hasn't changed
		await notebooksPositron.expectCellCountToBe(initialCount);
	});

	test('Move first cell down - should swap with second cell', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// Setup: Create notebook with 3 cells
		await notebooksPositron.newNotebook(3);

		// Verify initial order
		await notebooksPositron.expectCellCountToBe(3);
		await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 0');
		await notebooksPositron.expectCellContentAtIndexToBe(1, '# Cell 1');
		await notebooksPositron.expectCellContentAtIndexToBe(2, '# Cell 2');

		// Select first cell and move down
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await app.code.driver.page.keyboard.press('Alt+ArrowDown');

		// Verify cell moved down by exactly one position
		await notebooksPositron.expectCellCountToBe(3);
		await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 1');
		await notebooksPositron.expectCellContentAtIndexToBe(1, '# Cell 0');
		await notebooksPositron.expectCellContentAtIndexToBe(2, '# Cell 2');
	});

	test('Move cell up - basic operation', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// Setup: Create notebook with 3 cells
		await notebooksPositron.newNotebook(3);

		// Verify initial order
		await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 0');
		await notebooksPositron.expectCellContentAtIndexToBe(1, '# Cell 1');
		await notebooksPositron.expectCellContentAtIndexToBe(2, '# Cell 2');

		// Select second cell and move up
		await notebooksPositron.selectCellAtIndex(1, { editMode: false });
		await app.code.driver.page.keyboard.press('Alt+ArrowUp');

		// Verify cell moved up
		await notebooksPositron.expectCellCountToBe(3);
		await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 1');
		await notebooksPositron.expectCellContentAtIndexToBe(1, '# Cell 0');
		await notebooksPositron.expectCellContentAtIndexToBe(2, '# Cell 2');
	});

	test('Move cell down - basic operation', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// Setup: Create notebook with 3 cells
		await notebooksPositron.newNotebook(3);

		// Verify initial order
		await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 0');
		await notebooksPositron.expectCellContentAtIndexToBe(1, '# Cell 1');
		await notebooksPositron.expectCellContentAtIndexToBe(2, '# Cell 2');

		// Select first cell and move down
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await app.code.driver.page.keyboard.press('Alt+ArrowDown');

		// Verify cell moved down
		await notebooksPositron.expectCellCountToBe(3);
		await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 1');
		await notebooksPositron.expectCellContentAtIndexToBe(1, '# Cell 0');
		await notebooksPositron.expectCellContentAtIndexToBe(2, '# Cell 2');
	});

	test('Move last cell up', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// Setup: Create notebook with 3 cells
		await notebooksPositron.newNotebook(3);

		// Verify initial order
		await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 0');
		await notebooksPositron.expectCellContentAtIndexToBe(1, '# Cell 1');
		await notebooksPositron.expectCellContentAtIndexToBe(2, '# Cell 2');

		// Select last cell and move up
		await notebooksPositron.selectCellAtIndex(2, { editMode: false });
		await app.code.driver.page.keyboard.press('Alt+ArrowUp');

		// Verify cell moved up
		await notebooksPositron.expectCellCountToBe(3);
		await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 0');
		await notebooksPositron.expectCellContentAtIndexToBe(1, '# Cell 2');
		await notebooksPositron.expectCellContentAtIndexToBe(2, '# Cell 1');
	});

	test('Boundary: Cannot move first cell up', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// Setup: Create notebook with 3 cells
		await notebooksPositron.newNotebook(3);

		// Verify initial order
		await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 0');
		await notebooksPositron.expectCellContentAtIndexToBe(1, '# Cell 1');
		await notebooksPositron.expectCellContentAtIndexToBe(2, '# Cell 2');

		// Select first cell and try to move up (should be no-op)
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await app.code.driver.page.keyboard.press('Alt+ArrowUp');

		// Verify order hasn't changed
		await notebooksPositron.expectCellCountToBe(3);
		await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 0');
		await notebooksPositron.expectCellContentAtIndexToBe(1, '# Cell 1');
		await notebooksPositron.expectCellContentAtIndexToBe(2, '# Cell 2');
	});

	test('Boundary: Cannot move last cell down', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// Setup: Create notebook with 3 cells
		await notebooksPositron.newNotebook(3);

		// Verify initial order
		await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 0');
		await notebooksPositron.expectCellContentAtIndexToBe(1, '# Cell 1');
		await notebooksPositron.expectCellContentAtIndexToBe(2, '# Cell 2');

		// Select last cell and try to move down (should be no-op)
		await notebooksPositron.selectCellAtIndex(2, { editMode: false });
		await app.code.driver.page.keyboard.press('Alt+ArrowDown');

		// Verify order hasn't changed
		await notebooksPositron.expectCellCountToBe(3);
		await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 0');
		await notebooksPositron.expectCellContentAtIndexToBe(1, '# Cell 1');
		await notebooksPositron.expectCellContentAtIndexToBe(2, '# Cell 2');
	});

	test('Move cell multiple times', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// Setup: Create notebook with 4 cells
		await notebooksPositron.newNotebook(4);

		// Verify initial order
		await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 0');
		await notebooksPositron.expectCellContentAtIndexToBe(1, '# Cell 1');
		await notebooksPositron.expectCellContentAtIndexToBe(2, '# Cell 2');
		await notebooksPositron.expectCellContentAtIndexToBe(3, '# Cell 3');

		// Move Cell 0 down three times to end
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await app.code.driver.page.keyboard.press('Alt+ArrowDown');
		await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 1');
		await notebooksPositron.expectCellContentAtIndexToBe(1, '# Cell 0');
		await notebooksPositron.expectCellContentAtIndexToBe(2, '# Cell 2');
		await notebooksPositron.expectCellContentAtIndexToBe(3, '# Cell 3');

		await app.code.driver.page.keyboard.press('Alt+ArrowDown');
		await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 1');
		await notebooksPositron.expectCellContentAtIndexToBe(1, '# Cell 2');
		await notebooksPositron.expectCellContentAtIndexToBe(2, '# Cell 0');
		await notebooksPositron.expectCellContentAtIndexToBe(3, '# Cell 3');

		await app.code.driver.page.keyboard.press('Alt+ArrowDown');
		await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 1');
		await notebooksPositron.expectCellContentAtIndexToBe(1, '# Cell 2');
		await notebooksPositron.expectCellContentAtIndexToBe(2, '# Cell 3');
		await notebooksPositron.expectCellContentAtIndexToBe(3, '# Cell 0');

		// Now move it back up
		await app.code.driver.page.keyboard.press('Alt+ArrowUp');
		await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 1');
		await notebooksPositron.expectCellContentAtIndexToBe(1, '# Cell 2');
		await notebooksPositron.expectCellContentAtIndexToBe(2, '# Cell 0');
		await notebooksPositron.expectCellContentAtIndexToBe(3, '# Cell 3');
	});

	test('Undo/redo cell move operation', async function ({ app, hotKeys }) {
		const { notebooksPositron } = app.workbench;

		// Setup: Create notebook with 3 cells
		await notebooksPositron.newNotebook(3);

		// Verify initial order
		await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 0');
		await notebooksPositron.expectCellContentAtIndexToBe(1, '# Cell 1');
		await notebooksPositron.expectCellContentAtIndexToBe(2, '# Cell 2');

		// Move cell 1 up
		await notebooksPositron.selectCellAtIndex(1, { editMode: false });
		await app.code.driver.page.keyboard.press('Alt+ArrowUp');
		await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 1');
		await notebooksPositron.expectCellContentAtIndexToBe(1, '# Cell 0');
		await notebooksPositron.expectCellContentAtIndexToBe(2, '# Cell 2');

		// Undo the move
		await hotKeys.undo();
		await app.code.driver.page.waitForTimeout(500);

		// Verify order is restored
		await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 0');
		await notebooksPositron.expectCellContentAtIndexToBe(1, '# Cell 1');
		await notebooksPositron.expectCellContentAtIndexToBe(2, '# Cell 2');

		// Redo the move
		await hotKeys.redo();
		await app.code.driver.page.waitForTimeout(500);

		// Verify order is changed again
		await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 1');
		await notebooksPositron.expectCellContentAtIndexToBe(1, '# Cell 0');
		await notebooksPositron.expectCellContentAtIndexToBe(2, '# Cell 2');
	});
});
