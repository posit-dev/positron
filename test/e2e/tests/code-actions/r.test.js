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
const path_1 = __importStar(require("path"));
const _test_setup_1 = require("../_test.setup");
const test_1 = require("@playwright/test");
const assert_1 = require("assert");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('R Code Actions', { tag: [_test_setup_1.tags.EDITOR, _test_setup_1.tags.WIN, _test_setup_1.tags.WEB, _test_setup_1.tags.ARK] }, () => {
    _test_setup_1.test.afterEach(async function ({ app, hotKeys, cleanup }) {
        await hotKeys.closeAllEditors();
        await cleanup.discardAllChanges();
    });
    (0, _test_setup_1.test)('R - Can execute code in untitled file with Ctrl+Enter', {
        annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/11533' }]
    }, async ({ app, r, page }) => {
        const { editors, quickaccess, quickInput, console } = app.workbench;
        // Create a new untitled file
        await editors.newUntitledFile();
        // Change language mode to R
        await quickaccess.runCommand('workbench.action.editor.changeLanguageMode', { keepOpen: true });
        await quickInput.waitForQuickInputOpened();
        await quickInput.type('R');
        await quickInput.selectQuickInputElementContaining('R', { timeout: 5000 });
        await quickInput.waitForQuickInputClosed();
        // Type R code
        await app.workbench.editor.type('1 + 1');
        // Execute with Ctrl/Cmd+Enter
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
        // Verify the result appears in the console
        await console.waitForConsoleContents('[1] 2');
    });
    (0, _test_setup_1.test)("R - Can insert a Roxygen skeleton", async function ({ app, r, openFile }) {
        const fileName = 'supermarket-sales.r';
        await openFile((0, path_1.join)('workspaces/read-xlsx-r/', fileName));
        const termLocator = await app.workbench.editor.clickOnTerm(fileName, 'get_data_from_excel', 7, true);
        await termLocator.hover();
        await app.code.driver.currentPage.locator('.codicon-light-bulb').click();
        const generateTemplate = app.code.driver.currentPage.getByText('Generate a roxygen template');
        await (0, test_1.expect)(async () => {
            try {
                await generateTemplate.hover({ timeout: 2000 });
                await generateTemplate.click({ timeout: 2000 });
            }
            catch (e) {
                // workaround for click problem
                await app.code.driver.currentPage.mouse.move(0, 0);
                throw e;
            }
        }).toPass({ timeout: 30000 });
        const line7 = await app.workbench.editor.getLine(fileName, 7);
        (0, test_1.expect)(line7).toBe('#\' Title');
        const line12 = await app.workbench.editor.getLine(fileName, 12);
        (0, test_1.expect)(line12).toBe('#\' @examples');
    });
    (0, _test_setup_1.test)("R - Can fold code", async function ({ app, r, hotKeys }) {
        const fileName = 'folding.R';
        await _test_setup_1.test.step('Create test file', async () => {
            await app.workbench.quickaccess.runCommand('workbench.action.files.newUntitledFile', { keepOpen: false });
            await hotKeys.save();
            await app.workbench.quickInput.waitForQuickInputOpened();
            await app.workbench.quickInput.type(path_1.default.join(app.workspacePathOrFolder, fileName));
            await app.workbench.quickInput.clickOkButton();
            await app.workbench.quickInput.waitForQuickInputClosed();
            await app.workbench.editor.selectTabAndType(fileName, collapseText);
        });
        await _test_setup_1.test.step('Single hash collpase', async () => {
            // Scroll to top of file to ensure folding glyphs are rendered
            await app.code.driver.currentPage.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
            await app.code.driver.currentPage.locator('.codicon-folding-expanded').first().click();
            await (0, test_1.expect)(app.code.driver.currentPage.locator('.codicon-folding-collapsed')).toHaveCount(1);
            try {
                const line2 = await app.workbench.editor.getLine(fileName, 2);
                (0, assert_1.fail)(`Expected line 2 to be folded, but got: ${line2}`);
            }
            catch { } // expected error when line is folded
            await app.code.driver.currentPage.locator('.codicon-folding-collapsed').first().click();
            await (0, test_1.expect)(app.code.driver.currentPage.locator('.codicon-folding-expanded')).toHaveCount(4);
        });
        await _test_setup_1.test.step('Double hash collpase', async () => {
            await app.code.driver.currentPage.locator('.codicon-folding-expanded').nth(1).click();
            await (0, test_1.expect)(app.code.driver.currentPage.locator('.codicon-folding-collapsed')).toHaveCount(1);
            try {
                const line4 = await app.workbench.editor.getLine(fileName, 4);
                (0, assert_1.fail)(`Expected line 4 to be folded, but got: ${line4}`);
            }
            catch { } // expected error when line is folded
            const line9 = await app.workbench.editor.getLine(fileName, 9);
            (0, test_1.expect)(line9).toBe('## Section 1.2 ----');
            await app.code.driver.currentPage.locator('.codicon-folding-collapsed').first().click();
            await (0, test_1.expect)(app.code.driver.currentPage.locator('.codicon-folding-expanded')).toHaveCount(4);
        });
        await _test_setup_1.test.step('Triple hash collpase', async () => {
            await app.code.driver.currentPage.locator('.codicon-folding-expanded').nth(2).click();
            await (0, test_1.expect)(app.code.driver.currentPage.locator('.codicon-folding-collapsed')).toHaveCount(1);
            try {
                const line6 = await app.workbench.editor.getLine(fileName, 6);
                (0, assert_1.fail)(`Expected line 6 to be folded, but got: ${line6}`);
            }
            catch { } // expected error when line is folded
            await app.code.driver.currentPage.locator('.codicon-folding-collapsed').first().click();
            await (0, test_1.expect)(app.code.driver.currentPage.locator('.codicon-folding-expanded')).toHaveCount(4);
            const line7 = await app.workbench.editor.getLine(fileName, 7);
            (0, test_1.expect)(line7).toBe('#### Section 1.1.1.1 ----');
        });
    });
});
const collapseText = `# Section 1 ----

## Section 1.1 ----

### Section 1.1.1 ----

#### Section 1.1.1.1 ----

## Section 1.2 ----`;
//# sourceMappingURL=r.test.js.map