"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
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
exports.Toasts = void 0;
const test_1 = __importStar(require("@playwright/test"));
class Toasts {
    code;
    get toastNotification() { return this.code.driver.currentPage.locator('.notification-toast'); }
    get closeButton() { return this.toastNotification.locator('.codicon-notifications-clear'); }
    getOptionButton(button) { return this.toastNotification.getByRole('button', { name: button }); }
    constructor(code) {
        this.code = code;
    }
    // --- Actions ---
    async waitForAppear(title, { timeout = 20000 } = {}) {
        title
            ? await this.toastNotification.getByText(title).waitFor({ state: 'attached', timeout })
            : await this.toastNotification.waitFor({ state: 'attached', timeout });
    }
    async waitForDisappear(title, { timeout = 20000 } = {}) {
        title
            ? await this.toastNotification.getByText(title).waitFor({ state: 'detached', timeout })
            : await this.toastNotification.waitFor({ state: 'detached', timeout });
    }
    async clickButton(button) {
        await test_1.default.step(`Click toast button: ${button}`, async () => {
            await this.getOptionButton(button).click();
        });
    }
    async closeAll() {
        const count = await this.toastNotification.count();
        for (let i = 0; i < count; i++) {
            try {
                await this.toastNotification.nth(i).hover({ timeout: 5000 });
                await this.closeButton.nth(i).click({ timeout: 5000 });
            }
            catch {
                this.code.logger.log(`Toast ${i} already closed`);
            }
        }
    }
    async closeWithText(message) {
        try {
            const toast = this.toastNotification.filter({ hasText: message });
            await toast.hover();
            await this.closeButton.filter({ hasText: message }).click();
        }
        catch {
            this.code.logger.log('Toast "${message}" not found');
        }
    }
    async closeWithHeader(header) {
        const toast = this.toastNotification.filter({ hasText: header });
        await toast.hover();
        await toast.locator('.codicon-notifications-clear').click();
    }
    // --- Verifications ---
    async expectToastWithTitle(title, timeoutMs = 3000) {
        await test_1.default.step(`Verify toast ${title ? `visible: ${title}` : 'visible'}`, async () => {
            if (title) {
                await (0, test_1.expect)(this.toastNotification.filter({ hasText: title })).toBeVisible({ timeout: timeoutMs });
            }
            else {
                await (0, test_1.expect)(this.toastNotification).toBeVisible({ timeout: timeoutMs });
            }
        });
    }
    async expectToastWithTitleNotToAppear(title, timeoutMs = 5000) {
        await test_1.default.step(`Verify toast not visible: ${title}`, async () => {
            await (0, test_1.expect)(this.toastNotification.filter({ hasText: title })).not.toBeVisible({ timeout: timeoutMs });
        });
    }
    async expectImportSettingsToastToBeVisible(visible = true) {
        await test_1.default.step(`Verify import settings toast is ${visible ? '' : 'NOT'} visible`, async () => {
            const buttons = [
                this.toastNotification.getByRole('button', { name: 'Compare settings' }),
                this.toastNotification.getByRole('button', { name: 'Later' }),
                this.toastNotification.getByRole('button', { name: "Don't Show Again" }),
            ];
            for (const btn of buttons) {
                visible ? await (0, test_1.expect)(btn).toBeVisible() : await (0, test_1.expect)(btn).not.toBeVisible();
            }
        });
    }
    async expectNotToBeVisible(timeoutMs = 3000) {
        const end = Date.now() + timeoutMs;
        while (Date.now() < end) {
            if (await this.toastNotification.count() > 0) {
                throw new Error('Toast appeared unexpectedly');
            }
            await this.code.driver.currentPage.waitForTimeout(1000);
        }
    }
    async awaitToastDisappearance(timeoutMs = 3000) {
        await (0, test_1.expect)(this.toastNotification).toHaveCount(0, { timeout: timeoutMs });
    }
}
exports.Toasts = Toasts;
//# sourceMappingURL=dialog-toasts.js.map