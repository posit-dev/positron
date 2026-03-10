"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = require("assert");
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Plots', { tag: [_test_setup_1.tags.PLOTS, _test_setup_1.tags.EDITOR] }, () => {
    _test_setup_1.test.describe('R Plots', {
        tag: [_test_setup_1.tags.ARK]
    }, () => {
        (0, _test_setup_1.test)('R - plot should not be updated after initial appearance', { tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.WIN] }, async function ({ app, r }) {
            // debug - uncomment so that test plot is second plot
            // await app.workbench.console.executeCode('R', 'plot(1)');
            // await app.workbench.plots.waitForCurrentPlot();
            await app.workbench.console.executeCode('R', 'plot(rexp(50000))');
            await app.workbench.plots.waitForCurrentPlot();
            try {
                await waitForNoChangesAtLocator(app.code.driver.currentPage, '.plot-instance img', 10000);
                console.log('No changes detected for 10 seconds');
            }
            catch (error) {
                (0, assert_1.fail)('Changes detected within the specified duration');
            }
        });
    });
});
async function waitForNoChangesAtLocator(page, selector, duration = 10000) {
    await page.evaluate(({ selector, duration }) => {
        return new Promise((resolve, reject) => {
            const targetElement = document.querySelector(selector);
            if (!targetElement) {
                reject(new Error('Target element not found'));
                return;
            }
            let timeoutId;
            const observer = new MutationObserver((mutationsList) => {
                if (mutationsList.length > 0) {
                    observer.disconnect();
                    clearTimeout(timeoutId);
                    reject(new Error('Changes detected within the specified duration'));
                }
            });
            observer.observe(targetElement, {
                childList: true, // Detect child node additions/removals
                attributes: true, // Detect attribute changes
                subtree: true, // Detect changes in all descendant nodes
                characterData: true // Detect text content changes
            });
            // If no changes are detected within the duration, resolve
            timeoutId = setTimeout(() => {
                observer.disconnect();
                resolve();
            }, duration);
        });
    }, { selector, duration });
}
//# sourceMappingURL=r-plot-updates.test.js.map