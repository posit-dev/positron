/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IPositronPreviewService } from 'vs/workbench/services/positronPreview/browser/positronPreview';
import { Event, Emitter } from 'vs/base/common/event';
import { IOverlayWebview, IWebviewService, WebviewInitInfo } from 'vs/workbench/contrib/webview/browser/webview';

export class PreviewWebview extends Disposable {
	constructor(
		readonly viewType: string,
		readonly providedId: string | undefined,
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
		throw new Error('Method not implemented.');
	}
	set activePreviewWebviewId(id: string) {
		throw new Error('Method not implemented.');
	}

	onDidChangeActivePreviewWebview: Event<string>;

	openPreview(webviewInitInfo: WebviewInitInfo,
		viewType: string,
		title: string,
		preserveFocus?: boolean | undefined): PreviewWebview {

		const webview = this._webviewService.createWebviewOverlay(webviewInitInfo);
		const preview = new PreviewWebview(viewType, undefined, title, webview);

		this._items.set(preview.providedId!, preview);
		return preview;
	}

	onDidCreatePreviewWebview: Event<PreviewWebview>;
}
