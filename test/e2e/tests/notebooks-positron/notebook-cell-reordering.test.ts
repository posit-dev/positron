/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Notebook Cell Reordering', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {
	// Drag-and-drop integration, drag-handle hover visibility, and auto-scroll-during-drag
	// only. Action-bar / keyboard move triggers, boundary no-ops, sequential moves,
	// undo/redo, and the multi-select grouping decision are covered by:
	//   - selectionKeybindings.vitest.ts (MoveCellUp/Down action wiring)
	//   - positronNotebookInstance.vitest.ts (moveCellsUp/Down behavior)
	//   - notebookUndoRedo.vitest.ts (moveCells undo/redo)
	//   - sortableCellListLogic.vitest.ts (drop-index + multi-select grouping)
	//   - sortableCellList.vitest.tsx (escape cancels drag)

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

	test('Drag-and-drop: auto-scroll when dragging in long notebook', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const page = app.code.driver.currentPage;

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

	test('Multi-drag: drag three cells to beginning of notebook', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.currentPage.keyboard;

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
