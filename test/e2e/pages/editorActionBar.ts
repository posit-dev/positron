/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect, Locator, Page } from '@playwright/test';
import { Viewer } from './viewer';
import { QuickAccess } from './quickaccess';

type EditorActionBarButton =
	| 'Split Editor Right'
	| 'Split Editor Down'
	| 'Preview'
	| 'Open Changes'
	| 'Open in Viewer'
	| 'Move into new window'
	| 'Open as Plain Text File'
	| 'Deploy with Posit Publisher'
	| 'Convert to Code'
	| 'Clear Column Sorting';


export class EditorActionBar {
	get actionBar(): Locator { return this.page.locator('.editor-action-bar > .positron-action-bar > .action-bar-region'); }

	constructor(private page: Page, private viewer: Viewer, private quickaccess: QuickAccess) { }

	// --- Actions ---

	/**
	 * Action: Click a specified button in the editor action bar.
	 * Note: Adds hover before click to prevent test flakes in CI.
	 * Special handling is included for the "Split Editor Down" action (requires holding Alt key).
	 *
	 * @param button - Name of the button to click in the editor action bar.
	 */
	async clickButton(button: EditorActionBarButton): Promise<void> {
		const buttonLocator = this.page.getByLabel(button, { exact: true });

		if (button === 'Split Editor Down') {
			// Special case: "Split Editor Down" requires holding Alt key
			await this.page.keyboard.down('Alt');
			await buttonLocator.hover();
			await buttonLocator.click();
			await this.page.keyboard.up('Alt');
		} else {
			// General case: Hover and click the button
			await buttonLocator.hover();
			await buttonLocator.click();
		}
	}

	/**
	 * Action: Set the summary position to the specified side.
	 * @param isWeb whether the test is running in the web or desktop app
	 * @param position select 'Left' or 'Right' to position the summary
	 */
	async selectSummaryOn(isWeb: boolean, position: 'Left' | 'Right') {
		if (isWeb) {
			await this.page.getByLabel('More actions', { exact: true }).click();
			await this.page.getByRole('menuitemcheckbox', { name: `Summary on ${position}` }).hover();
			await this.page.keyboard.press('Enter');
		}
		else {
			await this.quickaccess.runCommand(`workbench.action.positronDataExplorer.summaryOn${position}`);
		}
	}

