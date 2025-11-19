/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from '../infra/code.js';
import test, { expect, Locator, Page } from '@playwright/test';

export type MenuItemState = {
	label: string;
	enabled?: boolean;
	visible?: boolean;
	checked?: boolean;
};

export class ContextMenu {
	private get page(): Page { return this.code.driver.page; }
	private isNativeMenu: boolean;
	private get contextMenu(): Locator { return this.page.locator('.monaco-menu'); }
	private getContextMenuItem(label: string | RegExp): Locator { return this.contextMenu.getByRole('menuitem', { name: label }); }
	private getContextMenuCheckboxItem(label: string | RegExp): Locator { return this.contextMenu.getByRole('menuitemcheckbox', { name: label }); }

	constructor(private code: Code) {
		// Check if we're on macOS AND we have an Electron app instance
		// Only macOS + Electron combination uses native context menus
		this.isNativeMenu = process.platform === 'darwin' && !!this.code.electronApp;
	}

	/**
	 * Action: Triggers a context menu without selecting a submenu item.
	 * - For native menus this returns the menu id/items from showContextMenu.
	 * - For web menus this clicks the trigger and waits for the in-page menu to appear.
	 */
	private async triggerMenu(menuTrigger: Locator, menuTriggerButton: ClickButton = 'left'): Promise<{ menuId: number; items: MenuItemState[] } | undefined> {
		if (this.isNativeMenu && this.code.electronApp) {
			this.code.logger?.log?.('[contextMenu] using native context');
			let nativeResult: { menuId: number; items: MenuItemState[] } | undefined;
			try {
				await expect(async () => {
					nativeResult = await this.showContextMenu(() => menuTrigger.click({ button: menuTriggerButton }));
					expect(nativeResult).toBeDefined();
				}).toPass({ timeout: 5000 });
			} catch {
				throw new Error('Native context menu did not appear after retries.');
			}
			return nativeResult!;
		} else {
			this.code.logger?.log?.('[contextMenu] using web context');
			try {
				await expect(async () => {
					try { await menuTrigger.click({ button: menuTriggerButton }); } catch { /* ignore transient */ }
					const visible = await this.contextMenu.isVisible().catch(() => false);
					if (!visible) { console.warn('[contextMenu] web menu did not appear'); }
					expect(visible).toBeTruthy();
				}).toPass({ timeout: 5000 });
			} catch {
				throw new Error('Web context menu did not appear after retries.');
			}
			return undefined;
		}
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
				this.code.logger.log(`Using native menu to select: ${menuItemLabel}`);
				await this.nativeMenuTriggerAndClick({ menuTrigger, menuItemLabel, menuTriggerButton });
			} else {
				this.code.logger.log(`Using web menu to select: ${menuItemLabel}`);
				await this.triggerMenu(menuTrigger, menuTriggerButton);

				// Hover over the menu item
				const menuItem = menuItemType === 'menuitemcheckbox'
					? this.getContextMenuCheckboxItem(menuItemLabel)
					: this.getContextMenuItem(menuItemLabel);
				await menuItem.hover({ timeout: 1000 });
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
	 * Action: Closes an open context menu
	 *
	 * @returns Promise that resolves when the context menu is closed
	 */
	private async closeContextMenu(): Promise<void> {
		// Prefer native IPC for Electron on macOS; fall back to sending Escape to the page.
		if (this.isNativeMenu && this.code.electronApp) {
			try {
				await this.code.electronApp.evaluate(({ app }) => {
					app.emit('e2e:contextMenuClose');
				});
				return;
			} catch (err) {
				console.error('[closeContextMenu] native IPC failed, falling back to Escape:', err);
			}
		}

		// Fallback: dismiss any in-page menu with Escape. Ignore transient failures.
		await this.page.keyboard.press('Escape').catch(() => { /* ignore */ });
	}

	// --- Private methods ---

	/**
	 * Shows a context menu and returns the menu ID and items.
	 * @param trigger A function that triggers the context menu (e.g., a click on a button)
	 * @returns
	 */
	private async showContextMenu(trigger: () => Promise<void>): Promise<{ menuId: number; items: MenuItemState[] } | undefined> {
		if (!this.code.electronApp) {
			throw new Error(`[showContextMenu] Electron app is not available. Platform: ${process.platform}`);
		}

		try {
			// Ask the main process to wait for the context menu shown event.
			const shownPromise: Promise<[number, MenuItemState[]]> | undefined = this.code.electronApp.evaluate(({ app }) => {
				return new Promise((resolve) => {
					const listener: any = (...args: [number, MenuItemState[]]) => {
						app.removeListener('e2e:contextMenuShown' as any, listener);
						resolve(args);
					};
					app.addListener('e2e:contextMenuShown' as any, listener);
				});
			});

			if (!shownPromise) { return undefined; }

			// Trigger the menu first, then wait for the native event with a bounded timeout.
			await trigger();

			const NATIVE_MENU_WAIT_MS = 2000;
			const shownEvent = await Promise.race<
				| [number, MenuItemState[]]
				| undefined
			>([
				shownPromise,
				new Promise(resolve => setTimeout(() => resolve(undefined), NATIVE_MENU_WAIT_MS))
			]);

			if (shownEvent) {
				const [menuId, items] = shownEvent as [number, MenuItemState[]];
				return { menuId, items };
			}

			// Timed out waiting for native menu event;
			// Return undefined so caller can retry/fall back
			console.error('[showContextMenu] timed out waiting for native menu event');
			return undefined;
		} catch (err) {
			// Return undefined so caller can retry/fall back
			console.error('[showContextMenu] native evaluate failed:', err);
			return undefined;
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
		const menuItems = await this.triggerMenu(menuTrigger, menuTriggerButton);

		if (!menuItems) {
			throw new Error('Native context menu did not appear or no menu items found.');
		}

		// Handle native menu items
		const menuItemExists = typeof menuItemLabel === 'string'
			? menuItems.items.some(item => item.label === menuItemLabel)
			: menuItems.items.some(item => menuItemLabel.test(item.label));

		if (!menuItemExists) {
			const labelStr = typeof menuItemLabel === 'string'
				? menuItemLabel
				: menuItemLabel.toString();
			throw new Error(`Context menu '${labelStr}' not found. Available items: ${menuItems.items.map(i => i.label).join(', ')}`);
		}

		const actualItemLabel = typeof menuItemLabel === 'string'
			? menuItemLabel
			: menuItems.items.find(item => menuItemLabel.test(item.label))!.label;

		if (!actualItemLabel) {
			throw new Error('Failed to find matching menu item');
		}

		await this.selectContextMenuItem(menuItems.menuId, actualItemLabel);
	}

	/**
	 * Verify: Verifies the states of multiple context menu items.
	 * @param param0 - menuTrigger, menuTriggerButton, menuItemStates
	 */
	async triggerAndVerifyMenuItems({ menuTrigger, menuTriggerButton = 'left', menuItemStates }:
		Omit<ContextMenuClick, 'menuItemType' | 'menuItemLabel'> & { clickButton?: ClickButton; menuItemStates: MenuItemState[] }): Promise<void> {

		const menuItems = await this.triggerMenu(menuTrigger, menuTriggerButton);

		if (this.isNativeMenu) {
			if (!menuItems) {
				throw new Error('Context menu did not appear or no menu items found.');
			}

			// Verify each requested menu item state
			for (const expectedItem of menuItemStates) {
				const menuItem = menuItems.items.find(item =>
					typeof expectedItem.label === 'string'
						? item.label.includes(expectedItem.label)
						: (expectedItem.label as RegExp).test(item.label)
				);

				if (!menuItem) {
					throw new Error(`Context menu item '${expectedItem.label}' not found.`);
				}

				// verify enabled state
				if (typeof expectedItem.enabled === 'boolean' && menuItem.enabled !== expectedItem.enabled) {
					throw new Error(`Context menu item '${expectedItem.label}' enabled state mismatch.`);
				}

				// verify visibility state
				if (typeof expectedItem.visible === 'boolean' && menuItem.visible !== expectedItem.visible) {
					throw new Error(`Context menu item '${expectedItem.label}' visibility state mismatch.`);
				}

				// verify checked state
				if (typeof expectedItem.checked === 'boolean' && menuItem.checked !== expectedItem.checked) {
					throw new Error(`Context menu item '${expectedItem.label}' checked state mismatch.`);
				}
			}

		} else {
			for (const { label: menuLabel, visible, enabled } of menuItemStates) {
				const menuItem = this.getContextMenuItem(menuLabel);

				// verify visibility state
				if (typeof visible === 'boolean') {
					visible
						? await expect(menuItem).toBeVisible({ timeout: 2000 })
						: await expect(menuItem).not.toBeVisible({ timeout: 2000 });
				}

				// verify enabled state
				if (typeof enabled === 'boolean') {
					enabled
						? await expect(menuItem).toBeEnabled({ timeout: 2000 })
						: await expect(menuItem).toBeDisabled({ timeout: 2000 });
				}

				// verify checked state
				// todo: not dealing with this right now. :)
			}
		}
		await this.closeContextMenu();
	}
}

type ClickButton = 'left' | 'right' | 'middle';

interface ContextMenuClick {
	menuTrigger: Locator;
	menuItemLabel: string | RegExp;
	menuItemType?: 'menuitemcheckbox' | 'menuitem';
	menuTriggerButton?: ClickButton;
}
