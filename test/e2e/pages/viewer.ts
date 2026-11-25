/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect, FrameLocator, Locator, Page } from '@playwright/test';
import { Code } from '../infra/code';
import { ContextMenu } from './dialog-contextMenu.js';

const OUTER_FRAME = '.webview';
const INNER_FRAME = '#active-frame';
const REFRESH_BUTTON = '.preview-action-bar .codicon-refresh';
const VIEWER_PANEL = '[id="workbench.panel.positronPreview"]';
const ACTION_BAR = '.positron-action-bar';
const OPEN_IN_DROPDOWN_BUTTON = '.preview-action-bar .action-bar-button-drop-down-button[aria-label="Select where to open"]';
const OPEN_IN_PRIMARY_BUTTON = '.preview-action-bar .action-bar-button-action-button[aria-label="Select where to open"]';

const FULL_APP = 'body';
// The Viewer's integrated browser draws its page in this element's place.
const INTEGRATED_BROWSER = `${VIEWER_PANEL} .positron-preview-browser`;

/**
 * Where the Viewer shows a page: in the webview's frames, or with the
 * integrated browser, its own page. Both find elements the same way.
 */
export type ViewerContent = Pick<Page, 'locator' | 'getByRole' | 'getByText' | 'getByLabel'>;

export class Viewer {

	get fullApp(): Locator { return this.code.driver.currentPage.locator(FULL_APP); }
	get viewerFrame(): FrameLocator { return this.code.driver.currentPage.frameLocator(OUTER_FRAME).frameLocator(INNER_FRAME); }
	get interruptButton(): Locator { return this.code.driver.currentPage.locator(ACTION_BAR).getByRole('button', { name: 'Interrupt execution' }); }
	get urlBar(): Locator { return this.code.driver.currentPage.getByRole('textbox', { name: 'The current URL' }); }
	/** The frames holding pages in the Viewer; there should only ever be one. */
	get pageFrames(): Locator { return this.code.driver.currentPage.frameLocator(OUTER_FRAME).locator('iframe'); }

	constructor(private code: Code, private contextMenu: ContextMenu) { }

	getViewerLocator(locator: string): Locator {
		return this.viewerFrame.locator(locator);
	}

	getViewerFrame(): FrameLocator {
		return this.viewerFrame;
	}

	/** Whether the Viewer shows its content in the integrated browser rather than a webview. */
	async usesIntegratedBrowser(): Promise<boolean> {
		return await this.code.driver.currentPage.locator(INTEGRATED_BROWSER).count() > 0;
	}

	/**
	 * The page the integrated browser shows in the Viewer: the one showing, or
	 * if others show too (a browser editor tab), the one at the Viewer's URL.
	 */
	async getBrowserPage(): Promise<Page> {
		let found: Page | undefined;
		await expect(async () => {
			const workbench = this.code.driver.currentPage;
			const showing: Page[] = [];
			for (const page of this.code.driver.getAllWindows()) {
				if (page !== workbench && !page.isClosed() && /^https?:/.test(page.url()) &&
					await page.evaluate(() => document.visibilityState).catch(() => 'hidden') === 'visible') {
					showing.push(page);
				}
			}
			const viewerUrl = showing.length > 1 && await this.urlBar.isVisible() ? await this.urlBar.inputValue() : undefined;
			found = viewerUrl ? showing.find(page => page.url() === viewerUrl) : showing.length === 1 ? showing[0] : undefined;
			expect(found, `one page showing in the Viewer, of: ${showing.map(page => page.url()).join(', ')}`).toBeDefined();
		}).toPass({ timeout: 15000 });
		return found!;
	}

	/** Where the Viewer shows its page now, whichever backend shows it. */
	async getViewerContent(useIframe?: boolean): Promise<ViewerContent> {
		if (await this.usesIntegratedBrowser()) {
			return this.getBrowserPage();
		}
		return useIframe === undefined
			? !this.code.electronApp
				? this.viewerFrame.frameLocator('iframe')
				: this.getViewerFrame()
			: useIframe
				? this.viewerFrame.frameLocator('iframe')
				: this.getViewerFrame();
	}

	async refreshViewer() {
		await this.code.driver.currentPage.locator(REFRESH_BUTTON).click({ timeout: 15000 });
	}

	async navigateToUrl(url: string) {
		await test.step(`Navigate the Viewer to ${url}`, async () => {
			await this.urlBar.fill(url);
			await this.urlBar.press('Enter');
		});
	}

	async navigateBack() {
		await this.code.driver.currentPage.locator(ACTION_BAR).getByRole('button', { name: 'Go back', exact: true }).click();
	}

