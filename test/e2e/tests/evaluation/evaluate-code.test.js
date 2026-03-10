"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Evaluate Code', {
    tag: [_test_setup_1.tags.CRITICAL, _test_setup_1.tags.WEB]
}, () => {
    _test_setup_1.test.describe('R', {
        tag: [_test_setup_1.tags.ARK]
    }, () => {
        _test_setup_1.test.beforeEach(async function ({ app, r }) {
            await app.workbench.layouts.enterLayout('stacked');
        });
        _test_setup_1.test.afterEach(async function ({ app }) {
            await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');
        });
        (0, _test_setup_1.test)('evaluate R expression returns JSON result', async function ({ app, page }) {
            await _test_setup_1.test.step('Submit code for evaluation', async () => {
                await app.workbench.quickaccess.runCommand('workbench.action.evaluateCode', { keepOpen: true });
                await app.workbench.quickInput.waitForQuickInputOpened();
                await app.workbench.quickInput.type('list(a = 1, b = TRUE)');
                await page.keyboard.press('Enter');
            });
            await _test_setup_1.test.step('Verify editor content', async () => {
                const viewLines = page.locator('[id="workbench.parts.editor"] .view-lines');
                await (0, _test_setup_1.expect)(viewLines).toContainText('## Input', { timeout: 30000 });
                await (0, _test_setup_1.expect)(viewLines).toContainText('list(a = 1, b = TRUE)');
                await (0, _test_setup_1.expect)(viewLines).toContainText('## Result');
                await (0, _test_setup_1.expect)(viewLines).toContainText('"a"');
                await (0, _test_setup_1.expect)(viewLines).toContainText('"b"');
            });
        });
        (0, _test_setup_1.test)('evaluate R expression with output', async function ({ app, page }) {
            // isTRUE(cat('oatmeal')) prints 'oatmeal' and returns FALSE
            await _test_setup_1.test.step('Submit code for evaluation', async () => {
                await app.workbench.quickaccess.runCommand('workbench.action.evaluateCode', { keepOpen: true });
                await app.workbench.quickInput.waitForQuickInputOpened();
                await app.workbench.quickInput.type("isTRUE(cat('oatmeal'))");
                await page.keyboard.press('Enter');
            });
            await _test_setup_1.test.step('Verify editor content', async () => {
                const viewLines = page.locator('[id="workbench.parts.editor"] .view-lines');
                await (0, _test_setup_1.expect)(viewLines).toContainText('## Input', { timeout: 30000 });
                await (0, _test_setup_1.expect)(viewLines).toContainText("isTRUE(cat('oatmeal'))");
                await (0, _test_setup_1.expect)(viewLines).toContainText('## Result');
                await (0, _test_setup_1.expect)(viewLines).toContainText('false');
                await (0, _test_setup_1.expect)(viewLines).toContainText('## Output');
                await (0, _test_setup_1.expect)(viewLines).toContainText('oatmeal');
            });
        });
    });
    _test_setup_1.test.describe('Python', () => {
        _test_setup_1.test.beforeEach(async function ({ app, python }) {
            await app.workbench.layouts.enterLayout('stacked');
        });
        _test_setup_1.test.afterEach(async function ({ app }) {
            await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');
        });
        (0, _test_setup_1.test)('evaluate Python expression returns JSON result', async function ({ app, page }) {
            await _test_setup_1.test.step('Submit code for evaluation', async () => {
                await app.workbench.quickaccess.runCommand('workbench.action.evaluateCode', { keepOpen: true });
                await app.workbench.quickInput.waitForQuickInputOpened();
                await app.workbench.quickInput.type('{"a": 1, "b": True}');
                await page.keyboard.press('Enter');
            });
            await _test_setup_1.test.step('Verify editor content', async () => {
                const viewLines = page.locator('[id="workbench.parts.editor"] .view-lines');
                await (0, _test_setup_1.expect)(viewLines).toContainText('## Input', { timeout: 30000 });
                await (0, _test_setup_1.expect)(viewLines).toContainText('{"a": 1, "b": True}');
                await (0, _test_setup_1.expect)(viewLines).toContainText('## Result');
                await (0, _test_setup_1.expect)(viewLines).toContainText('"a"');
                await (0, _test_setup_1.expect)(viewLines).toContainText('"b"');
            });
        });
        (0, _test_setup_1.test)('evaluate Python expression with output', async function ({ app, page }) {
            // print('hello') or 42 prints 'hello' and returns 42
            await _test_setup_1.test.step('Submit code for evaluation', async () => {
                await app.workbench.quickaccess.runCommand('workbench.action.evaluateCode', { keepOpen: true });
                await app.workbench.quickInput.waitForQuickInputOpened();
                await app.workbench.quickInput.type("print('hello') or 42");
                await page.keyboard.press('Enter');
            });
            await _test_setup_1.test.step('Verify editor content', async () => {
                const viewLines = page.locator('[id="workbench.parts.editor"] .view-lines');
                await (0, _test_setup_1.expect)(viewLines).toContainText('## Input', { timeout: 30000 });
                await (0, _test_setup_1.expect)(viewLines).toContainText("print('hello') or 42");
                await (0, _test_setup_1.expect)(viewLines).toContainText('## Result');
                await (0, _test_setup_1.expect)(viewLines).toContainText('42');
                await (0, _test_setup_1.expect)(viewLines).toContainText('## Output');
                await (0, _test_setup_1.expect)(viewLines).toContainText('hello');
            });
        });
    });
});
//# sourceMappingURL=evaluate-code.test.js.map