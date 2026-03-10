"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = require("path");
const _test_setup_1 = require("../_test.setup");
const test_1 = require("@playwright/test");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Matplotlib Interact', { tag: [_test_setup_1.tags.PLOTS, _test_setup_1.tags.NOTEBOOKS] }, () => {
    (0, _test_setup_1.test)('Python - Matplotlib Interact Test', {
        tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.WIN],
    }, async function ({ app, hotKeys, python }) {
        const { notebooks, quickaccess } = app.workbench;
        // open the Matplotlib Interact notebook and run all cells
        await quickaccess.openDataFile((0, path_1.join)(app.workspacePathOrFolder, 'workspaces', 'matplotlib', 'interact.ipynb'));
        await notebooks.selectInterpreter('Python');
        await hotKeys.closeSecondarySidebar();
        await notebooks.runAllCells();
        await hotKeys.toggleBottomPanel();
        // interact with the sliders and verify the plot updates
        const plotLocator = notebooks.frameLocator.locator('.widget-output');
        const plotImageLocator = plotLocator.locator('img');
        const imgSrcBefore = await plotImageLocator.getAttribute('src');
        const sliders = await notebooks.frameLocator.locator('.slider-container .slider').all();
        for (const slider of sliders) {
            await slider.hover();
            await slider.click();
        }
        const imgSrcAfter = await plotImageLocator.getAttribute('src');
        (0, test_1.expect)(imgSrcBefore).not.toBe(imgSrcAfter);
    });
});
//# sourceMappingURL=matplotlib-interact.test.js.map