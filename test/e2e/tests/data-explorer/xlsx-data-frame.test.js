"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = require("path");
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Data Explorer - XLSX', {
    tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.WIN, _test_setup_1.tags.DATA_EXPLORER, _test_setup_1.tags.PERFORMANCE]
}, () => {
    _test_setup_1.test.afterEach(async function ({ hotKeys }) {
        await hotKeys.closeAllEditors();
        await hotKeys.showSecondarySidebar();
    });
    (0, _test_setup_1.test)('Python - Verify data explorer functionality with XLSX input', async function ({ app, python, openFile, runCommand, hotKeys, metric }) {
        const { dataExplorer, variables, editors } = app.workbench;
        await openFile((0, path_1.join)('workspaces', 'read-xlsx-py', 'supermarket-sales.py'));
        await runCommand('python.execInConsole');
        await metric.dataExplorer.loadData(async () => {
            await variables.doubleClickVariableRow('df');
            await editors.verifyTab('Data: df', { isVisible: true });
            await dataExplorer.waitForIdle();
        }, 'py.pandas.DataFrame');
        await hotKeys.closeSecondarySidebar();
        await dataExplorer.grid.sortColumnBy(1, 'Sort Descending');
        const visibleTableData = await dataExplorer.grid.getData();
        const firstRow = visibleTableData.at(0);
        (0, _test_setup_1.expect)(firstRow['Invoice ID']).toBe('898-04-2717');
    });
    (0, _test_setup_1.test)('R - Verify data explorer functionality with XLSX input', async function ({ app, r, openFile, runCommand, hotKeys, metric }) {
        const { dataExplorer, variables, editors } = app.workbench;
        await openFile((0, path_1.join)('workspaces', 'read-xlsx-r', 'supermarket-sales.r'));
        await runCommand('r.sourceCurrentFile');
        await metric.dataExplorer.loadData(async () => {
            await variables.doubleClickVariableRow('df2');
            await editors.verifyTab('Data: df2', { isVisible: true });
            await dataExplorer.waitForIdle();
        }, 'r.tibble');
        await hotKeys.closeSecondarySidebar();
        await dataExplorer.grid.sortColumnBy(1, 'Sort Descending');
        const visibleTableData = await dataExplorer.grid.getData();
        const firstRow = visibleTableData.at(0);
        (0, _test_setup_1.expect)(firstRow['Invoice ID']).toBe('898-04-2717');
    });
});
//# sourceMappingURL=xlsx-data-frame.test.js.map