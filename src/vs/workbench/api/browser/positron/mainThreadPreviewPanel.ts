/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { MainThreadWebviews, reviveWebviewExtension } from 'vs/workbench/api/browser/mainThreadWebviews';
import { WebviewExtensionDescription } from 'vs/workbench/api/common/extHost.protocol';
import { ExtensionKeyedWebviewOriginStore } from 'vs/workbench/contrib/webview/browser/webview';
import { IExtHostContext } from 'vs/workbench/services/extensions/common/extHostCustomers';
import { IPositronPreviewService } from 'vs/workbench/services/positronPreview/browser/positronPreview';
import * as extHostProtocol from 'vs/workbench/api/common/positron/extHost.positron.protocol';
import { PreviewWebview } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewService';
import { Disposable } from 'vs/base/common/lifecycle';

/**
 * Bi-directional map between webview handles and previews.
 */
class PreviewWebviewStore {
	private readonly _handlesToPreviews = new Map<string, PreviewWebview>();
	private readonly _previewsToHandles = new Map<PreviewWebview, string>();

	public add(handle: string, input: PreviewWebview): void {
		this._handlesToPreviews.set(handle, input);
		this._previewsToHandles.set(input, handle);
	}

	public getHandleForPreview(input: PreviewWebview): string | undefined {
		return this._previewsToHandles.get(input);
	}

	public getPreviewForHandle(handle: string): PreviewWebview | undefined {
		return this._handlesToPreviews.get(handle);
	}

	public delete(handle: string): void {
		const input = this.getPreviewForHandle(handle);
		this._handlesToPreviews.delete(handle);
		if (input) {
			this._previewsToHandles.delete(input);
		}
	}

	public get size(): number {
		return this._handlesToPreviews.size;
	}

	[Symbol.iterator](): Iterator<PreviewWebview> {
		return this._handlesToPreviews.values();
	}
}

export class MainThreadPreviewPanel extends Disposable implements extHostProtocol.MainThreadPreviewPanelShape {

	private readonly webviewOriginStore: ExtensionKeyedWebviewOriginStore;

	private readonly _previews = new PreviewWebviewStore();

	private readonly _proxy: extHostProtocol.ExtHostPreviewPanelShape;

	constructor(
		context: IExtHostContext,
		private readonly _mainThreadWebviews: MainThreadWebviews,
		@IStorageService private readonly _storageService: IStorageService,
		@IPositronPreviewService private readonly _positronPreviewService: IPositronPreviewService,
	) {
		super();

		this.webviewOriginStore = new ExtensionKeyedWebviewOriginStore('mainThreadPreviewPanel.origins', this._storageService);

		this._proxy = context.getProxy(extHostProtocol.ExtHostPositronContext.ExtHostPreviewPanel);
	}

	$createPreviewPanel(extensionData: WebviewExtensionDescription, handle: string, viewType: string, initData: extHostProtocol.IPreviewInitData, preserveFocus: boolean): void {
		const extension = reviveWebviewExtension(extensionData);
		const origin = this.webviewOriginStore.getOrigin(viewType, extension.id);

		const preview = this._positronPreviewService.openPreview({
			origin,
			providedViewType: viewType,
			title: initData.title,
			options: {
				enableFindWidget: false,
				retainContextWhenHidden: true,
			},
			contentOptions: {
				allowScripts: initData.webviewOptions.enableScripts,
				allowForms: initData.webviewOptions.enableForms,
				enableCommandUris: false,
				localResourceRoots:
					Array.isArray(initData.webviewOptions.localResourceRoots) ?
						initData.webviewOptions.localResourceRoots.map(
							r => URI.revive(r)) : undefined,
			},
			extension
		},
			`mainThreadWebview-${viewType}`,
			initData.title,
			preserveFocus);

		this.addWebview(handle, preview);
	}

	$disposePreview(handle: string): void {
		throw new Error('Method not implemented.');
	}

	$reveal(handle: string, preserveFocus: boolean): void {
		throw new Error('Method not implemented.');
	}

	$setTitle(handle: string, value: string): void {
		throw new Error('Method not implemented.');
	}

	override dispose(): void {
		super.dispose();
	}

	public addWebview(handle: extHostProtocol.PreviewHandle, preview: PreviewWebview): void {
		this._previews.add(handle, preview);
		this._mainThreadWebviews.addWebview(handle, preview.webview,
			{
				// This is the standard for extensions built for VS Code
				// 1.57.0 and above (see `shouldSerializeBuffersForPostMessage`).
				serializeBuffersForPostMessage: true
			});

		preview.webview.onDidDispose(() => {
			this._proxy.$onDidDisposePreviewPanel(handle).finally(() => {
				this._previews.delete(handle);
			});
		});
	}
}
