/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Layouts', { tag: [tags.WEB, tags.LAYOUTS, tags.WIN] }, () => {

	test.describe('Stacked Layout', () => {

		test('Verify Stacked Layout displays Console, Terminal, and Auxiliary Sections in correct order', async function ({ app }) {
			const layouts = app.positron.layouts;

			await app.code.driver.page.setViewportSize({ width: 1400, height: 1000 });

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

		test('Verify Side-by-Side Layout collapses Sidebar and Panel while arranging Console, Variables, and Plots', async function ({ app }) {

			const layouts = app.positron.layouts;

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

		test('Verify Notebook Layout collapses Panel by default and expands correctly', async function ({ app }) {

			const layouts = app.positron.layouts;

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

			// ------ Auxiliary Bar -------
			// Should be collapsed
			await expect(layouts.auxBar).not.toBeVisible();
		});
	});
});
