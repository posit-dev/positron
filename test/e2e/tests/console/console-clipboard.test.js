"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
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
const os = __importStar(require("os"));
const _test_setup_1 = require("../_test.setup");
const test_1 = require("@playwright/test");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Console - Clipboard', { tag: [_test_setup_1.tags.CONSOLE, _test_setup_1.tags.WIN, _test_setup_1.tags.WEB] }, () => {
    (0, _test_setup_1.test)('Python - Verify copy from console & paste to console', async ({ app, python, page }) => {
        await testConsoleClipboard(app, 'a = 1', (new URL(page.url())).port);
    });
    (0, _test_setup_1.test)('Python - Verify copy from console & paste to console with context menu', { tag: [_test_setup_1.tags.WEB_ONLY] }, async ({ app, python, page }) => {
        await testConsoleClipboardWithContextMenu(app, '>>>', /Python .+ restarted\./, (new URL(page.url())).port);
    });
    (0, _test_setup_1.test)('R - Verify copy from console & paste to console ', {
        tag: [_test_setup_1.tags.ARK]
    }, async ({ app, r, page }) => {
        await testConsoleClipboard(app, 'a <- 1', (new URL(page.url())).port);
    });
    (0, _test_setup_1.test)('R - Verify copy from console & paste to console with context menu', { tag: [_test_setup_1.tags.WEB_ONLY, _test_setup_1.tags.ARK] }, async ({ app, r, page }) => {
        await testConsoleClipboardWithContextMenu(app, '>', /R .+ restarted\./, (new URL(page.url())).port);
    });
});
async function testConsoleClipboard(app, testLine, port) {
    if (app.web) {
        await app.code.driver.browserContext.grantPermissions(['clipboard-read'], { origin: `http://localhost:${port}` });
    }
    const console = app.workbench.console;
    const page = console.activeConsole.page();
    await toggleAuxiliaryBar(app);
    await initializeConsole(console);
    await executeCopyAndPaste(console, page, testLine);
    await verifyClipboardPaste(console, testLine);
    await toggleAuxiliaryBar(app);
}
async function testConsoleClipboardWithContextMenu(app, prompt, regex, port) {
    await app.workbench.console.clearButton.click();
    await app.workbench.console.restartButton.click();
    await app.workbench.console.waitForReady(prompt);
    if (app.web) {
        await app.code.driver.browserContext.grantPermissions(['clipboard-read'], { origin: `http://localhost:${port}` });
    }
    await (0, test_1.expect)(async () => {
        await app.workbench.terminal.handleContextMenu(app.workbench.console.activeConsole, 'Select All');
        // wait a little between selection and copy
        await app.code.wait(1000);
        await app.workbench.terminal.handleContextMenu(app.workbench.console.activeConsole, 'Copy');
        const clipboardText = await app.workbench.clipboard.getClipboardText();
        (0, test_1.expect)(clipboardText).toMatch(regex);
    }).toPass({ timeout: 30000 });
}
async function toggleAuxiliaryBar(app) {
    await _test_setup_1.test.step('Toggle auxiliary bar', async () => {
        await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
    });
}
async function initializeConsole(console) {
    await _test_setup_1.test.step('Initialize console', async () => {
        await console.sendEnterKey();
        await console.clearButton.click();
    });
}
async function executeCopyAndPaste(console, page, testLine) {
    const isMac = os.platform() === 'darwin';
    const modifier = isMac ? 'Meta' : 'Control';
    await _test_setup_1.test.step('Copy and paste', async () => {
        // Type the test line into the console
        await console.typeToConsole(testLine);
        // Copy the test line
        await page.keyboard.press(`${modifier}+A`);
        await page.keyboard.press(`${modifier}+C`);
        await console.sendEnterKey();
        await console.waitForConsoleExecution();
        // Ensure the test line is in the console's output
        await console.waitForConsoleContents(testLine);
        // Clear the console
        await console.clearButton.click();
        // Paste the copied line into the console
        await page.keyboard.press(`${modifier}+V`);
    });
}
async function verifyClipboardPaste(console, testLine) {
    await _test_setup_1.test.step('Verify clipboard paste ', async () => {
        // Verify the pasted line in the current input
        await console.waitForCurrentConsoleLineContents(testLine.replaceAll(' ', ' '));
        await console.sendEnterKey();
        await console.waitForConsoleExecution();
        // Ensure the console contains the test line after execution
        await console.waitForConsoleContents(testLine);
    });
}
//# sourceMappingURL=console-clipboard.test.js.map