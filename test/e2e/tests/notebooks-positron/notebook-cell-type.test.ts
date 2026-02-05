/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Cell Type', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test('Change cell type via command mode keyboard shortcuts', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const code = 'print("hello")';

		await test.step('Create notebook and select Python kernel', async () => {
			await notebooksPositron.newNotebook();
			await notebooksPositron.kernel.select('Python');
		});

		await test.step('Add code to cell and run it', async () => {
			await notebooksPositron.addCodeToCell(0, code, { run: true });
			await notebooksPositron.expectOutputAtIndex(0, ['hello']);
		});

		await test.step('Convert to markdown', async () => {
			await notebooksPositron.performCellAction('changeToMarkdown');
		});

		await test.step('Verify cell is markdown and content preserved', async () => {
			await notebooksPositron.expectCellTypeAtIndexToBe(0, 'markdown');
			await notebooksPositron.expectCellContentAtIndexToBe(0, code);
		});

		await test.step('Convert back to code', async () => {
			await notebooksPositron.performCellAction('changeToCode');
		});

		await test.step('Verify cell is code, content preserved, and output restored', async () => {
			await notebooksPositron.expectCellTypeAtIndexToBe(0, 'code');
			await notebooksPositron.expectCellContentAtIndexToBe(0, code);
			await notebooksPositron.expectOutputAtIndex(0, ['hello']);
		});
	});
});
