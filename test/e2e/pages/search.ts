/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import { Code } from '../infra/code';

const VIEWLET = '.search-view';
const INPUT = `${VIEWLET} .search-widget .search-container .monaco-inputbox textarea`;
const INCLUDE_INPUT = `${VIEWLET} .query-details .file-types.includes .monaco-inputbox input`;
const FILE_MATCH = (filename: string) => `${VIEWLET} .results .filematch[data-resource$="${filename}"]`;

/*
 *  Reuseable Positron search functionality for tests to leverage.
 */
export class Search {

	constructor(private code: Code) { }

	async openSearchViewlet(): Promise<void> {
		const page = this.code.driver.page;

		const wb = page.locator('.monaco-workbench');
		if (await wb.isVisible()) {
			await wb.click({ position: { x: 10, y: 10 } });
			await page.waitForTimeout(50);
		} else {
			await page.evaluate(() => document.body.focus());
			await page.waitForTimeout(50);
		}

		const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
		await page.keyboard.down(mod);
		await page.keyboard.down('Shift');
		await page.keyboard.press('KeyF', { delay: 20 }); // small delay helps WebKit
		await page.keyboard.up('Shift');
		await page.keyboard.up(mod);

		await expect(page.locator(INPUT)).toBeVisible();
		await expect(page.locator(INPUT)).toBeFocused();
	}

	async clearSearchResults(): Promise<void> {
		await this.code.driver.page.locator(`.sidebar .title-actions .codicon-search-clear-results`).click();
		await this.waitForNoResultText();
	}

	async waitForNoResultText(): Promise<void> {

		await expect(async () => {
			const textContent = await this.code.driver.page.locator(`${VIEWLET} .messages`).textContent();

			expect(textContent === '' || textContent === 'Search was canceled before any results could be found').toBe(true);
		}).toPass({ timeout: 20000 });
	}

	async searchFor(value: string): Promise<any> {
		await this.code.driver.page.locator(INPUT).fill(value);
		await this.code.driver.page.keyboard.press('Enter');
	}

	async waitForResultText(text: string): Promise<void> {
		await expect(async () => {
			const message = await this.code.driver.page.locator(`${VIEWLET} .messages .message`).textContent();
			expect(message).toContain(text);
		}).toPass({ timeout: 20000 });
	}

	async setFilesToIncludeText(text: string): Promise<void> {
		await this.code.driver.page.locator(INCLUDE_INPUT).fill(text || '');
	}

	async showQueryDetails(): Promise<void> {
		await this.code.driver.page.locator(`${VIEWLET} .query-details .more`).click();
	}

	async hideQueryDetails(): Promise<void> {
		await this.code.driver.page.locator(`${VIEWLET} .query-details.more .more`).click();
	}

	async removeFileMatch(filename: string): Promise<void> {
		const fileMatch = FILE_MATCH(filename);
		await this.code.driver.page.locator(fileMatch).click();
		await this.code.driver.page.locator(`${fileMatch} .action-label.codicon-search-remove`).click();
	}
}
