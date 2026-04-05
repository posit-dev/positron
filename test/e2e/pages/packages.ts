/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect, Page } from '@playwright/test';
import { Code } from '../infra/code';
import { ContextMenu } from './dialog-contextMenu';

/**
 * Page object for the Packages pane (gated behind positron.environments.enable).
 * Shows installed packages for the active interpreter session.
 */
export class Packages {
	private get page(): Page { return this.code.driver.page; }

	// Container and list elements
	private packagesContainer = this.page.locator('.positron-packages-list');
	private packageItemNames = this.packagesContainer.locator('.packages-list-item-name');
	private selectedItem = this.packagesContainer.locator('.packages-list-item.selected');

	// Action bar
	private sessionLabel = this.packagesContainer.locator('.action-bar-region-left button');
	private refreshButton = this.page.getByRole('button', { name: 'Refresh Packages' });

	// Sidebar icon
	private sidebarIcon = this.page.locator('a.action-label.codicon-package');

	constructor(private code: Code, private contextMenu: ContextMenu) { }

	// -- Actions --

	/**
	 * Action: Open the Packages pane in the sidebar.
	 * No-ops if the pane is already visible.
	 */
	async open(): Promise<void> {
		await test.step('Open Packages pane', async () => {
			if (!await this.packagesContainer.isVisible()) {
				await this.sidebarIcon.click();
				await expect(this.packagesContainer).toBeVisible();
			}
		});
	}

	/**
	 * Action: Click a package row by name to select it.
	 * @param name - exact package name to select
	 */
	async selectPackage(name: string): Promise<void> {
		await test.step(`Select package: ${name}`, async () => {
			await this.packageItemNames.getByText(name, { exact: true }).click();
		});
	}

	/**
	 * Action: Right-click a package and choose a context menu item.
	 * @param name - exact package name to right-click
	 * @param menuItem - context menu label to click (e.g. "Update Package", "Uninstall Package")
	 */
	async rightClickPackage(name: string, menuItem: string): Promise<void> {
		await test.step(`Right-click ${name} -> ${menuItem}`, async () => {
			await this.selectPackage(name);
			await this.contextMenu.triggerAndClick({
				menuTrigger: this.selectedItem,
				menuItemLabel: menuItem,
				menuTriggerButton: 'right',
			});
		});
	}

	/**
	 * Action: Click the Refresh Packages button.
	 */
	async refresh(): Promise<void> {
		await test.step('Refresh packages', async () => {
			await this.refreshButton.click();
		});
	}

	// -- Getters --

	/**
	 * Get the count of visible package items.
	 */
	async getPackageCount(): Promise<number> {
		return await this.packageItemNames.count();
	}

	/**
	 * Get all visible package names as an array.
	 */
	async getPackageNames(): Promise<string[]> {
		const items = await this.packageItemNames.all();
		return Promise.all(items.map(item => item.innerText()));
	}

	/**
	 * Get the session label text (e.g. "Python 3.10.15 (Pyenv)", "R 4.4.2").
	 */
	async getSessionLabel(): Promise<string> {
		return await this.sessionLabel.innerText();
	}

	// -- Assertions --

	/**
	 * Verify: A package with the given name is visible (or not visible) in the list.
	 * @param name - exact package name
	 * @param visible - true to assert visible (default), false to assert not visible
	 */
	async expectPackageToBeVisible(name: string, visible = true): Promise<void> {
		await test.step(`Expect package "${name}" to be ${visible ? 'visible' : 'not visible'}`, async () => {
			const item = this.packageItemNames.getByText(name, { exact: true });
			visible
				? await expect(item).toBeVisible()
				: await expect(item).not.toBeVisible();
		});
	}

	/**
	 * Verify: The package count is at least the given number.
	 * @param count - minimum expected package count
	 */
	async expectPackageCountGreaterThan(count: number): Promise<void> {
		await test.step(`Expect package count > ${count}`, async () => {
			await expect(this.packageItemNames.first()).toBeVisible();
			const actual = await this.packageItemNames.count();
			expect(actual).toBeGreaterThan(count);
		});
	}

	/**
	 * Verify: The selected package row is highlighted.
	 */
	async expectPackageToBeSelected(): Promise<void> {
		await test.step('Expect a package to be selected', async () => {
			await expect(this.selectedItem).toBeVisible();
		});
	}

	/**
	 * Verify: The session label contains the expected text.
	 * @param text - substring expected in the label (e.g. "Python", "R 4.4.2")
	 */
	async expectSessionLabelToContain(text: string): Promise<void> {
		await test.step(`Expect session label to contain "${text}"`, async () => {
			await expect(this.sessionLabel).toContainText(text);
		});
	}

	/**
	 * Verify: The Packages pane is visible in the sidebar.
	 */
	async expectToBeVisible(): Promise<void> {
		await test.step('Expect Packages pane to be visible', async () => {
			await expect(this.packagesContainer).toBeVisible();
		});
	}
}
