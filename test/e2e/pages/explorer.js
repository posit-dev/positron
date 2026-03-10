"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.Explorer = void 0;
const test_1 = require("@playwright/test");
const POSITRON_EXPLORER_TITLE = 'div[id="workbench.view.explorer"] h3.title';
/*
 *  Reuseable Positron explorer functionality for tests to leverage.
 */
class Explorer {
    code;
    get explorerTitle() { return this.code.driver.currentPage.locator(POSITRON_EXPLORER_TITLE); }
    get explorerTitleLocator() { return this.code.driver.currentPage.locator(POSITRON_EXPLORER_TITLE); }
    constructor(code) {
        this.code = code;
    }
    async verifyExplorerFilesExist(files) {
        const explorerFiles = this.code.driver.currentPage.locator('.monaco-list > .monaco-scrollable-element');
        for (let i = 0; i < files.length; i++) {
            const timeout = i === 0 ? 50000 : undefined; // 50s for the first check, default for the rest as sometimes waiting for the folder to load
            await (0, test_1.expect)(explorerFiles.getByLabel(files[i], { exact: true }).locator('a')).toBeVisible({ timeout });
        }
    }
}
exports.Explorer = Explorer;
//# sourceMappingURL=explorer.js.map