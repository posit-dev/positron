/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IExtensionDescription } from '../../../../platform/extensions/common/extensions.js';
import { serializeWebviewOptions, toExtensionData, ExtHostWebview, ExtHostWebviews } from '../extHostWebview.js';
import { IExtHostWorkspace } from '../extHostWorkspace.js';
import type * as vscode from 'vscode';
import type * as positron from 'positron';
import * as extHostProtocol from './extHost.positron.protocol.js';

/** The dialog's size, if the caller does not pick one. */
const DEFAULT_WIDTH = 700;
const DEFAULT_HEIGHT = 500;

/**
 * The extension-host half of a webview hosted in a Positron modal dialog.
 *
 * Deliberately much smaller than `ExtHostPreviewPanel` or
 * `ExtHostWebviewPanel`: a modal dialog is either open or gone, so there is no
 * view state to track -- no view column, no visible/active transitions, no
 * serialization.
 */
class ExtHostWebviewDialog extends Disposable implements positron.WebviewDialog {

	readonly #handle: extHostProtocol.WebviewDialogHandle;
	readonly #proxy: extHostProtocol.MainThreadWebviewDialogShape;
	readonly #viewType: string;
	readonly #webview: ExtHostWebview;
	readonly #title: string;

	#isDisposed = false;

	readonly #onDidDispose = this._register(new Emitter<void>());
	public readonly onDidDispose = this.#onDidDispose.event;

	constructor(
		handle: extHostProtocol.WebviewDialogHandle,
		proxy: extHostProtocol.MainThreadWebviewDialogShape,
		viewType: string,
		title: string,
		webview: ExtHostWebview,
	) {
		super();
		this.#handle = handle;
		this.#proxy = proxy;
		this.#viewType = viewType;
		this.#title = title;
		this.#webview = webview;
	}

	public override dispose() {
		if (this.#isDisposed) {
			return;
		}

		this.#isDisposed = true;
		this.#onDidDispose.fire();
		this.#proxy.$disposeWebviewDialog(this.#handle);
		this.#webview.dispose();

		super.dispose();
	}

	get viewType(): string {
		this.assertNotDisposed();
		return this.#viewType;
	}

	get title(): string {
		this.assertNotDisposed();
		return this.#title;
	}

	get webview(): vscode.Webview {
		this.assertNotDisposed();
		return this.#webview;
	}

	private assertNotDisposed() {
		if (this.#isDisposed) {
			throw new Error('Webview dialog is disposed');
		}
	}
}

export class ExtHostWebviewDialogs extends Disposable implements extHostProtocol.ExtHostWebviewDialogShape {

	private static newHandle(): extHostProtocol.WebviewDialogHandle {
		return generateUuid();
	}

	private readonly _proxy: extHostProtocol.MainThreadWebviewDialogShape;

	private readonly _dialogs = new Map<extHostProtocol.WebviewDialogHandle, ExtHostWebviewDialog>();

	constructor(
		mainContext: extHostProtocol.IMainPositronContext,
		private readonly webviews: ExtHostWebviews,
		private readonly workspace: IExtHostWorkspace | undefined,
	) {
		super();
		this._proxy = mainContext.getProxy(extHostProtocol.MainPositronContext.MainThreadWebviewDialog);
	}

	public override dispose(): void {
		super.dispose();
		this._dialogs.forEach(dialog => dialog.dispose());
		this._dialogs.clear();
	}

	public createWebviewDialog(
		extension: IExtensionDescription,
		viewType: string,
		title: string,
		options: positron.WebviewDialogOptions = {},
	): positron.WebviewDialog {
		const handle = ExtHostWebviewDialogs.newHandle();
		this._proxy.$createWebviewDialog(toExtensionData(extension), handle, viewType, {
			title,
			webviewOptions: serializeWebviewOptions(extension, this.workspace, options),
			width: options.width ?? DEFAULT_WIDTH,
			height: options.height ?? DEFAULT_HEIGHT,
		}, false);

		const webview = this.webviews.$createNewWebview(handle, options, extension) as ExtHostWebview;
		const dialog = new ExtHostWebviewDialog(handle, this._proxy, viewType, title, webview);
		this._dialogs.set(handle, dialog);
		return dialog;
	}

	/**
	 * The dialog went away on the main thread -- the user dismissed it, or the
	 * window is going down. Disposing here fires `onDidDispose` for the extension.
	 */
	async $onDidDisposeWebviewDialog(handle: extHostProtocol.WebviewDialogHandle): Promise<void> {
		const dialog = this._dialogs.get(handle);
		this._dialogs.delete(handle);
		dialog?.dispose();
		this.webviews.$deleteWebview(handle);
	}
}
