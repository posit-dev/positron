/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import fs from 'fs';
import os from 'os';
import { expect, tags } from '../_test.setup';
import { test } from './_test.setup.js';
import { PositronNotebooks } from '../../pages/notebooksPositron.js';

test.use({
	suiteId: __filename
});

test.describe('Notebook Working Directory Configuration', {
	tag: [tags.WIN, tags.NOTEBOOKS, tags.POSITRON_NOTEBOOKS]
	// Web tag removed: path resolution is browser-agnostic; Electron provides full coverage
}, () => {

	test.beforeAll(async function ({ hotKeys, python }) {
		await hotKeys.notebookLayout();
	});

	test.afterEach(async function ({ app }) {
		await app.workbench.notebooksPositron.closeNotebookWithoutSaving();
	});

	const testCases = [
		{
			title: 'Default working directory is the notebook parent',
			workingDirectory: null, // null = use default (clear settings)
			expectedEnd: 'working-directory-notebook',
		},
		{
			title: 'fileDirname works',
			workingDirectory: '${fileDirname}',
			expectedEnd: 'working-directory-notebook',
		},
		{
			title: 'Paths that do not exist result in the default notebook parent',
			workingDirectory: '/does/not/exist',
			expectedEnd: 'working-directory-notebook',
		},
		{
			title: 'Bad variables result in the default notebook parent',
			workingDirectory: '${asdasd}',
			expectedEnd: 'working-directory-notebook',
		},
		{
			title: 'workspaceFolder works',
			workingDirectory: '${workspaceFolder}',
			expectedEnd: 'qa-example-content',
		},
	];

	testCases.forEach(({ title, workingDirectory, expectedEnd }) => {
		test(title, async function ({ app, settings }) {
			if (workingDirectory === null) {
				// Clear user settings to exercise the default working directory.
				// The Positron notebook editor is the default, so no editor override
				// needs to be re-applied after clearing.
				await settings.clear();
			} else {
				await settings.set({ 'notebook.workingDirectory': workingDirectory }, { reload: 'web', waitMs: 1000 });
			}

			await verifyWorkingDirectoryEndsWith(app.workbench.notebooksPositron, expectedEnd);
		});
	});

	test('A hardcoded path works', async function ({ app, settings, python }) {
		// Make a temp dir
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-test'));
		await settings.set({
			'notebook.workingDirectory': tempDir
		}, { reload: 'web' });

		await verifyWorkingDirectoryEndsWith(app.workbench.notebooksPositron, path.basename(tempDir));
	});
});

async function verifyWorkingDirectoryEndsWith(notebooksPositron: PositronNotebooks, expectedEnd: string) {
	await notebooksPositron.openNotebook('working-directory.ipynb');
	await notebooksPositron.kernel.select('Python');
	await notebooksPositron.runCodeAtIndex(0);
	// The %pwd cell prints the working directory as a quoted repr (e.g. '/path/to/dir').
	// Use an anchored regex against the full output so a parent path that merely
	// contains `expectedEnd` as a substring does not produce a false positive.
	await expect(notebooksPositron.cellOutput(0)).toContainText(new RegExp(`^'.*${expectedEnd}'$`), { timeout: 30000 });
}
