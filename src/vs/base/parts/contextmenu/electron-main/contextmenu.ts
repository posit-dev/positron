/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { app, IpcMainEvent, Menu, MenuItem } from 'electron';
import { validatedIpcMain } from '../../ipc/electron-main/ipcMain.js';
import { CONTEXT_MENU_CHANNEL, CONTEXT_MENU_CLOSE_CHANNEL, IPopupOptions, ISerializableContextMenuItem } from '../common/contextmenu.js';

export function registerContextMenuListener(): void {
	const contextMenus = new Map<number, Menu>();

	validatedIpcMain.on(CONTEXT_MENU_CHANNEL, (event: IpcMainEvent, contextMenuId: number, items: ISerializableContextMenuItem[], onClickChannel: string, options?: IPopupOptions) => {
		const menu = createMenu(event, onClickChannel, items);

		// --- Start Positron ---
		// If the user has dev tools opened, append the "Inspect Element" menu item to the context menu.
		if (options && event.sender.isDevToolsOpened()) {
			menu.append(new MenuItem({
				type: 'separator'
			}));

			menu.append(new MenuItem({
				type: 'normal',
				label: 'Inspect Element',
				click: (menuItem, browserWindow: any, contextmenuEvent) => {
					const webContents = browserWindow?.webContents;
					if (webContents) {
						// TODO (kevin): I had trouble convincing Electron to bring the devtools
						// window to the front, so we just take the easy way out and re-open the page.
						webContents.closeDevTools();
						webContents.inspectElement(options.x || 0, options.y || 0);
					}
				}
			}));
		}

		// Register test-only context menu hooks when running in Playwright
		if (process.env.PW_TEST === '1') {
			// Allow Playwright to trigger a context menu item by label
			const selectListener: any = (contextMenuId: number, label: string) => {
				const item = contextMenus.get(contextMenuId)?.items.find(item => item.label === label);
				if (item) {
					item.click();
					menu.closePopup();
				}
				app.removeListener('e2e:contextMenuSelect' as any, selectListener);
			};
			app.on('e2e:contextMenuSelect' as any, selectListener);

			// Allow Playwright to programmatically dismiss open context menus
			const closeListener = () => {
				for (const menu of contextMenus.values()) {
					try {
						menu.closePopup();
					} catch (e) {
						console.warn('Failed to close menu:', e);
					}
				}
				contextMenus.clear();
				app.removeListener('e2e:contextMenuClose' as any, closeListener);
			};

			app.on('e2e:contextMenuClose' as any, closeListener);

			// Notify Playwright that a context menu has opened and list its items
			menu.on('menu-will-show', () => {
				contextMenus.set(contextMenuId, menu);
				app.emit('e2e:contextMenuShown', contextMenuId, menu.items.map(item => item.label));
			});

			// Clean up context menu reference after it closes
			menu.on('menu-will-close', () => {
				contextMenus.delete(contextMenuId);
			});
		}
		// --- End Positron ---

		menu.popup({
			x: options ? options.x : undefined,
			y: options ? options.y : undefined,
			positioningItem: options ? options.positioningItem : undefined,
			callback: () => {
				// Workaround for https://github.com/microsoft/vscode/issues/72447
				// It turns out that the menu gets GC'ed if not referenced anymore
				// As such we drag it into this scope so that it is not being GC'ed
				if (menu) {
					event.sender.send(CONTEXT_MENU_CLOSE_CHANNEL, contextMenuId);
				}
			}
		});
	});
}

function createMenu(event: IpcMainEvent, onClickChannel: string, items: ISerializableContextMenuItem[]): Menu {
	const menu = new Menu();

	items.forEach(item => {
		let menuitem: MenuItem;

		// Separator
		if (item.type === 'separator') {
			menuitem = new MenuItem({
				type: item.type,
			});
		}

		// Sub Menu
		else if (Array.isArray(item.submenu)) {
			menuitem = new MenuItem({
				submenu: createMenu(event, onClickChannel, item.submenu),
				label: item.label
			});
		}

		// Normal Menu Item
		else {
			menuitem = new MenuItem({
				label: item.label,
				type: item.type,
				accelerator: item.accelerator,
				checked: item.checked,
				enabled: item.enabled,
				visible: item.visible,
				click: (menuItem, win, contextmenuEvent) => event.sender.send(onClickChannel, item.id, contextmenuEvent)
			});
		}

		menu.append(menuitem);
	});

	return menu;
}
