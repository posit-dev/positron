"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = require("path");
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename,
    snapshots: false
});
// test is too heavy for web
_test_setup_1.test.describe('Large R Notebook', {
    tag: [_test_setup_1.tags.NOTEBOOKS]
}, () => {
    (0, _test_setup_1.test)('R - Large notebook execution', {
        tag: [_test_setup_1.tags.ARK]
    }, async function ({ app, openDataFile, runCommand, r }) {
        _test_setup_1.test.slow();
        const { notebooks, layouts } = app.workbench;
        // open the large R notebook and run all cells
        await openDataFile((0, path_1.join)('workspaces', 'large_r_notebook', 'spotify.ipynb'));
        await notebooks.selectInterpreter('R');
        await notebooks.runAllCells({ timeout: 12000 });
        // scroll through the notebook and count unique plot outputs
        await layouts.enterLayout('notebook');
        await runCommand('notebook.focusTop');
        await app.code.driver.currentPage.locator('span').filter({ hasText: 'library(dplyr)' }).locator('span').first().click();
        const allFigures = [];
        const uniqueLocators = new Set();
        for (let i = 0; i < 6; i++) {
            for (let j = 0; j < 100; j++) {
                // second param to mouse.wheel is not processed correctly so loop is needed
                await app.code.driver.currentPage.mouse.wheel(0, 1);
            }
            const figureLocator = app.workbench.notebooks.frameLocator.locator('.output_container');
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
        (0, _test_setup_1.expect)(allFigures.length).toBeGreaterThan(20);
    });
});
//# sourceMappingURL=notebook-large-r.test.js.map