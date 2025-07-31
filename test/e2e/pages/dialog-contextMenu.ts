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
	 * @param menuItemClickPosition Where to click on the menu item (defaults to center)
	 */
	async triggerAndClick({
		menuTrigger,
		menuItemLabel,
		menuItemClickPosition = 'center',
	}: ContextMenuClick): Promise<void> {
		await test.step(`Trigger context menu and click '${menuItemLabel}'`, async () => {
			if (this.isNativeMenu) {
				await this._triggerAndClick({ menuTrigger, menuItemLabel, menuItemClickPosition });
			} else {
				await menuTrigger.click();
				const menuItem = this.getContextMenuItem(menuItemLabel);

				const box = await menuItem.boundingBox();
				if (!box) {
					throw new Error(`Could not get bounding box for menu item '${menuItemLabel}'`);
				}

				const pos = this.getClickOffset(menuItemClickPosition, box);
				await this.page.mouse.move(pos.x, pos.y); // Hover at the specific position
				await this.page.waitForTimeout(500);
				await this.page.mouse.click(pos.x, pos.y); // Click at the same position
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
	 * @param clickPosition optional click position on the menu item
	 */
	private async selectContextMenuItem(contextMenuId: number, label: string, clickPosition?: ClickPosition): Promise<void> {
		await this.code.electronApp?.evaluate(async ({ app }, [contextMenuId, label, clickPosition]) => {
			app.emit('e2e:contextMenuSelect', contextMenuId, label, clickPosition);
		}, [contextMenuId, label, clickPosition]);
	}

	/**
	 * Triggers a context menu and clicks a specified menu item in native menus (macOS/Electron).
	 *
	 * @param menuTrigger The element that will trigger the context menu
	 * @param menuItemLabel The menu item to select
	 * @param triggerClickPosition Where to click on the trigger element (defaults to center)
	 * @param menuItemClickPosition Where to click on the menu item (defaults to center)
	 */
	private async _triggerAndClick({ menuTrigger, menuItemLabel, menuItemClickPosition = 'center' }: ContextMenuClick): Promise<void> {
		// Show the context menu by clicking on the trigger element
		const menuItems = await this.showContextMenu(async () => {
			await menuTrigger.click();
		});

		// Handle the menu interaction once it's shown
		if (menuItems) {
			// Verify the requested menu item exists
			if (!menuItems.items.includes(menuItemLabel)) {
				throw new Error(`Context menu '${menuItemLabel}' not found. Available items: ${menuItems.items.join(', ')}`);
			}
			// Select the menu item through Electron IPC
			await this.selectContextMenuItem(menuItems.menuId, menuItemLabel, menuItemClickPosition);
		} else {
			throw new Error(`Context menu '${menuItemLabel}' did not appear or no menu items found.`);
		}
	}


	getClickOffset(position: 'center' | 'right' | 'left' | 'top' | 'bottom', bounds: Electron.Rectangle): { x: number; y: number } {
		const { x, y, width, height } = bounds;
		switch (position) {
			case 'left':
				return { x: x + 5, y: y + height / 2 };
			case 'right':
				return { x: x + width - 5, y: y + height / 2 };
			case 'top':
				return { x: x + width / 2, y: y + 5 };
			case 'bottom':
				return { x: x + width / 2, y: y + height - 5 };
			case 'center':
			default:
				return { x: x + width / 2, y: y + height / 2 };
		}
	}
}



interface ContextMenuClick {
	menuTrigger: Locator;
	menuItemLabel: string;
	menuItemClickPosition?: ClickPosition;
}
type ClickPosition = 'center' | 'right' | 'left' | 'top' | 'bottom';
