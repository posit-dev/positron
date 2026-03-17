"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const _test_setup_1 = require("../_test.setup");
const _test_setup_js_1 = require("./_test.setup.js");
_test_setup_js_1.test.use({
    suiteId: __filename
});
// Generates a simple matplotlib plot
const matplotlibPlotCode = `import matplotlib.pyplot as plt
plt.figure(figsize=(3, 2))
plt.plot([1, 2, 3], [1, 4, 9])
plt.show()`;
_test_setup_js_1.test.describe('Positron Notebooks: Copy Output Image', {
    tag: [_test_setup_1.tags.POSITRON_NOTEBOOKS, _test_setup_1.tags.WIN, _test_setup_1.tags.WEB]
}, () => {
    _test_setup_js_1.test.beforeEach(async function ({ app, python }) {
        const { notebooks, notebooksPositron } = app.workbench;
        await app.workbench.layouts.enterLayout('notebook');
        await notebooks.createNewNotebook();
        await notebooksPositron.expectToBeVisible();
        await notebooksPositron.kernel.select('Python');
    });
    (0, _test_setup_js_1.test)('Copy Image appears in output ellipsis menu for plot output', async function ({ app, headless }) {
        _test_setup_js_1.test.skip(!!headless, 'Clipboard image tests require headed mode');
        const { notebooksPositron, contextMenu } = app.workbench;
        await _test_setup_js_1.test.step('Execute cell that generates a plot', async () => {
            await notebooksPositron.addCodeToCell(0, matplotlibPlotCode, { run: true, waitForSpinner: true });
        });
        const cellOutput = notebooksPositron.cell.nth(0).getByTestId('cell-output');
        const ellipsisButton = notebooksPositron.cell.nth(0).getByRole('button', { name: 'Cell Output Actions' });
        await _test_setup_js_1.test.step('Verify plot image appears in output', async () => {
            await (0, test_1.expect)(cellOutput.locator('img')).toBeVisible();
        });
        await _test_setup_js_1.test.step('Verify Copy Image option exists in ellipsis menu', async () => {
            // Retry to handle timing: context keys may not be set on the first
            // attempt due to the React render cycle.
            await (0, test_1.expect)(async () => {
                await contextMenu.triggerAndVerifyMenuItems({
                    menuTrigger: ellipsisButton,
                    menuTriggerButton: 'left',
                    menuItemStates: [{ label: 'Copy Image', visible: true }],
                });
            }).toPass({ timeout: 15000 });
        });
        await _test_setup_js_1.test.step('Click Copy Image and verify clipboard has image data', async () => {
            await app.workbench.clipboard.clearClipboard();
            await contextMenu.triggerAndClick({
                menuTrigger: ellipsisButton,
                menuTriggerButton: 'left',
                menuItemLabel: 'Copy Image',
            });
            await (0, test_1.expect)(async () => {
                const clipboardImageBuffer = await app.workbench.clipboard.getClipboardImage();
                (0, test_1.expect)(clipboardImageBuffer).not.toBeNull();
            }).toPass({ timeout: 15000 });
        });
    });
});
//# sourceMappingURL=notebook-copy-output-image.test.js.map