/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from '../infra/code.js';
import test, { Locator, Page } from '@playwright/test';

export class ContextMenu {
	private get page(): Page { return this.code.driver.page; }
	private isNativeMenu: boolean;
	private get contextMenu(): Locator { return this.page.locator('.monaco-menu'); }
	private get contextMenuItems(): Locator { return this.contextMenu.getByRole('menuitem'); }
	private getContextMenuItem(label: string | RegExp): Locator { return this.contextMenu.getByRole('menuitem', { name: label }); }
	private getContextMenuCheckboxItem(label: string | RegExp): Locator { return this.contextMenu.getByRole('menuitemcheckbox', { name: label }); }

	constructor(private code: Code) {
		// Check if we're on macOS AND we have an Electron app instance
		// Only macOS + Electron combination uses native context menus
		this.isNativeMenu = process.platform === 'darwin' && !!this.code.electronApp;
	}

	/**
	 * Action: Triggers a context menu and clicks a specified menu item.
	 * Note: This method is designed to work in both browser and electron!
	 *
	 * @param menuTrigger The locator that will trigger the context menu when clicked
	 * @param menuItemLabel The label of the menu item to click
	 * @param menuItemType The type of the menu item, either 'menuitemcheckbox' or 'menuitem'
	 */
	async triggerAndClick({ menuTrigger, menuItemLabel, menuItemType = 'menuitem', menuTriggerButton = 'left' }: ContextMenuClick): Promise<void> {
		await test.step(`Trigger context menu and click '${menuItemLabel}'`, async () => {
			if (this.isNativeMenu) {
				await this.nativeMenuTriggerAndClick({ menuTrigger, menuItemLabel, menuTriggerButton });
			} else {
				await menuTrigger.hover();
				await menuTrigger.click({ button: menuTriggerButton });

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
				throw new Error(`Electron app is not available. Platform: ${process.platform}`);
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
	private async nativeMenuTriggerAndClick({ menuTrigger, menuItemLabel, menuTriggerButton = 'left' }: Omit<ContextMenuClick, 'menuItemType'> & { clickButton?: ClickButton }): Promise<void> {
		// Show the context menu by clicking on the trigger element
		const menuItems = await this.showContextMenu(() => menuTrigger.click({ button: menuTriggerButton }));

		// Handle the menu interaction once it's shown
		if (menuItems) {
			// Verify the requested menu item exists
			const menuItemExists = typeof menuItemLabel === 'string'
				? menuItems.items.includes(menuItemLabel)
				: menuItems.items.some(item => menuItemLabel.test(item));

			if (!menuItemExists) {
				const labelStr = typeof menuItemLabel === 'string'
					? menuItemLabel
					: menuItemLabel.toString();
				throw new Error(`Context menu '${labelStr}' not found. Available items: ${menuItems.items.join(', ')}`);
			}

			// For RegExp, find the first matching item
			const actualItemLabel = typeof menuItemLabel === 'string'
				? menuItemLabel
				: menuItems.items.find(item => menuItemLabel.test(item));

			if (!actualItemLabel) {
				throw new Error('Failed to find matching menu item');
			}

			// Select the menu item through Electron IPC
			await this.selectContextMenuItem(menuItems.menuId, actualItemLabel);
		} else {
			const labelStr = typeof menuItemLabel === 'string'
				? menuItemLabel
				: menuItemLabel.toString();
			throw new Error(`Context menu '${labelStr}' did not appear or no menu items found.`);
		}
	}
}

type ClickButton = 'left' | 'right' | 'middle';

interface ContextMenuClick {
	menuTrigger: Locator;
	menuItemLabel: string | RegExp;
	menuItemType?: 'menuitemcheckbox' | 'menuitem';
	menuTriggerButton?: ClickButton;
}