	async clearViewer() {
		const viewerTab = this.code.driver.currentPage.getByRole('tab', { name: 'Viewer' });
		if (!await viewerTab.isVisible()) {
			return; // Viewer was never opened, nothing to clear.
		}
		await viewerTab.locator('a').click();

		const clearRegex = /Clear the/;

		if (await this.fullApp.getByLabel(clearRegex).isVisible()) {
			await this.fullApp.getByLabel(clearRegex).click();
			await expect(this.fullApp.getByLabel(clearRegex)).toBeHidden({ timeout: 10000 });
		}
	}

	async openViewerToEditor() {
		await test.step('Open Viewer content in editor tab via "Open in..." dropdown', async () => {
			const dropdownButton = this.code.driver.currentPage.locator(OPEN_IN_DROPDOWN_BUTTON);
			await this.contextMenu.triggerAndClick({
				menuTrigger: dropdownButton,
				menuItemLabel: /Open in Editor Tab$/,
				menuItemType: 'menuitemcheckbox'
			});
		});
	}

	async clickOpenInPrimaryButton() {
		await test.step('Click primary half of "Open in..." split button', async () => {
			await this.code.driver.currentPage.locator(OPEN_IN_PRIMARY_BUTTON).click();
		});
	}

	/** Expects the integrated browser's error in place of a page that failed to load. */
	async expectLoadError(): Promise<void> {
		await test.step('Expect the Viewer to show that the page failed to load', async () => {
			await expect(this.code.driver.currentPage.locator(VIEWER_PANEL).getByRole('alert')).toContainText('Failed to Load Page', { timeout: 30000 });
		});
	}

	/** Clicks Reload in the error shown in place of a page that failed to load. */
	async reloadAfterLoadError(): Promise<void> {
		await test.step('Reload from the Viewer\'s load error', async () => {
			await this.code.driver.currentPage.locator(VIEWER_PANEL).getByRole('alert').getByRole('button', { name: 'Reload', exact: true }).click();
		});
	}

	async expectViewerPanelVisible(timeout = 10000): Promise<void> {
		await test.step('Expect viewer panel visible', async () => {
			await expect(this.code.driver.currentPage.locator(VIEWER_PANEL)).toBeVisible({ timeout });
		});
	}

	async expectUrlToHaveValue(expectedUrl: string, timeout = 10000): Promise<void> {
		await test.step(`Expect viewer URL to have value: ${expectedUrl}`, async () => {
			await expect(this.urlBar).toHaveValue(expectedUrl, { timeout });
		});
	}

	/**
	 * Wait for content to be visible in the viewer frame, with retry on failure.
	 *
	 * Dev servers (Flask, Dash, etc.) may report "running" before actually accepting
	 * connections, causing ERR_CONNECTION_RESET. If content isn't visible, the onRetry
	 * callback is called to allow restarting the server before the next attempt.
	 *
	 * @param useIframe - Set to false for Positron output (great-tables, modelsummary) that renders directly.
	 *                    Defaults to true for web apps (Flask, Dash) that render in an iframe.
	 */
	async expectContentVisible(
		getLocator: (content: ViewerContent) => Locator,
		options?: { timeout?: number; onRetry?: () => Promise<void>; useIframe?: boolean }
	): Promise<void> {
		const { timeout = 60000, onRetry, useIframe = undefined } = options ?? {};

		await test.step('Expect content visible in viewer frame', async () => {
			await expect(async () => {
				const locator = getLocator(await this.getViewerContent(useIframe));


				// Check if content is visible
				let isVisible = false;
				try {
					isVisible = await locator.isVisible();
				} catch {
					// Frame might not be accessible after ERR_CONNECTION_RESET
				}

				// If content isn't visible, call onRetry to allow restarting the server
				if (!isVisible && onRetry) {
					await onRetry();
				}

				// Expect the content to be visible
				await expect(locator).toBeVisible({ timeout: 5000 });
			}).toPass({ timeout });
		});
	}

	async expectContentNotVisible(getLocator: (content: ViewerContent) => Locator, timeout = 10000): Promise<void> {
		await test.step('Expect content not visible in viewer frame', async () => {
			await expect(async () => {
				// With no page showing in the integrated browser, nothing is visible.
				const content = await this.usesIntegratedBrowser() ? await this.getBrowserPage().catch(() => undefined) : this.getViewerFrame();
				if (!content) {
					return;
				}
				const locator = getLocator(content);
				await expect(locator).not.toBeVisible({ timeout: 5000 });
			}).toPass({ timeout });
		});
	}
}
