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

	test.describe('Default Layout', () => {

		test('Verify Default Layout displays Console, Terminal, and Auxiliary Sections in correct order', { tag: [tags.WEB, tags.CROSS_BROWSER, tags.WORKBENCH, tags.JUPYTER] }, async function ({ app }) {
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

	test.describe('Data Analysis Layout', () => {

		test('Verify Data Analysis Layout hides the Panel and stacks Console, Variables, Plots, and Terminal on the right', { tag: [tags.WEB, tags.CROSS_BROWSER, tags.WORKBENCH, tags.JUPYTER] }, async function ({ app }) {

			const layouts = app.workbench.layouts;

			await layouts.enterLayout('data_analysis');

			// ------ Panel -------
			await expect(layouts.panelContent).not.toBeVisible();

			// ------ Auxiliary Bar -------
			await expect(layouts.auxBar).toBeVisible();
			await expect(layouts.auxBarViewsTab.nth(0)).toHaveText('Session');

			const consoleSection = layouts.auxBar.getByLabel(/console section/i);
			const variablesSection = layouts.auxBar.getByLabel(/variables section/i);
			const plotsSection = layouts.auxBar.getByLabel(/plots section/i);
			const terminalSection = layouts.auxBar.getByLabel(/terminal section/i);

			// The console and variables start open; plots and the terminal start collapsed
			await expect(consoleSection).toHaveAttribute('aria-expanded', 'true');
			await expect(variablesSection).toHaveAttribute('aria-expanded', 'true');
			await expect(plotsSection).toHaveAttribute('aria-expanded', 'false');
			await expect(terminalSection).toHaveAttribute('aria-expanded', 'false');

			// Should be in vertical order of console, variables, plots, terminal
			const consoleY = await layouts.boundingBoxProperty(consoleSection, 'y');
			const variablesY = await layouts.boundingBoxProperty(variablesSection, 'y');
			const plotsY = await layouts.boundingBoxProperty(plotsSection, 'y');
			const terminalY = await layouts.boundingBoxProperty(terminalSection, 'y');
			expect(consoleY).toBeLessThan(variablesY);
			expect(variablesY).toBeLessThan(plotsY);
			expect(plotsY).toBeLessThan(terminalY);
		});
	});

	test.describe('Notebook Layout', () => {

		test('Verify Notebook Layout puts the console and terminal in the session view, collapsed', { tag: [tags.WEB, tags.CROSS_BROWSER, tags.WORKBENCH, tags.JUPYTER] }, async function ({ app }) {

			const layouts = app.workbench.layouts;

			await layouts.enterLayout('notebook');

			// ------ Panel -------
			await expect(layouts.panelContent).not.toBeVisible();

			// ------ Auxiliary Bar -------
			// Variables starts open; the console and terminal sit below it, collapsed
			await expect(layouts.auxBar).toBeVisible();
			await expect(layouts.auxBarViewsTab.nth(0)).toHaveText('Session');
			await expect(layouts.auxBar.getByLabel(/variables section/i)).toHaveAttribute('aria-expanded', 'true');
			await expect(layouts.auxBar.getByLabel(/console section/i)).toHaveAttribute('aria-expanded', 'false');
			await expect(layouts.auxBar.getByLabel(/terminal section/i)).toHaveAttribute('aria-expanded', 'false');


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
			await expect(layouts.panelContent).not.toBeVisible();

			// ------ Auxiliary Bar -------
			// The console and terminal start collapsed; variables and plots start open
			await expect(layouts.auxBar).toBeVisible();
			await expect(layouts.auxBarViewsTab.nth(0)).toHaveText('Session');
			await expect(layouts.auxBar.getByLabel(/console section/i)).toHaveAttribute('aria-expanded', 'false');
			await expect(layouts.auxBar.getByLabel(/terminal section/i)).toHaveAttribute('aria-expanded', 'false');
			await expect(layouts.auxBar.getByLabel(/variables section/i)).toHaveAttribute('aria-expanded', 'true');
			await expect(layouts.auxBar.getByLabel(/plots section/i)).toHaveAttribute('aria-expanded', 'true');
		});
	});

	test.describe('Assistant Layout with Posit Assistant', { tag: [tags.ASSISTANT] }, () => {

		test.afterEach('Reset Layout', async function ({ app }) {
			// Close the Posit Assistant editor tab(s) with the mouse BEFORE any
			// keyboard-driven cleanup. While the webview is open it is not safe to
			// drive the keyboard: when its content finishes loading it focuses its
			// own chat input, dismissing an open quick input mid-command, and with
			// the webview focused the Cmd+K of the close-all-editors chord is
			// swallowed while the following Cmd+W closes the whole app window.
			const assistantTabs = app.code.driver.currentPage
				.locator('.tabs-container .tab[data-resource-name^="webview-posit-assistant"]');
			while (await assistantTabs.count() > 0) {
				await assistantTabs.first().locator('.action-label.codicon-close-small').click();
			}
			await app.workbench.layouts.enterLayout('stacked');
		});

		// Intentionally untagged for every browser-based project: like the Posit
		// Assistant test above, this opens the webview-backed Posit Assistant,
		// which is unreliable on web (#13933). Runs on desktop only.
		//
		// No settings setup: the layout's precondition needs `assistant.enabled`,
		// which defaults to true and registers from the extension manifest at scan
		// time. Setting it explicitly mid-test makes the extension activate right
		// then, and that activation steals focus from the open quick input.
		test('Verify Assistant Layout hides Sidebar and Panel and opens Posit Assistant in the editor area', async function ({ app }) {
			const layouts = app.workbench.layouts;

			await layouts.enterLayout('assistant');

			// ------ Panel and Sidebar -------
			// Both should be collapsed
			await expect(layouts.panelContent).not.toBeVisible();
			await expect(layouts.sidebar).not.toBeVisible();

			// ------ Auxiliary Bar -------
			await expect(layouts.auxBar).toBeVisible();
			await expect(layouts.auxBarViewsTab.nth(0)).toHaveText('Session');

			// Console starts collapsed (it pops open on first code run), and so does
			// the terminal; Variables and Plots start expanded
			const consoleSection = layouts.auxBar.getByLabel(/console section/i);
			const variablesSection = layouts.auxBar.getByLabel(/variables section/i);
			const plotsSection = layouts.auxBar.getByLabel(/plots section/i);
			await expect(consoleSection).toHaveAttribute('aria-expanded', 'false');
			await expect(layouts.auxBar.getByLabel(/terminal section/i)).toHaveAttribute('aria-expanded', 'false');
			await expect(variablesSection).toHaveAttribute('aria-expanded', 'true');
			await expect(plotsSection).toHaveAttribute('aria-expanded', 'true');

			// ------ Editor area -------
			// The layout opens Posit Assistant as a webview editor tab whose
			// data-resource-name is webview-posit-assistant-<uuid>. Match on that
			// prefix; matching the "Posit Assistant" label would also hit the
			// activity bar icon (role=tab too).
			await app.workbench.editors.waitForActiveTab(/^webview-posit-assistant/);
		});
	});
});
