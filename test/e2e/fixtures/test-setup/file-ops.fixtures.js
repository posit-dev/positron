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
exports.FileOperationsFixture = FileOperationsFixture;
const playwright = __importStar(require("@playwright/test"));
const path = __importStar(require("path"));
const test_1 = require("@playwright/test");
/**
 * Create file operation helpers for opening files and folders
 */
function FileOperationsFixture(app) {
    return {
        openFile: async (filePath, waitForFocus = true) => {
            await test_1.test.step(`Open file: ${path.basename(filePath)}`, async () => {
                await app.workbench.quickaccess.openFile(path.join(app.workspacePathOrFolder, filePath), waitForFocus);
            });
        },
        openDataFile: async (filePath) => {
            await test_1.test.step(`Open data file: ${path.basename(filePath)}`, async () => {
                await app.workbench.quickaccess.openDataFile(path.join(app.workspacePathOrFolder, filePath));
            });
        },
        openFolder: async (folderPath) => {
            await test_1.test.step(`Open folder: ${folderPath}`, async () => {
                await app.workbench.hotKeys.openFolder();
                await playwright.expect(app.workbench.quickInput.quickInputList.locator('a').filter({ hasText: '..' })).toBeVisible();
                const folderNames = folderPath.split('/');
                for (const folderName of folderNames) {
                    const quickInputOption = app.workbench.quickInput.quickInputResult.getByText(folderName);
                    // Ensure we are ready to select the next folder
                    const timeoutMs = 30000;
                    const retryInterval = 2000;
                    const maxRetries = Math.ceil(timeoutMs / retryInterval);
                    for (let i = 0; i < maxRetries; i++) {
                        try {
                            await playwright.expect(quickInputOption).toBeVisible({ timeout: retryInterval });
                            // Success — exit loop
                            break;
                        }
                        catch (error) {
                            // Press PageDown if not found
                            await app.code.driver.currentPage.keyboard.press('PageDown');
                            // If last attempt, rethrow
                            if (i === maxRetries - 1) {
                                throw error;
                            }
                        }
                    }
                    await app.workbench.quickInput.quickInput.pressSequentially(folderName + '/');
                    // Ensure next folder is no longer visible
                    await playwright.expect(quickInputOption).not.toBeVisible();
                }
                await app.workbench.quickInput.clickOkButton();
            });
        }
    };
}
//# sourceMappingURL=file-ops.fixtures.js.map