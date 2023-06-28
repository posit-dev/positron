/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IOverlayWebview } from 'vs/workbench/contrib/webview/browser/webview';
import { Emitter, Event } from 'vs/base/common/event';

export class PreviewWebview extends Disposable {

	private _disposed = false;

	private _visible = false;

	private _active = false;

	private _onDidChangeActiveState = new Emitter<boolean>();
	private _onDidChangeVisibleState = new Emitter<boolean>();

	constructor(
		readonly viewType: string,
		readonly previewId: string,
		readonly name: string,
		readonly webview: IOverlayWebview
	) {
		super();

		this.onDidChangeActiveState = this._onDidChangeActiveState.event;
		this.onDidChangeVisibleState = this._onDidChangeVisibleState.event;

		// Ensure that the webview is disposed when the preview is disposed.
		this._register(this.webview);
	}

	onDidChangeActiveState: Event<boolean>;

	onDidChangeVisibleState: Event<boolean>;

	isDisposed(): boolean {
		return this._disposed;
	}

	get active(): boolean {
		return this._active;
	}

	set active(active: boolean) {
		this._active = active;
		this._onDidChangeActiveState.fire(active);
	}

	get visible(): boolean {
		return this._visible;
	}

	set visible(visible: boolean) {
		this._visible = visible;
		this._onDidChangeActiveState.fire(visible);
	}

	override dispose() {
		super.dispose();
		this._disposed = true;
	}
}
