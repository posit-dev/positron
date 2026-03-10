"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = require("path");
const _test_setup_js_1 = require("../_test.setup.js");
const test_1 = require("@playwright/test");
const R_FILE = 'basic-outline-with-vars.r';
const PY_FILE = 'basic-outline-with-vars.py';
_test_setup_js_1.test.use({
    suiteId: __filename
});
_test_setup_js_1.test.describe('Outline', { tag: [_test_setup_js_1.tags.WEB, _test_setup_js_1.tags.PYREFLY] }, () => {
    _test_setup_js_1.test.afterAll(async function ({ hotKeys }) {
        await hotKeys.closeAllEditors();
    });
    _test_setup_js_1.test.describe('Outline: Sessions', () => {
        _test_setup_js_1.test.beforeAll(async function ({ app, openFile, hotKeys }) {
            const { outline } = app.workbench;
            await openFile(`workspaces/outline/${PY_FILE}`);
            await openFile(`workspaces/outline/${R_FILE}`);
            await hotKeys.closeSecondarySidebar();
            await outline.focus();
        });
        _test_setup_js_1.test.skip('Verify outline is based on editor and per session', async function ({ app, sessions }) {
            const { outline, console, editor } = app.workbench;
            // No active session - verify no outlines
            await editor.selectTab(PY_FILE);
            await outline.expectOutlineToBeEmpty();
            await editor.selectTab(R_FILE);
            await outline.expectOutlineToBeEmpty();
            // Start sessions
            const [pySession1, pySession2, rSession1, rSession2] = await sessions.start(['python', 'pythonAlt', 'r', 'rAlt']);
            // Select Python file
            await editor.selectTab(PY_FILE);
            await verifyPythonOutline(outline);
            // Select R Session 1 - verify Python outline
            // Use last-active Python session's LSP for Python files, even if foreground session is R.
            await sessions.select(rSession1.id);
            await verifyPythonOutline(outline);
            // Select Python Session 1 - verify Python outline
            await sessions.select(pySession1.id);
            await console.typeToConsole('global_variable="goodbye"', true);
            await verifyPythonOutline(outline);
            // Select R file
            await editor.selectTab(R_FILE);
            await verifyROutline(outline);
            // Select R Session 1 - verify R outline
            await sessions.select(rSession1.id);
            await verifyROutline(outline);
            // Select R Session 2 - verify R outline
            await sessions.select(rSession2.id);
            await verifyROutline(outline);
            // Select Python file - verify Python outline
            await editor.selectTab(PY_FILE);
            await verifyPythonOutline(outline);
            // Python Session 2 - verify Python outline
            await sessions.select(pySession2.id);
            await console.typeToConsole('global_variable="goodbye2"', true);
            await verifyPythonOutline(outline);
        });
        _test_setup_js_1.test.skip('Verify outline after reload with Python in foreground and R in background', {
            tag: [_test_setup_js_1.tags.ARK],
        }, async function ({ app, hotKeys, sessions }) {
            const { outline, editor } = app.workbench;
            // Start sessions
            await sessions.deleteAll();
            await sessions.start(['python', 'r']);
            // Verify outlines for both file types
            await editor.selectTab(PY_FILE);
            await verifyPythonOutline(outline);
            await editor.selectTab(R_FILE);
            await verifyROutline(outline);
            // Reload window
            await sessions.expectSessionCountToBe(2);
            await hotKeys.reloadWindow(true);
            await sessions.expectSessionCountToBe(2);
            // Verify outlines for both file types
            await editor.selectTab(PY_FILE);
            await verifyPythonOutline(outline);
            await editor.selectTab(R_FILE);
            await verifyROutline(outline);
        });
        _test_setup_js_1.test.skip('Verify outline after reload with R in foreground and Python in background', {
            tag: [_test_setup_js_1.tags.ARK],
        }, async function ({ app, hotKeys, sessions }) {
            const { outline, editor } = app.workbench;
            // Start sessions
            await sessions.deleteAll();
            await sessions.start(['r', 'python']);
            // Verify outlines for both file types
            await editor.selectTab(R_FILE);
            await verifyROutline(outline);
            await editor.selectTab(PY_FILE);
            await verifyPythonOutline(outline);
            // Reload window
            await hotKeys.reloadWindow(true);
            // Verify outlines for both file types
            await editor.selectTab(R_FILE);
            await verifyROutline(outline);
            await editor.selectTab(PY_FILE);
            await verifyPythonOutline(outline);
        });
    });
    _test_setup_js_1.test.describe('Outline: Basic', () => {
        (0, _test_setup_js_1.test)('R - Verify Outline Contents', {
            tag: [_test_setup_js_1.tags.ARK]
        }, async function ({ app, r, openFile }) {
            await openFile((0, path_1.join)('workspaces', 'chinook-db-r', 'chinook-sqlite.r'));
            await app.workbench.outline.expectOutlineToContain([
                'con',
                'albums',
                'df',
            ]);
        });
        (0, _test_setup_js_1.test)('Python - Verify Outline Contents', async function ({ app, python, openFile }) {
            await openFile((0, path_1.join)('workspaces', 'chinook-db-py', 'chinook-sqlite.py'));
            await (0, test_1.expect)(async () => {
                try {
                    await app.workbench.outline.expectOutlineToContain([
                        'data_file_path',
                        'conn',
                        'cur',
                        'rows',
                        'df'
                    ]);
                }
                catch (e) {
                    await app.code.driver.currentPage.keyboard.press('PageDown');
                    await app.code.driver.currentPage.keyboard.press('End');
                    await app.code.driver.currentPage.keyboard.press('Enter');
                    await app.code.driver.currentPage.keyboard.press('Enter');
                    throw e;
                }
            }).toPass({ timeout: 60000 });
        });
    });
});
async function verifyPythonOutline(outline) {
    await outline.expectOutlineElementCountToBe(2); // ensure no dupes from multisessions
    await outline.expectOutlineElementToBeVisible('global_variable = "hello"');
    await outline.expectOutlineElementToBeVisible('def demonstrate_scope');
}
async function verifyROutline(outline) {
    await outline.expectOutlineElementCountToBe(2); // ensure no dupes from multisessions
    await outline.expectOutlineElementToBeVisible('demonstrate_scope');
    await outline.expectOutlineElementToBeVisible('global_variable');
}
//# sourceMappingURL=lsp-outline.test.js.map