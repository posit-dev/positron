/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, Locator } from '@playwright/test';
import { Code } from '../infra/code';
import { ContextMenu } from './dialog-contextMenu';
import { QuickInput } from './quickInput';
import { Toasts } from './dialog-toasts';

/*
 *  Reuseable Positron packages pane functionality for tests to leverage
 */
export class Packages {

	packagesButton: Locator;
	packagesContainer: Locator;
	packagesViewMoreActionsButton: Locator;

	constructor(private code: Code, private contextMenu: ContextMenu, private quickInput: QuickInput, private toasts: Toasts) {
		this.packagesButton = this.code.driver.currentPage.locator('a.action-label.codicon-package');
		this.packagesContainer = this.code.driver.currentPage.locator('.positron-packages-list');
		// More Actions button (overflow menu) in the packages view title bar
		this.packagesViewMoreActionsButton = code.driver.currentPage
			.getByRole('toolbar', { name: 'Packages actions' })
			.getByRole('button', { name: 'Views and More Actions...' });
	}

	/**
	 * Verifies the packages list is displayed with the expected version
	 * @param expectedVersion The expected version string to verify
	 */
	async verifyPackagesList(): Promise<void> {
		// Ensure packages pane is open
		await this.clickPackagesButton();

		// Verify the packages list is displayed
		await expect(this.packagesContainer).toBeVisible();

		// Verify package list items are present
		const packageItems = this.packagesContainer.locator('.packages-list-item-name');
		await expect(packageItems.first()).toBeVisible();
		const itemCount = await packageItems.count();
		expect(itemCount).toBeGreaterThan(0);
	}

	/**
	 * Clicks the packages button to open the packages view
	 * If the packages pane is already visible, this is a no-op
	 */
	async clickPackagesButton(): Promise<void> {
		const isVisible = await this.packagesContainer.isVisible();
		if (!isVisible) {
			await this.packagesButton.click();
		}
	}

	/**
	 * Closes the packages pane if it's currently open
	 */
	async closePackagesPane(): Promise<void> {
		const isVisible = await this.packagesContainer.isVisible();
		if (isVisible) {
			await this.packagesButton.click();
		}
	}

	/**
	 * Types into the packages pane filter input to narrow the visible list.
	 * @param text The filter text to apply (pass '' to clear).
	 */
	async searchPackages(text: string): Promise<void> {
		await this.clickPackagesButton();
		await this.packagesContainer.getByPlaceholder('Filter packages').fill(text);
	}

	/**
	 * Asserts that a package row is present in the currently filtered list.
	 * Retries past the post-install refresh delay (the install toast clears
	 * before the package provider re-emits its snapshot).
	 * @param name The exact package name to look for.
	 * @param timeout Max time to wait for the row to appear.
	 */
	async expectPackageInList(name: string, timeout = 30_000): Promise<void> {
		await this.clickPackagesButton();
		const row = this.packagesContainer.locator('.packages-list-item-name', { hasText: name });
		await expect(row.first()).toBeVisible({ timeout });
	}

	/**
	 * Installs a package using the Install Package action in the view title overflow menu
	 * @param packageName The name of the package to install (e.g., 'cowsay')
	 * @param options Optional parameters for installation
	 * @param options.version Specific version to install. If not provided, uses the first version in the list.
	 */
	async installPackage(packageName: string, options?: { version?: string }): Promise<void> {
		// Ensure packages pane is open
		await this.clickPackagesButton();

		// Click "Install Package" from the overflow menu
		await this.contextMenu.triggerAndClick({
			menuTrigger: this.packagesViewMoreActionsButton,
			menuItemLabel: 'Install Package',
			exact: true
		});

		// Wait for the quick input to appear
		await this.quickInput.waitForQuickInputOpened();

		// Type the package name and submit to trigger API search
		await this.quickInput.type(packageName);
		await this.quickInput.submitInputBox();

		// Wait for search results to load (API call)
		await this.quickInput.selectQuickInputElementExact(packageName);

		// Wait for version selection screen
		await this.quickInput.waitForQuickInputOpened();

		if (options?.version) {
			// Type the specific version
			await this.quickInput.type(options.version);
			await this.quickInput.submitInputBox();
		}

		// Press Enter to confirm version selection (select first item)
		await this.quickInput.selectQuickInputElement(0);

		await this.quickInput.waitForQuickInputClosed();

		// Wait for the "Installing packages..." toast to appear and then disappear
		await this.toasts.waitForAppear('Installing packages...', { timeout: 10000 });
		await this.toasts.waitForDisappear('Installing packages...', { timeout: 60000 });
	}
}
