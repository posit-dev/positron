"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = require("path");
const _test_setup_1 = require("../_test.setup");
const infra_1 = require("../../infra");
const assert_1 = require("assert");
_test_setup_1.test.use({
    suiteId: __filename
});
// AWS Configuration
const region = "us-west-2";
const bucketName = "positron-qa-data-files";
const objectKey = "largeParquet.parquet";
const githubActions = process.env.GITHUB_ACTIONS === "true";
_test_setup_1.test.describe('Data Explorer - Very Large Data Frame', { tag: [_test_setup_1.tags.WIN, _test_setup_1.tags.DATA_EXPLORER, _test_setup_1.tags.PERFORMANCE] }, () => {
    _test_setup_1.test.beforeAll(async function ({ app }) {
        if (githubActions && process.platform !== 'win32') {
            const localFilePath = (0, path_1.join)(app.workspacePathOrFolder, "data-files", objectKey);
            const downloadOptions = {
                region: region,
                bucketName: bucketName,
                key: objectKey,
                localFilePath: localFilePath
            };
            await (0, infra_1.downloadFileFromS3)(downloadOptions);
        }
    });
    _test_setup_1.test.afterEach(async function ({ hotKeys }) {
        await hotKeys.closeAllEditors();
        await hotKeys.showSecondarySidebar();
    });
    if (githubActions && process.platform !== 'win32') {
        (0, _test_setup_1.test)('Python - Verify data loads with very large unique data dataframe', async function ({ app, openFile, runCommand, python, metric }) {
            const { dataExplorer, variables, editors } = app.workbench;
            await openFile((0, path_1.join)('workspaces', 'performance', 'loadBigParquet.py'));
            await runCommand('python.execInConsole');
            const { duration_ms } = await metric.dataExplorer.loadData(async () => {
                await variables.doubleClickVariableRow('df');
                await editors.verifyTab('Data: df', { isVisible: true, isSelected: true });
                await dataExplorer.waitForIdle();
            }, 'py.pandas.DataFrame');
            if (duration_ms > 40000) {
                (0, assert_1.fail)(`Opening large unique parquet took ${duration_ms} milliseconds (pandas)`);
            }
        });
        (0, _test_setup_1.test)('R - Verify data loads with very large unique data dataframe', async function ({ app, openFile, runCommand, r, metric }) {
            const { variables, editors, dataExplorer } = app.workbench;
            await openFile((0, path_1.join)('workspaces', 'performance', 'loadBigParquet.r'));
            await runCommand('r.sourceCurrentFile');
            // Record how long it takes to load the data
            const { duration_ms } = await metric.dataExplorer.loadData(async () => {
                await variables.doubleClickVariableRow('df2');
                await editors.verifyTab('Data: df2', { isVisible: true, isSelected: true });
                await dataExplorer.waitForIdle();
            }, 'r.tibble');
            if (duration_ms > 75000) {
                (0, assert_1.fail)(`Opening large unique parquet took ${duration_ms} milliseconds (tibble)`);
            }
        });
    }
    else {
        (0, _test_setup_1.test)('Python - Verify data loads with very large duplicated data dataframe', async function ({ app, openFile, runCommand, hotKeys, python, metric }) {
            const { dataExplorer, variables, editors } = app.workbench;
            await openFile((0, path_1.join)('workspaces', 'performance', 'multiplyParquet.py'));
            await runCommand('python.execInConsole');
            const { duration_ms } = await metric.dataExplorer.loadData(async () => {
                await variables.doubleClickVariableRow('df_large');
                await editors.verifyTab('Data: df_large', { isVisible: true, isSelected: true });
                await dataExplorer.waitForIdle();
            }, 'py.pandas.DataFrame');
            if (duration_ms > 27000) {
                (0, assert_1.fail)(`Opening large unique parquet took ${duration_ms} milliseconds (pandas)`);
            }
        });
        (0, _test_setup_1.test)('R - Verify data loads with very large duplicated data dataframe', async function ({ app, openFile, runCommand, hotKeys, r, metric }) {
            const { variables, editors, dataExplorer } = app.workbench;
            await openFile((0, path_1.join)('workspaces', 'performance', 'multiplyParquet.r'));
            await runCommand('r.sourceCurrentFile');
            const { duration_ms } = await metric.dataExplorer.loadData(async () => {
                await variables.doubleClickVariableRow('df3_large');
                await editors.verifyTab('Data: df3_large', { isVisible: true, isSelected: true });
                await dataExplorer.waitForIdle();
            }, 'r.tibble');
            if (duration_ms > 60000) {
                (0, assert_1.fail)(`Opening large unique parquet took ${duration_ms} milliseconds (tibble)`);
            }
        });
    }
});
//# sourceMappingURL=very-large-data-frame.test.js.map