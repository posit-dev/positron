"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const _test_setup_1 = require("../_test.setup");
const _test_setup_js_1 = require("./_test.setup.js");
_test_setup_js_1.test.use({
    suiteId: __filename
});
_test_setup_js_1.test.describe('Notebook Assistant: Feature Toggle', {
    tag: [_test_setup_1.tags.POSITRON_NOTEBOOKS, _test_setup_1.tags.ASSISTANT, _test_setup_1.tags.WIN]
}, () => {
    (0, _test_setup_js_1.test)('Notebook AI features hidden when assistant disabled', async function ({ app, settings }) {
        const { notebooksPositron } = app.workbench;
        // Disable assistant features
        await settings.set({ 'positron.assistant.enable': false });
        // Create a new notebook
        await notebooksPositron.createNewNotebook();
        await notebooksPositron.kernel.select('R');
        // Add a code cell with intentional error
        await notebooksPositron.addCodeToCell(0, 'invalid_function()', { run: true });
        await notebooksPositron.expectExecutionOrder([{ index: 0, order: 1 }]);
        await notebooksPositron.expectNotebookErrorVisible();
        // Verify assistant buttons are NOT visible
        await notebooksPositron.expectAssistantButtonsVisible(false);
        await notebooksPositron.expectErrorAssistantButtonsVisible(false);
    });
    (0, _test_setup_js_1.test)('Notebook AI features visible when assistant enabled', async function ({ app, settings }) {
        const { notebooksPositron, assistant } = app.workbench;
        // Enable assistant and sign in to echo provider
        await settings.set({ 'positron.assistant.enable': true });
        await assistant.loginModelProvider('echo');
        // Create a new notebook with a cell that produces an error
        await notebooksPositron.createNewNotebook();
        await notebooksPositron.kernel.select('R');
        // Add a code cell with intentional error
        await notebooksPositron.addCodeToCell(0, 'invalid_function()', { run: true });
        await notebooksPositron.expectExecutionOrder([{ index: 0, order: 1 }]);
        await notebooksPositron.expectNotebookErrorVisible();
        // Verify assistant buttons ARE visible
        await notebooksPositron.expectAssistantButtonsVisible(true);
        await notebooksPositron.expectErrorAssistantButtonsVisible(true);
        await assistant.logoutModelProvider('echo');
    });
});
_test_setup_js_1.test.describe('Notebook Assistant: Interaction Flow', {
    tag: [_test_setup_1.tags.POSITRON_NOTEBOOKS, _test_setup_1.tags.ASSISTANT, _test_setup_1.tags.WEB, _test_setup_1.tags.WIN]
}, () => {
    _test_setup_js_1.test.beforeAll(async function ({ assistant }) {
        await assistant.loginModelProvider('echo');
    });
    _test_setup_js_1.test.afterAll(async function ({ assistant }) {
        await assistant.logoutModelProvider('echo');
    });
    (0, _test_setup_js_1.test)('Fix error button opens chat and sends error context', async function ({ app }) {
        const { notebooksPositron, assistant } = app.workbench;
        // Create notebook
        await notebooksPositron.createNewNotebook();
        await notebooksPositron.kernel.select('Python');
        // Add a valid cell first
        await notebooksPositron.addCodeToCell(0, 'x = 10', { run: true });
        await notebooksPositron.expectExecutionOrder([{ index: 0, order: 1 }]);
        // Add a cell with an error and run it
        await notebooksPositron.addCodeToCell(1, 'result = x + undefined_var', { run: true });
        await notebooksPositron.expectExecutionOrder([{ index: 1, order: 2 }]);
        await notebooksPositron.expectNotebookErrorVisible();
        // Click the Fix button and wait for response
        await notebooksPositron.clickFixErrorButton();
        await assistant.waitForResponseComplete();
        // Verify the chat panel is visible and received a response
        await assistant.expectChatPanelVisible();
        await assistant.expectChatResponseVisible();
        // Verify the error context was sent
        const responseText = await assistant.getChatResponseText(app.workspacePathOrFolder);
        (0, test_1.expect)(responseText).toContain('undefined_var');
    });
    (0, _test_setup_js_1.test)('Explain error button opens chat and sends error context', async function ({ app }) {
        const { notebooksPositron, assistant } = app.workbench;
        // Create notebook
        await notebooksPositron.createNewNotebook();
        await notebooksPositron.kernel.select('Python');
        // Add a cell with an error and run it
        await notebooksPositron.addCodeToCell(0, 'undefined_function()', { run: true });
        await notebooksPositron.expectExecutionOrder([{ index: 0, order: 1 }]);
        await notebooksPositron.expectNotebookErrorVisible();
        // Click the Explain button and wait for response
        await notebooksPositron.clickExplainErrorButton();
        await assistant.waitForResponseComplete();
        // Verify the chat panel is visible and received a response
        await assistant.expectChatPanelVisible();
        await assistant.expectChatResponseVisible();
        // Verify the error context was sent
        const responseText = await assistant.getChatResponseText(app.workspacePathOrFolder);
        (0, test_1.expect)(responseText).toContain('undefined_function');
    });
});
//# sourceMappingURL=notebook-assistant-features.test.js.map