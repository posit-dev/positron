"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Layouts', { tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.LAYOUTS, _test_setup_1.tags.WIN, _test_setup_1.tags.WORKBENCH, _test_setup_1.tags.CROSS_BROWSER] }, () => {
    _test_setup_1.test.describe('Stacked Layout', () => {
        (0, _test_setup_1.test)('Verify Stacked Layout displays Console, Terminal, and Auxiliary Sections in correct order', async function ({ app }) {
            const layouts = app.workbench.layouts;
            await app.code.driver.currentPage.setViewportSize({ width: 1400, height: 1000 });
            // Enter layout with help pane docked in session panel
            await layouts.enterLayout('stacked');
            // ------ Sidebar -------
            await (0, _test_setup_1.expect)(layouts.sidebar).toBeVisible();
            // ------ Panel -------
            await (0, _test_setup_1.expect)(layouts.panelContent).toBeVisible();
            // The console tab should be in the panel at the first position followed by the
            // terminal tab
            await (0, _test_setup_1.expect)(layouts.panelViewsTab.nth(0)).toHaveText('Console');
            await (0, _test_setup_1.expect)(layouts.panelViewsTab.nth(1)).toHaveText('Terminal');
            // ------ Auxiliary Bar -------
            await (0, _test_setup_1.expect)(layouts.auxBar).toBeVisible();
            // First view should be the session view
            await (0, _test_setup_1.expect)(layouts.auxBarViewsTab.nth(0)).toHaveText('Session');
            const variablesSection = layouts.auxBar.getByLabel('Variables Section');
            const plotsSection = layouts.auxBar.getByLabel('Plots Section');
            await (0, _test_setup_1.expect)(variablesSection).toBeVisible();
            await (0, _test_setup_1.expect)(plotsSection).toBeVisible();
            // Neither section should be collapsed
            await (0, _test_setup_1.expect)(variablesSection).toHaveAttribute('aria-expanded', 'true');
            await (0, _test_setup_1.expect)(plotsSection).toHaveAttribute('aria-expanded', 'true');
            // Variables section should sit above the plots section
            const variablesSectionY = await layouts.boundingBoxProperty(variablesSection, 'y');
            const plotsSectionY = await layouts.boundingBoxProperty(plotsSection, 'y');
            (0, _test_setup_1.expect)(variablesSectionY).toBeLessThan(plotsSectionY);
            await (0, _test_setup_1.expect)(layouts.auxBar).toBeVisible();
        });
    });
    _test_setup_1.test.describe('Side-by-side Layout', () => {
        (0, _test_setup_1.test)('Verify Side-by-Side Layout collapses Sidebar and Panel while arranging Console, Variables, and Plots', async function ({ app }) {
            const layouts = app.workbench.layouts;
            // Enter layout with help pane docked in session panel
            await layouts.enterLayout('side_by_side');
            // ------ Panel and Sidebar -------
            // Both should be collapsed.
            await (0, _test_setup_1.expect)(layouts.panelContent).not.toBeVisible();
            await (0, _test_setup_1.expect)(layouts.sidebar).not.toBeVisible();
            // ------ Auxiliary Bar -------
            await (0, _test_setup_1.expect)(layouts.auxBar).toBeVisible();
            // First view should be the session view, second should be terminal
            await (0, _test_setup_1.expect)(layouts.auxBarViewsTab.nth(0)).toHaveText('Session');
            await (0, _test_setup_1.expect)(layouts.auxBarViewsTab.nth(1)).toHaveText('Terminal');
            const consoleSection = layouts.auxBar.getByLabel(/console section/i);
            const variablesSection = layouts.auxBar.getByLabel(/variables section/i);
            const plotsSection = layouts.auxBar.getByLabel(/plots section/i);
            await (0, _test_setup_1.expect)(consoleSection).toBeVisible();
            await (0, _test_setup_1.expect)(variablesSection).toBeVisible();
            await (0, _test_setup_1.expect)(plotsSection).toBeVisible();
            // Only the console section should be expanded
            await (0, _test_setup_1.expect)(consoleSection).toHaveAttribute('aria-expanded', 'true');
            await (0, _test_setup_1.expect)(variablesSection).toHaveAttribute('aria-expanded', 'false');
            await (0, _test_setup_1.expect)(plotsSection).toHaveAttribute('aria-expanded', 'false');
            // Should be in vertical order of console, variables, plots
            const consoleY = await layouts.boundingBoxProperty(consoleSection, 'y');
            const variablesY = await layouts.boundingBoxProperty(variablesSection, 'y');
            const plotsY = await layouts.boundingBoxProperty(plotsSection, 'y');
            (0, _test_setup_1.expect)(consoleY).toBeLessThan(variablesY);
            (0, _test_setup_1.expect)(variablesY).toBeLessThan(plotsY);
        });
    });
    _test_setup_1.test.describe('Notebook Layout', () => {
        (0, _test_setup_1.test)('Verify Notebook Layout collapses Panel by default and expands correctly', async function ({ app }) {
            const layouts = app.workbench.layouts;
            // Enter layout with help pane docked in session panel
            await layouts.enterLayout('notebook');
            // ------ Panel -------
            // Panel should be collapsed
            await (0, _test_setup_1.expect)(layouts.panelContent).not.toBeVisible();
            // In the collapsed layout, the first tab should be the console and the second
            // should be the terminal
            await (0, _test_setup_1.expect)(layouts.panelViewsTab.nth(0)).toHaveText('Console');
            await (0, _test_setup_1.expect)(layouts.panelViewsTab.nth(1)).toHaveText('Terminal');
            // When expanding the panel it should go to roughly 40% the height of the window
            await layouts.panelExpandButton.click();
            const fullAppHeight = await layouts.boundingBoxProperty(layouts.fullApp, 'height');
            const panelHeight = await layouts.boundingBoxProperty(layouts.panel, 'height');
            (0, _test_setup_1.expect)(panelHeight).toBeGreaterThan(fullAppHeight * 0.3);
            // ------ Sidebar -------
            // If the sidebar is collapsed is dependent upon the size of the window. If it
            // is _not_ collapsed, then it needs to be wider than 180px.
            // TODO: Test this after resizing the window to make sure behavior is correct.
            try {
                const sidebarWidth = await layouts.boundingBoxProperty(layouts.sidebar, 'width');
                if (sidebarWidth) {
                    (0, _test_setup_1.expect)(sidebarWidth).toBeGreaterThan(180);
                }
            }
            catch (e) {
                // No op if the sidebar isn't visible
            }
        });
    });
    _test_setup_1.test.describe('Assistant Layout', () => {
        _test_setup_1.test.afterEach('Reset Layout', async function ({ app }) {
            await app.workbench.layouts.enterLayout('stacked');
        });
        (0, _test_setup_1.test)('Verify Assistant Layout displays all three main parts', async function ({ app }) {
            const layouts = app.workbench.layouts;
            // Enter assistant layout
            await layouts.enterLayout('assistant');
            // ------ Sidebar -------
            // Should be visible with the Chat view
            await (0, _test_setup_1.expect)(layouts.sidebar).toBeVisible();
            // ------ Panel -------
            // Should be visible with Console and Terminal tabs
            await (0, _test_setup_1.expect)(layouts.panelContent).toBeVisible();
            await (0, _test_setup_1.expect)(layouts.panelViewsTab.nth(0)).toHaveText('Console');
            await (0, _test_setup_1.expect)(layouts.panelViewsTab.nth(1)).toHaveText('Terminal');
            // ------ Auxiliary Bar -------
            // Should be visible with Session view
            await (0, _test_setup_1.expect)(layouts.auxBar).toBeVisible();
            await (0, _test_setup_1.expect)(layouts.auxBarViewsTab.nth(0)).toHaveText('Session');
            const variablesSection = layouts.auxBar.getByLabel('Variables Section');
            const plotsSection = layouts.auxBar.getByLabel('Plots Section');
            await (0, _test_setup_1.expect)(variablesSection).toBeVisible();
            await (0, _test_setup_1.expect)(plotsSection).toBeVisible();
            // Both sections should be expanded
            await (0, _test_setup_1.expect)(variablesSection).toHaveAttribute('aria-expanded', 'true');
            await (0, _test_setup_1.expect)(plotsSection).toHaveAttribute('aria-expanded', 'true');
        });
    });
});
//# sourceMappingURL=layouts.test.js.map