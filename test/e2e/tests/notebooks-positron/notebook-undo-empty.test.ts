/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Undo/Redo with Empty Notebook', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test('undo should restore deleted cell when notebook becomes empty', async function ({ app, hotKeys }) {
		const { notebooksPositron } = app.workbench;

		// Create a new notebook (starts with one empty cell)
		await notebooksPositron.newNotebook();
		await notebooksPositron.expectCellCountToBe(1);

		// Add content to the cell
		await notebooksPositron.addCodeToCell(0, 'print("Hello, World!")');
		await notebooksPositron.expectCellContentAtIndexToBe(0, 'print("Hello, World!")');

		// Delete the cell using keyboard shortcut
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await notebooksPositron.performCellAction('delete');

		// Verify notebook is now empty
		await notebooksPositron.expectCellCountToBe(0);

		// Undo the deletion using Cmd+Z / Ctrl+Z
		await hotKeys.undo();

		// Verify the cell is restored with its content
		await notebooksPositron.expectCellCountToBe(1);
		await notebooksPositron.expectCellContentAtIndexToBe(0, 'print("Hello, World!")');
	});

	test('redo should delete cell again after undo in empty notebook', async function ({ app, hotKeys }) {
		const { notebooksPositron } = app.workbench;

		// Create a new notebook with one cell
		await notebooksPositron.newNotebook();
		await notebooksPositron.addCodeToCell(0, 'x = 42');

		// Delete the cell
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await notebooksPositron.performCellAction('delete');
		await notebooksPositron.expectCellCountToBe(0);

		// Undo the deletion
		await hotKeys.undo();
		await notebooksPositron.expectCellCountToBe(1);
		await notebooksPositron.expectCellContentAtIndexToBe(0, 'x = 42');

		// Redo the deletion
		await hotKeys.redo();
		await notebooksPositron.expectCellCountToBe(0);

		// Undo again to verify it still works
		await hotKeys.undo();
		await notebooksPositron.expectCellCountToBe(1);
		await notebooksPositron.expectCellContentAtIndexToBe(0, 'x = 42');
	});

	test('undo should work after deleting all cells one by one', async function ({ app, hotKeys }) {
		const { notebooksPositron } = app.workbench;

		// Create notebook with 3 cells
		await notebooksPositron.newNotebook({ codeCells: 3 });
		await notebooksPositron.expectCellCountToBe(3);

		// Delete cells one by one
		await notebooksPositron.selectCellAtIndex(2, { editMode: false });
		await notebooksPositron.performCellAction('delete');
		await notebooksPositron.expectCellCountToBe(2);

		await notebooksPositron.selectCellAtIndex(1, { editMode: false });
		await notebooksPositron.performCellAction('delete');
		await notebooksPositron.expectCellCountToBe(1);

		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await notebooksPositron.performCellAction('delete');
		await notebooksPositron.expectCellCountToBe(0);

		// Undo all deletions
		await hotKeys.undo();
		await notebooksPositron.expectCellCountToBe(1);
		await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 0');

		await hotKeys.undo();
		await notebooksPositron.expectCellCountToBe(2);
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1']);

		await hotKeys.undo();
		await notebooksPositron.expectCellCountToBe(3);
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2']);
	});

	test('undo should work using jupyter-style Z key when notebook is empty', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// Create notebook with content
		await notebooksPositron.newNotebook();
		await notebooksPositron.addCodeToCell(0, 'data = [1, 2, 3]');

		// Delete the cell
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await notebooksPositron.performCellAction('delete');
		await notebooksPositron.expectCellCountToBe(0);

		// Undo using Jupyter-style Z key
		await notebooksPositron.performCellAction('undo');
		await notebooksPositron.expectCellCountToBe(1);
		await notebooksPositron.expectCellContentAtIndexToBe(0, 'data = [1, 2, 3]');

		// Redo using Jupyter-style Shift+Z
		await notebooksPositron.performCellAction('redo');
		await notebooksPositron.expectCellCountToBe(0);
	});

	test('undo should preserve cell type and content after deletion', async function ({ app, hotKeys }) {
		const { notebooksPositron } = app.workbench;

		// Create notebook with both code and markdown cells
		await notebooksPositron.newNotebook();

		// Add markdown cell with content
		await notebooksPositron.addCell('markdown');
		const markdownContent = '# My Header\n\nSome text here';
		await notebooksPositron.addCodeToCell(1, markdownContent);
		await notebooksPositron.viewMarkdown.click();

		// Verify markdown is rendered
		await notebooksPositron.expectMarkdownTagToBe('h1', 'My Header');

		// Delete the code cell (index 0)
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await notebooksPositron.performCellAction('delete');
		await notebooksPositron.expectCellCountToBe(1);

		// Delete the markdown cell
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await notebooksPositron.performCellAction('delete');
		await notebooksPositron.expectCellCountToBe(0);

		// Undo to restore markdown cell
		await hotKeys.undo();
		await notebooksPositron.expectCellCountToBe(1);
		await notebooksPositron.expectCellTypeAtIndexToBe(0, 'markdown');

		// Undo to restore code cell
		await hotKeys.undo();
		await notebooksPositron.expectCellCountToBe(2);
		await notebooksPositron.expectCellTypeAtIndexToBe(0, 'code');
		await notebooksPositron.expectCellTypeAtIndexToBe(1, 'markdown');
	});
});
