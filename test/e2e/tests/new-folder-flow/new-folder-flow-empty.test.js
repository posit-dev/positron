"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const infra_1 = require("../../infra");
const _test_setup_1 = require("../_test.setup");
const new_folder_flow_js_1 = require("./helpers/new-folder-flow.js");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('New Folder Flow: Empty Project', { tag: [_test_setup_1.tags.MODAL, _test_setup_1.tags.NEW_FOLDER_FLOW, _test_setup_1.tags.WEB] }, () => {
    const folderTemplate = infra_1.FolderTemplate.EMPTY_PROJECT;
    (0, _test_setup_1.test)('Verify empty folder defaults', { tag: [_test_setup_1.tags.CRITICAL, _test_setup_1.tags.WIN] }, async function ({ app }) {
        const { newFolderFlow } = app.workbench;
        const folderName = (0, new_folder_flow_js_1.addRandomNumSuffix)('empty-project');
        // Create a new empty project folder
        await newFolderFlow.createNewFolder({
            folderTemplate,
            folderName
        });
        await newFolderFlow.verifyFolderCreation(folderName);
        await (0, new_folder_flow_js_1.verifyPyprojectTomlNotCreated)(app);
    });
    (0, _test_setup_1.test)('Verify empty folder with git initialization', async function ({ app }) {
        const { newFolderFlow } = app.workbench;
        const folderName = (0, new_folder_flow_js_1.addRandomNumSuffix)('empty-project-git');
        // Create a new empty project folder with git initialized
        await newFolderFlow.createNewFolder({
            folderTemplate,
            folderName,
            initGitRepo: true
        });
        await newFolderFlow.verifyFolderCreation(folderName);
        await (0, test_1.expect)(async () => {
            await (0, new_folder_flow_js_1.verifyGitStatus)(app);
        }).toPass({ timeout: 120000 });
    });
});
//# sourceMappingURL=new-folder-flow-empty.test.js.map