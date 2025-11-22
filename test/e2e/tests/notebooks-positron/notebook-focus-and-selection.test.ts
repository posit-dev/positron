/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Notebook Focus and Selection', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {
	test.beforeAll(async function ({ app, settings }) {
		await app.workbench.notebooksPositron.enablePositronNotebooks(settings);
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Arrow keys move cell selection up and down', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;
		await notebooksPositron.newNotebook({ codeCells: 3, markdownCells: 2 });

		// arrow down moves selection down
		await notebooksPositron.selectCellAtIndex(1, { editMode: false });
		await keyboard.press('ArrowDown');
		await notebooksPositron.expectCellIndexToBeSelected(2, { inEditMode: false, isSelected: true });

		// arrow up moves selection up
		await notebooksPositron.selectCellAtIndex(3, { editMode: false });
		await keyboard.press('ArrowUp');
		await notebooksPositron.expectCellIndexToBeSelected(2, { inEditMode: false, isSelected: true });

		// arrow down at last cell does not change selection
		await notebooksPositron.selectCellAtIndex(4, { editMode: false });
		await keyboard.press('ArrowDown');
		await notebooksPositron.expectCellIndexToBeSelected(4, { inEditMode: false, isSelected: true });

		// arrow up at first cell does not change selection
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await keyboard.press('ArrowUp');
		await notebooksPositron.expectCellIndexToBeSelected(0, { inEditMode: false, isSelected: true });

		// Navigate down multiple times
		await keyboard.press('ArrowDown');
		await keyboard.press('ArrowDown');
		await keyboard.press('ArrowDown');
		await notebooksPositron.expectCellIndexToBeSelected(3, { inEditMode: false });
	});


	test('Click away and back: code cell re-enters edit mode, markdown stays in view mode', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;
		await notebooksPositron.newNotebook({ codeCells: 1, markdownCells: 1 });

		// Code cell: click away and back should restore edit mode
		await notebooksPositron.selectCellAtIndex(0);
		await notebooksPositron.clickAwayFromCell(0);
		await notebooksPositron.expectCellIndexToBeSelected(0, { inEditMode: false });
		await notebooksPositron.selectCellAtIndex(0);

		// verify backspace deletes cell content not cell (indicating edit mode is active)
		await notebooksPositron.expectCellIndexToBeSelected(0, { inEditMode: true });
		await keyboard.press('Backspace');
		await notebooksPositron.expectCellCountToBe(2);

		// Markdown cell: click away and back should stay in command/view mode
		await notebooksPositron.selectCellAtIndex(1, { editMode: true });
		await notebooksPositron.clickAwayFromCell(1);
		await notebooksPositron.expectCellIndexToBeSelected(1, { inEditMode: false });
		await notebooksPositron.selectCellAtIndex(1);
		await notebooksPositron.expectCellIndexToBeSelected(1, { inEditMode: true });
	});


	test('Enter key in edit mode adds newline within cell', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;
		await notebooksPositron.newNotebook({ codeCells: 2 });

		const lineText = '# Cell 1';

		// Go into edit mode in cell index 1
		await notebooksPositron.selectCellAtIndex(1, { editMode: true });
		await notebooksPositron.expectCellContentAtIndexToBe(1, lineText);

		// Position cursor in the middle of the cells contents to avoid any trailing newline trimming issues
		await keyboard.press('Home');
		const middleIndex = Math.floor(lineText.length / 2);
		for (let i = 0; i < middleIndex; i++) { // move to middle of line
			await notebooksPositron.editorAtIndex(1).press('ArrowRight');
		}

		// Verify the content was splits into two lines
		await notebooksPositron.expectCellToHaveLineCount({ cellIndex: 1, numLines: 1 });
		await app.code.driver.page.keyboard.press('Enter');
		await notebooksPositron.expectCellToHaveLineCount({ cellIndex: 1, numLines: 2 });
		await notebooksPositron.expectCellIndexToBeSelected(1, { inEditMode: true });
	});


	test('Notebook navigation and default cell selection between tabs', async function ({ app }) {
		const { notebooks, notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;
		await notebooksPositron.newNotebook({ codeCells: 3, markdownCells: 1 });

		const clickTab = (name: string | RegExp) => app.code.driver.page.getByRole('tab', { name }).click();
		// Depending on when this test is run, the untitled notebook may have a different number
		const TAB_1 = /Untitled-\d+\.ipynb/;
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

		// Switch between notebooks to ensure selection is preserved
		await test.step('Selection is preserved when switching between editors', async () => {
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

	test("`+ Code` and `+ Markdown` buttons insert the cell after the active cell and make it the new active cell", async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;
		await notebooksPositron.newNotebook({ codeCells: 2, markdownCells: 1 });

		// Select code cell at index 1
		await notebooksPositron.selectCellAtIndex(1);
		await notebooksPositron.expectCellIndexToBeSelected(1, { isActive: true, inEditMode: true });

		// Click the + Code button and verify the cell is inserted after the active cell
		await notebooksPositron.addCell('code');
		await notebooksPositron.expectCellCountToBe(4);
		await notebooksPositron.expectCellIndexToBeSelected(2, { isActive: true, inEditMode: true });

		// Ensure new code cell is editable
		await keyboard.type('print("Hello, World!")');
		await notebooksPositron.expectCellContentAtIndexToContain(2, 'print("Hello, World!")');

		// Click the + Markdown button and verify the cell is inserted after the active cell
		await notebooksPositron.addCell('markdown');
		await notebooksPositron.expectCellCountToBe(5);
		await notebooksPositron.expectCellIndexToBeSelected(3, { isActive: true, inEditMode: true });

		// Ensure new markdown cell is editable
		await keyboard.type('# Heading 1');
		await notebooksPositron.expectCellContentAtIndexToContain(3, '# Heading 1');
	});

	test("Multi-select and deselect retains anchor/active cell", async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		// Create a new notebook with 5 cells and select cell 2
		await notebooksPositron.newNotebook({ codeCells: 2, markdownCells: 3 });
		await notebooksPositron.selectCellAtIndex(2, { editMode: false });

		// Multi-select up to cell 0 and verify anchor is cell 0
		await keyboard.press('Shift+ArrowUp');
		await keyboard.press('Shift+ArrowUp');
		await notebooksPositron.expectCellIndexToBeSelected(0, { isSelected: true, isActive: true });
		await notebooksPositron.expectCellIndexToBeSelected(1, { isSelected: true, isActive: false });
		await notebooksPositron.expectCellIndexToBeSelected(2, { isSelected: true, isActive: false });

		// Deselect back down to cell 2 and verify anchor is cell 2
		await keyboard.press('Shift+ArrowDown');
		await keyboard.press('Shift+ArrowDown');
		await notebooksPositron.expectCellIndexToBeSelected(0, { isSelected: false, isActive: false });
		await notebooksPositron.expectCellIndexToBeSelected(1, { isSelected: false, isActive: false });
		await notebooksPositron.expectCellIndexToBeSelected(2, { isSelected: true, isActive: true });

		// Multi-select down to cell 4 and verify anchor is cell 4
		await keyboard.press('Shift+ArrowDown');
		await keyboard.press('Shift+ArrowDown');
		await notebooksPositron.expectCellIndexToBeSelected(2, { isSelected: true, isActive: false });
		await notebooksPositron.expectCellIndexToBeSelected(3, { isSelected: true, isActive: false });
		await notebooksPositron.expectCellIndexToBeSelected(4, { isSelected: true, isActive: true });

		// Deslect with Escape key and verify anchor is cell 4
		await keyboard.press('Escape');
		await notebooksPositron.expectCellIndexToBeSelected(0, { isSelected: false });
		await notebooksPositron.expectCellIndexToBeSelected(1, { isSelected: false });
		await notebooksPositron.expectCellIndexToBeSelected(2, { isSelected: false });
		await notebooksPositron.expectCellIndexToBeSelected(3, { isSelected: false });
		await notebooksPositron.expectCellIndexToBeSelected(4, { isSelected: true, isActive: true });
	});

	test("Multi-select and insert cell above/below becomes the active cell", async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		// Start a new notebook with 5 cells and select cell 2
		await notebooksPositron.newNotebook({ codeCells: 2, markdownCells: 3 });
		await notebooksPositron.selectCellAtIndex(2, { editMode: false });

		// Multi-select up to cell 0 and verify anchor is cell 0
		await keyboard.press('Shift+ArrowUp');
		await keyboard.press('Shift+ArrowUp');
		await notebooksPositron.expectCellIndexToBeSelected(0, { isSelected: true, isActive: true });
		await notebooksPositron.expectCellIndexToBeSelected(1, { isSelected: true, isActive: false });
		await notebooksPositron.expectCellIndexToBeSelected(2, { isSelected: true, isActive: false });

		// From cell action menu insert cell below and verify new cell is at index 1
		await notebooksPositron.triggerCellAction(0, 'Insert code cell below');
		await notebooksPositron.expectCellCountToBe(6);
		await notebooksPositron.expectCellIndexToBeSelected(1, { isActive: true, inEditMode: false });

		// Ensure we can type into the new cell
		await keyboard.press('Enter'); // enter edit mode
		await keyboard.type('print("New Below")');
		await notebooksPositron.expectCellContentAtIndexToContain(1, 'print("New Below")');
	});
})
