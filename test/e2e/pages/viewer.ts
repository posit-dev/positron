/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect, FrameLocator, Locator } from '@playwright/test';
import { Code } from '../infra/code';

const OUTER_FRAME = '.webview';
const INNER_FRAME = '#active-frame';
const REFRESH_BUTTON = '.codicon-positron-refresh';
const VIEWER_PANEL = '[id="workbench.panel.positronPreview"]';
const ACTION_BAR = '.positron-action-bar';

const FULL_APP = 'body';

export class Viewer {

	get fullApp(): Locator { return this.code.driver.page.locator(FULL_APP); }
	get viewerFrame(): FrameLocator { return this.code.driver.page.frameLocator(OUTER_FRAME).frameLocator(INNER_FRAME); }
	get interruptButton(): Locator { return this.code.driver.page.locator(ACTION_BAR).getByRole('button', { name: 'Interrupt execution' }); }

	constructor(private code: Code) { }

	getViewerLocator(locator: string,): Locator {
		return this.viewerFrame.locator(locator);
	}

	getViewerFrame(): FrameLocator {
		return this.viewerFrame;
	}

	async refreshViewer() {
		await this.code.driver.page.locator(REFRESH_BUTTON).click({ timeout: 15000 });
	}

	async clearViewer() {
		await this.code.driver.page.getByRole('tab', { name: 'Viewer' }).locator('a').click();

		const clearRegex = /Clear the/;

		if (await this.fullApp.getByLabel(clearRegex).isVisible()) {
			await this.fullApp.getByLabel(clearRegex).click();
		}
	}

	async openViewerToEditor() {
		await this.code.driver.page.locator('.codicon-go-to-file').click();
	}

	async expectViewerPanelVisible(timeout = 10000): Promise<void> {
		await test.step('Expect viewer panel visible', async () => {
			await expect(this.code.driver.page.locator(VIEWER_PANEL)).toBeVisible({ timeout });
		});
	}

	/**
	 * Wait for content to be visible in the viewer frame, with retry on failure.
	 *
	 * Dev servers (Flask, Dash, etc.) may report "running" before actually accepting
	 * connections, causing ERR_CONNECTION_RESET. If content isn't visible, the onRetry
	 * callback is called to allow restarting the server before the next attempt.
	 */
	async expectContentVisible(
		getLocator: (frame: FrameLocator) => Locator,
		options?: { timeout?: number; onRetry?: () => Promise<void> }
	): Promise<void> {
		const { timeout = 60000, onRetry } = options ?? {};

		await test.step('Expect content visible in viewer frame', async () => {
			await expect(async () => {
				const frame = !this.code.electronApp
					? this.viewerFrame.frameLocator('iframe')
					: this.getViewerFrame();
				const locator = getLocator(frame);

				// Check if content is visible
				let isVisible = false;
				try {
					isVisible = await locator.isVisible();
				} catch {
					// Frame might not be accessible after ERR_CONNECTION_RESET
				}

				if (!isVisible && onRetry) {
					await onRetry();
				}

				await expect(locator).toBeVisible({ timeout: 5000 });
			}).toPass({ timeout });
		});
	}
}
