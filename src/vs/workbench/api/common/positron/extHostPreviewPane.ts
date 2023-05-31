/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IPreviewPaneItem } from 'vs/workbench/services/positronPreview/common/positronPreview';
import * as extHostProtocol from './extHost.positron.protocol';
import type * as positron from 'positron';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';

class PreviewPaneItemProxy extends Disposable implements positron.PreviewPaneItem {

	private readonly _onDidReceiveMessage = new Emitter<Object>();

	constructor(
		private readonly _handle: number,
		private readonly _proxy: extHostProtocol.MainThreadPreviewPaneShape
	) {
		super();
		this.onDidReceiveMessage = this._onDidReceiveMessage.event;
	}

	isShowing(): Thenable<boolean> {
		return this._proxy.$isPreviewItemShowing(this._handle);
	}

	sendMessage(message: Object): Thenable<void> {
		return this._proxy.$sendMessageToPreviewPane(this._handle, message);
	}

	onDidReceiveMessage: Event<Object>;

	override dispose(): void {
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
		throw new Error('Method not implemented.');
	}

	createPreviewPaneItem(options: positron.PreviewPaneItemOptions): IPreviewPaneItem {
		const item = new PreviewPaneItemProxy(this._items.length, this._proxy);
		this._items.push(item);
		this._proxy.$createPreviewPaneItem(0, options);
		return item;
	}
}
