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
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {
	test.beforeAll(async function ({ app, settings }) {
		await app.workbench.notebooksPositron.enablePositronNotebooks(settings);
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Action Bar: swap 1st and 2nd cell', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// Open an existing notebook to match manual testing scenario
		const notebookPath = path.join('workspaces', 'bitmap-notebook', 'bitmap-notebook.ipynb');
		await notebooksPositron.openNotebook(notebookPath);

		// Get initial cell count
		const initialCount = await notebooksPositron.getCellCount();
		expect(initialCount).toBeGreaterThan(2); // Need at least 3 cells to test moving

		// Get the content of the first three cells to verify order
		const cell0Content = await notebooksPositron.getCodeCellContent(0);
		const cell1Content = await notebooksPositron.getCodeCellContent(1);
		const cell2Content = await notebooksPositron.getCodeCellContent(2);

		// Select "Move cell down"
		await notebooksPositron.triggerCellAction(0, 'Move cell down');

		// Verify cell moved down by EXACTLY ONE position
		await notebooksPositron.expectCellContentAtIndexToBe(0, cell1Content); // Former cell 1 is now at position 0
		await notebooksPositron.expectCellContentAtIndexToBe(1, cell0Content); // Former cell 0 is now at position 1
		await notebooksPositron.expectCellContentAtIndexToBe(2, cell2Content); // Cell 2 should be unchanged

		// Verify cell count hasn't changed
		await notebooksPositron.expectCellCountToBe(initialCount);
	});

	test('Keyboard: swap 1st and 2nd cell', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		// Setup: Create notebook with 3 cells
		await notebooksPositron.newNotebook({ codeCells: 3 });

		// Verify initial order
		await notebooksPositron.expectCellCountToBe(3);
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2']);

		// Select first cell and move down
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await keyboard.press('Alt+ArrowDown');

		// Verify cell moved down by exactly one position
		await notebooksPositron.expectCellCountToBe(3);
		await notebooksPositron.expectCellContentsToBe(['# Cell 1', '# Cell 0', '# Cell 2']);
	});

	test('Boundaries: first-up and last-down are no-ops', async ({ app }) => {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		await notebooksPositron.newNotebook({ codeCells: 3 });
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2']);

		// First cell up -> no change
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await keyboard.press('Alt+ArrowUp');
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2']);

		// Last cell down -> no change
		await notebooksPositron.selectCellAtIndex(2, { editMode: false });
		await keyboard.press('Alt+ArrowDown');
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2']);

		await notebooksPositron.expectCellCountToBe(3);
	});

	test('Multi-move: move first to end then one up', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		// Setup: Create notebook with 4 cells
		await notebooksPositron.newNotebook({ codeCells: 4 });
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2', '# Cell 3']);

		// Move Cell 0 down three times to end
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await keyboard.press('Alt+ArrowDown');
		await notebooksPositron.expectCellContentsToBe(['# Cell 1', '# Cell 0', '# Cell 2', '# Cell 3']);

		await keyboard.press('Alt+ArrowDown');
		await notebooksPositron.expectCellContentsToBe(['# Cell 1', '# Cell 2', '# Cell 0', '# Cell 3']);

		await keyboard.press('Alt+ArrowDown');
		await notebooksPositron.expectCellContentsToBe(['# Cell 1', '# Cell 2', '# Cell 3', '# Cell 0']);

		// Now move it back up
		await keyboard.press('Alt+ArrowUp');
		await notebooksPositron.expectCellContentsToBe(['# Cell 1', '# Cell 2', '# Cell 0', '# Cell 3']);
	});

	test('Undo/redo cell move operation', async function ({ app, hotKeys }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		// Setup: Create notebook with 3 cells
		await notebooksPositron.newNotebook({ codeCells: 3 });
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2']);

		// Move cell 1 up
		await notebooksPositron.selectCellAtIndex(1, { editMode: false });
		await keyboard.press('Alt+ArrowUp');
		await notebooksPositron.expectCellContentsToBe(['# Cell 1', '# Cell 0', '# Cell 2']);

		// Undo the move
		await notebooksPositron.performCellAction('undo');
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2']);

		// Redo the move
		await notebooksPositron.performCellAction('redo');
		await notebooksPositron.expectCellContentsToBe(['# Cell 1', '# Cell 0', '# Cell 2']);
	});

	// @dhruvisompura unskip me
	test.skip('Multiselect: move multiple cells', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		// Create notebook with 5 cells
		await notebooksPositron.newNotebook({ codeCells: 2, markdownCells: 3 });

		// Select cells 1, 2, and 3
		await notebooksPositron.selectCellAtIndex(1, { editMode: false });
		await keyboard.press('Shift+ArrowDown');
		await keyboard.press('Shift+ArrowDown');
		await notebooksPositron.expectCellsToBeSelected([1, 2, 3]);

		// Move selected cells down
		await keyboard.press('Alt+ArrowDown');
		await keyboard.press('Alt+ArrowDown');
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', 'Cell 4', '# Cell 1', 'Cell 2', 'Cell 3']);
	});
});
