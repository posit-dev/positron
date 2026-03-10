"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.References = void 0;
const test_1 = require("@playwright/test");
/*
 *  Reuseable Positron references functionality for tests to leverage.
 */
class References {
    code;
    static REFERENCES_WIDGET = '.monaco-editor .zone-widget .zone-widget-container.peekview-widget.reference-zone-widget.results-loaded';
    static REFERENCES_TITLE_COUNT = `${References.REFERENCES_WIDGET} .head .peekview-title .meta`;
    static REFERENCES = `${References.REFERENCES_WIDGET} .body .ref-tree.inline .monaco-list-row .highlight`;
    static REFERENCES_TITLE_FILE_NAME = `${References.REFERENCES_WIDGET} .head .peekview-title .filename`;
    static REFERENCE_FILES = `${References.REFERENCES_WIDGET} .reference-file .label-name`;
    constructor(code) {
        this.code = code;
    }
    async waitUntilOpen() {
        await (0, test_1.expect)(this.code.driver.currentPage.locator(References.REFERENCES_WIDGET)).toBeVisible();
    }
    async waitForReferencesCountInTitle(count) {
        await (0, test_1.expect)(async () => {
            const text = await this.code.driver.currentPage.locator(References.REFERENCES_TITLE_COUNT).textContent();
            const matches = text ? text.match(/\d+/) : null;
            return matches ? parseInt(matches[0]) === count : false;
        }).toPass({ timeout: 20000 });
    }
    async waitForReferencesCount(count) {
        await (0, test_1.expect)(async () => {
            const references = await this.code.driver.currentPage.locator(References.REFERENCES).all();
            (0, test_1.expect)(references.length).toBe(count);
        }).toPass({ timeout: 20000 });
    }
    async waitForFile(file) {
        const titles = await this.code.driver.currentPage.locator(References.REFERENCES_TITLE_FILE_NAME).all();
        for (const title of titles) {
            const text = await title.textContent();
            (0, test_1.expect)(text).toContain(file);
        }
    }
    async waitForReferenceFiles(files) {
        await (0, test_1.expect)(async () => {
            const fileNames = await this.code.driver.currentPage.locator(References.REFERENCE_FILES).all();
            for (const fileNameLocator of fileNames) {
                const fileName = await fileNameLocator.textContent();
                (0, test_1.expect)(files).toContain(fileName);
            }
        }).toPass({ timeout: 20000 });
    }
    async close() {
        // Sometimes someone else eats up the `Escape` key
        let count = 0;
        while (true) {
            await this.code.driver.currentPage.keyboard.press('Escape');
            try {
                (0, test_1.expect)((await this.code.driver.currentPage.locator(References.REFERENCES_WIDGET).all()).length).toBe(0);
                return;
            }
            catch (err) {
                if (++count > 5) {
                    throw err;
                }
                else {
                    await this.code.wait(1000);
                }
            }
        }
    }
}
exports.References = References;
//# sourceMappingURL=references.js.map