"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCM = void 0;
const test_1 = require("@playwright/test");
/*
 *  Reuseable Positron SCM functionality for tests to leverage.
 */
const VIEWLET = 'div[id="workbench.view.scm"]';
const SCM_INPUT_EDIT_CONTEXT = `${VIEWLET} .scm-editor .native-edit-context`;
const SCM_RESOURCE_CLICK = (name) => `${VIEWLET} .monaco-list-row .resource .monaco-icon-label[aria-label*="${name}"] .label-name`;
const SCM_RESOURCE_ACTION_CLICK = (name, actionName) => `.monaco-list-row .resource .monaco-icon-label[aria-label*="${name}"] .actions .action-label[aria-label="${actionName}"]`;
const COMMIT_COMMAND = `div[id="workbench.parts.sidebar"] .actions-container a.action-label[aria-label="Commit"]`;
const HISTORY_ITEM_CURRENT = '.scm-history-view .history-item-current .label-name';
class SCM {
    code;
    layout;
    constructor(code, layout) {
        this.code = code;
        this.layout = layout;
    }
    async openSCMViewlet() {
        await this.code.driver.currentPage.keyboard.press('Control+Shift+G');
        await (0, test_1.expect)(this.code.driver.currentPage.locator(SCM_INPUT_EDIT_CONTEXT)).toBeVisible();
    }
    async waitForChange(name, type) {
        await this.layout.enterLayout('fullSizedSidebar');
        const tooltip = type === 'Staged' ? 'Index Modified' : 'Modified';
        const locator = this.code.driver.currentPage
            .getByLabel('Source Control Management')
            .locator(`[data-tooltip="${tooltip}"] .file-icon`)
            .filter({ hasText: name });
        await (0, test_1.expect)(locator).toBeVisible();
        await this.layout.enterLayout('stacked');
    }
    async openChange(name) {
        await this.layout.enterLayout('fullSizedSidebar');
        await this.code.driver.currentPage.keyboard.press('Control+Shift+G'); // need to switch to scm view as it may have reset
        await this.code.driver.currentPage.locator(SCM_RESOURCE_CLICK(name)).last().click();
        await this.layout.enterLayout('stacked');
    }
    async stage(name) {
        await this.code.driver.currentPage.keyboard.press('Control+Shift+G'); // need to switch to scm view as it may have reset
        await this.code.driver.currentPage.locator(SCM_RESOURCE_ACTION_CLICK(name, 'Stage Changes')).click();
        await this.waitForChange(name, 'Staged');
    }
    async commit(message) {
        await this.code.driver.currentPage.keyboard.press('Control+Shift+G'); // need to switch to scm view as it may have reset
        await this.code.driver.currentPage.locator(SCM_INPUT_EDIT_CONTEXT).click({ force: true });
        await (0, test_1.expect)(this.code.driver.currentPage.locator(SCM_INPUT_EDIT_CONTEXT)).toBeFocused();
        await this.code.driver.currentPage.locator(SCM_INPUT_EDIT_CONTEXT).pressSequentially(message);
        await this.code.driver.currentPage.locator(COMMIT_COMMAND).click();
    }
    async verifyCurrentHistoryItem(name) {
        await (0, test_1.expect)(this.code.driver.currentPage.locator(HISTORY_ITEM_CURRENT)).toHaveText(name, { timeout: 20000 });
    }
}
exports.SCM = SCM;
//# sourceMappingURL=scm.js.map