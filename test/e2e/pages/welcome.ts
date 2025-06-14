/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import { Code } from '../infra/code';

const LOGO = '.product-logo';
const FOOTER = '.gettingStartedCategoriesContainer div.footer';
const START_SECTION = '.positron-welcome-page-start';
const HELP_TITLE = '.welcome-help-links';
const OPEN_SECTION = '.start-container';
const RECENT_SECTION = '.recently-opened';

const HEADING_ROLE = 'heading';
const BUTTON_ROLE = 'button';

export class Welcome {

	logo = this.code.driver.page.locator(LOGO);
	footer = this.code.driver.page.locator(FOOTER);
	startSection = this.code.driver.page.locator(START_SECTION);
	startButtons = this.startSection.getByRole(BUTTON_ROLE);
	helpSection = this.code.driver.page.locator(HELP_TITLE);
	helpTitle = this.helpSection.getByRole(HEADING_ROLE);
	helpLinks = this.helpSection.getByRole(BUTTON_ROLE);
	openSection = this.code.driver.page.locator(OPEN_SECTION);
	openTitle = this.openSection.getByRole(HEADING_ROLE);
	openButtons = this.openSection.getByRole(BUTTON_ROLE);
	recentSection = this.code.driver.page.locator(RECENT_SECTION);
	recentTitle = this.recentSection.getByRole(HEADING_ROLE);
	newNotebookButton = this.startButtons.getByText('New Notebook');
	newFileButton = this.startButtons.getByText('New File');
	newFolderFromTemplateButton = this.startButtons.getByText('New Folder');
	openFolderButton = this.startButtons.getByText('Open Folder');

	constructor(private code: Code) { }

	async expectLogoToBeVisible() {
		await expect(this.logo).toBeVisible();
	}

	async expectFooterToBeVisible() {
		await expect(this.footer).toBeVisible();
		await expect(this.footer).toHaveText('Show welcome page on startup');
	}

	async expectTabTitleToBe(title: string) {
		await expect(this.code.driver.page.getByRole('tab', { name: title })).toBeVisible();
	}

	async expectStartToContain(startButtons: string[]) {
		await expect(this.startSection).toBeVisible();

		for (const button of startButtons) {
			await expect(this.startButtons.filter({ hasText: button })).toBeVisible();
		}
	}

	async expectHelpToContain(helpButtons: string[]) {
		await expect(this.helpTitle).toBeVisible();
		await expect(this.helpTitle).toHaveText('Help');

		for (const link of helpButtons) {
			await expect(this.helpLinks.filter({ hasText: link })).toBeVisible();
		}
	}

	async expectRecentToContain(recentItems: string[]) {
		if (recentItems.length === 0) {
			await expect(this.recentSection).toContainText('You have no recent folders,open a folderto start');
			return;
		}

		await expect(this.recentSection).toBeVisible();
		await expect(this.recentTitle).toHaveText('Recent');
		for (const item of recentItems) {
			await expect(this.recentSection.getByRole(BUTTON_ROLE, { name: item })).toBeVisible();
		}
	}
}
