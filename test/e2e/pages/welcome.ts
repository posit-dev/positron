/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import test, { expect, type Locator } from '@playwright/test';
import { Code } from '../infra/code';

const LOGO = '.product-logo';
const FOOTER = '.gettingStartedCategoriesContainer div.footer';
const START_SECTION = '.positron-welcome-page-start';
const HELP_TITLE = '.welcome-help-links';
const OPEN_SECTION = '.start-container';
const RECENT_SECTION = '.recently-opened';
const WALKTHROUGH_SECTION = '.getting-started';
const HEADING_ROLE = 'heading';
const BUTTON_ROLE = 'button';

export class Welcome {

	get logo(): Locator { return this.code.driver.page.locator(LOGO); }
	get footer(): Locator { return this.code.driver.page.locator(FOOTER); }
	get startSection(): Locator { return this.code.driver.page.locator(START_SECTION); }
	get startButtons(): Locator { return this.startSection.getByRole(BUTTON_ROLE); }
	get helpSection(): Locator { return this.code.driver.page.locator(HELP_TITLE); }
	get helpTitle(): Locator { return this.helpSection.getByRole(HEADING_ROLE); }
	get helpLinks(): Locator { return this.helpSection.getByRole(BUTTON_ROLE); }
	get openSection(): Locator { return this.code.driver.page.locator(OPEN_SECTION); }
	get openTitle(): Locator { return this.openSection.getByRole(HEADING_ROLE); }
	get openButtons(): Locator { return this.openSection.getByRole(BUTTON_ROLE); }
	get recentSection(): Locator { return this.code.driver.page.locator(RECENT_SECTION); }
	get recentTitle(): Locator { return this.recentSection.getByRole(HEADING_ROLE); }
	get newNotebookButton(): Locator { return this.startButtons.getByText('New Notebook'); }
	get newFileButton(): Locator { return this.startButtons.getByText('New File'); }
	get newFolderFromTemplateButton(): Locator { return this.startButtons.getByText('New Folder'); }
	get openFolderButton(): Locator { return this.startButtons.getByText('Open Folder'); }
	get walkthroughSection(): Locator { return this.code.driver.page.locator(WALKTHROUGH_SECTION); }
	get walkthroughButtons(): Locator { return this.walkthroughSection.getByRole(BUTTON_ROLE); }

	constructor(private code: Code) { }

	async expectLogoToBeVisible() {
		await test.step('Verify logo is visible', async () => {
			await expect(this.logo).toBeVisible();
		});
	}

	async expectFooterToBeVisible() {
		await test.step('Verify footer is visible', async () => {
			await expect(this.footer).toBeVisible();
			await expect(this.footer).toHaveText('Show welcome page on startup');
		});
	}

	async expectTabTitleToBe(title: string) {
		await test.step(`Verify tab title: ${title}`, async () => {
			await expect(this.code.driver.page.getByRole('tab', { name: title })).toBeVisible();
		});
	}

	async expectConnectToBeVisible(visible: boolean) {
		await test.step(`Verify "Connect to..." is ${visible ? '' : 'NOT'} visible`, async () => {
			const connectButton = this.code.driver.page.getByRole(BUTTON_ROLE, { name: 'Connect to...' });
			if (visible) {
				await expect(connectButton).toBeVisible();
			}
			else {
				await expect(connectButton).not.toBeVisible();
			}
		});
	}

	async expectStartToContain(startButtons: string[]) {
		await test.step(`Verify start section contains expected buttons: ${startButtons}`, async () => {
			await expect(this.startSection).toBeVisible();

			for (const button of startButtons) {
				await expect(this.startButtons.filter({ hasText: button })).toBeVisible();
			}
		});
	}

	async expectHelpToContain(helpButtons: string[]) {
		await test.step(`Verify help section contains expected links: ${helpButtons}`, async () => {
			await expect(this.helpTitle).toBeVisible();
			await expect(this.helpTitle).toHaveText('Help');

			for (const link of helpButtons) {
				await expect(this.helpLinks.filter({ hasText: link })).toBeVisible();
			}
		});
	}

	async expectRecentToContain(recentItems: string[]) {
		await test.step(`Verify recent section contains expected items: ${recentItems}`, async () => {
			if (recentItems.length === 0) {
				await expect(this.recentSection).toContainText('You have no recent folders,open a folderto start');
				return;
			}

			await expect(this.recentSection).toBeVisible();
			await expect(this.recentTitle).toHaveText('Recent');
			for (const item of recentItems) {
				await expect(this.recentSection.getByRole(BUTTON_ROLE, { name: item })).toBeVisible();
			}
		});
	}

	async expectWalkthroughsToContain(walkthroughs: string[]) {
		await test.step(`Verify walkthrough section contains expected items: ${walkthroughs}`, async () => {
			await expect(this.walkthroughSection).toBeVisible();
			await expect(this.walkthroughSection).toContainText('Walkthroughs');

			for (const item of walkthroughs) {
				await expect(this.walkthroughButtons.filter({ hasText: item })).toBeVisible();
			}
		});
	}

	async expectWalkthroughsToHaveCount(count: number) {
		await test.step(`Verify walkthroughs count is ${count}`, async () => {
			const walkthroughs = this.walkthroughSection.getByRole(BUTTON_ROLE);
			await expect(walkthroughs).toHaveCount(count);
		});
	}
}
