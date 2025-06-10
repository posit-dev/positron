/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application } from '../../infra/index.js';
import { FlowButton, FolderTemplate } from '../../pages/newFolderFlow.js';
import { test, tags, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Folder Templates - Interpreter Startup Behavior', {
	tag: [tags.INTERPRETER, tags.WEB, tags.MODAL, tags.NEW_FOLDER_FLOW]
}, () => {
	let settingsBackup: string;

	// Note: see https://github.com/posit-dev/positron/issues/8045
	// Some extra diligence around clearing settings is used to avoid the language-specific settings
	// being overridden by other language-specific settings. At present, other tests don't set
	// language-specific settings, but this may change in the future.
	test.beforeAll(async ({ app }) => {
		settingsBackup = await app.workbench.settings.backupWorkspaceSettings();
		await app.workbench.settings.clearWorkspaceSettings();
	});
	test.afterEach(async function ({ app }) {
		await app.workbench.settings.clearWorkspaceSettings();
	});
	test.afterAll(async function ({ app }) {
		await app.workbench.settings.restoreWorkspaceSettings(settingsBackup);
	});

	test('Only Empty Project available when global interpreter startup behavior disabled',
		async function ({ app }) {
			// Disable startup behavior for all interpreters
			await app.workbench.settings.setWorkspaceSettings([['interpreters.startupBehavior', '"disabled"']]);

			console.log('general: workspaceSettings', await app.workbench.settings.getWorkspaceSettings());

			// Only Empty Project should be available
			await verifyAvailableFolderTemplates(app, [
				FolderTemplate.EMPTY_PROJECT
			]);
		});


	test('Python and Jupyter templates hidden when Python startup behavior is disabled', {
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/8045' },]
	}, async function ({ app }) {
		// Disable startup behavior for Python
		// Note: see the issue annotation -- this is a hacky way to set language-specific settings
		await app.workbench.settings.setWorkspaceSettings([['[python]', '{ "interpreters.startupBehavior": "disabled" }']]);

		console.log('python: workspaceSettings', await app.workbench.settings.getWorkspaceSettings());

		// Only Empty Project and R Project should be available
		await verifyAvailableFolderTemplates(app, [
			FolderTemplate.EMPTY_PROJECT,
			FolderTemplate.R_PROJECT
		]);
	});

	test('R - Folder Template hidden when R startup behavior is disabled', {
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/8045' },]
	}, async function ({ app }) {
		// Disable startup behavior for R
		// Note: see the issue annotation -- this is a hacky way to set language-specific settings
		await app.workbench.settings.setWorkspaceSettings([['[r]', '{ "interpreters.startupBehavior": "disabled" }']]);

		console.log('r: workspaceSettings', await app.workbench.settings.getWorkspaceSettings());


		// Only templates other than R should be available
		await verifyAvailableFolderTemplates(app, [
			FolderTemplate.EMPTY_PROJECT,
			FolderTemplate.PYTHON_PROJECT,
			FolderTemplate.JUPYTER_NOTEBOOK
		]);
	});
});

async function verifyAvailableFolderTemplates(app: Application, availableTemplates: FolderTemplate[]) {
	// Open up the new folder flow
	await app.workbench.quickaccess.runCommand('positron.workbench.action.newFolderFromTemplate', { keepOpen: false });

	// Get the locators for the folder templates
	const locatorMap = app.workbench.newFolderFlow.getFolderTemplateLocatorMap();
	for (const template of availableTemplates) {
		if (!locatorMap.has(template)) {
			throw new Error(`Template ${template} not found in locator map.`);
		}
	}

	// Confirm the available templates are visible and the others are not
	for (const [template, locator] of locatorMap.entries()) {
		if (availableTemplates.includes(template)) {
			await expect(locator).toBeVisible({ timeout: 500 });
		} else {
			await expect(locator).not.toBeVisible({ timeout: 500 });
		}
	}

	// Close the new folder flow
	await app.workbench.newFolderFlow.clickFlowButton(FlowButton.CANCEL);
}
