/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from '../infra/code.js';
import test, { Locator } from '@playwright/test';

export class ContextMenu {
	private page = this.code.driver.page;
	private isNativeMenu: boolean;
	private contextMenu: Locator = this.page.locator('.monaco-menu');
	private contextMenuItems: Locator = this.contextMenu.getByRole('menuitem');
	private getContextMenuItem: (label: string) => Locator = (label: string) => this.contextMenu.getByRole('menuitem', { name: label });
	private getContextMenuCheckboxItem: (label: string) => Locator = (label: string) => this.contextMenu.getByRole('menuitemcheckbox', { name: label, exact: true });

	constructor(
		private code: Code,
		private projectName: string,
		private platform: string,
	) {
		this.isNativeMenu = this.platform === 'darwin' && !this.projectName.includes('browser');
	}

	/**
	 * Action: Triggers a context menu and clicks a specified menu item.
	 * Note: This method is designed to work in both browser and electron!
	 *
	 * @param menuTrigger The locator that will trigger the context menu when clicked
	 * @param menuItemLabel The label of the menu item to click
	 * @param menuItemType The type of the menu item, either 'menuitemcheckbox' or 'menuitem'
	 */
	async triggerAndClick({ menuTrigger, menuItemLabel, menuItemType = 'menuitem' }: ContextMenuClick): Promise<void> {
		await test.step(`Trigger context menu and click '${menuItemLabel}'`, async () => {
			if (this.isNativeMenu) {
				await this.nativeMenuTriggerAndClick({ menuTrigger, menuItemLabel });
			} else {
				await menuTrigger.click();

				// Hover over the menu item
				const menuItem = menuItemType === 'menuitemcheckbox'
					? this.getContextMenuCheckboxItem(menuItemLabel)
					: this.getContextMenuItem(menuItemLabel);
				await menuItem.hover();
				await this.page.waitForTimeout(500);

				// Either selects the menu item or dismisses the tooltip
				await menuItem.press('Enter');
				if (await menuItem.isVisible()) {
					// Tooltip must have been blocking and now we click
					await menuItem.click();
				}
			}
		});
	}

	/**
	 * Helper: Gets all menu item labels from a context menu
	 * Note: This method is designed to work in both browser and electron!
	 *
	 * @param menuTrigger The locator that will trigger the context menu when clicked
	 * @returns Array of menu item labels
	 */
	async getMenuItems(menuTrigger: Locator): Promise<string[]> {
		return await test.step(`Get context menu items`, async () => {
			if (this.isNativeMenu) {
				const menuItems = await this.showContextMenu(() => menuTrigger.click());
				if (!menuItems) {
					throw new Error('Context menu did not appear or no menu items found.');
				}
				await this.closeContextMenu();
				return menuItems.items;
			} else {
				await menuTrigger.click();
				const menuItems = this.contextMenuItems;
				const count = await menuItems.count();
				const labels: string[] = [];

				for (let i = 0; i < count; i++) {
					const menuItem = menuItems.nth(i);
					const label = await menuItem.textContent();
					if (label) {
						labels.push(label.trim());
					}
				}
				await this.closeContextMenu();
				return labels;
			}
		});
	}

	/**
	 * Action: Closes an open context menu
	 *
	 * @returns Promise that resolves when the context menu is closed
	 */
	private async closeContextMenu(): Promise<void> {
		if (this.isNativeMenu) {
			await this.code.electronApp?.evaluate(({ app }) => {
				app.emit('e2e:contextMenuClose');
			});
		} else {
			await this.page.keyboard.press('Escape');
		}
	}

	// --- Private methods ---

	/**
	 * Shows a context menu and returns the menu ID and items.
	 * @param trigger A function that triggers the context menu (e.g., a click on a button)
	 * @returns
	 */
	private async showContextMenu(trigger: () => Promise<void>): Promise<{ menuId: number; items: string[] } | undefined> {
		try {
			if (!this.code.electronApp) {
				throw new Error(`Electron app is not available. Platform: ${this.platform}, Project: ${this.projectName}`);
			}

			const shownPromise: Promise<[number, string[]]> | undefined = this.code.electronApp.evaluate(({ app }) => {
				return new Promise((resolve) => {
					const listener: any = (...args: [number, string[]]) => {
						app.removeListener('e2e:contextMenuShown' as any, listener);
						resolve(args);
					};
					app.addListener('e2e:contextMenuShown' as any, listener);
				});
			});

			if (!shownPromise) { return undefined; }

			const [shownEvent] = await Promise.all([shownPromise, trigger()]);
			if (shownEvent) {
				const [menuId, items] = shownEvent;
				return { menuId, items };
			}
			return undefined;
		} catch (err) {
			console.error('[showContextMenu] failed:', err);
			throw err;
		}
	}

	/**
	 * Selects a context menu item by its label.
	 *
	 * @param contextMenuId the ID of the context menu to select an item from
	 * @param label the label of the menu item to select
	 */
	private async selectContextMenuItem(contextMenuId: number, label: string): Promise<void> {
		await this.code.electronApp?.evaluate(async ({ app }, [contextMenuId, label]) => {
			app.emit('e2e:contextMenuSelect', contextMenuId, label);
		}, [contextMenuId, label]);
	}

	/**
	 * Triggers a context menu and clicks a specified menu item in native menus (macOS/Electron).
	 *
	 * @param menuTrigger The locator that will trigger the context menu when clicked
	 * @param menuItemLabel The label of the menu item to click
	 */
	private async nativeMenuTriggerAndClick({ menuTrigger, menuItemLabel }: Omit<ContextMenuClick, 'menuItemType'>): Promise<void> {
		// Show the context menu by clicking on the trigger element
		const menuItems = await this.showContextMenu(() => menuTrigger.click());

		// Handle the menu interaction once it's shown
		if (menuItems) {
			// Verify the requested menu item exists
			if (!menuItems.items.includes(menuItemLabel)) {
				throw new Error(`Context menu '${menuItemLabel}' not found. Available items: ${menuItems.items.join(', ')}`);
			}
			// Select the menu item through Electron IPC
			await this.selectContextMenuItem(menuItems.menuId, menuItemLabel);
		} else {
			throw new Error(`Context menu '${menuItemLabel}' did not appear or no menu items found.`);
		}
	}
}


interface ContextMenuClick {
	menuTrigger: Locator;
	menuItemLabel: string;
	menuItemType?: 'menuitemcheckbox' | 'menuitem';
}
