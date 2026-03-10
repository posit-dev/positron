"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const _test_setup_1 = require("../_test.setup");
const test_1 = require("@playwright/test");
_test_setup_1.test.use({
    suiteId: __filename
});
let newFileName;
_test_setup_1.test.describe('Notebooks', {
    tag: [_test_setup_1.tags.CRITICAL, _test_setup_1.tags.WEB, _test_setup_1.tags.WIN, _test_setup_1.tags.NOTEBOOKS]
}, () => {
    _test_setup_1.test.describe('Python Notebooks', () => {
        _test_setup_1.test.beforeAll(async function ({ app, settings }) {
            if (app.web) {
                await settings.set({
                    'files.simpleDialog.enable': true,
                });
            }
        });
        _test_setup_1.test.beforeEach(async function ({ app, python }) {
            await app.workbench.layouts.enterLayout('notebook');
            await app.workbench.notebooks.createNewNotebook();
            await app.workbench.notebooks.selectInterpreter('Python');
        });
        _test_setup_1.test.afterEach(async function ({ app }) {
            await app.workbench.notebooks.closeNotebookWithoutSaving();
        });
        _test_setup_1.test.afterAll(async function ({ cleanup }) {
            await cleanup.removeTestFiles([newFileName]);
        });
        (0, _test_setup_1.test)('Python - Verify code cell execution and markdown formatting in notebook', async function ({ app }) {
            const { notebooks } = app.workbench;
            await _test_setup_1.test.step('Verify code cell execution in notebook', async () => {
                await notebooks.addCodeToCellAtIndex(0, 'eval("8**2")');
                await notebooks.executeCodeInCell();
                await notebooks.assertCellOutput('64');
            });
            await _test_setup_1.test.step('Verify markdown formatting in notebook', async () => {
                const randomText = Math.random().toString(36).substring(7);
                await notebooks.insertNotebookCell('markdown');
                await notebooks.typeInEditor(`## ${randomText} `);
                await notebooks.stopEditingCell();
                await notebooks.expectMarkdownTagToBe('h2', randomText);
            });
        });
        (0, _test_setup_1.test)('Python - Save untitled notebook and preserve session', async function ({ app, runCommand }) {
            const { notebooks, variables, layouts, quickInput, hotKeys } = app.workbench;
            // Ensure auxiliary sidebar is open to see variables pane
            await layouts.enterLayout('notebook');
            await hotKeys.showSecondarySidebar();
            // First, create and execute a cell to verify initial session
            await notebooks.addCodeToCellAtIndex(0, 'foo = "bar"');
            await test_1.expect.poll(async () => {
                try {
                    await notebooks.executeCodeInCell();
                    await variables.expectVariableToBe('foo', "'bar'", 2000);
                    return true;
                }
                catch {
                    return false;
                }
            }, {
                timeout: 15_000,
                intervals: [2_000],
            }).toBe(true);
            // Save the notebook using the command
            await runCommand('workbench.action.files.saveAs', { keepOpen: true });
            await quickInput.waitForQuickInputOpened();
            // Generate a random filename
            newFileName = `saved-session-test-${Math.random().toString(36).substring(7)}.ipynb`;
            await quickInput.type(path_1.default.join(app.workspacePathOrFolder, newFileName));
            await quickInput.clickOkButton();
            // Verify the variables pane shows the correct notebook name
            await variables.expectRuntimeToBe('visible', newFileName);
            // Test Flake - seems like kernel might not be ready immediately after saving. Let's explicitly set it to see if this helps.
            await notebooks.selectInterpreter('Python');
            // Verify the variable still exists
            await variables.expectVariableToBe('foo', "'bar'");
            await notebooks.insertNotebookCell('code');
            // Create a new variable using the now saved notebook
            // Add code to the new cell (using typeInEditor since addCodeToLastCell isn't available)
            await notebooks.addCodeToCellAtIndex(1, 'baz = "baz"');
            await (0, test_1.expect)(async () => {
                await notebooks.selectCellAtIndex(1);
                await notebooks.executeActiveCell();
                await variables.expectVariableToBe('baz', "'baz'");
            }).toPass({ timeout: 15000 });
        });
    });
    _test_setup_1.test.describe('R Notebooks', {
        tag: [_test_setup_1.tags.ARK]
    }, () => {
        _test_setup_1.test.beforeEach(async function ({ app, r }) {
            await app.workbench.layouts.enterLayout('notebook');
            await app.workbench.notebooks.createNewNotebook();
            await app.workbench.notebooks.selectInterpreter('R');
        });
        _test_setup_1.test.afterEach(async function ({ app }) {
            await app.workbench.notebooks.closeNotebookWithoutSaving();
        });
        (0, _test_setup_1.test)('R - Verify code cell execution and markdown formatting in notebook', async function ({ app }) {
            await _test_setup_1.test.step('Verify code cell execution in notebook', async () => {
                await app.workbench.notebooks.addCodeToCellAtIndex(0, 'eval(parse(text="8**2"))');
                await app.workbench.notebooks.executeCodeInCell();
                await app.workbench.notebooks.assertCellOutput('[1] 64');
            });
            await _test_setup_1.test.step('Verify markdown formatting in notebook', async () => {
                const randomText = Math.random().toString(36).substring(7);
                await app.workbench.notebooks.insertNotebookCell('markdown');
                await app.workbench.notebooks.typeInEditor(`## ${randomText} `);
                await app.workbench.notebooks.stopEditingCell();
                await app.workbench.notebooks.expectMarkdownTagToBe('h2', randomText);
            });
        });
    });
});
//# sourceMappingURL=notebook-create.test.js.map