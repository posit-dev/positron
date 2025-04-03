/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { availableRuntimes, WizardButton } from '../../infra';
import { test, expect, tags } from '../_test.setup';

const pythonRuntime = availableRuntimes['python'];
const rRuntime = availableRuntimes['r'];

test.use({
	suiteId: __filename
});

test.describe('Welcome Page', { tag: [tags.WELCOME, tags.WEB] }, () => {
	test.beforeEach(async function ({ runCommand }) {
		await runCommand('Help: Welcome');
	});

	test.afterEach(async function ({ runCommand }) {
		await runCommand('View: Close All Editors');
	});

	test.describe('General', () => {
		test('Verify Welcome page header and footer', async function ({ app }) {
			await expect(app.workbench.welcome.logo).toBeVisible();
			await expect(app.workbench.welcome.title).toHaveText([/(Positron)|(Positron Dev)/, 'an IDE for data science']);
			await expect(app.workbench.welcome.footer).toHaveText('Show welcome page on startup');
		});

		test('Verify Welcome page content', async function ({ app }) {
			const { welcome, quickaccess } = app.workbench;

			let OPEN_BUTTONS_LABELS = ['Open File...', 'Open Folder...', 'New Folder...', 'New Folder from Git...'];

			if (!app.web && process.platform === 'darwin') {
				OPEN_BUTTONS_LABELS = ['Open...', 'New Folder...', 'New Folder from Git...'];
			}

			await expect(welcome.startTitle).toHaveText('Start');
			await expect(welcome.startButtons).toHaveText(['New Notebook', 'New File', 'New Console', 'New Project']);
			await expect(welcome.helpTitle).toHaveText('Help');
			await expect(welcome.helpLinks).toHaveText(['Positron Documentation', 'Positron Community', 'Report a bug']);
			await expect(welcome.openTitle).toHaveText('Open');
			await expect(welcome.openButtons).toHaveText(OPEN_BUTTONS_LABELS);

			await quickaccess.runCommand('File: Clear Recently Opened...');

			await expect(welcome.recentTitle).toHaveText('Recent');
			// 'open a folder' is a button so there is no character space because of its padding
			await expect(welcome.recentSection.locator('.empty-recent')).toHaveText('You have no recent folders,open a folderto start.');
		});

		test('Verify clicking on `new project` from the Welcome page opens wizard', { tag: [tags.MODAL] }, async function ({ app }) {
			const { welcome, popups, newProjectWizard } = app.workbench;

			await welcome.newProjectButton.click();
			await popups.popupCurrentlyOpen();
			await popups.waitForModalDialogBox();

			// confirm New Project dialog box is open
			await popups.waitForModalDialogTitle('Create New Project');
			await newProjectWizard.clickWizardButton(WizardButton.CANCEL);
		});
	});

	test.describe('Python', () => {
		test('Python - Verify clicking on `new file` from the Welcome page opens editor', async function ({ app }) {
			await app.workbench.welcome.newFileButton.click();
			await app.workbench.quickInput.selectQuickInputElementContaining('Python File');

			await expect(app.workbench.editors.activeEditor.locator(app.workbench.editors.editorIcon)).toHaveClass(/python-lang-file-icon/);
		});

		test('Python - Verify clicking on `new console` from the Welcome page starts interpreter', async function ({ app, sessions }) {
			const { welcome, quickInput, console } = app.workbench;
			await sessions.deleteAll();

			await welcome.newConsoleButton.click();
			await sessions.expectStartNewSessionMenuToBeVisible();

			await quickInput.type(pythonRuntime.name);
			await quickInput.selectQuickInputElementContaining(pythonRuntime.name);
			await console.waitForInterpretersToFinishLoading();

			await sessions.expectSessionCountToBe(1);
			await sessions.expectSessionPickerToBe(pythonRuntime.name);
		});

		test('Python - Verify clicking on `new notebook` from the Welcome page opens notebook and sets kernel', async function ({ app, python }) {
			await app.workbench.welcome.newNotebookButton.click();
			await app.workbench.popups.clickOnModalDialogPopupOption('Python Notebook');

			await expect(app.workbench.editors.activeEditor.locator(app.workbench.editors.editorIcon)).toHaveClass(/ipynb-ext-file-icon/);
			await expect(app.workbench.notebooks.kernelDropdown).toHaveText(new RegExp(pythonRuntime.name, 'i'));
		});
	});

	test.describe('R', () => {
		test('R - Verify clicking on `new file` from the Welcome page opens editor', async function ({ app }) {
			await app.workbench.welcome.newFileButton.click();
			await app.workbench.quickInput.selectQuickInputElementContaining('R File');

			await expect(app.workbench.editors.activeEditor.locator(app.workbench.editors.editorIcon)).toHaveClass(/r-lang-file-icon/);
		});

		test('R - Verify clicking on `new console` from the Welcome page starts interpreter', async function ({ app, sessions }) {
			const { welcome, quickInput, console } = app.workbench;
			await sessions.deleteAll();

			await welcome.newConsoleButton.click();
			await sessions.expectStartNewSessionMenuToBeVisible();

			await quickInput.type(rRuntime.name);
			await quickInput.selectQuickInputElementContaining(rRuntime.name);
			await console.waitForInterpretersToFinishLoading();

			await sessions.expectSessionCountToBe(1);
			await sessions.expectSessionPickerToBe(rRuntime.name);
		});

		test('R - Verify clicking on `new notebook` from the Welcome page opens notebook and sets kernel', async function ({ app, r }) {
			await app.workbench.welcome.newNotebookButton.click();
			await app.workbench.popups.clickOnModalDialogPopupOption('R Notebook');

			await expect(app.workbench.editors.activeEditor.locator(app.workbench.editors.editorIcon)).toHaveClass(/ipynb-ext-file-icon/);
			await expect(app.workbench.notebooks.kernelDropdown).toHaveText(new RegExp(rRuntime.name, 'i'));
		});
	});
});
