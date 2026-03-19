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
exports.QuickInput = void 0;
const test_1 = __importStar(require("@playwright/test"));
const QUICK_INPUT_LIST = ".quick-input-widget .quick-input-list";
class QuickInput {
    code;
    static QUICK_INPUT = ".quick-input-widget";
    static QUICK_INPUT_INPUT = `${QuickInput.QUICK_INPUT} .quick-input-box input`;
    static QUICK_INPUT_RESULT = `${QuickInput.QUICK_INPUT} .quick-input-list .monaco-list-row`;
    // Note: this only grabs the label and not the description or detail
    static QUICK_INPUT_ENTRY_LABEL = `${this.QUICK_INPUT_RESULT} .quick-input-list-row > .monaco-icon-label .label-name`;
    static QUICKINPUT_OK_BUTTON = '.quick-input-widget .quick-input-action a:has-text("OK")';
    quickInputList;
    quickInput;
    quickInputTitleBar;
    quickInputResult;
    constructor(code) {
        this.code = code;
        this.quickInputList = this.code.driver.currentPage.locator(QUICK_INPUT_LIST);
        this.quickInput = this.code.driver.currentPage.locator(QuickInput.QUICK_INPUT_INPUT);
        this.quickInputTitleBar =
            this.code.driver.currentPage.locator(`.quick-input-title`);
        this.quickInputResult = this.code.driver.currentPage.locator(QuickInput.QUICK_INPUT_RESULT);
    }
    async expectTitleBarToHaveText(text) {
        await (0, test_1.expect)(this.quickInputTitleBar).toHaveText(text);
    }
    async expectQuickInputResultsToContain(titles) {
        await test_1.default.step("Verify Quick Input results contain expected title", async () => {
            for (let i = 0; i < titles.length; i++) {
                await (0, test_1.expect)(this.quickInputResult.filter({ hasText: titles[i] })).toBeVisible();
            }
        });
    }
    async waitForQuickInputOpened({ timeout = 3000, } = {}) {
        await (0, test_1.expect)(this.code.driver.currentPage.locator(QuickInput.QUICK_INPUT_INPUT)).toBeVisible({ timeout });
    }
    async type(value) {
        await this.code.driver.currentPage
            .locator(QuickInput.QUICK_INPUT_INPUT)
            .selectText();
        await this.code.driver.currentPage.keyboard.press("Backspace");
        await this.code.driver.currentPage
            .locator(QuickInput.QUICK_INPUT_INPUT)
            .fill(value);
    }
    async waitForQuickInputElementText() {
        const quickInputResult = this.code.driver.currentPage.locator(QuickInput.QUICK_INPUT_RESULT);
        // Wait for at least one matching element with non-empty text
        await (0, test_1.expect)(async () => {
            const texts = await quickInputResult.allTextContents();
            return texts.some((text) => text.trim() !== "");
        }).toPass();
        // Retrieve the text content of the first matching element
        const text = await quickInputResult.first().textContent();
        return text?.trim() || "";
    }
    async closeQuickInput() {
        await this.code.driver.currentPage.keyboard.press("Escape");
        await this.waitForQuickInputClosed();
    }
    async waitForQuickInputElements(accept) {
        const locator = this.code.driver.currentPage.locator(QuickInput.QUICK_INPUT_ENTRY_LABEL);
        await (0, test_1.expect)(async () => {
            const names = await locator.allTextContents();
            return accept(names);
        }).toPass();
    }
    async waitForQuickInputClosed() {
        await (0, test_1.expect)(this.code.driver.currentPage.locator(QuickInput.QUICK_INPUT_INPUT)).not.toBeVisible({ timeout: 5000 });
    }
    async selectQuickInputElement(index, keepOpen) {
        await this.waitForQuickInputOpened();
        await this.code.driver.currentPage
            .locator(QuickInput.QUICK_INPUT_RESULT)
            .nth(index)
            .click();
        if (!keepOpen) {
            await this.waitForQuickInputClosed();
        }
    }
    async selectQuickInputElementContaining(text, { timeout, force = true } = {}) {
        const firstMatch = this.code.driver.currentPage
            .locator(`${QuickInput.QUICK_INPUT_RESULT}[aria-label*="${text}"]`)
            .first();
        const firstMatchResult = (await firstMatch
            .locator(".quick-input-list-row")
            .nth(0)
            .textContent({ timeout })) || "";
        await firstMatch.click({ force, timeout });
        await this.code.driver.currentPage.mouse.move(0, 0);
        return firstMatchResult.trim();
    }
    async clickOkButton() {
        await this.code.driver.currentPage
            .locator(QuickInput.QUICKINPUT_OK_BUTTON)
            .click();
    }
}
exports.QuickInput = QuickInput;
//# sourceMappingURL=quickInput.js.map