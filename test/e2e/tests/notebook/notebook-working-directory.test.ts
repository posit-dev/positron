/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import fs from 'fs';
import os from 'os';
import { tags } from '../_test.setup';
import { test } from './_test.setup.js';
import { Notebooks } from '../../pages/notebooks.js';

test.use({
	suiteId: __filename
});

test.describe('Notebook Working Directory Configuration', {
	tag: [tags.WIN, tags.NOTEBOOKS]
	// Web tag removed: path resolution is browser-agnostic; Electron provides full coverage
}, () => {

	test.beforeAll(async function ({ hotKeys, python }) {
		await hotKeys.notebookLayout();
	});

	test.afterEach(async function ({ app }) {
		await app.workbench.notebooks.closeNotebookWithoutSaving();
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
				// Clear user settings to exercise the default working directory, but
				// keep the legacy notebook editor enabled. This suite targets the
				// legacy editor and `clear()` would otherwise drop the
				// `useLegacyNotebookEditor` override, opening the Positron editor.
				await settings.clear();
				await settings.set({ 'positron.notebook.enabled': false }, { reload: 'web', waitMs: 1000 });
			} else {
				await settings.set({ 'notebook.workingDirectory': workingDirectory }, { reload: 'web', waitMs: 1000 });
			}

			await verifyWorkingDirectoryEndsWith(app.workbench.notebooks, expectedEnd);
		});
	});

	test('A hardcoded path works', async function ({ app, settings, python }) {
		// Make a temp dir
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-test'));
		await settings.set({
			'notebook.workingDirectory': tempDir
		}, { reload: 'web' });

		await verifyWorkingDirectoryEndsWith(app.workbench.notebooks, path.basename(tempDir));
	});
});

async function verifyWorkingDirectoryEndsWith(notebooks: Notebooks, expectedEnd: string) {
	await notebooks.openNotebook('working-directory.ipynb');
	await notebooks.runAllCells({ timeout: 5000 });
	await notebooks.assertCellOutput(new RegExp(`^'.*${expectedEnd}'$`), 0, { timeout: 30000 });
}
