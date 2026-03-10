"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
const _test_setup_js_1 = require("./_test.setup.js");
const test_1 = require("@playwright/test");
_test_setup_js_1.test.use({
    suiteId: __filename
});
const DEFAULT_TIMEOUT = 10000;
// Test data
const createDataFrameCode = `import pandas as pd
df = pd.DataFrame({'Name': ['Alice', 'Bob', 'Charlie', 'David', 'Eve'], 'Age': [25, 30, 35, 40, 45], 'City': ['NYC', 'LA', 'Chicago', 'Houston', 'Phoenix']})
df`;
const largeDataFrameCode = `import pandas as pd
df = pd.DataFrame({'A': range(100), 'B': range(100, 200), 'C': range(200, 300), 'D': range(300, 400), 'E': range(400, 500)})
df`;
const sortableDataFrameCode = `import pandas as pd
df = pd.DataFrame({'Value': [30, 10, 50, 20, 40], 'Label': ['E', 'A', 'C', 'B', 'D']})
df`;
_test_setup_js_1.test.describe('Positron Notebooks: Inline Data Explorer', {
    tag: [_test_setup_1.tags.POSITRON_NOTEBOOKS, _test_setup_1.tags.DATA_EXPLORER, _test_setup_1.tags.WEB, _test_setup_1.tags.WIN]
}, () => {
    _test_setup_js_1.test.beforeEach(async function ({ app, python }) {
        const { notebooks, notebooksPositron } = app.workbench;
        await app.workbench.layouts.enterLayout('notebook');
        await notebooks.createNewNotebook();
        await notebooksPositron.expectToBeVisible();
        await notebooksPositron.kernel.select('Python');
    });
    (0, _test_setup_js_1.test)('Python - Verify inline data explorer renders for DataFrame output', async function ({ app }) {
        const { notebooksPositron, inlineDataExplorer } = app.workbench;
        await _test_setup_js_1.test.step('Execute cell that returns a DataFrame', async () => {
            await notebooksPositron.addCodeToCell(0, createDataFrameCode, { run: true, waitForSpinner: true });
        });
        await _test_setup_js_1.test.step('Verify inline data explorer appears', async () => {
            await inlineDataExplorer.expectToBeVisible();
            await inlineDataExplorer.expectGridToBeReady();
            await inlineDataExplorer.expectShapeToContain(5);
            await inlineDataExplorer.expectOpenButtonToBeVisible();
        });
        await _test_setup_js_1.test.step('Verify data grid content', async () => {
            await inlineDataExplorer.expectColumnHeaderToBeVisible('Name');
            await inlineDataExplorer.expectColumnHeaderToBeVisible('Age');
            await inlineDataExplorer.expectColumnHeaderToBeVisible('City');
        });
    });
    (0, _test_setup_js_1.test)('Python - Verify scroll in inline data explorer does not scroll notebook', async function ({ app }) {
        const { notebooksPositron, inlineDataExplorer } = app.workbench;
        const page = app.code.driver.currentPage;
        await _test_setup_js_1.test.step('Execute cell with large DataFrame', async () => {
            await notebooksPositron.addCodeToCell(0, largeDataFrameCode, { run: true, waitForSpinner: true });
        });
        await _test_setup_js_1.test.step('Verify inline data explorer appears', async () => {
            await inlineDataExplorer.expectToBeVisible();
            await inlineDataExplorer.expectGridToBeReady();
        });
        await _test_setup_js_1.test.step('Scroll within inline data explorer and verify notebook does not scroll', async () => {
            const notebookContainer = page.locator('.positron-notebook-cells-container');
            const scrollTopBefore = await notebookContainer.evaluate(el => el.scrollTop);
            await inlineDataExplorer.scrollWithinGrid(100);
            // Use toPass() instead of hard-coded timeout
            await (0, test_1.expect)(async () => {
                const scrollTopAfter = await notebookContainer.evaluate(el => el.scrollTop);
                (0, test_1.expect)(Math.abs(scrollTopAfter - scrollTopBefore)).toBeLessThan(5);
            }).toPass({ timeout: DEFAULT_TIMEOUT });
        });
    });
    (0, _test_setup_js_1.test)('Python - Verify open full Data Explorer and return to inline view', async function ({ app, hotKeys }) {
        const { notebooksPositron, inlineDataExplorer, dataExplorer } = app.workbench;
        const page = app.code.driver.currentPage;
        await _test_setup_js_1.test.step('Execute cell that returns a DataFrame', async () => {
            await notebooksPositron.addCodeToCell(0, createDataFrameCode, { run: true, waitForSpinner: true });
        });
        await _test_setup_js_1.test.step('Verify inline data explorer is working', async () => {
            await inlineDataExplorer.expectToBeVisible();
            await inlineDataExplorer.expectCellToBeVisible('Alice');
        });
        await _test_setup_js_1.test.step('Open full Data Explorer', async () => {
            // Count tabs before opening
            const tabsBefore = await page.locator('.tab').count();
            await inlineDataExplorer.openFullDataExplorer();
            // Wait for a new tab to appear (the Data Explorer tab)
            await (0, test_1.expect)(async () => {
                const tabsAfter = await page.locator('.tab').count();
                (0, test_1.expect)(tabsAfter).toBeGreaterThan(tabsBefore);
            }).toPass({ timeout: 15000 });
        });
        await _test_setup_js_1.test.step('Verify full Data Explorer renders', async () => {
            await dataExplorer.waitForIdle();
            await dataExplorer.expectStatusBarToHaveText(/5\s+rows\s+3\s+columns/);
        });
        await _test_setup_js_1.test.step('Close Data Explorer tab and return to notebook', async () => {
            // Close the active (Data Explorer) tab
            await hotKeys.closeTab();
            // Navigate back to the notebook tab if needed
            const notebookTab = page.locator('.tab').filter({ hasText: 'Untitled' });
            await (0, test_1.expect)(notebookTab).toBeVisible({ timeout: 5000 });
            await notebookTab.click();
        });
        await _test_setup_js_1.test.step('Verify inline data explorer still works after returning', async () => {
            await inlineDataExplorer.expectToBeVisible();
            await inlineDataExplorer.expectNoError();
            await inlineDataExplorer.expectGridToBeReady();
            await inlineDataExplorer.expectCellToBeVisible('Alice');
        });
    });
    (0, _test_setup_js_1.test)('Python - Verify column sorting in inline data explorer', async function ({ app }) {
        const { notebooksPositron, inlineDataExplorer } = app.workbench;
        await _test_setup_js_1.test.step('Execute cell with sortable DataFrame', async () => {
            await notebooksPositron.addCodeToCell(0, sortableDataFrameCode, { run: true, waitForSpinner: true });
        });
        await _test_setup_js_1.test.step('Verify inline data explorer appears', async () => {
            await inlineDataExplorer.expectToBeVisible();
            await inlineDataExplorer.expectGridToBeReady();
        });
        await _test_setup_js_1.test.step('Sort Value column ascending and verify order', async () => {
            await inlineDataExplorer.sortColumn('Value', 'ascending');
            await inlineDataExplorer.expectColumnToBeSorted('Value', [10, 20, 30, 40, 50]);
        });
        await _test_setup_js_1.test.step('Sort Value column descending and verify order', async () => {
            await inlineDataExplorer.sortColumn('Value', 'descending');
            await inlineDataExplorer.expectColumnToBeSorted('Value', [50, 40, 30, 20, 10]);
        });
    });
    (0, _test_setup_js_1.test)('Python - Verify re-execution updates the inline data explorer', async function ({ app, hotKeys }) {
        const { notebooksPositron, inlineDataExplorer } = app.workbench;
        const initialCode = `import pandas as pd
df = pd.DataFrame({'X': [1, 2, 3]})
df`;
        const updatedCode = `import pandas as pd
df = pd.DataFrame({'Y': [10, 20, 30, 40]})
df`;
        await _test_setup_js_1.test.step('Execute initial DataFrame', async () => {
            await notebooksPositron.addCodeToCell(0, initialCode, { run: true, waitForSpinner: true });
        });
        await _test_setup_js_1.test.step('Verify initial state', async () => {
            await inlineDataExplorer.expectToBeVisible();
            await inlineDataExplorer.expectGridToBeReady();
            await inlineDataExplorer.expectColumnHeaderToBeVisible('X');
            await inlineDataExplorer.expectShapeToContain(3);
        });
        await _test_setup_js_1.test.step('Clear and re-execute with different DataFrame', async () => {
            // Click cell to enter edit mode, then focus the editor programmatically
            // (native-edit-context is only visible when focused)
            await notebooksPositron.editModeAtIndex(0);
            const editor = notebooksPositron.editorAtIndex(0);
            await editor.focus();
            await hotKeys.selectAll();
            await editor.pressSequentially(updatedCode);
            await notebooksPositron.runCodeAtIndex(0);
        });
        await _test_setup_js_1.test.step('Verify updated state', async () => {
            await (0, test_1.expect)(async () => {
                await inlineDataExplorer.expectColumnHeaderToBeVisible('Y');
                await inlineDataExplorer.expectShapeToContain(4);
            }).toPass({ timeout: 15000 });
        });
    });
});
//# sourceMappingURL=notebook-inline-data-explorer.test.js.map