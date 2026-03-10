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
exports.VsCodeNotebooks = void 0;
const notebooks_1 = require("./notebooks");
const test_1 = __importStar(require("@playwright/test"));
/**
 * Notebooks functionality exclusive to VS Code notebooks.
 */
class VsCodeNotebooks extends notebooks_1.Notebooks {
    startChatButton;
    constructor(code, quickinput, quickaccess, hotKeys) {
        super(code, quickinput, quickaccess, hotKeys);
        this.startChatButton = this.code.driver.currentPage.getByLabel(/Start Chat to Generate Code/).first();
    }
    /**
     * Verify: a VS Code notebook is visible on the page.
     */
    async expectToBeVisible(timeout = 25000) {
        await test_1.default.step('Verify VS Code notebook is visible', async () => {
            await (0, test_1.expect)(this.startChatButton).toBeVisible({ timeout });
        });
    }
}
exports.VsCodeNotebooks = VsCodeNotebooks;
//# sourceMappingURL=notebooksVscode.js.map