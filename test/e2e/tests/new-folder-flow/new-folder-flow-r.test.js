"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const infra_1 = require("../../infra");
const _test_setup_1 = require("../_test.setup");
const new_folder_flow_js_1 = require("./helpers/new-folder-flow.js");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.beforeEach(async function ({ app, sessions }) {
    await sessions.expectAllSessionsToBeReady();
    await app.workbench.layouts.enterLayout('stacked');
});
_test_setup_1.test.describe('New Folder Flow: R Project', { tag: [_test_setup_1.tags.MODAL, _test_setup_1.tags.NEW_FOLDER_FLOW, _test_setup_1.tags.WEB, _test_setup_1.tags.ARK] }, () => {
    _test_setup_1.test.describe.configure({ mode: 'serial' });
    const folderTemplate = infra_1.FolderTemplate.R_PROJECT;
    _test_setup_1.test.beforeAll(async function ({ settings }) {
        await settings.set({ 'interpreters.startupBehavior': 'auto' }, { waitMs: 5000 });
    });
    (0, _test_setup_1.test)('R - Folder Defaults', { tag: [_test_setup_1.tags.CRITICAL, _test_setup_1.tags.WIN] }, async function ({ app, settings }) {
        const folderName = (0, new_folder_flow_js_1.addRandomNumSuffix)('r-defaults');
        await (0, new_folder_flow_js_1.createNewFolder)(app, {
            folderTemplate,
            folderName
        });
        await (0, new_folder_flow_js_1.verifyFolderCreation)(app, folderName);
        await (0, new_folder_flow_js_1.verifyConsoleReady)(app, folderTemplate);
        await (0, new_folder_flow_js_1.verifyPyprojectTomlNotCreated)(app);
    });
    (0, _test_setup_1.test)('R - Renv already installed', { tag: [_test_setup_1.tags.WIN] }, async function ({ app, packages }) {
        await packages.manage('renv', 'install');
        const folderName = (0, new_folder_flow_js_1.addRandomNumSuffix)('r-renvAlreadyInstalled');
        await (0, new_folder_flow_js_1.createNewFolder)(app, {
            folderTemplate,
            folderName,
            rEnvCheckbox: true,
        });
        await (0, new_folder_flow_js_1.verifyFolderCreation)(app, folderName);
        await (0, new_folder_flow_js_1.verifyConsoleReady)(app, folderTemplate);
        await (0, new_folder_flow_js_1.verifyRenvFilesArePresent)(app);
        await app.workbench.console.waitForConsoleContents('renv activated');
    });
    (0, _test_setup_1.test)('R - Cancel Renv install', { tag: [_test_setup_1.tags.WIN] }, async function ({ app, packages }) {
        const folderName = (0, new_folder_flow_js_1.addRandomNumSuffix)('r-cancelRenvInstall');
        await packages.manage('renv', 'uninstall');
        await (0, new_folder_flow_js_1.createNewFolder)(app, {
            folderTemplate,
            folderName,
            rEnvCheckbox: true,
        });
        await (0, new_folder_flow_js_1.handleRenvInstallModal)(app, 'cancel');
        await (0, new_folder_flow_js_1.verifyFolderCreation)(app, folderName);
        await (0, new_folder_flow_js_1.verifyConsoleReady)(app, folderTemplate);
    });
});
//# sourceMappingURL=new-folder-flow-r.test.js.map