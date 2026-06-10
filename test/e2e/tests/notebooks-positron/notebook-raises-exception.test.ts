/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { expect, tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

const TAGGED_NOTEBOOK = 'raises-exception-tag.ipynb';
let taggedNotebookPath: string | undefined;

test.describe('Positron Notebooks: Cell Execution with raises-exception tag', {
	tag: [tags.NOTEBOOKS, tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test.afterAll(async function () {
		if (taggedNotebookPath) {
			rmSync(taggedNotebookPath, { force: true });
		}
	});

	test('Python - Execution stops at exception without raises-exception tag', async function ({ app, python }) {
		const { notebooksPositron } = app.workbench;

		await notebooksPositron.newNotebook();
		await notebooksPositron.kernel.select('Python');

		// Cell 1: Normal execution; Cell 2: exception without tag; Cell 3: should NOT execute
		await notebooksPositron.addCodeToCell(0, 'print("Cell 1 executed")');
		await notebooksPositron.addCell('code');
		await notebooksPositron.addCodeToCell(1, 'raise ValueError("This should stop execution")');
		await notebooksPositron.addCell('code');
		await notebooksPositron.addCodeToCell(2, 'print("Cell 3 should not execute")');

		await notebooksPositron.clickActionBarButtton('Run All');

		// Verify outputs: cells 1 and 2 ran, the exception stopped execution before cell 3
		await expect(notebooksPositron.cellOutput(0).getByText('Cell 1 executed')).toBeVisible();
		await expect(notebooksPositron.cellOutput(1).getByText(/ValueError: This should stop execution/)).toBeVisible();
		await expect(notebooksPositron.cellOutput(2).getByText('Cell 3 should not execute')).toBeHidden();
		await notebooksPositron.expectExecutionOrder([{ index: 2, order: undefined }]);
	});

	test('Python - Execution continues after exception with raises-exception tag', async function ({ app, openDataFile, python }) {
		const { notebooksPositron } = app.workbench;

		// The jupyter cell-tags UI drives the VS Code notebook editor, so bake the
		// raises-exception tag into the cell metadata of a generated notebook instead.
		taggedNotebookPath = join(app.workspacePathOrFolder, TAGGED_NOTEBOOK);
		writeFileSync(taggedNotebookPath, taggedNotebookJson());

		await openDataFile(TAGGED_NOTEBOOK);
		await notebooksPositron.expectToBeVisible();
		await notebooksPositron.kernel.select('Python');

		await notebooksPositron.clickActionBarButtton('Run All');

		// Verify all three cells ran: the tagged exception did not stop execution
		await expect(notebooksPositron.cellOutput(0).getByText('Cell 1 executed')).toBeVisible();
		await expect(notebooksPositron.cellOutput(1).getByText(/ValueError: Expected error - execution should continue/)).toBeVisible();
		await expect(notebooksPositron.cellOutput(2).getByText('Cell 3 executed successfully!')).toBeVisible();
	});
});

function codeCell(source: string, cellTags: string[] = []): object {
	return {
		cell_type: 'code',
		execution_count: null,
		metadata: cellTags.length > 0 ? { tags: cellTags } : {},
		outputs: [],
		source: [source]
	};
}

function taggedNotebookJson(): string {
	return JSON.stringify({
		cells: [
			codeCell('print("Cell 1 executed")'),
			codeCell('raise ValueError("Expected error - execution should continue")', ['raises-exception']),
			codeCell('print("Cell 3 executed successfully!")')
		],
		metadata: {
			kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
			language_info: { name: 'python' }
		},
		nbformat: 4,
		nbformat_minor: 5
	}, null, 1);
}
