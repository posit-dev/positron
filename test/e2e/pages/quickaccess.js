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
exports.QuickAccess = void 0;
const path_1 = require("path");
const test_1 = __importStar(require("@playwright/test"));
var QuickAccessKind;
(function (QuickAccessKind) {
    QuickAccessKind[QuickAccessKind["Files"] = 1] = "Files";
    QuickAccessKind[QuickAccessKind["Commands"] = 2] = "Commands";
    QuickAccessKind[QuickAccessKind["Symbols"] = 3] = "Symbols";
})(QuickAccessKind || (QuickAccessKind = {}));
class QuickAccess {
    code;
    editors;
    quickInput;
    constructor(code, editors, quickInput) {
        this.code = code;
        this.editors = editors;
        this.quickInput = quickInput;
    }
    async openDataFile(path) {
        if (!(0, path_1.isAbsolute)(path)) {
            // we require absolute paths to get a single
            // result back that is unique and avoid hitting
            // the search process to reduce chances of
            // search needing longer.
            throw new Error('quickAccess.openFile requires an absolute path');
        }
        // quick access shows files with the basename of the path
        await this.openFileQuickAccessAndWait(path, (0, path_1.basename)(path));
        // open first element
        await this.quickInput.selectQuickInputElement(0);
    }
    async openFileQuickAccessAndWait(searchValue, expectedFirstElementNameOrExpectedResultCount) {
        // Clear editor history to ensure Quick Access is not "polluted"
        await this.runCommand('workbench.action.clearEditorHistory');
        if (/(8080|8787)/.test(this.code.driver.currentPage.url())) {
            await this.code.driver.currentPage.getByRole('button', { name: 'Clear', exact: true }).click();
        }
        await (0, test_1.expect)(async () => {
            // Open Quick Access and wait for the elements to appear
            await this.openQuickAccessWithRetry(QuickAccessKind.Files, searchValue);
            await this.quickInput.waitForQuickInputElements((elementNames) => {
                this.code.logger.log('QuickAccess: resulting elements:', elementNames);
                if (elementNames.length === 0) {
                    this.code.logger.log('QuickAccess: No elements found, retrying...');
                    return false; // Retry polling
                }
                const firstElementName = elementNames[0];
                // Check if "No matching results" appears
                if (firstElementName === 'No matching results') {
                    this.code.logger.log(`QuickAccess: File search returned "No matching results", retrying...`);
                    return false; // Retry polling
                }
                // Handle expected result count
                if (typeof expectedFirstElementNameOrExpectedResultCount === 'number') {
                    if (elementNames.length === expectedFirstElementNameOrExpectedResultCount) {
                        return true; // Condition met
                    }
                    this.code.logger.log(`QuickAccess: Expected ${expectedFirstElementNameOrExpectedResultCount} results, got ${elementNames.length}, retrying...`);
                    return false;
                }
                // Handle expected first element name
                if (firstElementName === expectedFirstElementNameOrExpectedResultCount) {
                    return true; // Condition met
                }
                this.code.logger.log(`QuickAccess: Expected first result '${expectedFirstElementNameOrExpectedResultCount}', got '${firstElementName}', retrying...`);
                return false;
            });
        }).toPass({
            timeout: 15000,
        });
        this.code.logger.log('QuickAccess: File search succeeded.');
    }
    async openFile(path, waitForFocus = true) {
        if (!(0, path_1.isAbsolute)(path)) {
            // we require absolute paths to get a single
            // result back that is unique and avoid hitting
            // the search process to reduce chances of
            // search needing longer.
            throw new Error('QuickAccess.openFile requires an absolute path');
        }
        const fileName = (0, path_1.basename)(path);
        // quick access shows files with the basename of the path
        await this.openFileQuickAccessAndWait(path, (0, path_1.basename)(path));
        // open first element
        await this.quickInput.selectQuickInputElement(0);
        // wait for editor being focused
        if (waitForFocus) {
            await this.editors.waitForActiveTab(fileName);
            await this.editors.selectTab(fileName);
        }
    }
    async openQuickAccessWithRetry(kind, value) {
        // Other parts of code might steal focus away from quickinput :(
        await (0, test_1.expect)(async () => {
            // Open via keybinding
            switch (kind) {
                case QuickAccessKind.Files:
                    await this.code.driver.currentPage.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
                    break;
                case QuickAccessKind.Symbols:
                    await this.code.driver.currentPage.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+O' : 'Control+Shift+O');
                    break;
                case QuickAccessKind.Commands:
                    await this.code.driver.currentPage.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P');
                    break;
                default:
                    throw new Error(`Unsupported QuickAccessKind: ${kind}`);
            }
            // Await for quick input widget opened
            try {
                await this.quickInput.waitForQuickInputOpened({ timeout: 3000 });
            }
            catch (err) {
                await this.code.driver.currentPage.keyboard.press('Escape');
                throw err;
            }
        }).toPass({
            timeout: 15000,
            intervals: [1000]
        });
        // Type value if any
        if (value) {
            await this.quickInput.type(value);
        }
    }
    async runCommand(commandId, options) {
        const stepWrapper = (label, fn) => {
            try {
                // Check if running in a test context
                if (test_1.default.info().title) {
                    return test_1.default.step(label, fn); // Use test.step if inside a test
                }
            }
            catch (e) {
                // Catch errors if not in a test context
            }
            return fn(); // Run directly if not in a test
        };
        await stepWrapper(`Run command: ${commandId}`, async () => {
            const keepOpen = options?.keepOpen;
            const exactLabelMatch = options?.exactLabelMatch;
            const openCommandPalletteAndTypeCommand = async () => {
                await this.openQuickAccessWithRetry(QuickAccessKind.Commands, `>${commandId}`);
                const text = await this.quickInput.waitForQuickInputElementText();
                return !(text === 'No matching commands' || (exactLabelMatch && text !== commandId));
            };
            await (0, test_1.expect)(async () => {
                const hasCommandFound = await openCommandPalletteAndTypeCommand();
                if (!hasCommandFound) {
                    this.code.logger.log(`QuickAccess: No matching commands, retrying...`);
                    await this.quickInput.closeQuickInput();
                    throw new Error(`Command not found: ${commandId}`);
                }
            }, `Run Command: ${commandId}`).toPass({
                timeout: 15000,
                intervals: [1000],
            });
            this.code.logger.log(`QuickAccess: ${commandId}  ✓ success`);
            await this.quickInput.selectQuickInputElement(0, keepOpen);
        });
    }
    async openQuickOutline({ timeout = 30000 }) {
        await (0, test_1.expect)(async () => {
            // Open quick outline via keybinding
            await this.openQuickAccessWithRetry(QuickAccessKind.Symbols);
            // Get the quick input element text
            const text = await this.quickInput.waitForQuickInputElementText();
            // Log the status
            this.code.logger.log(`QuickAccess: Quick Outline returned text: "${text}"`);
            // Fail the retry if no symbols are found
            if (text === 'No symbol information for the file') {
                throw new Error('No symbol information for the file');
            }
        }).toPass({ timeout });
    }
}
exports.QuickAccess = QuickAccess;
//# sourceMappingURL=quickaccess.js.map