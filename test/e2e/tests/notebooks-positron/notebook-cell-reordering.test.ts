/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { tags } from '../_test.setup';
import { test } from './_test.setup.js';
import { expect } from '@playwright/test';

test.use({
	suiteId: __filename
});

test.describe('Notebook Cell Reordering', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test('Action Bar: swap 1st and 2nd cell', async function ({ app }) {
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

	test('Multiselect: move multiple cells', async function ({ app }) {
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
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '### Cell 4', '# Cell 1', '### Cell 2', '### Cell 3']);
	});

	// --- Drag-and-Drop Tests ---

	test('Drag handle: visible on hover, hidden otherwise', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// Setup: Create notebook with 3 cells
		await notebooksPositron.newNotebook({ codeCells: 3 });
		await notebooksPositron.expectCellCountToBe(3);

		// Click away from cells to ensure no hover state
		await notebooksPositron.clickAwayFromCell(0);

		// Drag handle should be hidden (opacity 0) when not hovering
		await notebooksPositron.expectDragHandleVisibility(0, false);

		// Hover over the first cell
		await notebooksPositron.hoverCell(0);

		// Drag handle should now be visible
		await notebooksPositron.expectDragHandleVisibility(0, true);
	});

	test('Drag-and-drop: swap 1st and 2nd cell', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// Setup: Create notebook with 3 cells
		await notebooksPositron.newNotebook({ codeCells: 3 });
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2']);

		// Drag cell 0 to position 1
		await notebooksPositron.dragCellToPosition(0, 1);

		// Verify cells are reordered
		await notebooksPositron.expectCellContentsToBe(['# Cell 1', '# Cell 0', '# Cell 2']);
		await notebooksPositron.expectCellCountToBe(3);
	});

	test('Drag-and-drop: move cell to end', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// Setup: Create notebook with 4 cells
		await notebooksPositron.newNotebook({ codeCells: 4 });
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2', '# Cell 3']);

		// Drag cell 0 to the last position
		await notebooksPositron.dragCellToPosition(0, 3);

		// Verify cell moved to end
		await notebooksPositron.expectCellContentsToBe(['# Cell 1', '# Cell 2', '# Cell 3', '# Cell 0']);
		await notebooksPositron.expectCellCountToBe(4);
	});

	test('Drag-and-drop: move cell from end to beginning', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// Setup: Create notebook with 4 cells
		await notebooksPositron.newNotebook({ codeCells: 4 });
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2', '# Cell 3']);

		// Drag last cell to first position
		await notebooksPositron.dragCellToPosition(3, 0);

		// Verify cell moved to beginning
		await notebooksPositron.expectCellContentsToBe(['# Cell 3', '# Cell 0', '# Cell 1', '# Cell 2']);
		await notebooksPositron.expectCellCountToBe(4);
	});

	test('Drag-and-drop: undo restores original order', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// Setup: Create notebook with 3 cells
		await notebooksPositron.newNotebook({ codeCells: 3 });
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2']);

		// Drag cell 0 to position 2
		await notebooksPositron.dragCellToPosition(0, 2);
		await notebooksPositron.expectCellContentsToBe(['# Cell 1', '# Cell 2', '# Cell 0']);

		// Select a cell and undo
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await notebooksPositron.performCellAction('undo');

		// Verify original order is restored
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2']);
	});

	test('Drag-and-drop: redo reapplies reorder', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// Setup: Create notebook with 3 cells
		await notebooksPositron.newNotebook({ codeCells: 3 });
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2']);

		// Drag cell 1 to position 0
		await notebooksPositron.dragCellToPosition(1, 0);
		await notebooksPositron.expectCellContentsToBe(['# Cell 1', '# Cell 0', '# Cell 2']);

		// Undo
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await notebooksPositron.performCellAction('undo');
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2']);

		// Redo
		await notebooksPositron.performCellAction('redo');
		await notebooksPositron.expectCellContentsToBe(['# Cell 1', '# Cell 0', '# Cell 2']);
	});

	test('Drag-and-drop: escape cancels drag operation', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		await notebooksPositron.newNotebook({ codeCells: 3 });
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2']);

		// Start drag but cancel with Escape
		await notebooksPositron.startDragCell(0);
		await keyboard.press('Escape');

		// Verify order unchanged
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2']);
	});

	test('Drag-and-drop: auto-scroll when dragging in long notebook', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const page = app.code.driver.page;

		// Ensure mouse is in a clean state (not pressed from a previous failed test)
		await page.mouse.up();

		// Create a notebook with 12 cells - enough to require scrolling
		// on typical viewport sizes (1200x800 or similar)
		await notebooksPositron.newNotebook({ codeCells: 12 });

		// Build expected initial content array
		const initialContents = Array.from({ length: 12 }, (_, i) => `# Cell ${i}`);
		await notebooksPositron.expectCellContentsToBe(initialContents);

		// Scroll to ensure cell 0 is visible at the top and wait for scroll to settle
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });

		// Drag cell 0 all the way to the end (position 11)
		// This requires auto-scrolling since cell 11 won't be visible initially
		try {
			await notebooksPositron.dragCellToPositionWithScroll(0, 11);
		} finally {
			// Ensure mouse is released even if drag fails
			await page.mouse.up();
		}

		// Verify cell 0 moved to the end
		// Original cells 1-11 shift up, cell 0 is now at position 11
		const expectedContents = [
			'# Cell 1', '# Cell 2', '# Cell 3', '# Cell 4', '# Cell 5',
			'# Cell 6', '# Cell 7', '# Cell 8', '# Cell 9', '# Cell 10',
			'# Cell 11', '# Cell 0'
		];
		await notebooksPositron.expectCellContentsToBe(expectedContents);
		await notebooksPositron.expectCellCountToBe(12);
	});

	// --- Multi-Cell Drag-and-Drop Tests ---

	test('Multi-drag: drag multiple selected cells together', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		// Create notebook with 5 cells
		await notebooksPositron.newNotebook({ codeCells: 5 });
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2', '# Cell 3', '# Cell 4']);

		// Select cells 1 and 2 (multi-select)
		await notebooksPositron.selectCellAtIndex(1, { editMode: false });
		await keyboard.press('Shift+ArrowDown');
		await notebooksPositron.expectCellsToBeSelected([1, 2]);

		// Drag the selected cells to position 4
		await notebooksPositron.dragCellToPosition(1, 4);

		// Verify cells 1 and 2 moved together to position 3 and 4
		// Original order: 0, 1, 2, 3, 4
		// After move: 0, 3, 4, 1, 2
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 3', '# Cell 4', '# Cell 1', '# Cell 2']);
		await notebooksPositron.expectCellCountToBe(5);
	});

	test('Multi-drag: single cell drag ignores multi-selection when dragging unselected cell', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		// Create notebook with 5 cells
		await notebooksPositron.newNotebook({ codeCells: 5 });
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2', '# Cell 3', '# Cell 4']);

		// Select cells 1 and 2 (multi-select)
		await notebooksPositron.selectCellAtIndex(1, { editMode: false });
		await keyboard.press('Shift+ArrowDown');
		await notebooksPositron.expectCellsToBeSelected([1, 2]);

		// Drag cell 0 (not part of selection) to position 3
		// This should only move cell 0, not the selected cells
		await notebooksPositron.dragCellToPosition(0, 3);

		// Only cell 0 should move
		// Original order: 0, 1, 2, 3, 4
		// After move: 1, 2, 3, 0, 4
		await notebooksPositron.expectCellContentsToBe(['# Cell 1', '# Cell 2', '# Cell 3', '# Cell 0', '# Cell 4']);
		await notebooksPositron.expectCellCountToBe(5);
	});

	test('Multi-drag: undo/redo multi-cell drag operation', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		// Create notebook with 4 cells
		await notebooksPositron.newNotebook({ codeCells: 4 });
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2', '# Cell 3']);

		// Select cells 0 and 1 (multi-select)
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await keyboard.press('Shift+ArrowDown');
		await notebooksPositron.expectCellsToBeSelected([0, 1]);

		// Drag selected cells to position 3
		await notebooksPositron.dragCellToPosition(0, 3);

		// Verify cells moved
		// Original order: 0, 1, 2, 3
		// After move: 2, 3, 0, 1
		await notebooksPositron.expectCellContentsToBe(['# Cell 2', '# Cell 3', '# Cell 0', '# Cell 1']);

		// Undo the multi-cell move
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await notebooksPositron.performCellAction('undo');
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2', '# Cell 3']);

		// Redo the multi-cell move
		await notebooksPositron.performCellAction('redo');
		await notebooksPositron.expectCellContentsToBe(['# Cell 2', '# Cell 3', '# Cell 0', '# Cell 1']);
	});

	test('Multi-drag: drag three cells to beginning of notebook', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		// Create notebook with 6 cells
		await notebooksPositron.newNotebook({ codeCells: 6 });
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2', '# Cell 3', '# Cell 4', '# Cell 5']);

		// Select cells 3, 4, and 5 (multi-select)
		await notebooksPositron.selectCellAtIndex(3, { editMode: false });
		await keyboard.press('Shift+ArrowDown');
		await keyboard.press('Shift+ArrowDown');
		await notebooksPositron.expectCellsToBeSelected([3, 4, 5]);

		// Drag selected cells to position 0
		await notebooksPositron.dragCellToPosition(3, 0);

		// Verify cells moved to beginning
		// Original order: 0, 1, 2, 3, 4, 5
		// After move: 3, 4, 5, 0, 1, 2
		await notebooksPositron.expectCellContentsToBe(['# Cell 3', '# Cell 4', '# Cell 5', '# Cell 0', '# Cell 1', '# Cell 2']);
		await notebooksPositron.expectCellCountToBe(6);
	});
});
