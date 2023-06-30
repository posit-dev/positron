/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { MainThreadWebviews, reviveWebviewExtension } from 'vs/workbench/api/browser/mainThreadWebviews';
import { WebviewExtensionDescription } from 'vs/workbench/api/common/extHost.protocol';
import { ExtensionKeyedWebviewOriginStore } from 'vs/workbench/contrib/webview/browser/webview';
import { IExtHostContext } from 'vs/workbench/services/extensions/common/extHostCustomers';
import * as extHostProtocol from 'vs/workbench/api/common/positron/extHost.positron.protocol';
import { Disposable } from 'vs/base/common/lifecycle';
import { IPositronPreviewService, POSITRON_PREVIEW_VIEW_ID } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewSevice';
import { PreviewWebview } from 'vs/workbench/contrib/positronPreview/browser/previewWebview';
import { IViewsService } from 'vs/workbench/common/views';

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

/**
 * This is the main thread implementation of the Preview panel. It handles
 * proxied requests from the extension host side and forwards them to the
 * appropriate webview or service.
 */
export class MainThreadPreviewPanel extends Disposable implements extHostProtocol.MainThreadPreviewPanelShape {

	private readonly webviewOriginStore: ExtensionKeyedWebviewOriginStore;

	private readonly _previews = new PreviewWebviewStore();

	private readonly _proxy: extHostProtocol.ExtHostPreviewPanelShape;

	constructor(
		context: IExtHostContext,
		private readonly _mainThreadWebviews: MainThreadWebviews,
		@IStorageService private readonly _storageService: IStorageService,
		@IPositronPreviewService private readonly _positronPreviewService: IPositronPreviewService,
		@IViewsService private readonly _viewsService: IViewsService,
	) {
		super();

		this.webviewOriginStore = new ExtensionKeyedWebviewOriginStore('mainThreadPreviewPanel.origins', this._storageService);

		// Create a proxy to the extension host side
		this._proxy = context.getProxy(extHostProtocol.ExtHostPositronContext.ExtHostPreviewPanel);
	}

	$createPreviewPanel(extensionData: WebviewExtensionDescription, handle: string, viewType: string, initData: extHostProtocol.IPreviewInitData, preserveFocus: boolean): void {
		const extension = reviveWebviewExtension(extensionData);
		const origin = this.webviewOriginStore.getOrigin(viewType, extension.id);

		// Ask the preview service to create a new preview. Note that the
		// preview service takes care of raising the preview panel if it isn't
		// currently visible to show the newly created preview.
		const preview = this._positronPreviewService.openPreview(handle, {
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
					// Call URI.revive on each element of the resource root
					// array, since the URI type is not fully serializable
					// across the extension host interface.
					Array.isArray(initData.webviewOptions.localResourceRoots) ?
						initData.webviewOptions.localResourceRoots.map(
							r => URI.revive(r)) : undefined,
			},
			extension
		},
			`mainThreadWebview-${viewType}`,
			initData.title,
			preserveFocus);

		// Store this preview in the map
		this.addWebview(handle, preview);

		// Establish event handlers for the preview view state changes, and
		// forward those to change events to the extension host side. Note that
		// (unlike WebviewPanel) the preview panel's view state changes are not
		// batched but delivered immediately.
		const updateState = () => {
			const viewStates: extHostProtocol.PreviewPanelViewStateData = {};
			viewStates[preview.previewId] = {
				active: preview.active,
				visible: preview.visible,
			};
			this._proxy.$onDidChangePreviewPanelViewStates(viewStates);
		};

		preview.onDidChangeActiveState(updateState);
		preview.onDidChangeVisibleState(updateState);
	}

	$disposePreview(handle: string): void {
		const preview = this._previews.getPreviewForHandle(handle);
		if (!preview || preview.isDisposed()) {
			return;
		}

		// Will trigger `$onDidDisposePreviewPanel`
		preview.dispose();
	}

	$reveal(handle: string, preserveFocus: boolean): void {
		const preview = this._previews.getPreviewForHandle(handle);
		if (!preview || preview.isDisposed()) {
			return;
		}

		this._positronPreviewService.activePreviewWebviewId = preview.previewId;

		// Raise the preview panel
		this._viewsService.openView(POSITRON_PREVIEW_VIEW_ID, preserveFocus);
	}

	$setTitle(handle: string, value: string): void {
		const preview = this._previews.getPreviewForHandle(handle);
		if (!preview || preview.isDisposed()) {
			return;
		}

		preview.webview.setTitle(value);
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
