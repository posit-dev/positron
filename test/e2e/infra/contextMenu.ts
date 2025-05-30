/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from './code.js';
import { Locator } from '@playwright/test';

export class ContextMenu {
	private page = this.code.driver.page;

	constructor(
		private code: Code,
		private projectName: string,
	) { }

	/**
	 * Helper: Gets all menu item labels from a context menu
	 *
	 * @param menuTrigger The locator that will trigger the context menu when clicked
	 * @returns Array of menu item labels
	 */
	async getMenuItems(menuTrigger: Locator): Promise<string[]> {
		if (this.projectName.includes('browser')) {
			await menuTrigger.click();
			const menuItems = this.page.getByRole('menuitem');
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
		} else {
			const menuItems = await this.showContextMenu(() => menuTrigger.click());
			if (!menuItems) {
				throw new Error('Context menu did not appear or no menu items found.');
			}
			await this.closeContextMenu();
			return menuItems.items;
		}
	}

	/**
	 * Action: Triggers a context menu and clicks a specified menu item.
	 *
	 * @param menuTrigger The locator that will trigger the context menu when clicked
	 * @param menuItemLabel The label of the menu item to click
	 */
	async triggerAndClick({ menuTrigger, menuItemLabel }: { menuTrigger: Locator; menuItemLabel: string }): Promise<void> {
		if (!this.projectName.includes('browser')) {
			await this._triggerAndClick({ menuTrigger, menuItemLabel });
		}
		else {
			await menuTrigger.click();
			await this.page.getByRole('menuitem', { name: menuItemLabel }).hover();
			await this.page.waitForTimeout(500);
			await this.page.getByRole('menuitem', { name: menuItemLabel }).click();
		}
	}

	/**
	 * Action: Closes an open context menu
	 *
	 * @returns Promise that resolves when the context menu is closed
	 */
	async closeContextMenu(): Promise<void> {
		if (this.projectName.includes('browser')) {
			await this.page.keyboard.press('Escape');
		} else {
			await this.code.electronApp?.evaluate(({ app }) => {
				app.emit('e2e:contextMenuClose');
			});
		}
	}

	private async showContextMenu(trigger: () => void): Promise<{ menuId: number; items: string[] } | undefined> {
		const shownPromise: Promise<[number, string[]]> | undefined = this.code.electronApp?.evaluate(({ app }) => {
			return new Promise((resolve) => {
				const listener: any = (...args: [number, string[]]) => {
					app.removeListener('e2e:contextMenuShown' as any, listener);
					resolve(args);
				};
				app.addListener('e2e:contextMenuShown' as any, listener);
			});
		});

		if (!shownPromise) {
			return undefined;
		}

		const [shownEvent] = await Promise.all([shownPromise, trigger()]);
		if (shownEvent) {
			const [menuId, items] = shownEvent;
			return {
				menuId,
				items
			};
		}

	}

	private async selectContextMenuItem(contextMenuId: number, label: string): Promise<void> {
		await this.code.electronApp?.evaluate(async ({ app }, [contextMenuId, label]) => {
			app.emit('e2e:contextMenuSelect', contextMenuId, label);
		}, [contextMenuId, label]);
	}

	private async _triggerAndClick({ menuTrigger, menuItemLabel }: { menuTrigger: Locator; menuItemLabel: string }): Promise<void> {
		const menuItems = await this.showContextMenu(() => menuTrigger.click());

		if (menuItems) {
			if (!menuItems.items.includes(menuItemLabel)) {
				throw new Error(`Context menu '${menuItemLabel}' not found. Available items: ${menuItems.items.join(', ')}`);
			}
			await this.selectContextMenuItem(menuItems.menuId, menuItemLabel);
		} else {
			throw new Error(`Context menu '${menuItemLabel}' did not appear or no menu items found.`);
		}
	}
}
