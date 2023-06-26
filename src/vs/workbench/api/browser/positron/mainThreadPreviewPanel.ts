/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { MainThreadWebviews, reviveWebviewExtension } from 'vs/workbench/api/browser/mainThreadWebviews';
import { WebviewExtensionDescription } from 'vs/workbench/api/common/extHost.protocol';
import { IPreviewInitData, MainPositronContext, MainThreadPreviewPanelShape } from 'vs/workbench/api/common/positron/extHost.positron.protocol';
import { ExtensionKeyedWebviewOriginStore } from 'vs/workbench/contrib/webview/browser/webview';
import { IExtHostContext, extHostNamedCustomer } from 'vs/workbench/services/extensions/common/extHostCustomers';
import { IPositronPreviewService } from 'vs/workbench/services/positronPreview/common/positronPreview';

@extHostNamedCustomer(MainPositronContext.MainThreadPreviewPanel)
export class MainThreadPreviewPanel implements MainThreadPreviewPanelShape {

	private readonly webviewOriginStore: ExtensionKeyedWebviewOriginStore;

	constructor(
		context: IExtHostContext,
		private readonly _mainThreadWebviews: MainThreadWebviews,
		@IStorageService private readonly _storageService: IStorageService,
		@IPositronPreviewService private readonly _positronPreviewService: IPositronPreviewService,
	) {
		this.webviewOriginStore = new ExtensionKeyedWebviewOriginStore('mainThreadPreviewPanel.origins', _storageService);
	}

	$createPreviewPanel(extensionData: WebviewExtensionDescription, handle: string, viewType: string, initData: IPreviewInitData, preserveFocus: boolean): void {
		const extension = reviveWebviewExtension(extensionData);
		const origin = this.webviewOriginStore.getOrigin(viewType, extension.id);

		this._positronPreviewService.openPreview({
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
	dispose(): void {
		throw new Error('Method not implemented.');
	}

}
