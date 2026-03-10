"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const infra_1 = require("../../infra");
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Welcome Page', { tag: [_test_setup_1.tags.WELCOME, _test_setup_1.tags.WEB] }, () => {
    _test_setup_1.test.afterEach(async function ({ hotKeys }) {
        await hotKeys.closeAllEditors();
    });
    _test_setup_1.test.describe('Workspace', () => {
        _test_setup_1.test.beforeEach(async function ({ hotKeys, sessions }) {
            await sessions.expectNoStartUpMessaging();
            await hotKeys.openWelcomeWalkthrough();
        });
        (0, _test_setup_1.test)('Verify page header, footer, content', async function ({ app }) {
            const { welcome } = app.workbench;
            await welcome.expectLogoToBeVisible();
            await welcome.expectFooterToBeVisible();
            await welcome.expectTabTitleToBe('Welcome');
            await welcome.expectStartToContain(['New Notebook', 'New File']);
            await welcome.expectHelpToContain(['Positron Documentation', 'Positron Community Forum', 'Report a Bug', 'Sign Up for Positron Updates']);
            await welcome.expectRecentToContain([]);
            app.web
                ? await welcome.expectConnectToBeVisible(false)
                : await welcome.expectConnectToBeVisible(true);
        });
        (0, _test_setup_1.test)('Verify limited walkthroughs on Welcome page and full list in `More...`', async function ({ app, hotKeys }) {
            const { welcome, quickInput } = app.workbench;
            await hotKeys.resetWelcomeWalkthrough();
            await hotKeys.reloadWindow(true);
            await welcome.expectWalkthroughsToHaveCount(3);
            await welcome.expectWalkthroughsToContain(['Migrating from VSCode to Positron', 'Migrating from RStudio to Positron', 'Explore the Positron Notebook Editor in Alpha']);
            await welcome.walkthroughSection.getByText('More...').click();
            await quickInput.expectTitleBarToHaveText('Open Walkthrough...');
            await quickInput.expectQuickInputResultsToContain([
                'Get Started with Python Development',
                'Migrating from VSCode to Positron',
                'Migrating from RStudio to Positron',
                'Get Started with Jupyter Notebooks',
                'Get Started with Posit Publisher',
                'Explore the Positron Notebook Editor in Alpha'
            ]);
        });
        (0, _test_setup_1.test)('Python - Verify clicking on `new notebook` from the Welcome page opens notebook and sets kernel', async function ({ app, python }) {
            const { welcome, popups, editors, notebooks } = app.workbench;
            await welcome.newNotebookButton.click();
            await popups.clickItem('Python Notebook');
            await editors.expectActiveEditorIconClassToMatch(/ipynb-ext-file-icon/);
            await notebooks.expectKernelToBe(infra_1.availableRuntimes['python'].name);
        });
        (0, _test_setup_1.test)('Python - Verify clicking on `new file` from the Welcome page opens editor', async function ({ app, python }) {
            const { welcome, quickInput, editors } = app.workbench;
            await welcome.newFileButton.click();
            await quickInput.selectQuickInputElementContaining('Python File');
            await editors.expectActiveEditorIconClassToMatch(/python-lang-file-icon/);
        });
        (0, _test_setup_1.test)('R - Verify clicking on `new notebook` from the Welcome page opens notebook and sets kernel', async function ({ app, sessions, r }) {
            const { welcome, popups, editors, notebooks } = app.workbench;
            await welcome.newNotebookButton.click();
            await popups.clickItem('R Notebook');
            await editors.expectActiveEditorIconClassToMatch(/ipynb-ext-file-icon/);
            await notebooks.expectKernelToBe(infra_1.availableRuntimes['r'].name);
            await sessions.deleteAll();
        });
        (0, _test_setup_1.test)('R - Verify clicking on `new file` from the Welcome page opens editor', async function ({ app, r }) {
            const { welcome, quickInput, editors } = app.workbench;
            await welcome.newFileButton.click();
            await quickInput.selectQuickInputElementContaining('R File');
            await editors.expectActiveEditorIconClassToMatch(/r-lang-file-icon/);
        });
    });
    _test_setup_1.test.describe('No Workspace', () => {
        _test_setup_1.test.beforeEach(async function ({ hotKeys, sessions }) {
            await hotKeys.closeWorkspace();
            await sessions.expectSessionPickerToBe('Start Session');
            await sessions.expectNoStartUpMessaging();
            await hotKeys.openWelcomeWalkthrough();
        });
        (0, _test_setup_1.test)('Verify page header, footer, content', async function ({ app }) {
            const { welcome } = app.workbench;
            await welcome.expectLogoToBeVisible();
            await welcome.expectFooterToBeVisible();
            await welcome.expectStartToContain(['Open Folder...', 'New Folder...', 'New from Git...']);
            await welcome.expectHelpToContain(['Positron Documentation', 'Positron Community Forum', 'Report a Bug', 'Sign Up for Positron Updates']);
            await welcome.expectRecentToContain(['qa-example-content']);
        });
        (0, _test_setup_1.test)('Verify clicking on `Open Folder` opens file browser', { tag: [_test_setup_1.tags.WEB_ONLY] }, async function ({ app, page }) {
            const { welcome, quickInput } = app.workbench;
            await welcome.openFolderButton.click();
            await quickInput.expectTitleBarToHaveText('Open Folder');
        });
        (0, _test_setup_1.test)('Verify clicking on `New Folder` opens New Folder Flow', { tag: [_test_setup_1.tags.NEW_FOLDER_FLOW] }, async function ({ app }) {
            const { welcome, newFolderFlow } = app.workbench;
            await welcome.newFolderFromTemplateButton.click();
            await newFolderFlow.expectFolderTemplatesToBeVisible({
                'Empty Project': true,
                'Python Project': true,
                'R Project': true,
                'Jupyter Notebook': true
            });
        });
        (0, _test_setup_1.test)('Verify clicking on `New from Git` opens dialog', { tag: [_test_setup_1.tags.MODAL] }, async function ({ app }) {
            const { welcome, modals } = app.workbench;
            await welcome.startButtons.getByText('New from Git...').click();
            await modals.expectToBeVisible('New Folder from Git');
        });
    });
});
//# sourceMappingURL=welcome.test.js.map