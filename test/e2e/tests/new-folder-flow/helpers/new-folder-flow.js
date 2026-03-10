"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.addRandomNumSuffix = addRandomNumSuffix;
exports.createNewFolder = createNewFolder;
exports.verifyFolderCreation = verifyFolderCreation;
exports.verifyConsoleReady = verifyConsoleReady;
exports.verifyGitFilesArePresent = verifyGitFilesArePresent;
exports.verifyGitStatus = verifyGitStatus;
exports.verifyRenvFilesArePresent = verifyRenvFilesArePresent;
exports.handleRenvInstallModal = handleRenvInstallModal;
exports.verifyCondaFilesArePresent = verifyCondaFilesArePresent;
exports.verifyCondaEnvStarts = verifyCondaEnvStarts;
exports.verifyVenvEnvStarts = verifyVenvEnvStarts;
exports.verifyUvEnvStarts = verifyUvEnvStarts;
exports.verifyPyprojectTomlCreated = verifyPyprojectTomlCreated;
exports.verifyPyprojectTomlNotCreated = verifyPyprojectTomlNotCreated;
const index_js_1 = require("../../../infra/index.js");
const _test_setup_js_1 = require("../../_test.setup.js");
function addRandomNumSuffix(name) {
    return `${name}_${Math.floor(Math.random() * 1000000)}`;
}
async function createNewFolder(app, options) {
    await _test_setup_js_1.test.step(`Create a new folder: ${options.folderName}`, async () => {
        await app.workbench.newFolderFlow.createNewFolder(options);
    });
}
async function verifyFolderCreation(app, folderName) {
    await _test_setup_js_1.test.step(`Verify folder created`, async () => {
        await (0, _test_setup_js_1.expect)(app.code.driver.currentPage.locator('#top-action-bar-current-working-folder')).toHaveText(folderName, { timeout: 60000 }); // this is really slow on windows CI for some reason
    });
}
async function verifyConsoleReady(app, folderTemplate) {
    await _test_setup_js_1.test.step(`Verify console is ready`, async () => {
        const consoleSymbol = folderTemplate === index_js_1.FolderTemplate.R_PROJECT ? '>' : '>>>';
        await app.workbench.console.waitForReadyAndStarted(consoleSymbol, 90000);
    });
}
async function verifyGitFilesArePresent(app) {
    await _test_setup_js_1.test.step('Verify that the .git files are present', async () => {
        await app.workbench.explorer.verifyExplorerFilesExist(['.git', '.gitignore']);
    });
}
async function verifyGitStatus(app) {
    await _test_setup_js_1.test.step('Verify git status', async () => {
        // Git status should show that we're on the main branch
        await app.workbench.terminal.createTerminal();
        await app.workbench.terminal.runCommandInTerminal('git status');
        await app.workbench.terminal.waitForTerminalText('On branch main');
    });
}
async function verifyRenvFilesArePresent(app) {
    await _test_setup_js_1.test.step(`Verify renv files are present`, async () => {
        await app.workbench.explorer.verifyExplorerFilesExist(['renv', '.Rprofile', 'renv.lock']);
    });
}
async function handleRenvInstallModal(app, action) {
    await _test_setup_js_1.test.step(`Handle Renv modal: ${action}`, async () => {
        await app.workbench.modals.installRenvModal(action);
    });
}
async function verifyCondaFilesArePresent(app) {
    await _test_setup_js_1.test.step('Verify .conda files are present', async () => {
        await app.workbench.explorer.verifyExplorerFilesExist(['.conda']);
    });
}
async function verifyCondaEnvStarts(app) {
    await _test_setup_js_1.test.step('Verify conda environment starts', async () => {
        await app.workbench.console.waitForConsoleContents(/\(Conda: .+\) started/);
    });
}
async function verifyVenvEnvStarts(app) {
    await _test_setup_js_1.test.step('Verify venv environment starts', async () => {
        await app.workbench.console.waitForConsoleContents(/\(Venv: .+\) started/);
    });
}
async function verifyUvEnvStarts(app) {
    await _test_setup_js_1.test.step('Verify uv environment starts', async () => {
        if (/(8080)/.test(app.code.driver.currentPage.url())) {
            app.code.driver.currentPage.getByRole('button', { name: 'Yes' }).click();
        }
        await app.workbench.console.waitForConsoleContents(/\(uv: .+\) started/);
    });
}
async function verifyPyprojectTomlCreated(app) {
    await _test_setup_js_1.test.step('Verify pyproject.toml file is created', async () => {
        const files = app.code.driver.currentPage.locator('.monaco-list > .monaco-scrollable-element');
        await (0, _test_setup_js_1.expect)(files.getByText('pyproject.toml')).toBeVisible({ timeout: 50000 });
    });
}
async function verifyPyprojectTomlNotCreated(app) {
    await _test_setup_js_1.test.step('Verify pyproject.toml file is not created', async () => {
        const files = app.code.driver.currentPage.locator('.monaco-list > .monaco-scrollable-element');
        await (0, _test_setup_js_1.expect)(files.getByText('pyproject.toml')).toHaveCount(0, { timeout: 50000 });
    });
}
//# sourceMappingURL=new-folder-flow.js.map