"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
let editorActionBar;
let dataExplorer;
const testCases = [
    {
        title: 'R - Can load data frame via variables pane',
        openFile: 'workspaces/generate-data-frames-r/simple-data-frames.r',
        variable: 'df',
        tabName: 'Data: df',
    },
    {
        title: 'Python - Can load data frame via variables pane',
        openFile: 'workspaces/generate-data-frames-py/simple-data-frames.py',
        variable: 'df',
        tabName: 'Data: df',
    },
    {
        title: 'Can open parquet file via DuckDB',
        openDataFile: 'data-files/100x100/100x100.parquet',
        tabName: 'Data: 100x100.parquet',
    },
    {
        title: 'Can open CSV file via DuckDB',
        openDataFile: 'data-files/flights/flights.csv',
        tabName: 'Data: flights.csv'
    }
];
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Editor Action Bar: Data Files', {
    tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.WIN, _test_setup_1.tags.EDITOR_ACTION_BAR, _test_setup_1.tags.DATA_EXPLORER]
}, () => {
    _test_setup_1.test.beforeAll(async function ({ app }) {
        editorActionBar = app.workbench.editorActionBar;
        dataExplorer = app.workbench.dataExplorer;
    });
    _test_setup_1.test.afterEach(async function ({ runCommand }) {
        await runCommand('workbench.action.closeAllEditors');
        await runCommand('Console: Clear Console');
    });
    for (const testCase of testCases) {
        (0, _test_setup_1.test)(testCase.title, async function ({ app, sessions, openDataFile, openFile }) {
            // Set interpreter
            const language = testCase.title.startsWith('R') ? 'r' : 'python';
            await sessions.start(language);
            // Open file
            testCase.openFile
                ? await openFile(testCase.openFile)
                : await openDataFile(testCase.openDataFile);
            // Open data explorer via variable pane
            if (testCase.variable) {
                await openDataExplorerViaVariablePane(app, testCase.variable, testCase.tabName);
            }
            // Ensure the summary panel is visible
            await dataExplorer.summaryPanel.show();
            // Verify action bar behavior
            await editorActionBar.selectSummaryOn(app.web, 'Left');
            await editorActionBar.verifySummaryPosition('Left');
            await editorActionBar.selectSummaryOn(app.web, 'Right');
            await editorActionBar.verifySummaryPosition('Right');
            await editorActionBar.clickButton('Split Editor Right');
            await editorActionBar.verifySplitEditor('right', testCase.tabName);
            await editorActionBar.clickButton('Split Editor Down');
            await editorActionBar.verifySplitEditor('down', testCase.tabName);
            await editorActionBar.verifyOpenInNewWindow(app.web, testCase.tabName);
        });
    }
});
async function openDataExplorerViaVariablePane(app, variable, tabName) {
    await _test_setup_1.test.step('Open data explorer via variable pane', async () => {
        await app.workbench.editor.playButton.click();
        await app.workbench.variables.doubleClickVariableRow(variable);
        await app.code.driver.currentPage.getByRole('tablist').locator('.tab').first().click();
        await app.code.driver.currentPage.getByLabel('Close').first().click();
        await (0, _test_setup_1.expect)(app.code.driver.currentPage.getByText(tabName, { exact: true })).toBeVisible();
    });
}
//# sourceMappingURL=editor-action-bar-data-files.test.js.map