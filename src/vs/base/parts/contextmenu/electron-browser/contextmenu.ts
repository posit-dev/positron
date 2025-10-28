/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CONTEXT_MENU_CHANNEL, CONTEXT_MENU_CLOSE_CHANNEL, IContextMenuEvent, IContextMenuItem, IPopupOptions, ISerializableContextMenuItem } from '../common/contextmenu.js';
import { ipcRenderer } from '../../sandbox/electron-browser/globals.js';

let contextMenuIdPool = 0;

export function popup(items: IContextMenuItem[], options?: IPopupOptions, onHide?: () => void): void {
	const processedItems: IContextMenuItem[] = [];

	const contextMenuId = contextMenuIdPool++;
	const onClickChannel = `vscode:onContextMenu${contextMenuId}`;
	const onClickChannelHandler = (event: unknown, itemId: number, context: IContextMenuEvent) => {
		const item = processedItems[itemId];
		item.click?.(context);
	};

	ipcRenderer.once(onClickChannel, onClickChannelHandler);
	ipcRenderer.once(CONTEXT_MENU_CLOSE_CHANNEL, (event: unknown, closedContextMenuId: number) => {
		console.log(`[${Date.now()}] ELECTRON BROWSER: Received CONTEXT_MENU_CLOSE_CHANNEL for contextMenuId: ${closedContextMenuId}, expecting: ${contextMenuId}`);
		if (closedContextMenuId !== contextMenuId) {
			console.log(`[${Date.now()}] ELECTRON BROWSER: Context menu ID mismatch, ignoring close event`);
			return;
		}

		console.log(`[${Date.now()}] ELECTRON BROWSER: Context menu ID matches, calling onHide`);
		ipcRenderer.removeListener(onClickChannel, onClickChannelHandler);

		onHide?.();
		console.log(`[${Date.now()}] ELECTRON BROWSER: onHide completed`);
	});

	console.log(`[${Date.now()}] ELECTRON BROWSER: Sending CONTEXT_MENU_CHANNEL to show menu with contextMenuId: ${contextMenuId}`);
	ipcRenderer.send(CONTEXT_MENU_CHANNEL, contextMenuId, items.map(item => createItem(item, processedItems)), onClickChannel, options);
}

function createItem(item: IContextMenuItem, processedItems: IContextMenuItem[]): ISerializableContextMenuItem {
	const serializableItem: ISerializableContextMenuItem = {
		id: processedItems.length,
		label: item.label,
		type: item.type,
		accelerator: item.accelerator,
		checked: item.checked,
		enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
		visible: typeof item.visible === 'boolean' ? item.visible : true
	};

	processedItems.push(item);

	// Submenu
	if (Array.isArray(item.submenu)) {
		serializableItem.submenu = item.submenu.map(submenuItem => createItem(submenuItem, processedItems));
	}

	return serializableItem;
}
