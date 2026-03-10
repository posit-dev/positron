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
exports.Modals = void 0;
const test_1 = __importStar(require("@playwright/test"));
class Modals {
    code;
    toasts;
    console;
    get modalBox() { return this.code.driver.currentPage.locator('.positron-modal-dialog-box'); }
    get modalTitle() { return this.modalBox.locator('.simple-title-bar-title'); }
    get modalMessage() { return this.code.driver.currentPage.locator('.dialog-box .message'); }
    get okButton() { return this.modalBox.getByRole('button', { name: 'OK' }); }
    get cancelButton() { return this.modalBox.getByRole('button', { name: 'Cancel' }); }
    getButton(label) { return this.modalBox.getByRole('button', { name: label }); }
    constructor(code, toasts, console) {
        this.code = code;
        this.toasts = toasts;
        this.console = console;
    }
    // --- Actions ---
    async clickOk() {
        await test_1.default.step('Click `OK` on modal dialog box', async () => {
            await this.okButton.click();
        });
    }
    async clickCancel() {
        await test_1.default.step('Click `Cancel` on modal dialog box', async () => {
            await this.cancelButton.click();
        });
    }
    async clickButton(label) {
        await test_1.default.step(`Click button in modal dialog box: ${label}`, async () => {
            await this.getButton(label).click();
        });
    }
    async installIPyKernel() {
        try {
            this.code.logger.log('Checking for modal dialog box');
            // fail fast if the modal is not present
            await this.expectToBeVisible(undefined, { timeout: 5000 });
            await this.clickButton('Install');
            this.code.logger.log('Installing ipykernel');
            await this.toasts.expectToastWithTitle();
            await this.toasts.expectNotToBeVisible();
            this.code.logger.log('Installed ipykernel');
            // after toast disappears console may not yet be refreshed (still on old interpreter)
            // TODO: make this smart later, perhaps by getting the console state from the API
            await this.code.wait(5000);
        }
        catch {
            this.code.logger.log('Did not find modal dialog box for ipykernel install');
        }
    }
    /**
     * Interacts with the Renv install modal dialog box. This dialog box appears when a user opts to
     * use Renv in the New Folder Flow and creates a new folder, but Renv is not installed.
     * @param action The action to take on the modal dialog box. Either 'install' or 'cancel'.
     */
    async installRenvModal(action) {
        try {
            await (0, test_1.expect)(this.code.driver.currentPage.locator('.simple-title-bar').filter({ hasText: 'Missing R package' })).toBeVisible({ timeout: 40000 });
            if (action === 'install') {
                this.code.logger.log('Install Renv modal detected: clicking `Install now`');
                await this.getButton('Install now').click();
            }
            else if (action === 'cancel') {
                this.code.logger.log('Install Renv modal detected: clicking `Cancel`');
                await this.getButton('Cancel').click();
            }
        }
        catch (error) {
            this.code.logger.log('No Renv modal detected; interacting with console directly');
            await this.console.typeToConsole('y');
            await this.console.sendEnterKey();
        }
    }
    // --- Verifications ---
    async expectMessageToContain(text) {
        await test_1.default.step(`Verify modal dialog box contains text: ${text}`, async () => {
            await (0, test_1.expect)(this.modalMessage).toContainText(text);
        });
    }
    async expectToBeVisible(title, { timeout = 30000, visible = true } = {}) {
        await test_1.default.step(`Verify modal dialog box is ${visible ? 'visible' : 'not visible'}${title ? ` : ${title}` : ''}`, async () => {
            if (visible) {
                await (0, test_1.expect)(this.modalBox).toBeVisible({ timeout });
                if (title) {
                    await (0, test_1.expect)(this.modalTitle).toHaveText(title, { timeout });
                }
            }
            else {
                await (0, test_1.expect)(this.modalBox).not.toBeVisible({ timeout });
            }
        });
    }
    async expectButtonToBeVisible(buttonLabel) {
        await test_1.default.step(`Verify button is visible: ${buttonLabel}`, async () => {
            await (0, test_1.expect)(this.modalBox.getByRole('button', { name: buttonLabel })).toBeVisible();
        });
    }
    async expectToContainText(text) {
        await test_1.default.step(`Verify modal dialog box has text: ${text}`, async () => {
            await (0, test_1.expect)(this.modalBox).toContainText(text);
        });
    }
}
exports.Modals = Modals;
//# sourceMappingURL=dialog-modals.js.map