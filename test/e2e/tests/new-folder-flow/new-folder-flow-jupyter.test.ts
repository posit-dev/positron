/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application } from '../../infra/index.js';
import { FolderTemplate } from '../../pages/newFolderFlow.js';
import { test, tags, expect } from '../_test.setup';
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
	}, async function ({ app, settings }) {
		const folderName = addRandomNumSuffix('python-notebook-runtime');

		// Create a new Python notebook folder
		await app.positron.newFolderFlow.createNewFolder({
			folderTemplate,
			folderName
		});

		await verifyFolderCreation(app, folderName);
		await verifyConsoleReady(app, folderTemplate);
		await verifyNotebookEditorVisible(app);
		await verifyNotebookAndConsolePythonVersion(app);
		await verifyPyprojectTomlNotCreated(app);
	});
});

async function verifyNotebookEditorVisible(app: Application) {
	const notebookEditorTab = app.code.driver.page.locator('[id="workbench.parts.editor"]').getByText('Untitled-1.ipynb', { exact: true });
	await expect(notebookEditorTab).toBeVisible();
}

async function verifyNotebookAndConsolePythonVersion(app: Application) {
	const sessionSelectorButton = app.code.driver.page.getByRole('button', { name: 'Select Interpreter Session' });
	const sessionSelectorText = await sessionSelectorButton.textContent();

	// Extract the version number (e.g., '3.10.12') from the button text
	const versionMatch = sessionSelectorText && sessionSelectorText.match(/Python ([0-9]+\.[0-9]+\.[0-9]+)/);
	const pythonVersion = versionMatch ? versionMatch[1] : undefined;

	// Fail the test if we can't extract the version
	expect(pythonVersion, 'Python version should be present in session selector').toBeTruthy();

	// After the runtime starts up the kernel status should be replaced with the kernel name.
	// The kernel name should contain the Python version from the session selector
	// Only look within an 'a' tag with class 'kernel-label' to avoid false positives
	const kernelLabel = app.code.driver.page.locator('a.kernel-label');
	await expect(kernelLabel).toContainText(`Python ${pythonVersion}`);
	await expect(kernelLabel).toContainText('python-notebook-runtime');
}
