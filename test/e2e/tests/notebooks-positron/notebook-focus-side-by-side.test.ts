/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Notebook Side-by-Side Focus Tests
 *
 * Verifies that focus stays in the correct notebook when switching between
 * side-by-side notebooks, especially when a cell in one notebook is in edit mode.
 */

import { tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Notebook Side-by-Side Focus', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test.beforeAll(async function ({ hotKeys }) {
		await hotKeys.closePrimarySidebar();
		await hotKeys.closeSecondarySidebar();
		await hotKeys.minimizeBottomPanel();
	});

	test('Focus stays in target notebook when clicking markdown cell while other notebook is in edit mode',
		async function ({ app, runCommand }) {
			const { notebooksPositron, editors } = app.workbench;

			// Create first notebook with a code cell and select Python kernel
			await notebooksPositron.newNotebook();
			await notebooksPositron.kernel.select('Python');
			await notebooksPositron.kernel.expectStatusToBe('idle');
			await notebooksPositron.addCodeToCell(0, 'x = 1');

			// Create second notebook with a code cell and a markdown cell
			await notebooksPositron.newNotebook({ codeCells: 1, markdownCells: 1 });
			await notebooksPositron.kernel.select('Python');
			await notebooksPositron.kernel.expectStatusToBe('idle');
			// Press Escape to exit markdown edit mode and render the cell
			await app.code.driver.page.keyboard.press('Escape');

			// Split notebooks side-by-side
			await runCommand('workbench.action.moveEditorToNextGroup');
			await editors.expectEditorGroupCount(2);

			const leftGroup = editors.editorGroup(0);
			const rightGroup = editors.editorGroup(1);
			const leftNotebook = notebooksPositron.scopedTo(leftGroup);
			const rightNotebook = notebooksPositron.scopedTo(rightGroup);

			// Click into code cell in the LEFT notebook to enter edit mode
			await leftNotebook.cell(0).click();
			await editors.expectEditorGroupActive(0, 5000);

			// Click the rendered markdown cell in the RIGHT notebook
			await rightNotebook.cell(1).click();

			// Verify the right editor group becomes and STAYS active.
			// The bug causes focus to snap back to the left notebook due to
			// the autorunDelta in CellEditorMonacoWidget.tsx stealing focus
			// when the left notebook's cell exits edit mode.
			await editors.expectEditorGroupActive(1, 5000);
			await editors.expectEditorGroupInactive(0);
		});
});
