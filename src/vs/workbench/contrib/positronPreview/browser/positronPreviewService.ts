/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IPositronPreviewService, IPreviewPaneItem, IPreviewPaneItemOptions } from 'vs/workbench/services/positronPreview/common/positronPreview';
import { Event, Emitter } from 'vs/base/common/event';
import { WebviewInitInfo } from 'vs/workbench/contrib/webview/browser/webview';

class PositronPreviewItem extends Disposable implements IPreviewPaneItem {
	id: string;

	_onDidReceiveMessageEmitter = new Emitter<Object>();

	constructor(readonly options: IPreviewPaneItemOptions) {
		super();

		// Generate random hex string for ID.
		this.id = Math.random().toString(16).slice(2);

		this.onDidReceiveMessage = this._onDidReceiveMessageEmitter.event;
	}

	isShowing(): Thenable<boolean> {
		throw new Error('Method not implemented.');
	}

	sendMessage(message: Object): Thenable<void> {
		throw new Error('Method not implemented.');
	}

	onDidReceiveMessage: Event<Object>;
}

export class PositronPreviewService extends Disposable implements IPositronPreviewService {

	declare readonly _serviceBrand: undefined;

	private _items: Map<string, IPreviewPaneItem> = new Map();

	private _onDidCreatePreviewPaneItemEmitter = new Emitter<IPreviewPaneItem>();
	private _onDidChangeActivePreviewPaneItemEmitter = new Emitter<string>();

	constructor() {
		super();
		this.onDidCreatePreviewPaneItem = this._onDidCreatePreviewPaneItemEmitter.event;
		this.onDidChangeActivePreviewPaneItem = this._onDidChangeActivePreviewPaneItemEmitter.event;
	}

	openPreview(webviewInitInfo: WebviewInitInfo,
		viewType: string,
		title: string,
		preserveFocus?: boolean | undefined): void {
		throw new Error('Method not implemented.');
	}

	onDidChangeActivePreviewPaneItem: Event<string>;

	onDidCreatePreviewPaneItem: Event<IPreviewPaneItem>;

	get previewPaneItems(): IPreviewPaneItem[] {
		return Array.from(this._items.values());
	}

	get activePreviewPaneItemId(): string {
		return this.previewPaneItems[0]?.id;
	}

	createPreviewPaneItem(options: IPreviewPaneItemOptions): Thenable<IPreviewPaneItem> {
		const item = new PositronPreviewItem(options);
		this._onDidCreatePreviewPaneItemEmitter.fire(item);

		// Creating a new preview item always makes it the active one.
		this._onDidChangeActivePreviewPaneItemEmitter.fire(item.id);

		return Promise.resolve(item);
	}

}
