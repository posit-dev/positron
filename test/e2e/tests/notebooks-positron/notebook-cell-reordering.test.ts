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

	test('Multi-drag: move two selected cells down', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		// Create notebook with 5 cells
		await notebooksPositron.newNotebook({ codeCells: 5 });
		await notebooksPositron.expectCellContentsToBe([
			'# Cell 0', '# Cell 1', '# Cell 2', '# Cell 3', '# Cell 4'
		]);

		// Select cells 1 and 2 (multi-select with Shift)
		await notebooksPositron.selectCellAtIndex(1, { editMode: false });
		await keyboard.press('Shift+ArrowDown');
		await notebooksPositron.expectCellsToBeSelected([1, 2]);

		// Drag cells 1 and 2 to after cell 3 (dragging by cell 1's handle)
		// Note: During multi-drag, cells shift significantly, so we target cell 4's position
		// to ensure the cursor lands past cell 3 in collision detection coordinates
		await notebooksPositron.dragCellToPosition(1, 4);

		// Verify final order: cell 3 moves up, cells 1 and 2 move down
		await notebooksPositron.expectCellContentsToBe([
			'# Cell 0', '# Cell 3', '# Cell 1', '# Cell 2', '# Cell 4'
		]);
		await notebooksPositron.expectCellCountToBe(5);
	});

	test('Multi-drag: move two selected cells up', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		// Create notebook with 5 cells
		await notebooksPositron.newNotebook({ codeCells: 5 });
		await notebooksPositron.expectCellContentsToBe([
			'# Cell 0', '# Cell 1', '# Cell 2', '# Cell 3', '# Cell 4'
		]);

		// Select cells 3 and 4 (multi-select with Shift)
		await notebooksPositron.selectCellAtIndex(3, { editMode: false });
		await keyboard.press('Shift+ArrowDown');
		await notebooksPositron.expectCellsToBeSelected([3, 4]);

		// Drag cells 3 and 4 to position 1 (dragging by cell 3's handle)
		// Note: dragCellToPosition captures positions BEFORE drag starts, so it uses
		// initial (non-transformed) positions for the target.
		await notebooksPositron.dragCellToPosition(3, 1);

		// Verify final order: cells 3 and 4 move up, cells 1 and 2 shift down
		await notebooksPositron.expectCellContentsToBe([
			'# Cell 0', '# Cell 3', '# Cell 4', '# Cell 1', '# Cell 2'
		]);
		await notebooksPositron.expectCellCountToBe(5);
	});

	test('Multi-drag: cells do not overlap when dragging down', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const page = app.code.driver.page;
		const keyboard = page.keyboard;

		// Create notebook with 6 cells
		await notebooksPositron.newNotebook({ codeCells: 6 });
		await notebooksPositron.expectCellContentsToBe([
			'# Cell 0', '# Cell 1', '# Cell 2', '# Cell 3', '# Cell 4', '# Cell 5'
		]);

		// Select cells 2 and 3 (multi-select with Shift)
		await notebooksPositron.selectCellAtIndex(2, { editMode: false });
		await keyboard.press('Shift+ArrowDown');
		await notebooksPositron.expectCellsToBeSelected([2, 3]);

		// Drag cells 2 and 3 to after cell 4
		// Note: During multi-drag DOWN, cell 4 shifts UP. We target cell 5
		// to ensure cursor lands at insertionIndex=5 in collision detection coordinates.
		await notebooksPositron.dragCellToPosition(2, 5);

		// Verify final order
		await notebooksPositron.expectCellContentsToBe([
			'# Cell 0', '# Cell 1', '# Cell 4', '# Cell 2', '# Cell 3', '# Cell 5'
		]);
	});

	test('Multi-drag: cells do not overlap when dragging up', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		// Create notebook with 6 cells
		await notebooksPositron.newNotebook({ codeCells: 6 });
		await notebooksPositron.expectCellContentsToBe([
			'# Cell 0', '# Cell 1', '# Cell 2', '# Cell 3', '# Cell 4', '# Cell 5'
		]);

		// Select cells 3 and 4 (multi-select with Shift)
		await notebooksPositron.selectCellAtIndex(3, { editMode: false });
		await keyboard.press('Shift+ArrowDown');
		await notebooksPositron.expectCellsToBeSelected([3, 4]);

		// Drag cells 3 and 4 to before cell 1
		await notebooksPositron.dragCellToPosition(3, 1);

		// Verify final order
		await notebooksPositron.expectCellContentsToBe([
			'# Cell 0', '# Cell 3', '# Cell 4', '# Cell 1', '# Cell 2', '# Cell 5'
		]);
	});

	test('Multi-drag: undo restores original order', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		// Create notebook with 5 cells
		await notebooksPositron.newNotebook({ codeCells: 5 });
		await notebooksPositron.expectCellContentsToBe([
			'# Cell 0', '# Cell 1', '# Cell 2', '# Cell 3', '# Cell 4'
		]);

		// Select cells 1 and 2
		await notebooksPositron.selectCellAtIndex(1, { editMode: false });
		await keyboard.press('Shift+ArrowDown');
		await notebooksPositron.expectCellsToBeSelected([1, 2]);

		// Drag cells 1 and 2 down
		// Note: During multi-drag DOWN, cell 3 shifts UP. We target cell 4
		// to ensure cursor lands at insertionIndex=4 in collision detection.
		await notebooksPositron.dragCellToPosition(1, 4);
		await notebooksPositron.expectCellContentsToBe([
			'# Cell 0', '# Cell 3', '# Cell 1', '# Cell 2', '# Cell 4'
		]);

		// Undo
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await notebooksPositron.performCellAction('undo');

		// Verify original order restored
		await notebooksPositron.expectCellContentsToBe([
			'# Cell 0', '# Cell 1', '# Cell 2', '# Cell 3', '# Cell 4'
		]);
	});

	test('Multi-drag: escape cancels operation', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const page = app.code.driver.page;
		const keyboard = page.keyboard;

		// Create notebook with 5 cells
		await notebooksPositron.newNotebook({ codeCells: 5 });
		await notebooksPositron.expectCellContentsToBe([
			'# Cell 0', '# Cell 1', '# Cell 2', '# Cell 3', '# Cell 4'
		]);

		// Select cells 1 and 2
		await notebooksPositron.selectCellAtIndex(1, { editMode: false });
		await keyboard.press('Shift+ArrowDown');
		await notebooksPositron.expectCellsToBeSelected([1, 2]);

		// Start drag but cancel with Escape
		await notebooksPositron.startDragCell(1);
		await notebooksPositron.moveDragToCell(3, 'bottom');
		await keyboard.press('Escape');

		// Verify order unchanged
		await notebooksPositron.expectCellContentsToBe([
			'# Cell 0', '# Cell 1', '# Cell 2', '# Cell 3', '# Cell 4'
		]);
	});

	// --- Non-Adjacent Multi-Cell Drag-and-Drop Tests ---

	test('Multi-drag non-adjacent: move cells 1 and 3 down', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// Create notebook with 5 cells
		await notebooksPositron.newNotebook({ codeCells: 5 });
		await notebooksPositron.expectCellContentsToBe([
			'# Cell 0', '# Cell 1', '# Cell 2', '# Cell 3', '# Cell 4'
		]);

		// Select cells 1 and 3 (non-adjacent) using Cmd/Ctrl+click
		await notebooksPositron.selectCellAtIndex(1, { editMode: false });
		await notebooksPositron.selectCellAtIndex(3, { editMode: false, addToSelection: true });
		await notebooksPositron.expectCellsToBeSelected([1, 3]);

		// Drag to after cell 4 (dragging by cell 1's handle)
		await notebooksPositron.dragCellToPosition(1, 4);

		// Non-adjacent cells should move as a contiguous block
		// Cells 1 and 3 are removed, leaving [0, 2, 4]
		// Then 1 and 3 are inserted after 4: [0, 2, 4, 1, 3]
		await notebooksPositron.expectCellContentsToBe([
			'# Cell 0', '# Cell 2', '# Cell 4', '# Cell 1', '# Cell 3'
		]);
		await notebooksPositron.expectCellCountToBe(5);
	});

	test('Multi-drag non-adjacent: move cells 2 and 4 up', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// Create notebook with 5 cells
		await notebooksPositron.newNotebook({ codeCells: 5 });
		await notebooksPositron.expectCellContentsToBe([
			'# Cell 0', '# Cell 1', '# Cell 2', '# Cell 3', '# Cell 4'
		]);

		// Select cells 2 and 4 (non-adjacent) using Cmd/Ctrl+click
		await notebooksPositron.selectCellAtIndex(2, { editMode: false });
		await notebooksPositron.selectCellAtIndex(4, { editMode: false, addToSelection: true });
		await notebooksPositron.expectCellsToBeSelected([2, 4]);

		// Drag to before cell 0 (dragging by cell 2's handle)
		await notebooksPositron.dragCellToPosition(2, 0);

		// Non-adjacent cells should move as a contiguous block
		// Cells 2 and 4 are removed, leaving [0, 1, 3]
		// Then 2 and 4 are inserted before 0: [2, 4, 0, 1, 3]
		await notebooksPositron.expectCellContentsToBe([
			'# Cell 2', '# Cell 4', '# Cell 0', '# Cell 1', '# Cell 3'
		]);
		await notebooksPositron.expectCellCountToBe(5);
	});

	test('Multi-drag non-adjacent: drag unselected cell moves only that cell', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// Create notebook with 5 cells
		await notebooksPositron.newNotebook({ codeCells: 5 });
		await notebooksPositron.expectCellContentsToBe([
			'# Cell 0', '# Cell 1', '# Cell 2', '# Cell 3', '# Cell 4'
		]);

		// Select cells 1 and 3 (non-adjacent)
		await notebooksPositron.selectCellAtIndex(1, { editMode: false });
		await notebooksPositron.selectCellAtIndex(3, { editMode: false, addToSelection: true });
		await notebooksPositron.expectCellsToBeSelected([1, 3]);

		// Drag cell 2 (which is NOT selected) to position 4
		await notebooksPositron.dragCellToPosition(2, 4);

		// Only cell 2 should move, selected cells stay in place
		await notebooksPositron.expectCellContentsToBe([
			'# Cell 0', '# Cell 1', '# Cell 3', '# Cell 4', '# Cell 2'
		]);
		await notebooksPositron.expectCellCountToBe(5);
	});

	test('Multi-drag non-adjacent: three non-adjacent cells', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// Create notebook with 6 cells
		await notebooksPositron.newNotebook({ codeCells: 6 });
		await notebooksPositron.expectCellContentsToBe([
			'# Cell 0', '# Cell 1', '# Cell 2', '# Cell 3', '# Cell 4', '# Cell 5'
		]);

		// Select cells 0, 2, and 4 (every other cell)
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await notebooksPositron.selectCellAtIndex(2, { editMode: false, addToSelection: true });
		await notebooksPositron.selectCellAtIndex(4, { editMode: false, addToSelection: true });
		await notebooksPositron.expectCellsToBeSelected([0, 2, 4]);

		// Drag to after cell 5 (dragging by cell 0's handle)
		await notebooksPositron.dragCellToPosition(0, 5);

		// All three non-adjacent cells should move as a contiguous block
		// Cells 0, 2, 4 are removed, leaving [1, 3, 5]
		// Then 0, 2, 4 are inserted after 5: [1, 3, 5, 0, 2, 4]
		await notebooksPositron.expectCellContentsToBe([
			'# Cell 1', '# Cell 3', '# Cell 5', '# Cell 0', '# Cell 2', '# Cell 4'
		]);
		await notebooksPositron.expectCellCountToBe(6);
	});
});
