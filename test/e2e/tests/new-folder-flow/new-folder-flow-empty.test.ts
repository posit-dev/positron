/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { FolderTemplate } from '../../infra';
import { test, tags } from '../_test.setup';
import { addRandomNumSuffix, verifyGitStatus, verifyPyprojectTomlNotCreated } from './helpers/new-folder-flow.js';

test.use({
	suiteId: __filename
});

test.describe('New Folder Flow: Empty Project', { tag: [tags.MODAL, tags.NEW_FOLDER_FLOW, tags.WEB] }, () => {
	const folderTemplate = FolderTemplate.EMPTY_PROJECT;

	test('Verify empty folder defaults', { tag: [tags.CRITICAL, tags.WIN] }, async function ({ app }) {
		const { newFolderFlow } = app.workbench;
		const folderName = addRandomNumSuffix('empty-project');

		// Create a new empty project folder
		await newFolderFlow.createNewFolder({
			folderTemplate,
			folderName
		});

		await newFolderFlow.verifyFolderCreation(folderName);
		await verifyPyprojectTomlNotCreated(app);
	});

	test('Verify empty folder with git initialization', { tag: [tags.WIN] }, async function ({ app }) {
		const { newFolderFlow } = app.workbench;
		const folderName = addRandomNumSuffix('empty-project-git');

		// Create a new empty project folder with git initialized
		await newFolderFlow.createNewFolder({
			folderTemplate,
			folderName,
			initGitRepo: true
		});

		await newFolderFlow.verifyFolderCreation(folderName);
		await verifyGitStatus(app);
	});
});
