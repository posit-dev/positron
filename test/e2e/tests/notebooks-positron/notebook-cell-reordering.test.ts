/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
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
});
