"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.Search = void 0;
const test_1 = require("@playwright/test");
const VIEWLET = '.search-view';
const INPUT = `${VIEWLET} .search-widget .search-container .monaco-inputbox textarea`;
const INCLUDE_INPUT = `${VIEWLET} .query-details .file-types.includes .monaco-inputbox input`;
const FILE_MATCH = (filename) => `${VIEWLET} .results .filematch[data-resource$="${filename}"]`;
/*
 *  Reuseable Positron search functionality for tests to leverage.
 */
class Search {
    code;
    constructor(code) {
        this.code = code;
    }
    async openSearchViewlet() {
        const searchTab = this.code.driver.currentPage.getByRole('tab', { name: 'Search' });
        const selected = await searchTab.getAttribute('aria-selected');
        if (selected !== 'true') {
            await searchTab.click();
        }
    }
    async clearSearchResults() {
        await this.code.driver.currentPage.locator(`.sidebar .title-actions .codicon-search-clear-results`).click();
        await this.waitForNoResultText();
    }
    async waitForNoResultText() {
        await (0, test_1.expect)(async () => {
            const textContent = await this.code.driver.currentPage.locator(`${VIEWLET} .messages`).textContent();
            (0, test_1.expect)(textContent === '' || textContent === 'Search was canceled before any results could be found').toBe(true);
        }).toPass({ timeout: 20000 });
    }
    async searchFor(value) {
        await this.code.driver.currentPage.locator(INPUT).fill(value);
        await this.code.driver.currentPage.keyboard.press('Enter');
    }
    async waitForResultText(text) {
        await (0, test_1.expect)(async () => {
            const message = await this.code.driver.currentPage.locator(`${VIEWLET} .messages .message`).textContent();
            (0, test_1.expect)(message).toContain(text);
        }).toPass({ timeout: 20000 });
    }
    async setFilesToIncludeText(text) {
        await this.code.driver.currentPage.locator(INCLUDE_INPUT).fill(text || '');
    }
    async showQueryDetails() {
        await this.code.driver.currentPage.locator(`${VIEWLET} .query-details .more`).click();
    }
    async hideQueryDetails() {
        await this.code.driver.currentPage.locator(`${VIEWLET} .query-details.more .more`).click();
    }
    async removeFileMatch(filename) {
        const fileMatch = FILE_MATCH(filename);
        await this.code.driver.currentPage.locator(fileMatch).click();
        await this.code.driver.currentPage.locator(`${fileMatch} .action-label.codicon-search-remove`).click();
    }
}
exports.Search = Search;
//# sourceMappingURL=search.js.map