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
exports.Editors = void 0;
const test_1 = __importStar(require("@playwright/test"));
class Editors {
    code;
    get activeEditor() { return this.code.driver.currentPage.locator('div.tab.tab-actions-right.active.selected'); }
    get editorIcon() { return this.code.driver.currentPage.locator('.monaco-icon-label.file-icon'); }
    get editorPart() { return this.code.driver.currentPage.locator('.split-view-view .part.editor'); }
    get suggestionList() { return this.code.driver.currentPage.locator('.suggest-widget .monaco-list-row'); }
    constructor(code) {
        this.code = code;
    }
    async clickTab(tabName) {
        await test_1.default.step(`Click tab: ${tabName}`, async () => {
            const tabLocator = this.code.driver.currentPage.getByRole('tab', { name: tabName });
            await (0, test_1.expect)(tabLocator).toBeVisible();
            await tabLocator.click();
        });
    }
    async verifyTab(tabName, { isVisible = true, isSelected = true }) {
        await test_1.default.step(`Verify tab: ${tabName} is ${isVisible ? '' : 'not'} visible, is ${isSelected ? '' : 'not'} selected`, async () => {
            const tabLocator = this.code.driver.currentPage.getByRole('tab', { name: tabName });
            await (isVisible
                ? (0, test_1.expect)(tabLocator).toBeVisible()
                : (0, test_1.expect)(tabLocator).not.toBeVisible());
            await (isSelected
                ? (0, test_1.expect)(tabLocator).toHaveClass(/selected/)
                : (0, test_1.expect)(tabLocator).not.toHaveClass(/selected/));
        });
    }
    escapeRegex(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    async waitForActiveTab(fileName, isDirty = false) {
        const { currentPage } = this.code.driver;
        const base = `.tabs-container div.tab.active${isDirty ? '.dirty' : ''}[aria-selected="true"]`;
        const active = currentPage.locator(base);
        // Ensure we’re looking at exactly one active tab
        await (0, test_1.expect)(active).toHaveCount(1);
        await (0, test_1.expect)(active).toBeVisible();
        const attrMatcher = fileName instanceof RegExp ? fileName : new RegExp(`${this.escapeRegex(fileName)}$`);
        await (0, test_1.expect)(active).toHaveAttribute('data-resource-name', attrMatcher);
    }
    async waitForActiveTabNotDirty(fileName) {
        await (0, test_1.expect)(this.code.driver.currentPage.locator(`.tabs-container div.tab.active:not(.dirty)[aria-selected="true"][data-resource-name$="${fileName}"]`)).toBeVisible();
    }
    async newUntitledFile() {
        if (process.platform === 'darwin') {
            await this.code.driver.currentPage.keyboard.press('Meta+N');
        }
        else {
            await this.code.driver.currentPage.keyboard.press('Control+N');
        }
        await this.waitForEditorFocus('Untitled-1');
    }
    async waitForEditorFocus(fileName) {
        await this.waitForActiveTab(fileName, undefined);
        await this.waitForActiveEditor(fileName);
    }
    async waitForActiveEditor(fileName) {
        const selector = `.editor-instance .monaco-editor[data-uri$="${fileName}"] .native-edit-context`;
        await (0, test_1.expect)(this.code.driver.currentPage.locator(selector)).toBeFocused();
    }
    async selectTab(fileName) {
        // Selecting a tab and making an editor have keyboard focus
        // is critical to almost every test. As such, we try our
        // best to retry this task in case some other component steals
        // focus away from the editor while we attempt to get focus
        await (0, test_1.expect)(async () => {
            await this.code.driver.currentPage.locator(`.tabs-container div.tab[data-resource-name$="${fileName}"]`).click();
            await this.code.driver.currentPage.keyboard.press(process.platform === 'darwin' ? 'Meta+1' : 'Control+1'); // make editor really active if click failed somehow
            await this.waitForEditorFocus(fileName);
        }).toPass();
    }
    async waitForTab(fileName, isDirty = false) {
        const { currentPage } = this.code.driver;
        const base = `.tabs-container div.tab${isDirty ? '.dirty' : ''}`;
        if (fileName instanceof RegExp) {
            // Find the *exact* data-resource-name of the first tab whose value matches the regex
            const matchedName = await currentPage.locator(`${base}[data-resource-name]`).evaluateAll((els, pattern) => {
                const rx = new RegExp(pattern.source, pattern.flags);
                for (const el of els) {
                    const v = el.getAttribute('data-resource-name') || '';
                    if (rx.test(v)) {
                        return v;
                    }
                }
                return null;
            }, { source: fileName.source, flags: fileName.flags });
            if (!matchedName) {
                throw new Error(`No tab found with data-resource-name matching ${fileName}`);
            }
            await (0, test_1.expect)(currentPage.locator(`${base}[data-resource-name="${matchedName}"]`)).toBeVisible();
        }
        else {
            // Original ends-with behavior for plain strings
            await (0, test_1.expect)(currentPage.locator(`${base}[data-resource-name$="${fileName}"]`)).toBeVisible();
        }
    }
    async waitForSCMTab(fileName) {
        await (0, test_1.expect)(this.code.driver.currentPage.locator(`.tabs-container div.tab[aria-label^="${fileName}"]`)).toBeVisible();
    }
    async saveOpenedFile() {
        if (process.platform === 'darwin') {
            await this.code.driver.currentPage.keyboard.press('Meta+S');
        }
        else {
            await this.code.driver.currentPage.keyboard.press('Control+S');
        }
    }
    async expectSuggestionListCount(count) {
        await test_1.default.step(`Expect editor suggestion list to have ${count} items`, async () => {
            await (0, test_1.expect)(this.suggestionList).toHaveCount(count);
        });
    }
    /**
     * Verify: editor contains the specified text
     * @param text The text to check in the editor
     */
    async expectEditorToContain(text) {
        await test_1.default.step(`Verify editor contains: ${text}`, async () => {
            await (0, test_1.expect)(this.code.driver.currentPage.locator('[id="workbench.parts.editor"]').getByRole('code').getByText(text)).toBeVisible();
        });
    }
    async expectActiveEditorIconClassToMatch(iconClass) {
        await test_1.default.step(`Expect active editor icon to match: ${iconClass}`, async () => {
            await (0, test_1.expect)(this.activeEditor.locator(this.editorIcon)).toHaveClass(iconClass);
        });
    }
}
exports.Editors = Editors;
//# sourceMappingURL=editors.js.map