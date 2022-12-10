/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BrowserWindow, IpcMainEvent, Menu, MenuItem } from 'electron';
import { validatedIpcMain } from 'vs/base/parts/ipc/electron-main/ipcMain';
import { withNullAsUndefined } from 'vs/base/common/types';
import { CONTEXT_MENU_CHANNEL, CONTEXT_MENU_CLOSE_CHANNEL, IPopupOptions, ISerializableContextMenuItem } from 'vs/base/parts/contextmenu/common/contextmenu';

export function registerContextMenuListener(): void {
	validatedIpcMain.on(CONTEXT_MENU_CHANNEL, (event: IpcMainEvent, contextMenuId: number, items: ISerializableContextMenuItem[], onClickChannel: string, options?: IPopupOptions) => {
		// --- Start Positron ---
		// Added options for IPopupOptions.
		const menu = createMenu(event, onClickChannel, items, options);
		// --- End Positron ---

		menu.popup({
			window: withNullAsUndefined(BrowserWindow.fromWebContents(event.sender)),
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

// --- Start Positron ---
// Added options for IPopupOptions.
function createMenu(event: IpcMainEvent, onClickChannel: string, items: ISerializableContextMenuItem[], options?: IPopupOptions): Menu {
	// --- End Positron ---
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

	// --- Start Positron ---
	// If the user has dev tools opened, append the "Inspect Element" menu item to the context menu.
	if (options && event.sender.isDevToolsOpened()) {
		menu.append(new MenuItem({
			type: 'separator'
		}));

		menu.append(new MenuItem({
			type: 'normal',
			label: 'Inspect Element',
			click: (menuItem, browserWindow, contextmenuEvent) => {
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
	// --- End Positron ---

	return menu;
}
