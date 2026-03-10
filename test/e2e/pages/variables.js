"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Variables = void 0;
const test_1 = __importStar(require("@playwright/test"));
const VARIABLE_ITEMS = '.variable-item:not(.disabled)';
const VARIABLE_NAMES = 'name-column';
const VARIABLE_DETAILS = 'details-column';
const CURRENT_VARIABLES_GROUP = '.variables-instance[style*="z-index: 1"]';
const VARIABLES_NAME_COLUMN = `${CURRENT_VARIABLES_GROUP} .variable-item .name-column`;
const VARIABLES_INTERPRETER = '.positron-variables-container .action-bar-button-label';
const VARIABLE_CHEVRON_ICON = '.gutter .expand-collapse-icon';
const VARIABLE_INDENTED = '.name-column-indenter[style*="margin-left: 40px"]';
const VARIABLES_GROUP_SELECTOR = '.positron-variables-container .action-bar-button-label';
const VARIABLES_FILTER_SELECTOR = '.positron-variables-container .action-bar-filter-input .text-input';
/*
 *  Reuseable Positron variables functionality for tests to leverage.
 */
class Variables {
    code;
    hotKeys;
    contextMenu;
    get interpreterLocator() { return this.code.driver.currentPage.locator(VARIABLES_INTERPRETER); }
    variablesPane;
    variablesRuntime;
    memoryMeter;
    memoryDropdown;
    memorySizeLabel;
    constructor(code, hotKeys, contextMenu) {
        this.code = code;
        this.hotKeys = hotKeys;
        this.contextMenu = contextMenu;
        this.variablesPane = this.code.driver.currentPage.locator('[id="workbench.panel.positronSession"]');
        this.variablesRuntime = (name) => this.variablesPane.getByRole('button', { name });
        this.memoryMeter = this.code.driver.currentPage.locator('.memory-usage-meter');
        this.memoryDropdown = this.code.driver.currentPage.locator('.memory-usage-dropdown');
        this.memorySizeLabel = this.code.driver.currentPage.locator('.memory-size-label');
    }
    async getFlatVariables() {
        const variables = new Map();
        await (0, test_1.expect)(this.code.driver.currentPage.locator(`${CURRENT_VARIABLES_GROUP} ${VARIABLE_ITEMS}`).first()).toBeVisible();
        const variableItems = await this.code.driver.currentPage.locator(`${CURRENT_VARIABLES_GROUP} ${VARIABLE_ITEMS}`).all();
        for (const item of variableItems) {
            const nameElement = item.locator(`.${VARIABLE_NAMES}`).first();
            const detailsElement = item.locator(`.${VARIABLE_DETAILS}`).first();
            const name = await nameElement.textContent();
            const value = detailsElement
                ? await detailsElement.locator(':scope > *').nth(0).textContent()
                : null;
            const type = detailsElement
                ? await detailsElement.locator(':scope > *').nth(1).textContent()
                : null;
            if (!name || !value || !type) {
                throw new Error('Could not parse variable item');
            }
            variables.set(name.trim(), { value: value.trim(), type: type.trim() });
        }
        return variables;
    }
    async focusVariablesView() {
        await this.code.driver.currentPage.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
        await this.code.driver.currentPage.keyboard.press('V');
    }
    async waitForVariableRow(variableName) {
        const desiredRow = this.code.driver.currentPage.locator(VARIABLES_NAME_COLUMN).filter({ hasText: variableName });
        await (0, test_1.expect)(desiredRow).toBeVisible();
        return desiredRow;
    }
    async doubleClickVariableRow(variableName) {
        await test_1.default.step(`Double click variable: ${variableName}`, async () => {
            await this.hotKeys.showSecondarySidebar();
            const desiredRow = this.code.driver.currentPage.locator(VARIABLES_NAME_COLUMN).filter({ hasText: variableName });
            await desiredRow.dblclick();
        });
    }
    async hasProgressBar() {
        const progressBar = this.code.driver.currentPage.locator('.variables-core .monaco-progress-container');
        return await progressBar.isVisible();
    }
    async toggleVariable({ variableName, action }) {
        await test_1.default.step(`${action} variable: ${variableName}`, async () => {
            await this.waitForVariableRow(variableName);
            const variable = this.code.driver.currentPage.locator(`${CURRENT_VARIABLES_GROUP} .name-value`, { hasText: variableName });
            const chevronIcon = variable.locator('..').locator(VARIABLE_CHEVRON_ICON);
            const isExpanded = await chevronIcon.evaluate((el) => el.classList.contains('codicon-chevron-down'));
            // perform action based on the 'action' parameter
            if (action === 'expand' && !isExpanded) {
                await chevronIcon.click();
            }
            else if (action === 'collapse' && isExpanded) {
                await chevronIcon.click();
            }
            const expectedClass = action === 'expand'
                ? /codicon-chevron-down/
                : /codicon-chevron-right/;
            await (0, test_1.expect)(chevronIcon).toHaveClass(expectedClass);
        });
    }
    async expandVariable(variableName) {
        await this.toggleVariable({ variableName, action: 'expand' });
    }
    async collapseVariable(variableName) {
        await this.toggleVariable({ variableName, action: 'collapse' });
    }
    /**
     * Gets the data (value and type) for the children of a parent variable.
     * NOTE: it assumes that either ALL variables are collapsed or ONLY the parent variable is expanded.
     *
     * @param parentVariable the parent variable to get the children of
     * @param collapseParent whether to collapse the parent variable after getting the children data
     * @returns a map of the children's name, value, and type
     */
    async getVariableChildren(parentVariable, collapseParent = true) {
        await this.expandVariable(parentVariable);
        const variable = this.code.driver.currentPage.locator(`${CURRENT_VARIABLES_GROUP} .name-value:text-is("${parentVariable}")`);
        // get the children of the parent variable, which are indented
        const children = await variable.locator('..').locator('..').locator('..').locator('..').locator(VARIABLE_ITEMS)
            .filter({ has: this.code.driver.currentPage.locator(VARIABLE_INDENTED) }).all();
        // create a map of the children's name, value, and type
        const result = {};
        for (const child of children) {
            const childName = await child.locator('.name-value').textContent() || '';
            const childValue = await child.locator('.details-column .value').textContent() || '';
            const childType = await child.locator('.details-column .right-column').textContent() || '';
            if (childName) {
                result[childName] = { value: childValue, type: childType };
            }
        }
        // collapse the parent variable if the flag is set
        if (collapseParent) {
            await this.collapseVariable(parentVariable);
        }
        return result;
    }
    async getCurrentVariablesGroup() {
        const group = await this.code.driver.currentPage.locator(VARIABLES_GROUP_SELECTOR).innerText();
        return group;
    }
    /**
     * Select a session in the variables pane.
     * @param name the name of the session to select
     */
    async selectSession(name) {
        await this.contextMenu.triggerAndClick({
            menuTrigger: this.code.driver.currentPage.locator('.positron-variables .positron-action-bar').first().locator('button'),
            menuItemLabel: name,
        });
    }
    async selectVariablesGroup(name) {
        await this.code.driver.currentPage.locator(VARIABLES_GROUP_SELECTOR).click();
        await this.code.driver.currentPage.locator('a.action-menu-item', { hasText: name }).first().isVisible();
        await this.code.wait(500);
        await this.code.driver.currentPage.locator('a.action-menu-item', { hasText: name }).first().click();
    }
    async getVariablesGroupList() {
        await this.code.driver.currentPage.locator(VARIABLES_GROUP_SELECTOR).click();
        const groupList = await this.code.driver.currentPage.locator('a.action-menu-item').all();
        const groupNames = await Promise.all(groupList.map(async (group) => group.innerText()));
        return groupNames;
    }
    async setFilterText(filterText) {
        await this.code.driver.currentPage.locator(VARIABLES_FILTER_SELECTOR).fill(filterText);
    }
    async clickDatabaseIconForVariableRow(rowName) {
        const DATABASE_ICON = '.codicon-database';
        await this.code.driver.currentPage.locator(`${CURRENT_VARIABLES_GROUP} ${VARIABLE_ITEMS}`).filter({ hasText: rowName }).locator(DATABASE_ICON).click();
    }
    async clickSessionLink() {
        await this.code.driver.currentPage.getByLabel('Active View Switcher').getByText('Session').click();
    }
    async clickDeleteAllVariables() {
        await this.code.driver.currentPage.getByLabel('Delete all objects').click();
    }
    /**
     * Verify: Confirm the runtime is visible in the variables pane.
     * @param language the language of the runtime: Python or R
     * @param version the version of the runtime: e.g. 3.10.15
     */
    async expectRuntimeToBe(expectation, sessionName) {
        await test_1.default.step(`Verify runtime is ${expectation}: ${sessionName}`, async () => {
            await this.hotKeys.showSecondarySidebar();
            expectation === 'visible'
                ? await (0, test_1.expect)(this.variablesRuntime(sessionName)).toBeVisible()
                : await (0, test_1.expect)(this.variablesRuntime(sessionName)).not.toBeVisible();
        });
    }
    /**
     * Verify: Confirm the variable is visible and has the expected value.
     * @param variableName the name of the variable to check
     * @param value the expected value of the variable
     * @param timeout (optional) timeout in milliseconds for visibility (default 15000)
     */
    async expectVariableToBe(variableName, value, timeout = 15000) {
        await test_1.default.step(`Verify variable: ${variableName} with value: ${value}`, async () => {
            await this.focusVariablesView();
            const variableRow = this.code.driver.currentPage
                .locator('.variables-instance[style*="z-index: 1"]')
                .locator('.name-column')
                .filter({ hasText: variableName })
                .locator('..');
            await (0, test_1.expect)(variableRow).toBeVisible({ timeout });
            await (0, test_1.expect)(variableRow.locator('.details-column .value')).toHaveText(value, { timeout: 3000 });
        });
    }
    async expectVariableToNotExist(variableName) {
        await test_1.default.step(`Verify variable does not exist: ${variableName}`, async () => {
            await this.focusVariablesView();
            const row = this.code.driver.currentPage
                .locator('.variables-instance[style*="z-index: 1"] .variable-item')
                .filter({ hasText: variableName });
            await (0, test_1.expect)(row).toHaveCount(0);
        });
    }
    /**
     * Verify: Confirm the session is selected in the variables pane.
     * @param sessionName the name of the session to check is selected
     */
    async expectSessionToBe(sessionName) {
        await test_1.default.step(`Verify session is selected in variables pane: ${sessionName}`, async () => {
            await (0, test_1.expect)(this.interpreterLocator).toBeVisible();
            await (0, test_1.expect)(this.interpreterLocator).toHaveText(sessionName);
        });
    }
    /**
     * Wait for the memory meter to be visible and showing a real value (not loading state).
     * Focuses the variables view first to ensure the meter is visible.
     */
    async expectMemoryMeterReady() {
        await this.focusVariablesView();
        await (0, test_1.expect)(this.memoryMeter).toBeVisible({ timeout: 30000 });
        await (0, test_1.expect)(this.memorySizeLabel).not.toHaveText('Mem', { timeout: 30000 });
    }
    /**
     * Open the memory usage dropdown by clicking the memory meter.
     * Does nothing if already open.
     */
    async openMemoryDropdown() {
        if (!await this.memoryDropdown.isVisible()) {
            await this.memoryMeter.click();
            await (0, test_1.expect)(this.memoryDropdown).toBeVisible({ timeout: 15000 });
        }
    }
    /**
     * Close the memory usage dropdown by pressing Escape.
     */
    async closeMemoryDropdown() {
        await this.code.driver.currentPage.keyboard.press('Escape');
        await (0, test_1.expect)(this.memoryDropdown).not.toBeVisible();
    }
    /**
     * Verify sessions appear (or do not appear) in the memory usage dropdown.
     * Opens the dropdown if not already visible, checks all sessions, then closes it.
     * @param sessions record mapping session names to expected visibility
     */
    async expectSessionsInMemoryDropdown(sessions) {
        await this.openMemoryDropdown();
        for (const [sessionName, visible] of Object.entries(sessions)) {
            const sessionLocator = this.memoryDropdown.locator('.usage-name').filter({ hasText: sessionName });
            if (visible) {
                await (0, test_1.expect)(sessionLocator).toBeVisible({ timeout: 15000 });
            }
            else {
                await (0, test_1.expect)(sessionLocator).not.toBeVisible({ timeout: 15000 });
            }
        }
        await this.closeMemoryDropdown();
    }
}
exports.Variables = Variables;
//# sourceMappingURL=variables.js.map