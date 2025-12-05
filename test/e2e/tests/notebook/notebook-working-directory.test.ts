/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import fs from 'fs';
import os from 'os';
import { test, tags, expect } from '../_test.setup';
import { Notebooks } from '../../pages/notebooks.js';

test.use({
	suiteId: __filename
});

test.describe('Notebook Working Directory Configuration', {
	tag: [tags.WIN, tags.WEB, tags.NOTEBOOKS]
}, () => {

	test.beforeAll(async function ({ python, app }) {
		await app.code.driver.page.setViewportSize({ width: 2560, height: 1440 });
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
			title: 'workspaceFolder works',
			workingDirectory: '${workspaceFolder}',
			expectedEnd: 'qa-example-content',
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
	];

	testCases.forEach(({ title, workingDirectory, expectedEnd }) => {
		test(title, async function ({ app, settings }) {
			workingDirectory === null
				? await settings.clear()
				: await settings.set({ 'notebook.workingDirectory': workingDirectory }, { reload: 'web' });

			await verifyWorkingDirectoryEndsWith(app.workbench.notebooks, expectedEnd);
		});
	});

	test('A hardcoded path works', async function ({ app, settings }) {
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
	await notebooks.selectInterpreter('Python');
	await expect(async () => {
		try {
			await notebooks.runAllCells({ timeout: 10000, throwError: true });
			await notebooks.assertCellOutput(new RegExp(`^'.*${expectedEnd}'$`));
		} catch (e) {
			await notebooks.interruptButton.click({ timeout: 3000 }).catch(() => { });
			throw e;
		}
	}, 'Expect working directory to end with: ' + expectedEnd).toPass({ timeout: 30000 });
}
