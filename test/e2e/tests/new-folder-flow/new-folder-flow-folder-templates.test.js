"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('New Folder Flow: Template visibility via Interpreter Settings', {
    tag: [_test_setup_1.tags.INTERPRETER, _test_setup_1.tags.WEB, _test_setup_1.tags.MODAL, _test_setup_1.tags.NEW_FOLDER_FLOW]
}, () => {
    // Some extra diligence around clearing settings is used to avoid the language-specific settings
    // being overridden by other language-specific settings. At present, other tests don't set
    // language-specific settings, but this may change in the future
    _test_setup_1.test.beforeAll(async function ({ settings }) {
        await settings.clear();
    });
    _test_setup_1.test.beforeEach(async function ({ settings }) {
        await settings.clear();
    });
    (0, _test_setup_1.test)('Verify only Empty Project available when global interpreter startup is disabled', async function ({ app, hotKeys, settings }) {
        const { newFolderFlow } = app.workbench;
        // Disable startup behavior for all interpreters
        await settings.set({
            'interpreters.startupBehavior': 'disabled'
        }, { reload: 'web', waitMs: 1000, keepOpen: true, waitForReady: false });
        await hotKeys.newFolderFromTemplate();
        // Only Empty Project should be available
        await newFolderFlow.expectFolderTemplatesToBeVisible({
            'Empty Project': true
        });
    });
    (0, _test_setup_1.test)('Verify Python and Jupyter templates hidden when Python startup is disabled', async function ({ app, hotKeys, settings }) {
        const { newFolderFlow } = app.workbench;
        // Disable startup behavior for Python
        await settings.set({
            '[python]': {
                "interpreters.startupBehavior": "disabled",
                "editor.formatOnSave": true
            }
        }, { reload: 'web', waitMs: 1000, keepOpen: true });
        await hotKeys.newFolderFromTemplate();
        // Only Empty Project and R Project should be available
        await newFolderFlow.expectFolderTemplatesToBeVisible({
            'R Project': true,
            'Empty Project': true
        });
    });
    (0, _test_setup_1.test)('Verify R folder template hidden when R startup is disabled', async function ({ app, hotKeys, settings }) {
        const { newFolderFlow } = app.workbench;
        // Disable startup behavior for R
        await settings.set({
            '[r]': {
                "interpreters.startupBehavior": "disabled",
                "editor.formatOnSave": true
            }
        }, { reload: 'web', waitMs: 1000, keepOpen: true });
        await hotKeys.newFolderFromTemplate();
        // Only templates other than R should be available
        await newFolderFlow.expectFolderTemplatesToBeVisible({
            'Python Project': true,
            'Jupyter Notebook': true,
            'Empty Project': true
        });
    });
});
//# sourceMappingURL=new-folder-flow-folder-templates.test.js.map