/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('New Folder Flow: Template visibility via Interpreter Settings', {
	tag: [tags.INTERPRETER, tags.WEB, tags.MODAL, tags.NEW_FOLDER_FLOW]
}, () => {

	// Some extra diligence around clearing settings is used to avoid the language-specific settings
	// being overridden by other language-specific settings. At present, other tests don't set
	// language-specific settings, but this may change in the future

	test.beforeAll(async function ({ settings }) {
		await settings.clear();
	});

	test.beforeEach(async function ({ settings }) {
		await settings.clear();
	});

	test('Verify only Empty Project available when global interpreter startup is disabled',
		async function ({ app, hotKeys, settings }) {
			const { newFolderFlow } = app.positron;

			// Disable startup behavior for all interpreters
			await settings.set({
				'interpreters.startupBehavior': 'disabled'
			}, { reload: 'web', waitMs: 1000, keepOpen: true });
			await hotKeys.newFolderFromTemplate();

			// Only Empty Project should be available
			await newFolderFlow.expectFolderTemplatesToBeVisible({
				'Empty Project': true
			});
		});


	test('Verify Python and Jupyter templates hidden when Python startup is disabled',
		async function ({ app, hotKeys, settings }) {
			const { newFolderFlow } = app.positron;

			// Disable startup behavior for Python
			await settings.set({
				'[python]': {
					"interpreters.startupBehavior": "disabled",
					"editor.formatOnSave": true
				}
			}, { reload: 'web', waitMs: 1000, keepOpen: true });
			await hotKeys.newFolderFromTemplate();

			// Only Empty Project and R Project should be available
			await newFolderFlow.expectFolderTemplatesToBeVisible({
				'R Project': true,
				'Empty Project': true
			});
		});

	test('Verify R folder template hidden when R startup is disabled',
		async function ({ app, hotKeys, settings }) {
			const { newFolderFlow } = app.positron;

			// Disable startup behavior for R
			await settings.set({
				'[r]': {
					"interpreters.startupBehavior": "disabled",
					"editor.formatOnSave": true
				}
			}, { reload: 'web', waitMs: 1000, keepOpen: true });
			await hotKeys.newFolderFromTemplate();

			// Only templates other than R should be available
			await newFolderFlow.expectFolderTemplatesToBeVisible({
				'Python Project': true,
				'Jupyter Notebook': true,
				'Empty Project': true
			});
		});
});
