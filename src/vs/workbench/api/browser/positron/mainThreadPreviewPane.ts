/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from 'vs/base/common/lifecycle';
import { ExtHostPositronContext, ExtHostPreviewPaneShape, MainPositronContext, MainThreadPreviewPaneShape } from 'vs/workbench/api/common/positron/extHost.positron.protocol';
import { IExtHostContext, extHostNamedCustomer } from 'vs/workbench/services/extensions/common/extHostCustomers';
import { IPositronPreviewService, IPreviewPaneItem, IPreviewPaneItemOptions } from 'vs/workbench/services/positronPreview/common/positronPreview';

@extHostNamedCustomer(MainPositronContext.MainThreadPreviewPane)
export class MainThreadPreviewPane implements MainThreadPreviewPaneShape {

	private readonly _disposables = new DisposableStore();

	private readonly _proxy: ExtHostPreviewPaneShape;

	private readonly _items: Map<number, IPreviewPaneItem> = new Map();

	constructor(
		extHostContext: IExtHostContext,
		@IPositronPreviewService private readonly _positronPreviewService: IPositronPreviewService,
	) {
		this._proxy = extHostContext.getProxy(ExtHostPositronContext.ExtHostPreviewPane);
	}

	async $createPreviewPaneItem(handle: number, options: IPreviewPaneItemOptions): Promise<void> {
		const item = await this._positronPreviewService.createPreviewPaneItem(options);
		this._items.set(handle, item);
		this._disposables.add(item);
	}

	$disposePreviewPaneItem(handle: number): Thenable<void> {
		if (this._items.has(handle)) {
			this._items.get(handle)?.dispose();
			this._items.delete(handle);
		} else {
			throw new Error(`Invalid preview pane item handle (${handle}); cannot dispose`);
		}
		return Promise.resolve();
	}

	$sendMessageToPreviewPane(handle: number, message: Object): Thenable<void> {
		if (this._items.has(handle)) {
			return this._items.get(handle)!.sendMessage(message);
		} else {
			throw new Error(`Invalid preview pane item handle (${handle}); cannot send message`);
		}
	}

	$isPreviewItemShowing(handle: number): Promise<boolean> {
		throw new Error('Method not implemented.');
	}

	dispose(): void {
		this._disposables.dispose();
	}
}

