"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const infra_1 = require("../../infra");
const _test_setup_1 = require("../_test.setup");
const new_folder_flow_js_1 = require("./helpers/new-folder-flow.js");
_test_setup_1.test.use({
    suiteId: __filename
});
// Not running conda test on windows because conda reeks havoc on selecting the correct python interpreter
_test_setup_1.test.describe('New Folder Flow: Python Project', {
    tag: [_test_setup_1.tags.MODAL, _test_setup_1.tags.NEW_FOLDER_FLOW, _test_setup_1.tags.WEB]
}, () => {
    const folderTemplate = infra_1.FolderTemplate.PYTHON_PROJECT;
    _test_setup_1.test.beforeAll(async function ({ settings }) {
        await settings.set({ 'interpreters.startupBehavior': 'auto' }, { waitMs: 1000 });
    });
    (0, _test_setup_1.test)('Existing env: ipykernel already installed', { tag: [_test_setup_1.tags.WIN], }, async function ({ app, sessions, python, settings }) {
        const folderName = (0, new_folder_flow_js_1.addRandomNumSuffix)('ipykernel-installed');
        await (0, new_folder_flow_js_1.createNewFolder)(app, {
            folderTemplate,
            folderName,
            status: 'existing',
            ipykernelFeedback: 'hide',
            interpreterPath: (await sessions.getSelectedSessionInfo()).path,
            createPyprojectToml: false,
        });
        await (0, new_folder_flow_js_1.verifyFolderCreation)(app, folderName);
        await (0, new_folder_flow_js_1.verifyConsoleReady)(app, folderTemplate);
        await (0, new_folder_flow_js_1.verifyPyprojectTomlNotCreated)(app);
    });
    // untagged windows because we cannot find any way to copy text from the terminal now that its a canvas
    // passing in python to ensure a valid version is used
    (0, _test_setup_1.test)('New env: Git initialized', { tag: [_test_setup_1.tags.CRITICAL] }, async function ({ app, settings, python }) {
        const folderName = (0, new_folder_flow_js_1.addRandomNumSuffix)('git-init');
        await settings.set({ 'files.exclude': { '**/.git': false, '**/.gitignore': false } }, { waitMs: 1000 });
        await (0, new_folder_flow_js_1.createNewFolder)(app, {
            folderTemplate,
            folderName,
            initGitRepo: true,
            status: 'new',
            pythonEnv: 'venv',
            createPyprojectToml: true,
        });
        await (0, new_folder_flow_js_1.verifyFolderCreation)(app, folderName);
        await (0, new_folder_flow_js_1.verifyConsoleReady)(app, folderTemplate);
        await (0, new_folder_flow_js_1.verifyGitFilesArePresent)(app);
        await (0, new_folder_flow_js_1.verifyVenvEnvStarts)(app);
        await (0, new_folder_flow_js_1.verifyGitStatus)(app);
        await (0, new_folder_flow_js_1.verifyPyprojectTomlCreated)(app);
    });
    (0, _test_setup_1.test)('New env: Conda environment', async function ({ app }) {
        const folderName = (0, new_folder_flow_js_1.addRandomNumSuffix)('conda-installed');
        await (0, new_folder_flow_js_1.createNewFolder)(app, {
            folderTemplate,
            folderName,
            status: 'new',
            pythonEnv: 'conda', // test relies on conda already installed on machine
            createPyprojectToml: true,
        });
        await (0, new_folder_flow_js_1.verifyFolderCreation)(app, folderName);
        await (0, new_folder_flow_js_1.verifyConsoleReady)(app, folderTemplate);
        await (0, new_folder_flow_js_1.verifyCondaFilesArePresent)(app);
        await (0, new_folder_flow_js_1.verifyCondaEnvStarts)(app);
        await (0, new_folder_flow_js_1.verifyPyprojectTomlCreated)(app);
    });
    // passing in python to ensure a valid version is used
    (0, _test_setup_1.test)('New env: Venv environment', { tag: [_test_setup_1.tags.CRITICAL, _test_setup_1.tags.WIN] }, async function ({ app, python }) {
        const folderName = (0, new_folder_flow_js_1.addRandomNumSuffix)('new-venv');
        await (0, new_folder_flow_js_1.createNewFolder)(app, {
            folderTemplate,
            folderName,
            status: 'new',
            pythonEnv: 'venv',
            createPyprojectToml: false,
        });
        await (0, new_folder_flow_js_1.verifyFolderCreation)(app, folderName);
        await (0, new_folder_flow_js_1.verifyConsoleReady)(app, folderTemplate);
        await (0, new_folder_flow_js_1.verifyVenvEnvStarts)(app);
        await (0, new_folder_flow_js_1.verifyPyprojectTomlNotCreated)(app);
    });
    (0, _test_setup_1.test)('New env: uv environment', { tag: [_test_setup_1.tags.CRITICAL, _test_setup_1.tags.WIN] }, async function ({ app }) {
        const folderName = (0, new_folder_flow_js_1.addRandomNumSuffix)('new-uv');
        await (0, new_folder_flow_js_1.createNewFolder)(app, {
            folderTemplate,
            folderName,
            status: 'new',
            pythonEnv: 'uv', // test relies on uv already installed on machine
            createPyprojectToml: true,
        });
        await (0, new_folder_flow_js_1.verifyFolderCreation)(app, folderName);
        await (0, new_folder_flow_js_1.verifyConsoleReady)(app, folderTemplate);
        await (0, new_folder_flow_js_1.verifyUvEnvStarts)(app);
        await (0, new_folder_flow_js_1.verifyPyprojectTomlCreated)(app);
    });
});
//# sourceMappingURL=new-folder-flow-python.test.js.map