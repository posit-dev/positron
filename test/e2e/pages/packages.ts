/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, Locator, Page } from '@playwright/test';
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
	packageActionsButton: Locator;
	private get page(): Page { return this.code.driver.page; }

	constructor(private code: Code, private contextMenu: ContextMenu, private quickInput: QuickInput, private toasts: Toasts) {
		this.packagesButton = code.driver.page.locator('a.action-label.codicon-package');
		this.packagesContainer = code.driver.page.locator('.positron-packages-list');
		this.packageActionsButton = code.driver.page.getByRole('button', { name: 'Package Actions' });
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
	 * Gets all packages by scrolling through the list with mouse wheel
	 * @returns An array of all package names
	 */
	async getAllPackages(): Promise<string[]> {
		// Ensure packages pane is open
		await this.clickPackagesButton();

		// Wait for the packages container to be visible
		await expect(this.packagesContainer).toBeVisible();

		const packageItems = this.packagesContainer.locator('.packages-list-item-name');
		await expect(packageItems.first()).toBeVisible();

		const seen = new Set<string>();
		const allPackages: string[] = [];

		// Scroll through the list to load all packages (handles virtualized lists)
		let stable = false;
		let scrollAttempts = 0;
		const maxScrollAttempts = 100; // prevent infinite loops

		while (!stable && scrollAttempts < maxScrollAttempts) {
			const itemCount = await packageItems.count();

			let newItemsFound = false;
			for (let i = 0; i < itemCount; i++) {
				const packageName = await packageItems.nth(i).textContent();

				if (packageName) {
					const name = packageName.trim();
					if (!seen.has(name)) {
						seen.add(name);
						allPackages.push(name);
						newItemsFound = true;
					}
				}
			}

			if (newItemsFound) {
				// Scroll using mouse wheel to load more items
				const box = await this.packagesContainer.boundingBox();
				if (box) {
					// Move mouse to center of packages container
					await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
					// Scroll down with mouse wheel (positive deltaY scrolls down)
					await this.page.mouse.wheel(0, 500);
					await this.page.waitForTimeout(100); // allow more items to render
				}
				scrollAttempts++;
			} else {
				stable = true; // no new items found after scrolling
			}
		}

		return allPackages;
	}

	/**
	 * Installs a package using the package actions menu
	 * @param packageName The name of the package to install (e.g., 'cowsay')
	 * @param options Optional parameters for installation
	 * @param options.version Specific version to install. If not provided, uses the first version in the list.
	 */
	async installPackage(packageName: string, options?: { version?: string }): Promise<void> {
		// Ensure packages pane is open
		await this.clickPackagesButton();

		// Open the package actions menu and click "Install Package"
		await this.contextMenu.triggerAndClick({
			menuTrigger: this.packageActionsButton,
			menuItemLabel: 'Install Package'
		});

		// Wait for the quick input to appear
		await this.quickInput.waitForQuickInputOpened();

		// Type the package name
		await this.quickInput.type(packageName);
		await this.quickInput.submitInputBox();

		// Wait for results and select the exact match
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
