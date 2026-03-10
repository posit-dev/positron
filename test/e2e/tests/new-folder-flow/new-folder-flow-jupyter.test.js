"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const newFolderFlow_js_1 = require("../../pages/newFolderFlow.js");
const _test_setup_1 = require("../_test.setup");
const new_folder_flow_js_1 = require("./helpers/new-folder-flow.js");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('New Folder Flow: Jupyter Project', {
    tag: [_test_setup_1.tags.MODAL, _test_setup_1.tags.NEW_FOLDER_FLOW],
}, () => {
    const folderTemplate = newFolderFlow_js_1.FolderTemplate.JUPYTER_NOTEBOOK;
    _test_setup_1.test.beforeAll(async function ({ settings }) {
        await settings.set({ 'interpreters.startupBehavior': 'auto' }, { waitMs: 5000 });
    });
    // Removing WIN tag until we get uv into windows CI as this expects uv to be the interpreter
    (0, _test_setup_1.test)('Jupyter Folder Defaults', {
        tag: [_test_setup_1.tags.CRITICAL, _test_setup_1.tags.INTERPRETER, _test_setup_1.tags.WIN]
    }, async function ({ app, settings }) {
        const folderName = (0, new_folder_flow_js_1.addRandomNumSuffix)('python-notebook-runtime');
        // Create a new Python notebook folder
        await app.workbench.newFolderFlow.createNewFolder({
            folderTemplate,
            folderName
        });
        await (0, new_folder_flow_js_1.verifyFolderCreation)(app, folderName);
        await (0, new_folder_flow_js_1.verifyConsoleReady)(app, folderTemplate);
        await verifyNotebookEditorVisible(app);
        await verifyNotebookAndConsolePythonVersion(app);
        await (0, new_folder_flow_js_1.verifyPyprojectTomlNotCreated)(app);
    });
});
async function verifyNotebookEditorVisible(app) {
    const notebookEditorTab = app.code.driver.currentPage.locator('[id="workbench.parts.editor"]').getByText('Untitled-1.ipynb', { exact: true });
    await (0, _test_setup_1.expect)(notebookEditorTab).toBeVisible();
}
async function verifyNotebookAndConsolePythonVersion(app) {
    const sessionSelectorButton = app.code.driver.currentPage.getByRole('button', { name: 'Select Session' });
    const sessionSelectorText = await sessionSelectorButton.textContent();
    // Extract the version number (e.g., '3.10.12') from the button text
    const versionMatch = sessionSelectorText && sessionSelectorText.match(/Python ([0-9]+\.[0-9]+\.[0-9]+)/);
    const pythonVersion = versionMatch ? versionMatch[1] : undefined;
    // Fail the test if we can't extract the version
    (0, _test_setup_1.expect)(pythonVersion, 'Python version should be present in session selector').toBeTruthy();
    // After the runtime starts up the kernel status should be replaced with the kernel name.
    // The kernel name should contain the Python version from the session selector
    // Only look within an 'a' tag with class 'kernel-label' to avoid false positives
    const kernelLabel = app.code.driver.currentPage.locator('a.kernel-label');
    await (0, _test_setup_1.expect)(kernelLabel).toContainText(`Python ${pythonVersion}`);
    await (0, _test_setup_1.expect)(kernelLabel).toContainText('python-notebook-runtime');
}
//# sourceMappingURL=new-folder-flow-jupyter.test.js.map