/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from '../../infra/code';

/**
 * JupyterLab page for interacting with the Jupyter interface
 */
export class JupyterLabPage {

	constructor(private code: Code) { }

	/**
	 * Open Positron from JupyterLab
	 */
	async openPositron(): Promise<void> {
		const page = this.code.driver.page;

		// Wait for the Positron launcher to be available
		const positronLauncher = page.locator('div.jp-LauncherCard-label[title^="Positron"]');
		await positronLauncher.waitFor({ timeout: 30000 });

		// Click to open Positron
		await positronLauncher.click();

		// Wait for Positron to load
		await page.waitForSelector('.monaco-workbench', { timeout: 60000 });
	}

	/**
	 * Navigate to JupyterHub control panel
	 */
	async goToControlPanel(): Promise<void> {
		const page = this.code.driver.page;

		// Click File menu
		await page.locator('div:text("File")').first().click();

		// Click Hub Control Panel
		await page.locator('div:text("Hub Control Panel")').click();

		// Wait for control panel to load
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

		// Click Log Out
		await page.locator('div:text("Log Out")').click();

		// Wait for logout to complete
		await page.waitForLoadState('networkidle');
	}
}
