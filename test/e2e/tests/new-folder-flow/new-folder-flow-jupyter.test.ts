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

	// No WIN tag: the #14163 workaround below switches the notebook kernel to the
	// global interpreter (POSITRON_PY_VER_SEL = System Python 3.10.10 on Windows),
	// which fails to start as a notebook kernel on the Windows runner ("Starting
	// Python 3.10.10 (System) interpreter ... failed"), so the kernel never reaches
	// idle. Restore the WIN tag once #14163 is fixed and the workaround is removed.
	test('Jupyter Folder Defaults', {
		tag: [tags.CRITICAL, tags.INTERPRETER]
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
	const { notebooksPositron } = app.workbench;

	// Assert the editor, not the tab: New Folder Flow opens duplicate tabs (#14163).
	await notebooksPositron.expectToBeVisible();
}

async function verifyNotebookKernelPythonVersion(app: Application) {
	const { sessions, notebooksPositron } = app.workbench;

	await sessions.expectSessionPickerToBe(/Untitled-1\.ipynb/);
	// Concrete version, not just "Python". Folder name not checked: the #14163
	// workaround rebinds the kernel to the global Python, not the project runtime.
	await notebooksPositron.kernel.expectBadgeToContain(/Python \d+\.\d+\.\d+/);
}
