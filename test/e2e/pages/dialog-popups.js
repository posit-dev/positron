"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Popups = void 0;
const test_1 = __importDefault(require("@playwright/test"));
class Popups {
    code;
    get popupBox() { return this.code.driver.currentPage.locator('.positron-modal-popup'); }
    getPopupItem(label) { return this.popupBox.locator('.positron-welcome-menu-item').getByText(label); }
    constructor(code) {
        this.code = code;
    }
    // --- Actions ---
    async clickItem(label) {
        await test_1.default.step(`Click item in popup dialog box: ${label}`, async () => {
            await this.getPopupItem(label).click();
        });
    }
}
exports.Popups = Popups;
//# sourceMappingURL=dialog-popups.js.map