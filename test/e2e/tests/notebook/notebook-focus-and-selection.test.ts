/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

// Not running on web due to Positron notebooks being desktop-only
test.describe('Notebook Focus and Selection', {
	tag: [tags.CRITICAL, tags.WIN, tags.NOTEBOOKS, tags.POSITRON_NOTEBOOKS]
}, () => {
	test.beforeAll(async function ({ app, settings }) {
		await app.workbench.notebooksPositron.enablePositronNotebooks(settings);
	});

	test.beforeEach(async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		await notebooksPositron.newNotebook(5);
		await notebooksPositron.expectCellCountToBe(5);
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Notebook keyboard behavior with cells', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		await test.step('Test 1: Arrow Down navigation moves focus to next cell', async () => {
			await notebooksPositron.selectCellAtIndex(1, { editMode: false });
			await keyboard.press('ArrowDown');
			await notebooksPositron.expectCellIndexToBeSelected(2, { inEditMode: false });
		});

		await test.step('Test 2: Arrow Up navigation moves focus to previous cell', async () => {
			await notebooksPositron.selectCellAtIndex(3, { editMode: false });
			await keyboard.press('ArrowUp');
			await notebooksPositron.expectCellIndexToBeSelected(2, { inEditMode: false });
		});

		await test.step('Test 3: Arrow Down at last cell does not change selection', async () => {
			await notebooksPositron.selectCellAtIndex(4, { editMode: false });
			await keyboard.press('ArrowDown');
			await notebooksPositron.expectCellIndexToBeSelected(4, { inEditMode: false });
		});

		await test.step('Test 4: Arrow Up at first cell does not change selection', async () => {
			await notebooksPositron.selectCellAtIndex(0, { editMode: false });
			await keyboard.press('ArrowUp');
			await notebooksPositron.expectCellIndexToBeSelected(0, { inEditMode: false });
		});

		await test.step('Test 5: Focus is maintained across multiple navigation operations', async () => {
			// Navigate down multiple times
			await keyboard.press('ArrowDown');
			await notebooksPositron.expectCellIndexToBeSelected(1, { inEditMode: false });

			await keyboard.press('ArrowDown');
			await notebooksPositron.expectCellIndexToBeSelected(2, { inEditMode: false });

			await keyboard.press('ArrowDown');
			await notebooksPositron.expectCellIndexToBeSelected(3, { inEditMode: false });

			// Navigate up
			await keyboard.press('ArrowUp');
			await notebooksPositron.expectCellIndexToBeSelected(2, { inEditMode: false });
		});


		await test.step('Test 6: Cell regains edit mode when clicking away and back', async () => {
			// verify we are starting with 5 cells
			await notebooksPositron.expectCellCountToBe(5);
			await notebooksPositron.selectCellAtIndex(1);

			// click away to defocus cell
			const active = notebooksPositron.cell.nth(1);
			const box = await active.boundingBox();
			if (box) {
				const page = app.code.driver.page;
				// We want to offset the click as little as possible to avoid
				// clicking other interactive elements. Here we're clicking just
				// below the bottom right of the cell which should be a safe
				// area due to that being where the cell padding is.
				const OFFSET = 10;
				const x = box.x + box.width - OFFSET;
				const y = box.y + box.height + OFFSET;

				await page.mouse.click(x, y);
			}

			// click back on cell to re-focus
			await notebooksPositron.selectCellAtIndex(1);

			// verify backspace deletes cell content not cell (indicating edit mode is active)
			await keyboard.press('Backspace');
			await notebooksPositron.expectCellCountToBe(5);
		});

		await test.step('Test 7: Shift+Arrow Down adds next cell to selection', async () => {
			await notebooksPositron.selectCellAtIndex(1, { editMode: false });
			await keyboard.press('Shift+ArrowDown');
			await notebooksPositron.expectCellIndexToBeSelected(1, { inEditMode: false });
			await notebooksPositron.expectCellIndexToBeSelected(2, { inEditMode: false });
		});
	});

	test('Editor mode behavior with notebook cells', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		await test.step('Test 1: Clicking into cell focuses editor and enters edit mode', async () => {
			// Clicking on cell should focus and enter edit mode
			await notebooksPositron.selectCellAtIndex(1);
			await notebooksPositron.expectCellIndexToBeSelected(0, { isSelected: false, inEditMode: false });
			await notebooksPositron.expectCellIndexToBeSelected(1, { isSelected: true, inEditMode: true });
			await notebooksPositron.expectCellIndexToBeSelected(2, { isSelected: false, inEditMode: false });
			await notebooksPositron.expectCellIndexToBeSelected(3, { isSelected: false, inEditMode: false });
			await notebooksPositron.expectCellIndexToBeSelected(4, { isSelected: false, inEditMode: false });

			// Verify we can type into the editor after clicking
			await keyboard.type('# editor good');
			await notebooksPositron.expectCellContentAtIndexToContain(1, '# editor good');
		});

		await test.step('Test 2: Enter key on selected cell enters edit mode and doesn\'t add new lines', async () => {
			// Verify pressing Enter enters edit mode
			await notebooksPositron.selectCellAtIndex(2, { editMode: false });
			await keyboard.press('Enter');
			await notebooksPositron.expectCellIndexToBeSelected(2, {
				isSelected: true,
				inEditMode: true
			});

			// Verify we can type into the editor after pressing Enter
			await keyboard.type('# test');
			await notebooksPositron.expectCellContentAtIndexToContain(2, /^# Cell 2# test/);
		});

		await test.step('Test 3: Shift+Enter on last cell creates new cell and enters edit mode', async () => {
			// Verify pressing Shift+Enter adds a new cell below
			await notebooksPositron.selectCellAtIndex(4);
			await notebooksPositron.expectCellCountToBe(5);
			await keyboard.press('Shift+Enter');
			await notebooksPositron.expectCellCountToBe(6);

			// Verify the NEW cell (index 5) is now in edit mode with focus
			await notebooksPositron.expectCellIndexToBeSelected(5, { inEditMode: true });

			// Verify we can type immediately in the new cell
			await keyboard.type('new cell content');
			await notebooksPositron.expectCellContentAtIndexToContain(5, 'new cell content');
		});

		await test.step('Enter key in edit mode adds newline within cell', async () => {
			const lineText = '# Cell 3';
			const numCells = 6;

			// Start with 6 cells
			await notebooksPositron.expectCellCountToBe(numCells);

			// Go into edit mode in cell 3
			await notebooksPositron.selectCellAtIndex(3);
			await notebooksPositron.expectCellIndexToBeSelected(3, { inEditMode: true });
			await notebooksPositron.expectCellContentAtIndexToBe(3, lineText);

			// Position cursor in the middle of the cells contents to avoid any trailing newline trimming issues
			await keyboard.press('Home');
			const middleIndex = Math.floor(lineText.length / 2);
			for (let i = 0; i < middleIndex; i++) { // move to middle of line
				await notebooksPositron.editorAtIndex(3).press('ArrowRight');
			}

			// Verify the content was splits into two lines
			await notebooksPositron.expectCellToHaveLineCount({ cellIndex: 3, numLines: 1 });
			await app.code.driver.page.keyboard.press('Enter');
			await notebooksPositron.expectCellToHaveLineCount({ cellIndex: 3, numLines: 2 });
			await notebooksPositron.expectCellIndexToBeSelected(3, { inEditMode: true });

			// Verify we still have the same number of cells we started with
			await notebooksPositron.expectCellCountToBe(numCells);
		});
	});

	test('Notebook navigation and default cell selection', async function ({ app }) {
		const { notebooks, notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		const clickTab = (name: string) => app.code.driver.page.getByRole('tab', { name }).click();
		const TAB_1 = 'Untitled-1.ipynb';
		const TAB_2 = 'bitmap-notebook.ipynb';

		// Start a new notebook (tab 1)
		await test.step('Open new notebook: Ensure keyboard navigation', async () => {
			await notebooksPositron.selectCellAtIndex(0, { editMode: false });
			await keyboard.press('ArrowDown');
			await notebooksPositron.expectCellIndexToBeSelected(1, { inEditMode: false });

			await keyboard.press('ArrowDown');
			await notebooksPositron.expectCellIndexToBeSelected(2, { inEditMode: false });
		});

		// Open an existing notebook (tab 2) which will steal focus away from the first notebook
		await test.step('Open existing notebook: Ensure 1st cell is selected', async () => {
			const notebookPath = path.join('workspaces', 'bitmap-notebook', TAB_2);
			await notebooks.openNotebook(notebookPath, false);
			await notebooksPositron.expectToBeVisible();
			await notebooksPositron.expectCellCountToBe(20);

			// Verify first cell is selected (without interaction)
			await notebooksPositron.expectCellIndexToBeSelected(0, { inEditMode: false });
		});

		// BUG: https://github.com/posit-dev/positron/issues/9849
		// Switch between notebooks to ensure selection is preserved
		await test.step.skip('Selection is preserved when switching between editors', async () => {
			// Switch back to tab 1 and verify selection is still at cell 2
			await clickTab(TAB_1);
			await notebooksPositron.expectCellIndexToBeSelected(2, { inEditMode: false });
			await keyboard.press('ArrowDown');
			await notebooksPositron.expectCellIndexToBeSelected(3, { inEditMode: false });

			// Switch back to tab 2 and verify selection is still at cell 0
			await clickTab(TAB_2);
			await notebooksPositron.expectCellIndexToBeSelected(0, { inEditMode: false });
			await keyboard.press('ArrowDown');
			await notebooksPositron.expectCellIndexToBeSelected(1, { inEditMode: false });

			// Switch back to tab 1 and verify selection is still at cell 3
			await clickTab(TAB_1);
			await notebooksPositron.expectCellIndexToBeSelected(3, { inEditMode: false });
		});
	});
});
