/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Folder Templates - Interpreter Startup Behavior', {
	tag: [tags.INTERPRETER, tags.WEB, tags.MODAL, tags.NEW_FOLDER_FLOW]
}, () => {

	// Note: see https://github.com/posit-dev/positron/issues/8045
	// Some extra diligence around clearing settings is used to avoid the language-specific settings
	// being overridden by other language-specific settings. At present, other tests don't set
	// language-specific settings, but this may change in the future

	test.beforeAll(async function ({ workspaceSettings }) {
		await workspaceSettings.clear();
	});

	test.beforeEach(async function ({ app }) {
		await app.workbench.settings.clearWorkspaceSettings();
	});

	test('Verify only Empty Project available when global startup is disabled', async function ({ app, workspaceSettings, hotKeys }) {
		// Disable startup behavior for all interpreters
		await workspaceSettings.set([['interpreters.startupBehavior', '"disabled"']]);
		await hotKeys.newFolderFromTemplate();

		// Only Empty Project should be available
		await app.workbench.newFolderFlow.expectFolderTemplatesToBeVisible({
			'Empty Project': true
		});
	});


	test('Verify Python and Jupyter templates hidden when Python startup is disabled', {
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/8045' },]
	}, async function ({ app, workspaceSettings, hotKeys }) {
		// Disable startup behavior for Python
		await workspaceSettings.set([['[python]', '{ "interpreters.startupBehavior": "disabled" }']]);
		await hotKeys.newFolderFromTemplate();

		// Only Empty Project and R Project should be available
		await app.workbench.newFolderFlow.expectFolderTemplatesToBeVisible({
			'R Project': true,
			'Empty Project': true
		});
	});

	test('Verify R folder template hidden when R startup is disabled', {
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/8045' },]
	}, async function ({ app, workspaceSettings, hotKeys }) {
		// Disable startup behavior for R
		await workspaceSettings.set([['[r]', '{ "interpreters.startupBehavior": "disabled" }']]);
		await hotKeys.newFolderFromTemplate();

		// Only templates other than R should be available
		await app.workbench.newFolderFlow.expectFolderTemplatesToBeVisible({
			'Python Project': true,
			'Jupyter Notebook': true,
			'Empty Project': true
		});
	});
});
