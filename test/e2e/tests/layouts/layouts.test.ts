/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

// NOTE: the browser/web-based tags (@:web, @:cross-browser, @:workbench, @:jupyter)
// are not on this describe. They are applied per-test below so the "opens the Posit
// Assistant view" test can opt out of every browser-based project -- it fails on web
// (see #13933) and the same focus race hits the other browser configs.
test.describe('Layouts', { tag: [tags.LAYOUTS, tags.WIN] }, () => {

	test.describe('Stacked Layout', () => {

		test('Verify Stacked Layout displays Console, Terminal, and Auxiliary Sections in correct order', { tag: [tags.WEB, tags.CROSS_BROWSER, tags.WORKBENCH, tags.JUPYTER] }, async function ({ app }) {
			const layouts = app.workbench.layouts;

			await app.code.driver.currentPage.setViewportSize({ width: 1400, height: 1000 });

			// Enter layout with help pane docked in session panel
			await layouts.enterLayout('stacked');

			// ------ Sidebar -------
			await expect(layouts.sidebar).toBeVisible();

			// ------ Panel -------
			await expect(layouts.panelContent).toBeVisible();

			// The console tab should be in the panel at the first position followed by the
			// terminal tab
			await expect(layouts.panelViewsTab.nth(0)).toHaveText('Console');
			await expect(layouts.panelViewsTab.nth(1)).toHaveText('Terminal');

			// ------ Auxiliary Bar -------
			await expect(layouts.auxBar).toBeVisible();

			// First view should be the session view
			await expect(layouts.auxBarViewsTab.nth(0)).toHaveText('Session');

			const variablesSection = layouts.auxBar.getByLabel('Variables Section');
			const plotsSection = layouts.auxBar.getByLabel('Plots Section');
			await expect(variablesSection).toBeVisible();
			await expect(plotsSection).toBeVisible();

			// Neither section should be collapsed
			await expect(variablesSection).toHaveAttribute('aria-expanded', 'true');
			await expect(plotsSection).toHaveAttribute('aria-expanded', 'true');

			// Variables section should sit above the plots section
			const variablesSectionY = await layouts.boundingBoxProperty(variablesSection, 'y');
			const plotsSectionY = await layouts.boundingBoxProperty(plotsSection, 'y');
			expect(variablesSectionY).toBeLessThan(plotsSectionY);

			await expect(layouts.auxBar).toBeVisible();
		});
	});

	test.describe('Side-by-side Layout', () => {

		test('Verify Side-by-Side Layout collapses Sidebar and Panel while arranging Console, Variables, and Plots', { tag: [tags.WEB, tags.CROSS_BROWSER, tags.WORKBENCH, tags.JUPYTER] }, async function ({ app }) {

			const layouts = app.workbench.layouts;

			// Enter layout with help pane docked in session panel
			await layouts.enterLayout('side_by_side');

			// ------ Panel and Sidebar -------
			// Both should be collapsed.
			await expect(layouts.panelContent).not.toBeVisible();
			await expect(layouts.sidebar).not.toBeVisible();

			// ------ Auxiliary Bar -------
			await expect(layouts.auxBar).toBeVisible();

			// First view should be the session view, second should be terminal
			await expect(layouts.auxBarViewsTab.nth(0)).toHaveText('Session');
			await expect(layouts.auxBarViewsTab.nth(1)).toHaveText('Terminal');

			const consoleSection = layouts.auxBar.getByLabel(/console section/i);
			const variablesSection = layouts.auxBar.getByLabel(/variables section/i);
			const plotsSection = layouts.auxBar.getByLabel(/plots section/i);
			await expect(consoleSection).toBeVisible();
			await expect(variablesSection).toBeVisible();
			await expect(plotsSection).toBeVisible();

			// Only the console section should be expanded
			await expect(consoleSection).toHaveAttribute('aria-expanded', 'true');
			await expect(variablesSection).toHaveAttribute('aria-expanded', 'false');
			await expect(plotsSection).toHaveAttribute('aria-expanded', 'false');

			// Should be in vertical order of console, variables, plots
			const consoleY = await layouts.boundingBoxProperty(consoleSection, 'y');
			const variablesY = await layouts.boundingBoxProperty(variablesSection, 'y');
			const plotsY = await layouts.boundingBoxProperty(plotsSection, 'y');
			expect(consoleY).toBeLessThan(variablesY);
			expect(variablesY).toBeLessThan(plotsY);
		});
	});

	test.describe('Notebook Layout', () => {

		test('Verify Notebook Layout collapses Panel by default and expands correctly', { tag: [tags.WEB, tags.CROSS_BROWSER, tags.WORKBENCH, tags.JUPYTER] }, async function ({ app }) {

			const layouts = app.workbench.layouts;

			// Enter layout with help pane docked in session panel
			await layouts.enterLayout('notebook');

			// ------ Panel -------
			// Panel should be collapsed
			await expect(layouts.panelContent).not.toBeVisible();

			// In the collapsed layout, the first tab should be the console and the second
			// should be the terminal
			await expect(layouts.panelViewsTab.nth(0)).toHaveText('Console');
			await expect(layouts.panelViewsTab.nth(1)).toHaveText('Terminal');

			// When expanding the panel it should go to roughly 40% the height of the window
			await layouts.panelExpandButton.click();
			const fullAppHeight = await layouts.boundingBoxProperty(layouts.fullApp, 'height');
			const panelHeight = await layouts.boundingBoxProperty(layouts.panel, 'height');
			expect(panelHeight).toBeGreaterThan(fullAppHeight * 0.3);


			// ------ Sidebar -------
			// If the sidebar is collapsed is dependent upon the size of the window. If it
			// is _not_ collapsed, then it needs to be wider than 180px.
			// TODO: Test this after resizing the window to make sure behavior is correct.
			try {
				const sidebarWidth = await layouts.boundingBoxProperty(layouts.sidebar, 'width');
				if (sidebarWidth) {
					expect(sidebarWidth).toBeGreaterThan(180);
				}
			} catch (e) {
				// No op if the sidebar isn't visible
			}
		});
	});

	test.describe.skip('Assistant Layout', {
		tag: [tags.ASSISTANT],
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/14037' }]
	}, () => {
		test.afterEach('Reset Layout', async function ({ app }) {
			await app.workbench.layouts.enterLayout('stacked');
		});

		test.afterAll('Reset Settings', async function ({ settings }) {
			// `assistant.enabled` is worker-scoped; clear it once so it doesn't leak to other files
			await settings.remove(['assistant.enabled']);
		});


		test('Verify Assistant Layout displays all three main parts and opens the legacy chat view', { tag: [tags.WEB, tags.CROSS_BROWSER, tags.WORKBENCH, tags.JUPYTER] }, async function ({ app, settings }) {
			const layouts = app.workbench.layouts;

			// Pin the legacy fallback branch (Posit Assistant disabled)
			await settings.set({ 'assistant.enabled': false });

			// Enter assistant layout
			await layouts.enterLayout('assistant');

			// ------ Sidebar -------
			// Should open and focus the legacy Chat view
			await expect(layouts.sidebar).toBeVisible();
			await layouts.expectActiveSidebarView('Chat');

			// ------ Panel -------
			// Should be visible with Console and Terminal tabs
			await expect(layouts.panelContent).toBeVisible();
			await expect(layouts.panelViewsTab.nth(0)).toHaveText('Console');
			await expect(layouts.panelViewsTab.nth(1)).toHaveText('Terminal');

			// ------ Auxiliary Bar -------
			// Should be visible with Session view
			await expect(layouts.auxBar).toBeVisible();
			await expect(layouts.auxBarViewsTab.nth(0)).toHaveText('Session');

			const variablesSection = layouts.auxBar.getByLabel('Variables Section');
			const plotsSection = layouts.auxBar.getByLabel('Plots Section');
			await expect(variablesSection).toBeVisible();
			await expect(plotsSection).toBeVisible();

			// Both sections should be expanded
			await expect(variablesSection).toHaveAttribute('aria-expanded', 'true');
			await expect(plotsSection).toHaveAttribute('aria-expanded', 'true');
		});

		// Intentionally untagged for every browser-based project (no @:web, @:cross-browser,
		// @:workbench, or @:jupyter). This fails deterministically on web (chromium), where
		// the Assistant layout loses the focus race opening the webview-backed Posit Assistant
		// view; #13989 attempted a fix but did not resolve it. Runs on desktop
		// (electron/windows/macOS, via inherited @:win) only, pending a real fix (#13933).
		test('Verify Assistant Layout opens the Posit Assistant view when enabled', async function ({ app, settings }) {
			const layouts = app.workbench.layouts;

			// Enable Posit Assistant so the layout targets its view container
			await settings.set({ 'assistant.enabled': true });

			// Enter assistant layout
			await layouts.enterLayout('assistant');

			// ------ Sidebar -------
			// Should open and focus the Posit Assistant view
			await expect(layouts.sidebar).toBeVisible();
			await app.workbench.positAssistant.expectViewOpen();
		});
	});
});
