/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IPreviewPaneItem } from 'vs/workbench/services/positronPreview/common/positronPreview';
import * as extHostProtocol from './extHost.positron.protocol';
import type * as positron from 'positron';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';

class PreviewPaneItemProxy extends Disposable implements positron.PreviewPaneItem {

	id: string;

	private readonly _onDidReceiveMessage = new Emitter<Object>();

	constructor(
		readonly handle: number,
		private readonly _proxy: extHostProtocol.MainThreadPreviewPaneShape
	) {
		super();
		this.id = Math.random().toString(16).slice(2);
		this.onDidReceiveMessage = this._onDidReceiveMessage.event;
	}

	isShowing(): Thenable<boolean> {
		return this._proxy.$isPreviewItemShowing(this.handle);
	}

	sendMessage(message: Object): Thenable<void> {
		return this._proxy.$sendMessageToPreviewPane(this.handle, message);
	}

	emitMessage(message: Object): void {
		this._onDidReceiveMessage.fire(message);
	}

	onDidReceiveMessage: Event<Object>;

	override dispose(): void {
		this._proxy.$disposePreviewPaneItem(this.handle);
		super.dispose();
	}
}

export class ExtHostPreviewPane implements extHostProtocol.ExtHostPreviewPaneShape {

	private readonly _proxy: extHostProtocol.MainThreadPreviewPaneShape;

	private readonly _items: Array<PreviewPaneItemProxy> = [];

	constructor(
		mainContext: extHostProtocol.IMainPositronContext
	) {
		// Trigger creation of the proxy
		this._proxy = mainContext.getProxy(extHostProtocol.MainPositronContext.MainThreadPreviewPane);
	}

	$emitMessageFromPreviewPane(handle: number, message: Object): void {
		if (handle >= 0 && handle < this._items.length) {
			this._items[handle].emitMessage(message);
		} else {
			throw new Error(`Invalid preview pane item handle (${handle}); ` +
				`dropping message ${JSON.stringify(message)}`);
		}
	}

	createPreviewPaneItem(options: positron.PreviewPaneItemOptions): IPreviewPaneItem {
		// Create the proxy and add it to the list of items
		const item = new PreviewPaneItemProxy(this._items.length, this._proxy);
		this._items.push(item);

		// Trigger creation of the item in the main process
		this._proxy.$createPreviewPaneItem(item.handle, options);

		return item;
	}
}
