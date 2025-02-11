/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { WizardButton } from '../../infra';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Welcome Page', { tag: [tags.WELCOME, tags.WEB] }, () => {
	test.beforeEach(async function ({ app }) {
		await app.workbench.quickaccess.runCommand('Help: Welcome');
	});

	test.afterEach(async function ({ app }) {
		await app.workbench.quickaccess.runCommand('View: Close All Editors');
	});

	test.describe('General', () => {
		test('Verify Welcome page header and footer', async function ({ app }) {

			await expect(app.workbench.welcome.logo).toBeVisible();

			// product name in release is 'Positron' and in dev is 'Positron Dev'
			await expect(app.workbench.welcome.title).toHaveText([/(Positron)|(Positron Dev)/, 'an IDE for data science']);

			await expect(app.workbench.welcome.footer).toHaveText('Show welcome page on startup');
		});

		test('Verify Welcome page content', async function ({ app }) {

			let OPEN_BUTTONS_LABELS;
			if (!app.web) {
				if (process.platform === 'darwin') {
					OPEN_BUTTONS_LABELS = ['Open...', 'New Folder...', 'New Folder from Git...'];
				} else {
					OPEN_BUTTONS_LABELS = ['Open File...', 'Open Folder...', 'New Folder...', 'New Folder from Git...'];
				}
			} else {
				OPEN_BUTTONS_LABELS = ['Open File...', 'Open Folder...', 'New Folder...', 'New Folder from Git...'];
			}

			await expect(app.workbench.welcome.startTitle).toHaveText('Start');

			await expect(app.workbench.welcome.startButtons).toHaveText(['New Notebook', 'New File', 'New Console', 'New Project']);

			await expect(app.workbench.welcome.helpTitle).toHaveText('Help');

			await expect(app.workbench.welcome.helpLinks).toHaveText(['Positron Documentation', 'Positron Community', 'Report a bug']);

			await expect(app.workbench.welcome.openTitle).toHaveText('Open');

			await expect(app.workbench.welcome.openButtons).toHaveText(OPEN_BUTTONS_LABELS);

			await app.workbench.quickaccess.runCommand('File: Clear Recently Opened...');

			await expect(app.workbench.welcome.recentTitle).toHaveText('Recent');

			// 'open a folder' is a button so there is no character space because of its padding
			await expect(app.workbench.welcome.recentSection.locator('.empty-recent')).toHaveText('You have no recent folders,open a folderto start.');
		});

		test('Verify clicking on `new project` from the Welcome page opens wizard', { tag: [tags.MODAL] }, async function ({ app }) {
			await app.workbench.welcome.newProjectButton.click();
			await app.workbench.popups.popupCurrentlyOpen();

			await app.workbench.popups.waitForModalDialogBox();

			// confirm New Project dialog box is open
			await app.workbench.popups.waitForModalDialogTitle('Create New Project');

			await app.workbench.newProjectWizard.clickWizardButton(WizardButton.CANCEL);
		});
	});

	test.describe('Python', () => {
		test('Python - Verify clicking on `new file` from the Welcome page opens editor', async function ({ app, python }) {
			await app.workbench.welcome.newFileButton.click();

			await app.workbench.quickInput.selectQuickInputElementContaining('Python File');

			await expect(app.workbench.editors.activeEditor.locator(app.workbench.editors.editorIcon)).toHaveClass(/python-lang-file-icon/);

			await app.workbench.quickaccess.runCommand('View: Close Editor');
		});

		test('Python - Verify clicking on `new notebook` from the Welcome page opens notebook and sets interpreter', async function ({ app, python }) {
			await app.workbench.welcome.newNotebookButton.click();
			await app.workbench.popups.clickOnModalDialogPopupOption('Python Notebook');
			await expect(app.workbench.editors.activeEditor.locator(app.workbench.editors.editorIcon)).toHaveClass(/ipynb-ext-file-icon/);
			const expectedInterpreterVersion = new RegExp(`Python ${process.env.POSITRON_PY_VER_SEL}`, 'i');
			await expect(app.workbench.notebooks.kernelDropdown).toHaveText(expectedInterpreterVersion);
		});

		test('Python - Verify clicking on `new console` from the Welcome page maximizes console and starts interpreter', async function ({ app, python }) {
			await app.workbench.welcome.newConsoleButton.click();
			await app.workbench.popups.popupCurrentlyOpen();

			const expectedInterpreterVersion = new RegExp(`Python ${process.env.POSITRON_PY_VER_SEL}`, 'i');
			await app.workbench.popups.clickOnModalDialogPopupOption(expectedInterpreterVersion);

			// editor is hidden because bottom panel is maximized
			await expect(app.workbench.editors.editorPart).not.toBeVisible();

			// console is the active view in the bottom panel
			await expect(app.workbench.layouts.panelViewsTab.and(app.code.driver.page.locator('.checked'))).toHaveText('Console');
		});
	});

	test.describe('R', () => {
		test('R - Verify clicking on `new file` from the Welcome page opens editor', async function ({ app, r }) {
			await app.workbench.welcome.newFileButton.click();

			await app.workbench.quickInput.selectQuickInputElementContaining('R File');

			await expect(app.workbench.editors.activeEditor.locator(app.workbench.editors.editorIcon)).toHaveClass(/r-lang-file-icon/);
		});

		test('R - Verify clicking on `new console` from the Welcome page maximizes console and starts interpreter', async function ({ app, r }) {
			await app.workbench.welcome.newConsoleButton.click();
			await app.workbench.popups.popupCurrentlyOpen();

			const expectedInterpreterVersion = new RegExp(`R ${process.env.POSITRON_R_VER_SEL}`, 'i');
			await app.workbench.popups.clickOnModalDialogPopupOption(expectedInterpreterVersion);

			// editor is hidden because bottom panel is maximized
			await expect(app.workbench.editors.editorPart).not.toBeVisible();

			// console is the active view in the bottom panel
			await expect(app.workbench.layouts.panelViewsTab.and(app.code.driver.page.locator('.checked'))).toHaveText('Console');
		});

		test('R - Verify clicking on `new notebook` from the Welcome page opens notebook and sets interpreter', async function ({ app, r }) {
			await app.workbench.welcome.newNotebookButton.click();

			await app.workbench.popups.clickOnModalDialogPopupOption('R Notebook');

			await expect(app.workbench.editors.activeEditor.locator(app.workbench.editors.editorIcon)).toHaveClass(/ipynb-ext-file-icon/);

			const expectedInterpreterVersion = new RegExp(`R ${process.env.POSITRON_R_VER_SEL}`, 'i');
			await expect(app.workbench.notebooks.kernelDropdown).toHaveText(expectedInterpreterVersion);
		});
	});
});
