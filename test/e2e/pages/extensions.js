"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.Extensions = void 0;
const test_1 = require("@playwright/test");
class Extensions {
    code;
    quickaccess;
    constructor(code, quickaccess) {
        this.code = code;
        this.quickaccess = quickaccess;
    }
    async searchForExtension(id) {
        await this.quickaccess.runCommand('Extensions: Focus on Extensions View', { exactLabelMatch: true });
        await this.code.driver.currentPage.locator('div.extensions-viewlet[id="workbench.view.extensions"] .monaco-editor .native-edit-context').pressSequentially(`@id:${id}`);
        await (0, test_1.expect)(this.code.driver.currentPage.locator(`div.part.sidebar div.composite.title h2`)).toHaveText('Extensions: Marketplace');
        let retrials = 1;
        while (retrials++ < 10) {
            try {
                const locator = this.code.driver.currentPage.locator(`div.extensions-viewlet[id="workbench.view.extensions"] .monaco-list-row[data-extension-id="${id}"]`);
                await (0, test_1.expect)(locator).toBeVisible();
                return;
            }
            catch (error) {
                this.code.logger.log(`Extension '${id}' is not found. Retrying count: ${retrials}`);
                await this.quickaccess.runCommand('workbench.extensions.action.refreshExtension');
            }
        }
        throw new Error(`Extension ${id} is not found`);
    }
    async closeExtension(title) {
        try {
            await this.code.driver.currentPage.locator(`.tabs-container div.tab[aria-label="Extension: ${title}, preview"] div.tab-actions a.action-label.codicon.codicon-close`).click();
        }
        catch (e) {
            this.code.logger.log(`Extension '${title}' not opened as preview. Trying without 'preview'.`);
            await this.code.driver.currentPage.locator(`.tabs-container div.tab[aria-label="Extension: ${title}"] div.tab-actions a.action-label.codicon.codicon-close`).click();
        }
    }
    async installExtension(id, waitUntilEnabled, attemptInstallOnly = false) {
        await this.searchForExtension(id);
        const locator = this.code.driver.currentPage.locator(`div.extensions-viewlet[id="workbench.view.extensions"] .monaco-list-row[data-extension-id="${id}"] .extension-list-item .monaco-action-bar .action-item:not(.disabled) .extension-action.install`).first();
        await (0, test_1.expect)(locator).toBeVisible();
        await locator.click();
        if (!attemptInstallOnly) {
            await (0, test_1.expect)(this.code.driver.currentPage.locator(`.extension-editor .monaco-action-bar .action-item:not(.disabled) .extension-action.uninstall`).first()).toBeVisible();
            if (waitUntilEnabled) {
                await (0, test_1.expect)(this.code.driver.currentPage.locator(`.extension-editor .monaco-action-bar .action-item:not(.disabled) a[aria-label="Disable this extension"]`)).toBeVisible();
            }
        }
    }
}
exports.Extensions = Extensions;
//# sourceMappingURL=extensions.js.map