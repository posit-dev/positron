/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import test, { expect, type Locator } from '@playwright/test';
import { Code } from '../infra/code';

const PAGE = '.positron-welcome-page';
const HEADER = '.positron-welcome-page-header';
const HEADER_TITLE = '.positron-welcome-page-header .welcome-header-title';
const HELP_BUTTON = '.positron-welcome-page-header .welcome-header-help';
const WALKTHROUGH_BANNER = '.positron-welcome-page-walkthrough-banner';
const SEE_ALL_WALKTHROUGHS = '.positron-welcome-page-walkthrough-banner .walkthrough-banner-link';
const RECENT_SECTION = '.recently-opened';
const HEADING_ROLE = 'heading';
const BUTTON_ROLE = 'button';
const CATEGORIES_SLIDE = '.gettingStartedSlideCategories';
const DETAILS_SLIDE = '.gettingStartedSlideDetails';
const STARTUP_CHECKBOX = '#showOnStartup';
const ENVIRONMENT_SETUP = '.positron-welcome-page-environment-setup';
const ENVIRONMENT_SETUP_SUMMARY = '.positron-welcome-page-environment-setup .environment-health-group-summary';

export class Welcome {

	get welcomePage(): Locator { return this.code.driver.currentPage.locator(PAGE); }
	get header(): Locator { return this.code.driver.currentPage.locator(HEADER); }
	get headerTitle(): Locator { return this.code.driver.currentPage.locator(HEADER_TITLE); }
	get helpButton(): Locator { return this.code.driver.currentPage.locator(HELP_BUTTON); }
	get walkthroughBanner(): Locator { return this.code.driver.currentPage.locator(WALKTHROUGH_BANNER); }
	get seeAllWalkthroughsButton(): Locator { return this.code.driver.currentPage.locator(SEE_ALL_WALKTHROUGHS); }
	get recentSection(): Locator { return this.code.driver.currentPage.locator(RECENT_SECTION); }
	get recentTitle(): Locator { return this.recentSection.getByRole(HEADING_ROLE); }
	get startupCheckbox(): Locator { return this.code.driver.currentPage.locator(STARTUP_CHECKBOX); }
	get environmentSetup(): Locator { return this.code.driver.currentPage.locator(ENVIRONMENT_SETUP); }
	get environmentSetupProgress(): Locator { return this.code.driver.currentPage.locator(ENVIRONMENT_SETUP).getByRole('progressbar'); }
	get environmentSetupSummary(): Locator { return this.code.driver.currentPage.locator(ENVIRONMENT_SETUP_SUMMARY); }

	constructor(private code: Code) { }

	async expectPageToBeVisible() {
		await test.step('Verify welcome page is visible', async () => {
			await expect(this.welcomePage).toBeVisible();
		});
	}

	/**
	 * Verify the header renders.
	 *
	 * The title is matched loosely because it carries the product name, which
	 * reads "Positron Dev" on a dev build and "Positron" on a release one.
	 */
	async expectHeaderToBeVisible() {
		await test.step('Verify header is visible', async () => {
			await expect(this.header).toBeVisible();
			await expect(this.headerTitle).toContainText('Welcome to Positron');
			await expect(this.helpButton).toBeVisible();
		});
	}

	async expectTabTitleToBe(title: string) {
		await test.step(`Verify tab title: ${title}`, async () => {
			await expect(this.code.driver.currentPage.locator('[id="workbench.parts.editor"]').getByRole('tab', { name: title })).toBeVisible();
		});
	}

	async expectConnectToBeVisible(visible: boolean) {
		await test.step(`Verify "Connect to..." is ${visible ? '' : 'NOT'} visible`, async () => {
			const connectButton = this.code.driver.currentPage.getByRole(BUTTON_ROLE, { name: 'Connect to...' });
			if (visible) {
				await expect(connectButton).toBeVisible();
			}
			else {
				await expect(connectButton).not.toBeVisible();
			}
		});
	}

	/**
	 * Verify the "Recent" section renders.
	 *
	 * We assert the section is present, not its contents: the app is worker-scoped, so the
	 * recently-opened list is variable (earlier suites in the worker leave folders in it).
	 */
	async expectRecentToBeVisible() {
		await test.step('Verify recent section is visible', async () => {
			await expect(this.recentSection).toBeVisible();
			await expect(this.recentTitle).toHaveText('Recent');
		});
	}

	async expectStartupCheckboxToBeVisible() {
		await test.step('Verify "Show welcome page on startup" checkbox is visible', async () => {
			await expect(this.startupCheckbox).toBeVisible();
		});
	}

	/**
	 * Verifies the off-screen slide is inert, which is what keeps its focusable
	 * content out of the tab order, and that the visible slide is not.
	 *
	 * Asserts the mechanism rather than walking the page with Tab. A counted walk
	 * has to know how many tab stops the page has, and that number changes with
	 * the recent list and between web and desktop; too low a count stops short of
	 * the boundary and passes without testing anything.
	 * @param hidden Which slide is currently parked off-screen.
	 */
	async expectHiddenSlideToBeInert(hidden: 'welcome' | 'walkthrough') {
		await test.step(`Verify the off-screen ${hidden} slide is inert`, async () => {
			const page = this.code.driver.currentPage;
			const hiddenSlide = hidden === 'welcome' ? CATEGORIES_SLIDE : DETAILS_SLIDE;
			const visibleSlide = hidden === 'welcome' ? DETAILS_SLIDE : CATEGORIES_SLIDE;

			await expect(page.locator(hiddenSlide)).toHaveAttribute('inert');
			await expect(page.locator(visibleSlide)).not.toHaveAttribute('inert');
		});
	}

}
