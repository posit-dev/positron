/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import { Application, Logger, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';

/*
 *  Welcome test cases.
 */

export function setup(logger: Logger) {
	describe('Welcome Page', () => {
		installAllHandlers(logger);

		beforeEach(async function () {
			const app = this.app as Application;

			await app.workbench.quickaccess.runCommand('Help: Welcome');
			app.workbench.editors.waitForActiveEditor('Welcome');
		});

		afterEach(async function () {
			const app = this.app as Application;
			await app.workbench.quickaccess.runCommand('View: Close All Editors');
		});

		it('Verify Welcome page header and footer', async function () {
			const app = this.app as Application;
			const logoLocator = '.product-logo';
			const titleLocator = '.gettingStartedCategoriesContainer div.header div .positron';
			const footerLocator = '.gettingStartedCategoriesContainer div.footer';

			const footer = app.code.driver.getLocator(footerLocator);

			const logo = app.code.driver.getLocator(logoLocator);

			await expect(logo).toBeVisible();
			const logoBox = await (await logo.elementHandle())?.boundingBox();

			expect(logoBox?.height).toBeGreaterThan(0);
			expect(logoBox?.width).toBeGreaterThan(0);

			const title = app.code.driver.getLocator(titleLocator);

			// product name in release is 'Positron' and in dev is 'Positron Dev'
			await expect(title).toHaveText([/(Positron)|(Positron Dev)/, 'an IDE for data science']);

			await expect(footer).toHaveText('Show welcome page on startup');
		});

		it('Verify Welcome page content', async function () {
			const app = this.app as Application;

			const startTitle = app.workbench.positronWelcome.startSection.getByRole('heading');
			const startButtons = app.workbench.positronWelcome.startSection.getByRole('button');

			const helpSection = app.code.driver.getLocator('.positron-welcome-page-help');
			const helpTitle = helpSection.getByRole('heading');
			const helpLinks = helpSection.getByRole('link');

			const openSection = app.code.driver.getLocator('.categories-column.categories-column-right .index-list.start-container');
			const openTitle = openSection.getByRole('heading');
			const openButtons = openSection.getByRole('button');

			const recentSection = app.code.driver.getLocator('.categories-column.categories-column-right .index-list.recently-opened');
			const recentTitle = recentSection.getByRole('heading');

			await expect(startTitle).toHaveText('Start');

			await expect(startButtons).toHaveCount(4);
			await expect(startButtons).toHaveText(['New Notebook', 'New File', 'New Console', 'New Project']);

			await expect(helpTitle).toHaveText('Help');

			await expect(helpLinks).toHaveCount(3);
			await expect(helpLinks).toHaveText(['Positron Documentation', 'Positron Community', 'Report a bug']);

			await expect(openTitle).toHaveText('Open');

			await expect(openButtons).toHaveCount(3);
			await expect(openButtons).toHaveText(['Open...', 'New Folder...', 'New Folder from Git...']);

			await app.workbench.quickaccess.runCommand('File: Clear Recently Opened...');

			await expect(recentTitle).toHaveText('Recent');

			// 'open a folder' is a button so there is no character space because of its padding
			await expect(recentSection.locator('.empty-recent')).toHaveText('You have no recent folders,open a folderto start.');
		});

		it('Click on new project from the Welcome page', async function () {
			const app = this.app as Application;

			await app.workbench.positronWelcome.clickNewProject();
			await app.workbench.positronPopups.popupCurrentlyOpen();

			await app.workbench.positronPopups.waitForModalDialogBox();

			// confirm New Project dialog box is open
			await app.workbench.positronPopups.waitForModalDialogTitle('Create New Project');

			await app.workbench.positronPopups.clickCancelOnModalDialogBox();
		});

		describe('Python', () => {
			before(async function () {
				await PositronPythonFixtures.SetupFixtures(this.app as Application);
			});

			it('Create a new Python file from the Welcome page', async function () {
				const app = this.app as Application;

				const editorTabLocator = app.code.driver.getLocator('div.tab.tab-actions-right.active.selected');

				await app.workbench.positronWelcome.clickNewFile();

				await app.workbench.quickinput.selectQuickInputElementContaining('Python File');

				await expect(editorTabLocator.locator('.monaco-icon-label.file-icon')).toHaveClass(/python-lang-file-icon/);

				await app.workbench.quickaccess.runCommand('View: Close Editor');
			});

			it('Create a new Python notebook from the Welcome page', async function () {
				const app = this.app as Application;

				const editorTabLocator = app.code.driver.getLocator('div.tab.tab-actions-right.active.selected');

				await app.workbench.positronWelcome.clickNewNotebook();

				await app.workbench.positronPopups.clickOnModalDialogPopupOption('Python Notebook');

				await expect(editorTabLocator.locator('.monaco-icon-label.file-icon')).toHaveClass(/ipynb-ext-file-icon/);

				const expectedInterpreterVersion = new RegExp(`Python ${process.env.POSITRON_PY_VER_SEL}`, 'i');
				await expect(app.code.driver.getLocator('div.notebook-toolbar-container > div.notebook-toolbar-right a.kernel-label')).toHaveText(expectedInterpreterVersion);
			});

			it('Click on Python console from the Welcome page', async function () {
				const app = this.app as Application;

				await app.workbench.positronWelcome.clickNewConsole();
				await app.workbench.positronPopups.popupCurrentlyOpen();

				const expectedInterpreterVersion = new RegExp(`Python ${process.env.POSITRON_PY_VER_SEL}`, 'i');
				await app.workbench.positronPopups.clickOnModalDialogPopupOption(expectedInterpreterVersion);

				// editor is hidden because bottom panel is maximized
				await expect(app.code.driver.getLocator('.split-view-view .part.editor')).not.toBeVisible();

				// console is the active view in the bottom panel
				await expect(app.code.driver.getLocator('.part.panel [aria-label="Active View Switcher"] li.action-item.checked')).toHaveText('Console');
			});
		});

		describe('R', () => {
			before(async function () {
				await PositronRFixtures.SetupFixtures(this.app as Application);
			});

			it('Create a new R file from the Welcome page', async function () {
				const app = this.app as Application;

				const editorTabLocator = app.code.driver.getLocator('div.tab.tab-actions-right.active.selected');

				await app.workbench.positronWelcome.clickNewFile();

				await app.workbench.quickinput.selectQuickInputElementContaining('R File');

				await expect(editorTabLocator.locator('.monaco-icon-label.file-icon')).toHaveClass(/r-lang-file-icon/);
			});

			it('Click on R console from the Welcome page', async function () {
				const app = this.app as Application;

				await app.workbench.positronWelcome.clickNewConsole();
				await app.workbench.positronPopups.popupCurrentlyOpen();

				const expectedInterpreterVersion = new RegExp(`R ${process.env.POSITRON_R_VER_SEL}`, 'i');
				await app.workbench.positronPopups.clickOnModalDialogPopupOption(expectedInterpreterVersion);

				// editor is hidden because bottom panel is maximized
				await expect(app.code.driver.getLocator('.split-view-view .part.editor')).not.toBeVisible();

				// console is the active view in the bottom panel
				await expect(app.code.driver.getLocator('.part.panel [aria-label="Active View Switcher"] li.action-item.checked')).toHaveText('Console');
			});

			it('Create a new R notebook from the Welcome page', async function () {
				const app = this.app as Application;

				const editorTabLocator = app.code.driver.getLocator('div.tab.tab-actions-right.active.selected');

				await app.workbench.positronWelcome.clickNewNotebook();

				await app.workbench.positronPopups.clickOnModalDialogPopupOption('R Notebook');

				await expect(editorTabLocator.locator('.monaco-icon-label.file-icon')).toHaveClass(/ipynb-ext-file-icon/);

				const expectedInterpreterVersion = new RegExp(`R ${process.env.POSITRON_R_VER_SEL}`, 'i');
				await expect(app.code.driver.getLocator('div.notebook-toolbar-container > div.notebook-toolbar-right a.kernel-label')).toHaveText(expectedInterpreterVersion);
			});
		});
	});

}
