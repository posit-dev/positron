/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from '../../infra/code';
import type { PositJupyter } from '../../infra/workbench-jupyter';

/**
 * JupyterLab page for interacting with the Jupyter interface
 */
export class JupyterLabPage {

	constructor(private code: Code, private positJupyter?: PositJupyter) { }

	/**
	 * Open Positron from JupyterLab
	 */
	async openPositron(): Promise<void> {
		const page = this.code.driver.page;
		const context = page.context();

		// Wait for JupyterLab to be ready by checking for the Positron launcher
		const positronLauncher = page.locator('.jp-LauncherCard', {
			has: page.locator('.jp-LauncherCard-label[title^="Positron"]')
		});
		await positronLauncher.waitFor({ state: 'visible', timeout: 30000 });

		// Ensure the launcher is scrolled into view and clickable
		await positronLauncher.scrollIntoViewIfNeeded();

		// Set up listeners for both popup types (try both event types)
		const popupPromise = Promise.race([
			page.waitForEvent('popup', { timeout: 45000 }),
			context.waitForEvent('page', { timeout: 45000 })
		]);

		// Perform a trial click to verify the element is actionable, then click for real
		await positronLauncher.click({ trial: true });
		await positronLauncher.click();

		// Wait for the popup/new page
		const newPage = await popupPromise;

		// Get the authenticated URL from the popup
		await newPage.waitForLoadState('domcontentloaded');
		const authenticatedUrl = newPage.url();

		// Close the popup
		await newPage.close();

		// Navigate to the authenticated URL in the original tab
		await page.goto(authenticatedUrl);
		await page.waitForLoadState('domcontentloaded');

		// Store the JupyterLab URL to return to later
		if (this.positJupyter) {
			this.positJupyter.setJupyterLabUrl('http://localhost:8888/user/admin/lab/workspaces/auto-h');
		}

		// Wait for Positron to load
		await page.waitForSelector('.monaco-workbench', { timeout: 60000 });
	}

	/**
	 * Navigate to JupyterHub control panel
	 */
	async goToControlPanel(): Promise<void> {
		const page = this.code.driver.page;

		// Navigate directly to the hub control panel
		await page.goto('http://localhost:8888/hub/home');
		await page.waitForLoadState('networkidle');
	}

	/**
	 * Stop the Jupyter server from the control panel
	 */
	async stopServer(): Promise<void> {
		const page = this.code.driver.page;

		// Wait for and click Stop My Server button
		const stopButton = page.locator('a:text("Stop My Server")');
		await stopButton.waitFor({ timeout: 10000 });
		await stopButton.click();

		// Wait for the stop action to complete
		await page.waitForLoadState('networkidle');
	}

	/**
	 * Start the Jupyter server from the control panel
	 */
	async startServer(): Promise<void> {
		const page = this.code.driver.page;

		// Wait for and click Start My Server button
		const startButton = page.locator('a:text("Start My Server")');
		await startButton.waitFor({ timeout: 10000 });
		await startButton.click();

		// Wait for lab to load
		await page.waitForSelector('div[title^="Positron"]', { timeout: 60000 });
	}

	/**
	 * Log out from JupyterHub
	 */
	async logout(): Promise<void> {
		const page = this.code.driver.page;

		// Click File menu
		await page.locator('div:text("File")').first().click();

		// Click Log Out (use first() as there may be multiple matches)
		await page.locator('div:text("Log Out")').nth(1).click();

		// Wait for logout to complete
		await page.waitForLoadState('networkidle');
	}
}
