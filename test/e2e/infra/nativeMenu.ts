/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from './code.js';
import { Locator } from '@playwright/test';

export class NativeMenu {

	constructor(
		private code: Code
	) {

	}

	async showContextMenu(trigger: () => void): Promise<{ menuId: number; items: string[] } | undefined> {
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

	async selectContextMenuItem(contextMenuId: number, label: string): Promise<void> {
		await this.code.electronApp?.evaluate(async ({ app }, [contextMenuId, label]) => {
			app.emit('e2e:contextMenuSelect', contextMenuId, label);
		}, [contextMenuId, label]);
	}

	async triggerAndClick(menuTrigger: Locator, menuItemLabel: string) {
		const menuItems = await this.showContextMenu(() => menuTrigger.click());

		if (menuItems) {
			if (!menuItems.items.includes(menuItemLabel)) {
				throw new Error(`Context menu '${menuItemLabel}' not found. Available items: ${menuItems.items.join(', ')}`);
			}
			await this.selectContextMenuItem(menuItems.menuId, menuItemLabel);
		} else {
			throw new Error(`Context menu '${menuItemLabel}' did not appear or no menu items found.`);
		}
	};
}
