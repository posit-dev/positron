/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { availableRuntimes } from '../../infra';
import { test, tags } from '../_test.setup';

const pythonRuntime = availableRuntimes['python'];
const rRuntime = availableRuntimes['r'];

test.use({
	suiteId: __filename
});

test.describe.skip('Welcome Page', { tag: [tags.WELCOME, tags.WEB] }, () => {
	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test.describe('Workspace', () => {
		test.beforeEach(async function ({ hotKeys }) {
			await hotKeys.welcomeWalkthrough();
		});

		test('Verify page header, footer, content', async function ({ app }) {
			const { welcome } = app.workbench;

			await welcome.expectLogoToBeVisible();
			await welcome.expectTitleToBeVisible();
			await welcome.expectFooterToBeVisible();
			await welcome.expectTabTitleToBe('Welcome');
			await welcome.expectStartToContain(['New Notebook', 'New File']);
			await welcome.expectHelpToContain(['Positron Documentation', 'Positron Community', 'Report a bug']);
			await welcome.expectRecentToContain([]);
		});

		test('Python - Verify clicking on `new notebook` from the Welcome page opens notebook and sets kernel', async function ({ app, python }) {
			const { welcome, popups, editors, notebooks } = app.workbench;

			await welcome.newNotebookButton.click();
			await popups.clickOnModalDialogPopupOption('Python Notebook');
			await editors.expectActiveEditorIconClassToMatch(/ipynb-ext-file-icon/);
			await notebooks.expectKernelToBe(pythonRuntime.name);
		});

		test('Python - Verify clicking on `new file` from the Welcome page opens editor', async function ({ app, python }) {
			const { welcome, quickInput, editors } = app.workbench;

			await welcome.newFileButton.click();
			await quickInput.selectQuickInputElementContaining('Python File');
			await editors.expectActiveEditorIconClassToMatch(/python-lang-file-icon/);
		});

		test('R - Verify clicking on `new notebook` from the Welcome page opens notebook and sets kernel', async function ({ app, r }) {
			const { welcome, popups, editors, notebooks } = app.workbench;

			await welcome.newNotebookButton.click();
			await popups.clickOnModalDialogPopupOption('R Notebook');

			await editors.expectActiveEditorIconClassToMatch(/ipynb-ext-file-icon/);
			await notebooks.expectKernelToBe(rRuntime.name);
		});

		test('R - Verify clicking on `new file` from the Welcome page opens editor', async function ({ app, r }) {
			const { welcome, quickInput, editors } = app.workbench;

			await welcome.newFileButton.click();
			await quickInput.selectQuickInputElementContaining('R File');

			await editors.expectActiveEditorIconClassToMatch(/r-lang-file-icon/);
		});
	});

	test.describe('No Workspace', () => {
		test.beforeAll(async function ({ hotKeys, sessions }) {
			await hotKeys.closeWorkspace();
			await sessions.expectSessionPickerToBe('Start Session');
			await sessions.expectNoStartUpMessaging();
		});

		test.beforeEach(async function ({ hotKeys }) {
			await hotKeys.welcomeWalkthrough();
		});

		test('Verify page header, footer, content', async function ({ app }) {
			const { welcome } = app.workbench;

			await welcome.expectLogoToBeVisible();
			await welcome.expectTitleToBeVisible();
			await welcome.expectFooterToBeVisible();

			await welcome.expectStartToContain(['Open Folder...', 'New Folder from Template...', 'New Folder from Git...']);
			await welcome.expectHelpToContain(['Positron Documentation', 'Positron Community', 'Report a bug']);
			await welcome.expectRecentToContain(['qa-example-content']);
		});

		test('Verify clicking on `Open Folder` opens file browser', { tag: [tags.MODAL, tags.WEB_ONLY] }, async function ({ app, page }) {
			const { welcome, quickInput } = app.workbench;

			await welcome.openFolderButton.click();
			await quickInput.expectTitleBarToHaveText('Open Folder');
		});

		test('Verify clicking on `New Folder from Template` opens New Folder Flow', { tag: [tags.MODAL, tags.NEW_FOLDER_FLOW] }, async function ({ app }) {
			const { welcome, newFolderFlow } = app.workbench;

			await welcome.newFolderFromTemplateButton.click();
			await newFolderFlow.expectFolderTemplatesToBeVisible({
				'Empty Project': true,
				'Python Project': true,
				'R Project': true,
				'Jupyter Notebook': true
			});
		});

		test('Verify clicking on `New Folder from Git` opens dialog', { tag: [tags.MODAL, tags.NEW_FOLDER_FLOW] }, async function ({ app }) {
			const { welcome, popups } = app.workbench;

			await welcome.startButtons.getByText('New Folder from Git...').click();
			await popups.waitForModalDialogBox();
			await popups.waitForModalDialogTitle('New Folder from Git');
		});
	});

});
