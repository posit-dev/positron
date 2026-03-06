/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test as base, TestFixtures, WorkerFixtures } from '../tests/_test.setup';
import { pause, narrate, showOverlay, setupDemoLayout } from './demo-utils';

// Enable Positron notebooks (same pattern as notebooks-positron/_test.setup.ts)
const test = base.extend<TestFixtures, WorkerFixtures & { enablePositronNotebooks: boolean }>({
	enablePositronNotebooks: [true, { scope: 'worker', option: true }],
	beforeApp: [
		async ({ settingsFile }, use) => {
			settingsFile.append({ 'positron.notebook.enabled': true });
			await use();
		},
		{ scope: 'worker' }
	],
});

test.use({
	suiteId: __filename,
});

test.setTimeout(300_000);

test.describe('Demo: Notebook Cell Drag to Reorder', () => {

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('walkthrough', async function ({ app, page }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = page.keyboard;

		// Maximize editor area for clean recording
		await setupDemoLayout(app, page);

		// Create a notebook with 5 code cells
		await notebooksPositron.newNotebook({ codeCells: 5 });
		await pause(page, 1500);

		// --- Step 1-2: Single cell drag-and-drop ---

		await narrate(page, 'Drag and drop: grab the handle to reorder cells');

		// Select Cell 0 first so it's visually highlighted
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await pause(page, 800);

		// Hover to reveal the drag handle
		await notebooksPositron.hoverCell(0);
		await pause(page, 1200);

		// Drag Cell 0 down to position 2
		await notebooksPositron.dragCellToPosition(0, 2);
		await pause(page, 2000);

		// --- Step 3: Keyboard-based cell move ---

		await showOverlay(page, 'Keyboard: Alt+Arrow to move cells up/down');

		// Select Cell 4 and move it up with Alt+Arrow
		await notebooksPositron.selectCellAtIndex(4, { editMode: false });
		await pause(page, 1000);

		await keyboard.press('Alt+ArrowUp');
		await pause(page, 800);

		await keyboard.press('Alt+ArrowUp');
		await pause(page, 800);

		await keyboard.press('Alt+ArrowUp');
		await pause(page, 1500);

		// --- Step 4: Multi-cell drag (2 cells) ---

		await showOverlay(page, 'Multi-select: Shift+Arrow to select, then drag together');

		// Select Cell 1, then Shift+ArrowDown once to select cells 1-2
		await notebooksPositron.selectCellAtIndex(1, { editMode: false });
		await pause(page, 800);

		await keyboard.press('Shift+ArrowDown');
		await pause(page, 1000);

		// Drag the pair to the end
		await notebooksPositron.dragCellToPosition(1, 4);
		await pause(page, 2000);

		// --- Step 5: Undo ---

		await showOverlay(page, 'Undo: Ctrl/Cmd+Z restores previous order');

		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await notebooksPositron.performCellAction('undo');
		await pause(page, 1000);

		await notebooksPositron.performCellAction('undo');
		await pause(page, 1000);

		await notebooksPositron.performCellAction('undo');
		await pause(page, 1500);

		await showOverlay(page, '');
		await pause(page, 500);
	});
});
