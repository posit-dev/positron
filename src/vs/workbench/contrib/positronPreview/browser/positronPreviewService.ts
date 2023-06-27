/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IPositronPreviewService } from 'vs/workbench/services/positronPreview/browser/positronPreview';
import { Event, Emitter } from 'vs/base/common/event';
import { IOverlayWebview, IWebviewService, WebviewInitInfo } from 'vs/workbench/contrib/webview/browser/webview';
import { generateUuid } from 'vs/base/common/uuid';

export class PreviewWebview extends Disposable {
	constructor(
		readonly viewType: string,
		readonly providedId: string,
		readonly name: string,
		readonly webview: IOverlayWebview
	) {
		super();
		this._register(this.webview);
	}

	override dispose() {
		super.dispose();
	}
}

export class PositronPreviewService extends Disposable implements IPositronPreviewService {

	declare readonly _serviceBrand: undefined;

	private _items: Map<string, PreviewWebview> = new Map();

	private _selectedItemId = '';

	private _onDidCreatePreviewWebviewEmitter = new Emitter<PreviewWebview>();

	private _onDidChangeActivePreviewWebview = new Emitter<string>;

	constructor(
		@IWebviewService private readonly _webviewService: IWebviewService
	) {
		super();
		this.onDidCreatePreviewWebview = this._onDidCreatePreviewWebviewEmitter.event;
		this.onDidChangeActivePreviewWebview = this._onDidChangeActivePreviewWebview.event;
	}

	get previewWebviews(): PreviewWebview[] {
		return Array.from(this._items.values());
	}

	get activePreviewWebviewId(): string {
		return this._selectedItemId;
	}

	set activePreviewWebviewId(id: string) {
		this._selectedItemId = id;
		this._onDidChangeActivePreviewWebview.fire(id);
	}

	onDidChangeActivePreviewWebview: Event<string>;

	openPreview(webviewInitInfo: WebviewInitInfo,
		viewType: string,
		title: string,
		preserveFocus?: boolean | undefined): PreviewWebview {

		const webview = this._webviewService.createWebviewOverlay(webviewInitInfo);
		const id = generateUuid();
		const preview = new PreviewWebview(viewType, id, title, webview);

		this._items.set(preview.providedId, preview);

		this._onDidCreatePreviewWebviewEmitter.fire(preview);
		this.activePreviewWebviewId = preview.providedId;

		return preview;
	}

	onDidCreatePreviewWebview: Event<PreviewWebview>;
}
