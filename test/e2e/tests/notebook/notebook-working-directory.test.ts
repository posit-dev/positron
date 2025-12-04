/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import fs from 'fs';
import os from 'os';
import { test, tags } from '../_test.setup';
import { Notebooks } from '../../pages/notebooks.js';

test.use({
	suiteId: __filename
});

test.describe.skip('Notebook Working Directory Configuration', {
	tag: [tags.WIN, tags.WEB, tags.NOTEBOOKS]
}, () => {

	test.beforeAll(async function ({ python, app }) {
		await app.code.driver.page.setViewportSize({ width: 2560, height: 1440 });
	});

	test.afterEach(async function ({ app }) {
		await app.workbench.notebooks.closeNotebookWithoutSaving();
	});

	test('Default working directory is the notebook parent', async function ({ app, settings }) {
		await settings.clear();
		await verifyWorkingDirectoryEndsWith(app.workbench.notebooks, 'working-directory-notebook');
	});

	test('workspaceFolder works', async function ({ app, settings }) {
		await settings.set({
			'notebook.workingDirectory': '${workspaceFolder}'
		}, { reload: 'web' });
		await verifyWorkingDirectoryEndsWith(app.workbench.notebooks, 'qa-example-content');
	});

	test('fileDirname works', async function ({ app, settings }) {
		await settings.set({
			'notebook.workingDirectory': '${fileDirname}'
		}, { reload: 'web' });
		await verifyWorkingDirectoryEndsWith(app.workbench.notebooks, 'working-directory-notebook');
	});

	test('A hardcoded path works', async function ({ app, settings }) {
		// Make a temp dir
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-test'));

		await settings.set({
			'notebook.workingDirectory': tempDir
		}, { reload: 'web' });
		await verifyWorkingDirectoryEndsWith(app.workbench.notebooks, path.basename(tempDir));
	});

	test('Paths that do not exist result in the default notebook parent', async function ({ app, settings }) {
		await settings.set({
			'notebook.workingDirectory': '/does/not/exist'
		}, { reload: 'web' });
		await verifyWorkingDirectoryEndsWith(app.workbench.notebooks, 'working-directory-notebook');
	});

	test('Bad variables result in the default notebook parent', async function ({ app, settings }) {
		await settings.set({
			'notebook.workingDirectory': '${asdasd}'
		}, { reload: 'web' });
		await verifyWorkingDirectoryEndsWith(app.workbench.notebooks, 'working-directory-notebook');
	});
});

async function verifyWorkingDirectoryEndsWith(notebooks: Notebooks, expectedEnd: string) {
	await notebooks.openNotebook('working-directory.ipynb');
	await notebooks.selectInterpreter('Python');
	await notebooks.runAllCells();
	await notebooks.assertCellOutput(new RegExp(`^'.*${expectedEnd}'$`));
}
