/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Notebook Side-by-Side Isolation Tests
 *
 * Verifies that when two notebooks are open side-by-side:
 * 1. Kernel selection and status are independent per notebook
 * 2. Action buttons (Run Cell, Run All, Add Code) target their own notebook, not the focused one
 */

import { availableRuntimes } from '../../pages/sessions.js';
import { expect, tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Notebook Side-by-Side Isolation', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test.beforeAll(async function ({ hotKeys }) {
		await hotKeys.closePrimarySidebar();
		await hotKeys.closeSecondarySidebar();
		await hotKeys.minimizeBottomPanel();
	});

	test('Kernel selection and actions are independent per notebook',
		async function ({ app, runCommand, sessions }) {
			const { notebooksPositron, editors } = app.workbench;

			const kernelName = availableRuntimes['python'].name;
			const interpreterNameNb1 = /Untitled\-1.ipynb/;
			const interpreterNameNb2 = /Untitled\-2.ipynb/;

			// Notebook 1: Create and start kernel
			await notebooksPositron.newNotebook();
			await notebooksPositron.kernel.select('Python');
			await notebooksPositron.kernel.expectToBe(kernelName, { status: 'idle' });
			await sessions.expectSessionPickerToBe(interpreterNameNb1, { status: 'idle' });

			// Notebook 2: Create and ensure kernel autostarts
			await notebooksPositron.newNotebook();
			await notebooksPositron.kernel.expectToBe(kernelName, { status: 'idle' });
			await sessions.expectSessionPickerToBe(interpreterNameNb2, { status: 'idle' });

			// Split notebooks side-by-side
			await runCommand('workbench.action.moveEditorToNextGroup');
			await editors.expectEditorGroupCount(2);

			// Get scoped notebook helpers for each editor group
			const leftNotebook = notebooksPositron.scopedTo(editors.editorGroup(0));
			const rightNotebook = notebooksPositron.scopedTo(editors.editorGroup(1));

			// Verify both notebooks have Python kernel and are idle
			await leftNotebook.kernel.expectToBe(kernelName, { status: 'idle' });
			await rightNotebook.kernel.expectToBe(kernelName, { status: 'idle' });

			// --- Test: Kernel actions are independent ---

			// Shut down left notebook kernel and verify it does not affect right notebook
			await editors.clickTab('Untitled-1'); // temporary workaround, clicking the shutdown should change quickpick. @dhruvisompura remove when fixed.
			await leftNotebook.kernel.shutdown();
			await leftNotebook.kernel.expectToBe(kernelName, { status: 'disconnected' });
			await rightNotebook.kernel.expectToBe(kernelName, { status: 'idle' });
			await sessions.expectSessionPickerToBe(interpreterNameNb1, { status: 'disconnected' });

			// Restart right notebook kernel and verify it does not affect left notebook
			await editors.clickTab('Untitled-2'); // temporary workaround, clicking the shutdown should change quickpick. @dhruvisompura remove when fixed.
			await rightNotebook.kernel.restart();
			await leftNotebook.kernel.expectToBe(kernelName, { status: 'disconnected' });
			await rightNotebook.kernel.expectToBe(kernelName, { status: 'idle' });
			await sessions.expectSessionPickerToBe(interpreterNameNb2, { status: 'idle' });
		});

	test('Notebook action buttons target their own notebook, not the focused one',
		async function ({ app, runCommand }) {
			const { notebooksPositron, editors } = app.workbench;

			// Set up notebook 1 with Python code
			await notebooksPositron.newNotebook();
			await notebooksPositron.kernel.select('Python');
			await notebooksPositron.addCodeToCell(0, 'print("left_nb")');

			// Set up notebook 2 with different Python code
			await notebooksPositron.newNotebook();
			await notebooksPositron.kernel.select('Python');
			await notebooksPositron.addCodeToCell(0, 'print("right_nb")');

			// Split side-by-side
			await runCommand('workbench.action.moveEditorToNextGroup');
			await editors.expectEditorGroupCount(2);

			// Get scoped notebook helpers for each editor group
			const leftNotebook = notebooksPositron.scopedTo(editors.editorGroup(0));
			const rightNotebook = notebooksPositron.scopedTo(editors.editorGroup(1));

			// --- Test 1: Run Cell button (cell action bar) ---

			// Focus the RIGHT notebook by clicking its cell
			await rightNotebook.cell(0).click();

			// Verify clicking "Run Cell" in the LEFT notebook runs the cell in the LEFT notebook, not the focused RIGHT notebook
			await leftNotebook.runCellButton(0).click();
			await expect(leftNotebook.cellOutput(0)).toContainText('left_nb', { timeout: 30000 });
			await expect(rightNotebook.cellOutput(0)).not.toBeVisible({ timeout: 5000 });

			// --- Test 2: Run All button (editor action bar) ---

			// Clear left notebook output from Test 1
			await leftNotebook.clearOutputsButton.click();
			await expect(leftNotebook.cellOutput(0)).not.toBeVisible({ timeout: 5000 });

			// Focus the LEFT notebook
			await leftNotebook.cell(0).click();

			// Verify clicking "Run All" in the RIGHT notebook runs the cell in the RIGHT notebook, not the focused LEFT notebook
			await rightNotebook.runAllButton.click();
			await expect(rightNotebook.cellOutput(0)).toContainText('right_nb', { timeout: 30000 });
			await expect(leftNotebook.cellOutput(0)).not.toBeVisible({ timeout: 5000 });

			// --- Test 3: Add Code button (editor action bar) ---

			// Get current cell counts
			const leftCountBefore = await leftNotebook.cells.count();
			const rightCountBefore = await rightNotebook.cells.count();

			// Focus the LEFT notebook
			await leftNotebook.cell(0).click();

			// Click "+Code" button in the RIGHT notebook's action bar
			await rightNotebook.addCodeButton.click();

			// Verify RIGHT notebook got a new cell
			await expect(rightNotebook.cells).toHaveCount(rightCountBefore + 1, { timeout: 5000 });

			// Verify LEFT notebook cell count unchanged
			await expect(leftNotebook.cells).toHaveCount(leftCountBefore, { timeout: 5000 });
		});

});
