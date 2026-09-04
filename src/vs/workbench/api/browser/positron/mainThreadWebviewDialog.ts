/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap } from '../../../../base/common/lifecycle.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ExtensionKeyedWebviewOriginStore, IWebviewService } from '../../../contrib/webview/browser/webview.js';
import { showPositronWebviewDialog } from '../../../contrib/positronModalDialogs/browser/positronWebviewDialog.js';
import { IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { MainThreadWebviews, reviveWebviewContentOptions, reviveWebviewExtension } from '../mainThreadWebviews.js';
import { WebviewExtensionDescription } from '../../common/extHost.protocol.js';
import * as extHostProtocol from '../../common/positron/extHost.positron.protocol.js';

/**
 * Main thread implementation of webviews hosted in a Positron modal dialog.
 *
 * Unlike `MainThreadWebviewPanels`, this creates a bare overlay webview rather
 * than a `WebviewInput`: a modal dialog is not an editor, so there is nothing
 * for an editor input to hang off. The overlay is registered with
 * `MainThreadWebviews` so the extension-facing `postMessage` /
 * `onDidReceiveMessage` plumbing is the same as any other webview.
 */
export class MainThreadWebviewDialog extends Disposable implements extHostProtocol.MainThreadWebviewDialogShape {

	private readonly webviewOriginStore: ExtensionKeyedWebviewOriginStore;

	private readonly _proxy: extHostProtocol.ExtHostWebviewDialogShape;

	/**
	 * Open dialogs, keyed by handle. Disposing an entry closes the dialog and
	 * releases its webview, so the map owning them means a window teardown cleans
	 * up every dialog without the extension host having to participate.
	 */
	private readonly _dialogs = this._register(new DisposableMap<extHostProtocol.WebviewDialogHandle>());

	constructor(
		context: IExtHostContext,
		private readonly _mainThreadWebviews: MainThreadWebviews,
		@IStorageService private readonly _storageService: IStorageService,
		@IWebviewService private readonly _webviewService: IWebviewService,
	) {
		super();

		this.webviewOriginStore = new ExtensionKeyedWebviewOriginStore(
			'mainThreadWebviewDialog.origins', this._storageService);

		this._proxy = context.getProxy(extHostProtocol.ExtHostPositronContext.ExtHostWebviewDialog);
	}

	$createWebviewDialog(
		extensionData: WebviewExtensionDescription,
		handle: extHostProtocol.WebviewDialogHandle,
		viewType: string,
		initData: extHostProtocol.IWebviewDialogInitData,
		serializeBuffersForPostMessage: boolean,
	): void {
		const extension = reviveWebviewExtension(extensionData);
		const origin = this.webviewOriginStore.getOrigin(viewType, extension.id);

		const webview = this._webviewService.createWebviewOverlay({
			origin,
			providedViewType: viewType,
			title: initData.title,
			options: { retainContextWhenHidden: false, enableFindWidget: false },
			contentOptions: reviveWebviewContentOptions(initData.webviewOptions),
			extension,
		});

		this._mainThreadWebviews.addWebview(handle, webview, { serializeBuffersForPostMessage });

		const dialog = showPositronWebviewDialog({
			title: initData.title,
			webview,
			width: initData.width,
			height: initData.height,
			// Fires for a user dismissal as well as for our own close, so the
			// extension host learns about both through one path.
			onClosed: () => {
				// deleteAndLeak, not deleteAndDispose: the dialog is already closing,
				// and this callback can be reached from inside its own dispose. It is
				// a no-op when the key is already gone.
				this._dialogs.deleteAndLeak(handle);
				webview.dispose();
				this._proxy.$onDidDisposeWebviewDialog(handle);
			},
		});

		this._dialogs.set(handle, dialog);
	}

	$disposeWebviewDialog(handle: extHostProtocol.WebviewDialogHandle): void {
		// Disposing the dialog runs `onClosed`, which does the rest.
		this._dialogs.deleteAndDispose(handle);
	}
}
