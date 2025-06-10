/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { FolderTemplate } from '../../infra';
import { test, tags } from '../_test.setup';
import { addRandomNumSuffix, createNewFolder, verifyFolderCreation } from './helpers/new-folder-flow.js';

test.use({
	suiteId: __filename
});

test.describe('Empty Folder - New Folder Flow', { tag: [tags.MODAL, tags.NEW_FOLDER_FLOW, tags.WEB] }, () => {
	const folderTemplate = FolderTemplate.EMPTY_PROJECT;

	test('Empty Folder - Folder Defaults', { tag: [tags.CRITICAL, tags.WIN] }, async function ({ app }) {
		const folderName = addRandomNumSuffix('empty-project');

		// Create a new empty project folder
		await createNewFolder(app, {
			folderTemplate,
			folderName
		});

		await verifyFolderCreation(app, folderName);
	});
});
