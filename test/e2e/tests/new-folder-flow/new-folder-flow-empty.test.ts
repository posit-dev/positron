/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { FolderTemplate } from '../../infra';
import { test, expect, tags } from '../_test.setup';
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

	test('Only Empty Project template shows when interpreter startup behavior is disabled', async function ({ app, workspaceSettings }) {
		// Disable startup behavior for all interpreters
		await app.workbench.settings.removeWorkspaceSettings(['interpreters.startupBehavior']);
		await workspaceSettings.set([['interpreters.startupBehavior', '"disabled"']]);

		// Open up the new folder flow
		await app.workbench.quickaccess.runCommand('positron.workbench.action.newFolderFromTemplate', { keepOpen: false });

		// Get the locator map for folder templates
		const locatorMap = app.workbench.newFolderFlow.getFolderTemplateLocatorMap();

		// Only the Empty Project template should be visible
		for (const [folderTemplate, locator] of locatorMap) {
			if (folderTemplate !== FolderTemplate.EMPTY_PROJECT) {
				await expect(locator).not.toBeVisible({ timeout: 500 });
			} else {
				await expect(locator).toBeVisible({ timeout: 500 });
			}
		}
	});
});
