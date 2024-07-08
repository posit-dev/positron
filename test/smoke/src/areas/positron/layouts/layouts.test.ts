/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import { Application, Logger } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';

/*
 * Test cases for Positron layouts
 */
export function setup(logger: Logger) {
	describe('Layouts', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		describe('Layouts appear in the customize layouts dropdown', () => {

			it('Verify the stacked layout appears in the customize layouts dropdown', async function () {

				const app = this.app as Application;
				const layouts = app.workbench.positronLayouts;
				const quickPick = layouts.fullApp.locator('.quick-input-widget');
				const quickPickRows = quickPick.getByRole('option');

				// Open the customize layout dropdown
				await layouts.customizeLayoutButton.click();

				// Make sure dropdown is open before continuing
				await expect(quickPick.getByText('Customize Layout')).toBeVisible();

				// Make sure all the layouts are visible
				await expect(quickPickRows.getByText(/stacked layout/i)).toBeVisible();
				await expect(quickPickRows.getByText(/side-by-side layout/i)).toBeVisible();
				await expect(quickPickRows.getByText(/notebook layout/i)).toBeVisible();
			});
		});


		describe('Stacked Layout', () => {

			it('Verify stacked layout puts stuff in appropriate places', async function () {

				const app = this.app as Application;
				const layouts = app.workbench.positronLayouts;

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

		describe('Side-by-side Layout', () => {

			it('Verify Side-by-side layout puts stuff in appropriate places', async function () {

				const app = this.app as Application;
				const layouts = app.workbench.positronLayouts;

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

		describe('Notebook Layout', () => {

			it('Verify notebook layout puts stuff in appropriate places', async function () {

				const app = this.app as Application;
				const layouts = app.workbench.positronLayouts;

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
				const sidebarWidth = await layouts.boundingBoxProperty(layouts.sidebar, 'width');
				if (sidebarWidth) {
					expect(sidebarWidth).toBeGreaterThan(180);
				}

				// ------ Auxiliary Bar -------
				// Should be collapsed
				await expect(layouts.auxBar).not.toBeVisible();
			});
		});
	});
}
