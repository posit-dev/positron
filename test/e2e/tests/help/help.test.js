"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Help', { tag: [_test_setup_1.tags.HELP, _test_setup_1.tags.WEB] }, () => {
    _test_setup_1.test.beforeAll(async function ({ settings }) {
        // Enable reduced motion so we don't have to wait for animations of expanding
        // and collapsing the panel.
        await settings.set({ 'workbench.reduceMotion': 'on' }, { reload: 'web' });
    });
    (0, _test_setup_1.test)('Python - Verify Help landing page', { tag: [_test_setup_1.tags.WIN] }, async function ({ app }) {
        await app.workbench.layouts.enterLayout('fullSizedAuxBar');
        await app.workbench.help.openHelpPanel();
        const helpFrame = await app.workbench.help.getHelpWelcomePageFrame();
        const docLink = helpFrame.getByRole('link', { name: 'Positron Documentation' });
        await (0, _test_setup_1.expect)(docLink).toBeVisible();
        await (0, _test_setup_1.expect)(docLink).toHaveAttribute('href', 'https://positron.posit.co/');
        const newsletterLink = helpFrame.getByRole('link', { name: 'Sign Up for Positron Updates' });
        await (0, _test_setup_1.expect)(newsletterLink).toBeVisible();
        await (0, _test_setup_1.expect)(newsletterLink).toHaveAttribute('href', 'https://posit.co/positron-updates-signup/');
        await app.workbench.layouts.enterLayout('stacked');
    });
    (0, _test_setup_1.test)('Python - Verify basic help functionality', { tag: [_test_setup_1.tags.WIN] }, async function ({ app, python }) {
        await app.workbench.console.executeCode('Python', `?load`);
        await (0, _test_setup_1.expect)(async () => {
            const helpFrame = await app.workbench.help.getHelpFrame(0);
            await (0, _test_setup_1.expect)(helpFrame.locator('body')).toContainText('Load code into the current frontend.');
        }).toPass();
    });
    (0, _test_setup_1.test)('R - Verify basic help functionality', { tag: [_test_setup_1.tags.WIN] }, async function ({ app, r }) {
        await app.workbench.console.executeCode('R', `?load()`);
        await (0, _test_setup_1.expect)(async () => {
            const helpFrame = await app.workbench.help.getHelpFrame(1);
            await (0, _test_setup_1.expect)(helpFrame.locator('body')).toContainText('Reload Saved Datasets');
        }).toPass();
    });
    (0, _test_setup_1.test)('Verify help panel opens when empty, can be resized smaller, and remembers size height', { tag: [_test_setup_1.tags.WIN] }, async function ({ app, logger }) {
        // Not running on windows as the size calculation is off for the resolution in CI
        const help = app.workbench.help;
        const helpContainerLocator = help.getHelpContainer();
        const helpPanelHeaderLocator = help.getHelpHeader();
        const getHelpHeight = async () => (await helpContainerLocator.boundingBox())?.height ?? -1;
        // How close should our heights be? It's not totally clear why this isn't always
        // exact, but it's likely due to rounding errors or other factors. We'll allow
        // a small margin of error.
        const sizePrecision = 5;
        // Enter layout with help pane docked in session panel
        await app.workbench.layouts.enterLayout('dockedHelp');
        // Help panel starts collapsed thanks to the above command
        await (0, _test_setup_1.expect)(helpContainerLocator).not.toBeVisible();
        // Clicking the header opens it
        await helpPanelHeaderLocator.click();
        await (0, _test_setup_1.expect)(helpContainerLocator).toBeVisible();
        // Make sure that an empty help panel actually expands to a visible size.
        const helpPanelHeight = await getHelpHeight();
        (0, _test_setup_1.expect)(helpPanelHeight).toBeGreaterThan(100);
        // Now resize the help panel smaller than the pop-open size and make sure that
        // when we collapse and reopen it doesn't pop back to the full size again.
        // We'll make it roughly two thirds the size of the original height
        const resize_delta = helpPanelHeight / 3;
        const expectedHeightAfterResize = helpPanelHeight - resize_delta;
        await help.resizeHelpPanel({ y: resize_delta });
        // Verify that the height has changed by the expected amount
        const helpPanelHeightAfter = await getHelpHeight();
        (0, _test_setup_1.expect)(expectedHeightAfterResize - helpPanelHeightAfter)
            .toBeLessThan(sizePrecision);
        // Now collapse the panel again
        await helpPanelHeaderLocator.click();
        await (0, _test_setup_1.expect)(helpContainerLocator).not.toBeVisible();
        // Reopen the panel
        await helpPanelHeaderLocator.click();
        if (helpPanelHeightAfter <= 100) {
            // When the panel is small enough, it will pop back to the full size.
            // This can happen if the window used for testing is too small.
            // In this case we want to end the test early because the behavior wont be as
            // expected.
            // TODO: Make sure window is a set size at start of test.
            logger.log('Window too small to test resize memory. Skipping end of help panel collapse test.');
            return;
        }
        // Make sure that the panel is smaller than it was before after opening up.
        // Should be roughly the same size it was before we collapsed it. Allow for
        // small deviations due to rounding errors etc..
        const helpPanelHeightAfterReopen = await getHelpHeight();
        (0, _test_setup_1.expect)(Math.abs(helpPanelHeightAfterReopen - helpPanelHeightAfter))
            .toBeLessThan(sizePrecision);
    });
});
//# sourceMappingURL=help.test.js.map