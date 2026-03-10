"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = require("path");
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename,
});
// test is too heavy for web
_test_setup_1.test.describe('Large Python Notebook', {
    tag: [_test_setup_1.tags.NOTEBOOKS]
}, () => {
    _test_setup_1.test.afterAll(async function ({ hotKeys }) {
        await hotKeys.closeAllEditors();
    });
    (0, _test_setup_1.test)('Python - Large notebook execution', async function ({ app, openDataFile, runCommand, python }) {
        _test_setup_1.test.slow();
        const { notebooks, layouts } = app.workbench;
        // open the large Python notebook and run all cells
        await openDataFile((0, path_1.join)('workspaces', 'large_py_notebook', 'spotify.ipynb'));
        await notebooks.selectInterpreter('Python');
        await notebooks.runAllCells({ timeout: 12000 });
        // scroll through the notebook and count unique plot outputs
        await layouts.enterLayout('notebook');
        await runCommand('notebook.focusTop');
        await app.code.driver.currentPage.locator('span').filter({ hasText: 'import pandas as pd' }).locator('span').first().click();
        const allFigures = [];
        const uniqueLocators = new Set();
        for (let i = 0; i < 12; i++) {
            await app.code.driver.currentPage.keyboard.press('PageDown');
            const figureLocator = app.workbench.notebooks.frameLocator.locator('.plot-container');
            const figures = await figureLocator.all();
            if (figures.length > 0) {
                for (const figure of figures) {
                    if (!uniqueLocators.has(figure.toString())) {
                        allFigures.push(figure);
                        uniqueLocators.add(figure.toString());
                    }
                }
            }
        }
        (0, _test_setup_1.expect)(allFigures.length).toBeGreaterThan(15);
    });
});
//# sourceMappingURL=notebook-large-python.test.js.map