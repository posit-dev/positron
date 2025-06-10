/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { FolderTemplate } from '../../infra';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('New Folder Flow - Template Types', { tag: [tags.MODAL, tags.NEW_FOLDER_FLOW] }, () => {
	test.beforeAll(async function ({ app, workspaceSettings }) {
		await app.workbench.settings.removeWorkspaceSettings(['interpreters.startupBehavior']);
		// Disable startup behavior for all interpreters.
		await workspaceSettings.set([['interpreters.startupBehavior', '"disabled"']]);
	});

	test('Only Empty Project template shows when interpreter startup behavior is disabled', async function ({ app }) {
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