	/**
	 * Action: Click a menu item in the "Customize Notebook" dropdown.
	 * @param menuItem a menu item to click in the "Customize Notebook" dropdown
	 */
	async clickCustomizeNotebookMenuItem(menuItem: string) {
		const role = menuItem.includes('Line Numbers') ? 'menuitemcheckbox' : 'menuitem';
		const dropdownButton = this.page.getByLabel('Customize Notebook...');
		await dropdownButton.evaluate((button) => {
			(button as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
		});

		const toggleMenuItem = this.page.getByRole(role, { name: menuItem });
		await toggleMenuItem.hover();
		await this.page.waitForTimeout(500);
		await toggleMenuItem.click();
	}

	// --- Verifications ---

	/**
	 * Verify: Check that the editor is split in the specified direction (on the correct plane)
	 * @param direction the direction the editor was split
	 * @param tabName the name of the tab to verify
	 */
	async verifySplitEditor(direction: 'down' | 'right', tabName: string,) {
		await test.step(`Verify split editor: ${direction}`, async () => {
			// Verify 2 tabs
			await expect(this.page.getByRole('tab', { name: tabName })).toHaveCount(2, { timeout: 10000 });
			const splitTabs = this.page.getByRole('tab', { name: tabName });
			const firstTabBox = await splitTabs.nth(0).boundingBox();
			const secondTabBox = await splitTabs.nth(1).boundingBox();

			if (direction === 'right') {
				// Verify tabs are on the same X plane
				expect(firstTabBox).not.toBeNull();
				expect(secondTabBox).not.toBeNull();
				expect(firstTabBox!.y).toBeCloseTo(secondTabBox!.y, 1);
				expect(firstTabBox!.x).not.toBeCloseTo(secondTabBox!.x, 1);
			}
			else {
				// Verify tabs are on the same Y plane
				expect(firstTabBox).not.toBeNull();
				expect(secondTabBox).not.toBeNull();
				expect(firstTabBox!.x).toBeCloseTo(secondTabBox!.x, 1);
				expect(firstTabBox!.y).not.toBeCloseTo(secondTabBox!.y, 1);
			}

			// Close one tab
			await splitTabs.first().getByLabel('Close').click();
		});
	}

	/**
	 * Verify: Check that the "open in new window" contains the specified text
	 * @param isWeb whether the test is running in the web or desktop app
	 * @param text the text to verify in the new window
	 */
	async verifyOpenInNewWindow(isWeb: boolean, text: string | RegExp, exact = true) {
		if (!isWeb) {
			await test.step(`Verify "open new window" contains: ${text}`, async () => {
				const [newPage] = await Promise.all([
					this.page.context().waitForEvent('page'),
					this.clickButton('Move into new window')
				]);
				await newPage.waitForLoadState('load');
				exact
					? await expect(newPage.getByText(text, { exact: true })).toBeVisible()
					: await expect(newPage.getByText(text)).toBeVisible();
			});
		}
	}

	/**
	 * Verify: Check that the preview renders the specified heading
	 * @param heading the heading to verify in the preview
	 */
	async verifyPreviewRendersHtml(heading: string) {
		await test.step('Verify "preview" renders html', async () => {
			await this.page.getByLabel('Preview', { exact: true }).nth(0).click();
			const viewerFrame = this.viewer.getViewerFrame().frameLocator('iframe');
			await expect(viewerFrame.getByRole('heading', { name: heading })).toBeVisible({ timeout: 60000 });
		});
	}

	/**
	 * Verify: Check that the "open in viewer" renders the specified title
	 * @param isWeb whether the test is running in the web or desktop app
	 * @param title the title to verify in the viewer
	 */
	async verifyOpenViewerRendersHtml(isWeb: boolean, title: string) {
		await test.step('verify "open in viewer" renders html', async () => {
			const viewerFrame = this.page.locator('iframe.webview').contentFrame().locator('#active-frame').contentFrame();
			const cellLocator = isWeb
				? viewerFrame.frameLocator('iframe').getByRole('cell', { name: title })
				: viewerFrame.getByRole('cell', { name: title });

			await expect(cellLocator).toBeVisible({ timeout: 30000 });
		});
	}

	/**
	 * Verify: Check that the summary is positioned on the specified side
	 * @param position the side to verify the summary is positioned
	 */
	async verifySummaryPosition(position: 'Left' | 'Right') {
		await test.step(`Verify summary position: ${position}`, async () => {
			// Get the summary and table locators.
			const summaryLocator = this.page.locator('div.column-summary').first();
			const tableLocator = this.page.locator('div.data-grid-column-headers');

			// Ensure both the summary and table elements are visible
			await expect(summaryLocator).toBeVisible();
			await expect(tableLocator).toBeVisible();

			// Get the bounding boxes for both elements
			const summaryBox = await summaryLocator.boundingBox();
			const tableBox = await tableLocator.boundingBox();

			// Validate bounding boxes are available
			if (!summaryBox || !tableBox) {
				throw new Error('Bounding boxes could not be retrieved for summary or table.');
			}

			// Validate positions based on the expected position
			position === 'Left'
				? expect(summaryBox.x).toBeLessThan(tableBox.x)
				: expect(summaryBox.x).toBeGreaterThan(tableBox.x);
		});
	}

	/**
	 * Verify: the visibility of the editor action bar
	 *
	 * @param isVisible whether the editor action bar is expected to be visible
	 */
	async verifyIsVisible(isVisible: boolean) {
		await test.step(`Verify editor action bar is ${isVisible ? 'visible' : 'not visible'}`, async () => {
			isVisible
				? await expect(this.actionBar).toBeVisible()
				: await expect(this.actionBar).not.toBeVisible();
		});
	}
}
