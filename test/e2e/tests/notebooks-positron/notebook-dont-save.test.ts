/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import fs from 'fs';
import { expect, tags } from '../_test.setup.js';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

const ORIGINAL_SOURCE = 'print("original")';

function notebookJson(): string {
	return JSON.stringify({
		cells: [
			{
				cell_type: 'code',
				execution_count: null,
				metadata: {},
				outputs: [],
				source: [ORIGINAL_SOURCE],
			},
		],
		metadata: {
			language_info: { name: 'python' },
		},
		nbformat: 4,
		nbformat_minor: 5,
	}, null, 1);
}

test.describe('Positron Notebooks: Don\'t Save', {
	tag: [tags.WIN, tags.POSITRON_NOTEBOOKS]
}, () => {
	let notebookPath: string;

	test.beforeEach(async function ({ app }) {
		const fileName = `test-dont-save-${Math.random().toString(36).substring(7)}.ipynb`;
		notebookPath = path.join(app.workspacePathOrFolder, fileName);
		await fs.promises.writeFile(notebookPath, notebookJson());
	});

	test.afterEach(async function () {
		if (notebookPath && fs.existsSync(notebookPath)) {
			fs.unlinkSync(notebookPath);
		}
	});

	test('closing a dirty notebook without saving discards changes', async function ({ app, hotKeys }) {
		const { notebooksPositron, modals } = app.workbench;

		await test.step('Open notebook and verify original content', async () => {
			await notebooksPositron.openNotebook(notebookPath);
			await notebooksPositron.expectCellContentAtIndexToBe(0, ORIGINAL_SOURCE);

			// Dismiss the ipykernel install modal if it appears; this test does
			// not need a running kernel.
			await modals.expectToBeVisible(undefined, { timeout: 5000 }).then(
				() => modals.clickCancel(),
				() => { /* no modal; continue */ }
			);
		});

		await test.step('Edit the notebook so it becomes dirty', async () => {
			await notebooksPositron.addCodeToCell(0, 'print("edited")');
			await notebooksPositron.addCell('code');
			await notebooksPositron.addCodeToCell(1, 'x = 1');
			await notebooksPositron.expectCellCountToBe(2);

			// The tab must show the dirty indicator before we close, otherwise
			// the close path under test (dirty-editor confirmation) is skipped.
			await expect(app.code.driver.currentPage.locator('.tab.dirty')).toBeVisible();

			// Give the working copy backup service time to write a backup of
			// the dirty notebook, like a user pausing before closing.
			await app.code.wait(2000);
		});

		await test.step('Close the tab, discarding changes', async () => {
			// In the e2e environment the save-confirmation dialog is skipped and
			// "Don't Save" is chosen automatically (see skipDialogs in
			// AbstractFileDialogService), which exercises the same
			// EditorInput#revert path as a user clicking "Don't Save".
			await hotKeys.closeTab();
			await expect(app.code.driver.currentPage.locator('.positron-notebook')).not.toBeVisible();
		});

		await test.step('Verify the file on disk is unchanged', async () => {
			const onDisk = JSON.parse(await fs.promises.readFile(notebookPath, 'utf-8'));
			expect(onDisk.cells).toHaveLength(1);
			expect(onDisk.cells[0].source.join('')).toBe(ORIGINAL_SOURCE);
		});

		await test.step('Reopen and verify the edits were discarded', async () => {
			await notebooksPositron.openNotebook(notebookPath);
			await notebooksPositron.expectCellCountToBe(1);
			await notebooksPositron.expectCellContentAtIndexToBe(0, ORIGINAL_SOURCE);

			// The reopened notebook must not be dirty (a dirty reopen means the
			// discarded working copy leaked and was resurrected).
			await expect(app.code.driver.currentPage.locator('.tab.dirty')).not.toBeVisible();
		});
	});
});
