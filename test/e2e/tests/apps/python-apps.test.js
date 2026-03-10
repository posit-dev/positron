"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
const path_1 = require("path");
_test_setup_1.test.use({
    suiteId: __filename
});
const appTests = [
    {
        name: 'Dash',
        tags: [_test_setup_1.tags.WIN, _test_setup_1.tags.WORKBENCH],
        filePath: 'dash_example/dash_example.py',
        locator: frame => frame.getByText('Hello World'),
    },
    {
        name: 'FastAPI',
        tags: [_test_setup_1.tags.WIN],
        filePath: 'fastapi_example/fastapi_example.py',
        locator: frame => frame.getByText('FastAPI'),
    },
    {
        name: 'Gradio',
        tags: [_test_setup_1.tags.WIN],
        filePath: 'gradio_example/gradio_example.py',
        locator: frame => frame.getByRole('button', { name: 'Submit' }),
    },
    {
        name: 'Streamlit',
        tags: [_test_setup_1.tags.WEB, _test_setup_1.tags.WIN],
        filePath: 'streamlit_example/streamlit_example.py',
        locator: frame => frame.getByRole('button', { name: 'Deploy' }),
    },
    {
        name: 'Flask',
        tags: [_test_setup_1.tags.WEB, _test_setup_1.tags.WIN],
        filePath: 'flask_example/__init__.py',
        locator: frame => frame.getByText('Log In'),
    },
];
_test_setup_1.test.describe('Python Applications', {
    tag: [_test_setup_1.tags.CRITICAL, _test_setup_1.tags.APPS, _test_setup_1.tags.VIEWER, _test_setup_1.tags.EDITOR, _test_setup_1.tags.WEB]
}, () => {
    _test_setup_1.test.afterEach(async function ({ app, hotKeys }) {
        const { terminal, viewer } = app.workbench;
        await hotKeys.closeAllEditors();
        await hotKeys.focusConsole();
        await terminal.clickTerminalTab();
        await terminal.sendKeysToTerminal('Control+C');
        await viewer.clearViewer();
    });
    for (const appTest of appTests) {
        (0, _test_setup_1.test)(`Python - Verify Basic ${appTest.name} App`, {
            tag: appTest.tags
        }, async function ({ app, openFile, python }) {
            const { viewer, editor, terminal } = app.workbench;
            await openFile((0, path_1.join)('workspaces', 'python_apps', appTest.filePath));
            // Press play and verify the content is visible in the viewer frame
            await editor.pressPlay();
            await viewer.expectContentVisible(appTest.locator, {
                onRetry: async () => {
                    await terminal.clickTerminalTab();
                    await terminal.sendKeysToTerminal('Control+C');
                    await editor.pressPlay();
                }
            });
            // Click the "Open in Editor" button and verify the content is visible in the editor viewer frame
            await viewer.openViewerToEditor();
            await viewer.clearViewer();
            await editor.expectEditorViewerContentVisible(appTest.locator);
        });
    }
    (0, _test_setup_1.test)('Python - Verify Viewer interrupt button for Streamlit app', {
        tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.WIN]
    }, async function ({ app, openFile, python }) {
        const { viewer, editor, terminal } = app.workbench;
        // Open the Streamlit app file and press play
        await openFile((0, path_1.join)('workspaces', 'python_apps', 'streamlit_example', 'streamlit_example.py'));
        await editor.pressPlay();
        await viewer.expectContentVisible(frame => frame.getByRole('button', { name: 'Deploy' }), {
            onRetry: async () => {
                await terminal.clickTerminalTab();
                await terminal.sendKeysToTerminal('Control+C');
                await editor.pressPlay();
            }
        });
        await _test_setup_1.test.step('Verify interrupt button is visible', async () => {
            await (0, _test_setup_1.expect)(viewer.interruptButton).toBeVisible({ timeout: 10000 });
        });
        await _test_setup_1.test.step('Click interrupt button and verify it disappears', async () => {
            await viewer.interruptButton.click();
            await (0, _test_setup_1.expect)(viewer.interruptButton).not.toBeVisible({ timeout: 5000 });
        });
    });
});
//# sourceMappingURL=python-apps.test.js.map