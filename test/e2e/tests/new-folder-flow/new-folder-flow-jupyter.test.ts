/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application } from '../../infra/index.js';
import { FolderTemplate } from '../../pages/newFolderFlow.js';
import { test, tags } from '../_test.setup';
import { addRandomNumSuffix, verifyConsoleReady, verifyFolderCreation, verifyPyprojectTomlNotCreated } from './helpers/new-folder-flow.js';

test.use({
	suiteId: __filename
});

test.describe('New Folder Flow: Jupyter Project', {
	tag: [tags.MODAL, tags.NEW_FOLDER_FLOW],
}, () => {
	const folderTemplate = FolderTemplate.JUPYTER_NOTEBOOK;

	test.beforeAll(async function ({ settings }) {
		await settings.set({ 'interpreters.startupBehavior': 'auto' }, { waitMs: 5000 });
	});

	// Removing WIN tag until we get uv into windows CI as this expects uv to be the interpreter
	test('Jupyter Folder Defaults', {
		tag: [tags.CRITICAL, tags.INTERPRETER, tags.WIN]
	}, async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const folderName = addRandomNumSuffix('python-notebook-runtime');

		// Create a new Python notebook folder
		await app.workbench.newFolderFlow.createNewFolder({
			folderTemplate,
			folderName
		});

		await verifyFolderCreation(app, folderName);
		await verifyConsoleReady(app, folderTemplate);
		await verifyNotebookEditorVisible(app);

		// Workaround for https://github.com/posit-dev/positron/issues/14163
		// Shouldn't have to re-select the kernel. Remove lines 40-45 when fixed.
		await notebooksPositron.kernel.change('Python');
		await notebooksPositron.kernel.expectStatusToBe('idle');

		await verifyNotebookKernelPythonVersion(app);
		await verifyPyprojectTomlNotCreated(app);
	});
});

async function verifyNotebookEditorVisible(app: Application) {
	const { editors } = app.workbench;

	await editors.verifyTab('Untitled-1.ipynb', { isVisible: true });
}

async function verifyNotebookKernelPythonVersion(app: Application) {
	const { sessions, notebooksPositron } = app.workbench;

	await sessions.expectSessionPickerToBe(/Untitled-1\.ipynb/);
	// Assert the kernel resolved to a concrete Python version, not just a generic
	// "Python" label, so a stuck/unresolved kernel would fail here.
	await notebooksPositron.kernel.expectBadgeToContain(/Python \d+\.\d+\.\d+/);
}
