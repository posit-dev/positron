/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { expect } from '@playwright/test';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Action Bar Behavior', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test.beforeAll(async function ({ app, settings }) {
		await app.workbench.notebooksPositron.enablePositronNotebooks(settings);
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Cell deletion using action bar', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		await notebooksPositron.newNotebook({ codeCells: 6 });

		// ========================================
		// Test 1: Delete a selected cell (cell 2)
		// ========================================
		await test.step('Test 1: Delete selected cell (cell 2)', async () => {
			// Select cell 2 explicitly
			await notebooksPositron.selectCellAtIndex(2);

			// Verify cell 2 has correct content before deletion
			expect(await notebooksPositron.getCodeCellContent(2)).toBe('# Cell 2');

			// Delete the selected cell using action bar
			await notebooksPositron.deleteCellWithActionBar(2);

			// Verify cell count decreased
			await notebooksPositron.expectCellCountToBe(5);

			// Verify what was cell 3 is now at index 2
			expect(await notebooksPositron.getCodeCellContent(2)).toBe('# Cell 3');
		});

		// ========================================
		// Test 2: Delete another cell (cell 3, originally cell 4)
		// ========================================
		await test.step('Test 2: Delete another cell (cell 3, originally cell 4)', async () => {
			// Select cell 3 for deletion
			await notebooksPositron.selectCellAtIndex(3);

			// Verify cell 3 has correct content before deletion
			await notebooksPositron.expectCellContentAtIndexToBe(3, '# Cell 4');

			// Delete the selected cell using action bar
			await notebooksPositron.deleteCellWithActionBar(3);

			// Verify cell count decreased
			await notebooksPositron.expectCellCountToBe(4);

			// Verify the remaining cells are correct
			await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 0');
			await notebooksPositron.expectCellContentAtIndexToBe(1, '# Cell 1');
			await notebooksPositron.expectCellContentAtIndexToBe(2, '# Cell 3');
			await notebooksPositron.expectCellContentAtIndexToBe(3, '# Cell 5');
		});

		// ========================================
		// Test 3: Delete last cell (cell 3, contains '# Cell 5')
		// ========================================
		await test.step('Test 3: Delete last cell (cell 3, contains \'# Cell 5\')', async () => {
			// Verify we're at the last cell with correct content
			await notebooksPositron.expectCellContentAtIndexToBe(3, '# Cell 5');

			// Delete the last cell using action bar
			await notebooksPositron.deleteCellWithActionBar(3);

			// Verify cell count decreased
			await notebooksPositron.expectCellCountToBe(3);

			// Verify remaining cells
			await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 0');
			await notebooksPositron.expectCellContentAtIndexToBe(1, '# Cell 1');
			await notebooksPositron.expectCellContentAtIndexToBe(2, '# Cell 3');
		});

		// ========================================
		// Test 4: Delete first cell (cell 0)
		// ========================================
		await test.step('Test 4: Delete first cell (cell 0)', async () => {
			// Verify we're at the first cell with correct content
			expect(await notebooksPositron.getCodeCellContent(0)).toBe('# Cell 0');

			// Delete the first cell using action bar
			await notebooksPositron.deleteCellWithActionBar(0);

			// Verify cell count decreased
			await notebooksPositron.expectCellCountToBe(2);

			// Verify what was cell 1 is now at index 0
			expect(await notebooksPositron.getCodeCellContent(0)).toBe('# Cell 1');
			expect(await notebooksPositron.getCodeCellContent(1)).toBe('# Cell 3');
		});

		// ========================================
		// Test 5: Delete remaining cells
		// ========================================
		await test.step('Test 5: Delete remaining cells', async () => {
			// Delete until only one cell remains
			while (await notebooksPositron.getCellCount() > 1) {
				const currentCount = await notebooksPositron.getCellCount();
				await notebooksPositron.deleteCellWithActionBar(0);

				// Verify count decreased
				await notebooksPositron.expectCellCountToBe(currentCount - 1);
			}

			// Verify we have exactly one cell remaining with the correct content
			await notebooksPositron.expectCellCountToBe(1);
			await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 3');
		});
	});

	test('Cell copy/paste using action bar', async function ({ app, hotKeys }) {
		const { notebooksPositron } = app.workbench;

		// create notebook with 2 cells
		await notebooksPositron.newNotebook({ codeCells: 2 });
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1']);

		// Copy cell with action bar and paste below using action bar
		await notebooksPositron.selectCellAtIndex(0);
		await notebooksPositron.expectCellIndexToBeSelected(0, { inEditMode: true });
		await notebooksPositron.triggerCellAction(0, 'Copy cell');
		await notebooksPositron.triggerCellAction(0, 'Paste cell below');
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 0', '# Cell 1']);

		// ISSUE #10240: Pasting inside of cell includes metadata
		// Copy cell using action bar and paste into existing cell using keyboard
		// await notebooksPositron.selectCellAtIndex(0);
		// await notebooksPositron.expectCellIndexToBeSelected(0, { inEditMode: true });
		// await notebooksPositron.selectFromMoreActionsMenu(0, 'Copy cell');
		// await notebooksPositron.selectCellAtIndex(2);
		// await notebooksPositron.expectCellIndexToBeSelected(2, { inEditMode: true });
		// await hotKeys.selectAll();
		// await hotKeys.paste();
		// await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 0', '# Cell 0']);
	});

	test('Cell actions with multiple cells selected', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		// Create notebook with 3 cells
		await notebooksPositron.newNotebook({ codeCells: 3 });
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2']);

		// Select multiple cells (cell 0 and cell 1)
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await keyboard.press('Shift+ArrowDown');
		await notebooksPositron.expectCellIndexToBeSelected(0, { inEditMode: false });
		await notebooksPositron.expectCellIndexToBeSelected(1, { inEditMode: false });
		await notebooksPositron.triggerCellAction(1, 'Insert code cell above');

		// Verify new cell added in correct position
		await notebooksPositron.expectCellCountToBe(4);
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '', '# Cell 1', '# Cell 2']);
	});
});
