/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Cell Copy-Paste Behavior', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test.beforeAll(async ({ app, settings }) => {
		await app.workbench.notebooksPositron.enablePositronNotebooks(settings);
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Single: Copy and paste cell content in various scenarios', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		await notebooksPositron.newNotebook({ codeCells: 5 });

		// ========================================
		// Test 1: Copy single cell and paste at end
		// ========================================
		await test.step('Test 1: Copy single cell and paste at end', async () => {
			// Perform copy on cell 2
			await notebooksPositron.selectCellAtIndex(2, { editMode: false });
			await notebooksPositron.performCellAction('copy');

			// Move to last cell and perform paste
			await notebooksPositron.selectCellAtIndex(4, { editMode: false });
			await notebooksPositron.performCellAction('paste');
			await notebooksPositron.expectCellCountToBe(6);

			// Verify pasted contents are correct at new index 5
			await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2', '# Cell 3', '# Cell 4', '# Cell 2']);
		});

		// ========================================
		// Test 2: Cut single cell and paste at different position
		// ========================================
		await test.step('Test 2: Cut single cell and paste at different position', async () => {
			// Perform cut on cell 1
			await notebooksPositron.selectCellAtIndex(1, { editMode: false }); // # Cell 1
			await notebooksPositron.performCellAction('cut');

			// Verify cell count decreased and cell 1 is removed
			await notebooksPositron.expectCellCountToBe(5);
			await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 2', '# Cell 3', '# Cell 4', '# Cell 2']);

			// Move to index 3 and paste
			await notebooksPositron.selectCellAtIndex(3, { editMode: false });
			await notebooksPositron.performCellAction('paste');

			// Verify cell count restored and cell content is correct
			await notebooksPositron.expectCellCountToBe(6);
			await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 2', '# Cell 3', '# Cell 4', '# Cell 1', '# Cell 2']);
		});

		// ========================================
		// Test 3: Copy cell and paste multiple times (clipboard persistence)
		// ========================================
		await test.step('Test 3: Copy cell and paste multiple times (clipboard persistence)', async () => {
			// Copy cell 0
			await notebooksPositron.selectCellAtIndex(0, { editMode: false }); // # Cell 0
			await notebooksPositron.performCellAction('copy');

			// Paste at position 2
			await notebooksPositron.selectCellAtIndex(2, { editMode: false }); // # Cell 3
			await notebooksPositron.performCellAction('paste');

			// Verify first paste
			await notebooksPositron.expectCellCountToBe(7);
			await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 2', '# Cell 3', '# Cell 0', '# Cell 4', '# Cell 1', '# Cell 2']);

			// Paste again at position 5
			await notebooksPositron.selectCellAtIndex(5, { editMode: false });
			await notebooksPositron.performCellAction('paste');

			// Verify second paste
			await notebooksPositron.expectCellCountToBe(8);
			await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 2', '# Cell 3', '# Cell 0', '# Cell 4', '# Cell 1', '# Cell 0', '# Cell 2']);
		});

		// ========================================
		// Test 4: Cut and paste at beginning of notebook
		// ========================================
		await test.step('Test 4: Cut and paste at beginning of notebook', async () => {
			// Cut cell 4 (from the middle of the notebook)
			await notebooksPositron.selectCellAtIndex(4, { editMode: false });
			const cellToMoveContent = await notebooksPositron.getCellContent(4);
			await notebooksPositron.performCellAction('cut');
			await notebooksPositron.expectCellCountToBe(7);

			// Move to first cell and paste
			await notebooksPositron.selectCellAtIndex(0, { editMode: false });
			await notebooksPositron.performCellAction('paste');

			// Verify cell count restored and content is correct
			await notebooksPositron.expectCellCountToBe(8);
			await notebooksPositron.expectCellContentAtIndexToBe(1, cellToMoveContent);
		});
	});

	test('Multiselect: Cut from top and paste at bottom', async function ({ app, hotKeys }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		// Create notebook with 5 cells
		await notebooksPositron.newNotebook({ codeCells: 2, markdownCells: 3 });

		// Select cells 0, 1, and 2
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await keyboard.press('Shift+ArrowDown');
		await keyboard.press('Shift+ArrowDown');
		await notebooksPositron.expectCellsToBeSelected([0, 1, 2]);

		// Cut selected cells
		await notebooksPositron.performCellAction('cut');
		await notebooksPositron.expectCellContentsToBe(['Cell 3', 'Cell 4']);

		// Select last cell and paste below
		const lastIndex = await notebooksPositron.getCellCount() - 1;
		await notebooksPositron.selectCellAtIndex(lastIndex, { editMode: false });
		await notebooksPositron.performCellAction('paste');

		// Verify moved cells are at the end
		await notebooksPositron.expectCellContentsToBe(['Cell 3', 'Cell 4', '# Cell 0', '# Cell 1', 'Cell 2']);
	});
});
