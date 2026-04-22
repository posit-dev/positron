/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
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

		// Wait for the Positron launcher to be available (ensures Jupyter is ready)
		const positronLauncher = page.locator('div.jp-LauncherCard-label[title^="Positron"]');
		await positronLauncher.waitFor({ timeout: 30000 });

		// Click the launcher to open in a new tab
		const [newPage] = await Promise.all([
			context.waitForEvent('page'),
			positronLauncher.click()
		]);

		// Wait for the new page to load and get its URL
		await newPage.waitForLoadState('networkidle');
		const positronUrl = newPage.url();

		// Close the new tab
		await newPage.close();

		// Navigate to the Positron URL in the original tab
		await page.goto(positronUrl);
		await page.waitForLoadState('networkidle');

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
