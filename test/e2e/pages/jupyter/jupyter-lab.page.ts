/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Code } from '../../infra/code';
import type { PositJupyter } from '../../infra/workbench-jupyter';

/**
 * How long to wait for JupyterHub's spawner to report the single-user server stopped. The
 * Positron server routinely takes longer than the hub's 10s slow-stop timeout to exit, and the
 * hub refuses to spawn a new server until the old one is gone.
 */
const SERVER_STOP_TIMEOUT = 120000;

/**
 * Text of the hub page a sign-in lands on while the server is still stopping.
 */
const SERVER_STOPPING_TEXT = 'Your server is stopping';

/**
 * JupyterLab page for interacting with the Jupyter interface
 */
export class JupyterLabPage {

	constructor(private code: Code, private positJupyter?: PositJupyter) { }

	/**
	 * Open Positron from JupyterLab
	 */
	async openPositron(): Promise<void> {
		const page = this.code.driver.currentPage;
		const context = page.context();

		// Wait for JupyterLab to be ready by checking for the Positron launcher
		const positronLauncher = page.locator('.jp-LauncherCard', {
			has: page.locator('.jp-LauncherCard-label[title^="Positron"]')
		});

		// If a previous worker's teardown left the server stopping (for example because it was
		// killed before `stopServer()` finished), signing in parks the browser on the hub's
		// "Your server is stopping" page instead of spawning. Accept either outcome, then recover
		// from the latter.
		const serverStopping = page.getByText(SERVER_STOPPING_TEXT);
		await expect(positronLauncher.or(serverStopping)).toBeVisible({ timeout: 30000 });
		if (await serverStopping.isVisible()) {
			await this.waitForServerToFinishStopping();
			await positronLauncher.waitFor({ state: 'visible', timeout: 60000 });
		}

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
		await this.positJupyter?.sessions.expectNoStartUpMessaging();
	}

	/**
	 * Navigate to JupyterHub control panel
	 */
	async goToControlPanel(): Promise<void> {
		const page = this.code.driver.currentPage;

		// Navigate directly to the hub control panel
		await page.goto('http://localhost:8888/hub/home');
		await page.waitForLoadState('networkidle');
	}

	/**
	 * Stop the Jupyter server from the control panel and wait until the hub reports it stopped.
	 */
	async stopServer(): Promise<void> {
		const page = this.code.driver.currentPage;
		const stopButton = page.locator('a:text("Stop My Server")');
		const startButton = page.locator('a:text("Start My Server")');

		// Click Stop My Server and wait for the hub to answer the stop request. The hub answers once
		// the server has stopped, or after its slow-stop timeout (10s) if it is still shutting down,
		// so this only means the request was accepted, not that the server is gone. Waiting for it
		// keeps the reloads below from aborting the request.
		const stopResponse = page.waitForResponse(
			response => response.request().method() === 'DELETE' && response.url().includes('/hub/api/users/'),
			{ timeout: 30000 }
		);
		await stopButton.waitFor({ timeout: 10000 });
		await stopButton.click();
		await stopResponse;

		// The home page renders "Stop My Server" whenever the spawner is active, which includes
		// still stopping. Reload until it renders without it: that is the hub reporting the server
		// stopped, and the point at which a sign-in or "Start My Server" spawns a new one instead of
		// landing on the "Your server is stopping" page.
		await expect(async () => {
			await page.reload({ waitUntil: 'domcontentloaded' });
			await expect(stopButton).toBeHidden({ timeout: 2000 });
		}).toPass({ timeout: SERVER_STOP_TIMEOUT, intervals: [2000] });
		await expect(startButton).toBeVisible();
	}

	/**
	 * Start the Jupyter server from the control panel
	 */
	async startServer(): Promise<void> {
		const page = this.code.driver.currentPage;

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
		const page = this.code.driver.currentPage;

		// Click File menu
		await page.locator('div:text("File")').first().click();

		// Click Log Out (use first() as there may be multiple matches)
		await page.locator('div:text("Log Out")').nth(1).click();

		// Wait for logout to complete
		await page.waitForLoadState('networkidle');
	}

	/**
	 * Reload the hub's "Your server is stopping" page until the spawner reports the server stopped.
	 * The page does not refresh itself in that state. Once the server is gone, the reload is
	 * redirected through the hub's spawn handler, which starts a fresh server and lands in
	 * JupyterLab.
	 */
	private async waitForServerToFinishStopping(): Promise<void> {
		const page = this.code.driver.currentPage;
		const serverStopping = page.getByText(SERVER_STOPPING_TEXT);

		console.warn('JupyterHub reports the previous server is still stopping; waiting for it to finish before spawning a new one');
		await expect(async () => {
			await page.reload({ waitUntil: 'domcontentloaded' });
			await expect(serverStopping).toBeHidden({ timeout: 2000 });
		}).toPass({ timeout: SERVER_STOP_TIMEOUT, intervals: [2000] });
	}
}
