/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Notebook: Empty State Behavior', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {
	test.beforeAll(async function ({ app, settings }) {
		await app.workbench.notebooksPositron.enablePositronNotebooks(settings);
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Can delete all, undo, redo on empty notebook', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		// create a new notebook with 2 code cells and 2 markdown cells
		await notebooksPositron.newNotebook({ codeCells: 2, markdownCells: 2 });

		// Delete all cells via multiselect
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await keyboard.press('Shift+ArrowDown');
		await keyboard.press('Shift+ArrowDown');
		await keyboard.press('Shift+ArrowDown'); // all 4 cells selected
		await notebooksPositron.performCellAction('delete');
		await notebooksPositron.expectCellCountToBe(0);

		// Ensure can undo to restore cells
		await notebooksPositron.performCellAction('undo');
		await notebooksPositron.expectCellCountToBe(4);
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '### Cell 2', '### Cell 3']);

		// Ensure can redo to delete cells again
		await notebooksPositron.performCellAction('redo');
		await notebooksPositron.expectCellCountToBe(0);


	});

	test('Can cut/paste on empty notebook', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		// create a new notebook with 2 code cells and 2 markdown cells
		await notebooksPositron.newNotebook({ codeCells: 2, markdownCells: 2 });

		// Cut all cells via multiselect
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await keyboard.press('Shift+ArrowDown');
		await keyboard.press('Shift+ArrowDown');
		await keyboard.press('Shift+ArrowDown'); // all 4 cells selected
		await notebooksPositron.performCellAction('cut');
		await notebooksPositron.expectCellCountToBe(0);

		// Paste into empty notebook
		await notebooksPositron.performCellAction('paste');
		await notebooksPositron.expectCellCountToBe(4);
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '### Cell 2', '### Cell 3']);

		// Undo the paste
		await notebooksPositron.performCellAction('undo');
		await notebooksPositron.expectCellCountToBe(0);

		// Redo the paste
		await notebooksPositron.performCellAction('redo');
		await notebooksPositron.expectCellCountToBe(4);
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '### Cell 2', '### Cell 3']);
	});
});
