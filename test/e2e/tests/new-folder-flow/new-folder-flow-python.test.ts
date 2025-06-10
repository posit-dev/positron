/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { FolderTemplate } from '../../infra';
import { test, tags } from '../_test.setup';
import { addRandomNumSuffix, createNewFolder, verifyCondaEnvStarts, verifyCondaFilesArePresent, verifyFolderCreation, verifyGitFilesArePresent, verifyGitStatus, verifyUvEnvStarts, verifyVenvEnvStarts } from './helpers/new-folder-flow.js';

test.use({
	suiteId: __filename
});

// Not running conda test on windows because conda reeks havoc on selecting the correct python interpreter
// Not running uv either because it is not installed on windows for now
test.describe('Python - New Folder Flow', { tag: [tags.MODAL, tags.NEW_FOLDER_FLOW, tags.WEB] }, () => {
	const folderTemplate = FolderTemplate.PYTHON_PROJECT;

	test('Existing env: ipykernel already installed', { tag: [tags.WIN], }, async function ({ app, sessions, python }) {
		const folderName = addRandomNumSuffix('ipykernel-installed');

		await createNewFolder(app, {
			folderTemplate,
			folderName,
			status: 'existing',
			ipykernelFeedback: 'hide',
			interpreterPath: (await sessions.getSelectedSessionInfo()).path
		});

		await verifyFolderCreation(app, folderName, folderTemplate);
	});

	// untagged windows because we cannot find any way to copy text from the terminal now that its a canvas
	test('New env: Git initialized', { tag: [tags.CRITICAL] }, async function ({ app }) {
		const folderName = addRandomNumSuffix('git-init');

		await createNewFolder(app, {
			folderTemplate,
			folderName,
			initGitRepo: true,
			status: 'new',
			pythonEnv: 'venv',
		});

		await verifyFolderCreation(app, folderName, folderTemplate);
		await verifyGitFilesArePresent(app);
		await verifyVenvEnvStarts(app);
		await verifyGitStatus(app);
	});

	test('New env: Conda environment', async function ({ app }) {
		const folderName = addRandomNumSuffix('conda-installed');
		await createNewFolder(app, {
			folderTemplate,
			folderName,
			status: 'new',
			pythonEnv: 'conda', // test relies on conda already installed on machine
		});

		await verifyFolderCreation(app, folderName, folderTemplate);
		await verifyCondaFilesArePresent(app);
		await verifyCondaEnvStarts(app);
	});

	test('New env: Venv environment', { tag: [tags.CRITICAL, tags.WIN] }, async function ({ app }) {
		const folderName = addRandomNumSuffix('new-venv');

		await createNewFolder(app, {
			folderTemplate,
			folderName,
			status: 'new',
			pythonEnv: 'venv',
		});

		await verifyFolderCreation(app, folderName, folderTemplate);
		await verifyVenvEnvStarts(app);
	});

	test('New env: uv environment', { tag: [tags.CRITICAL] }, async function ({ app }) {
		const folderName = addRandomNumSuffix('new-uv');

		await createNewFolder(app, {
			folderTemplate,
			folderName,
			status: 'new',
			pythonEnv: 'uv',  // test relies on uv already installed on machine
		});

		await verifyFolderCreation(app, folderName, folderTemplate);
		await verifyUvEnvStarts(app);
	});
});
