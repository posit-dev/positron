/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IWorkspaceTrustManagementService } from 'vs/platform/workspace/common/workspaceTrust';
import { INotebookRendererInfo } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { NotebookOutputWebview } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebview';
import { INotebookOutputWebview, IPositronNotebookOutputWebviewService } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService';
import { IWebviewService, WebviewInitInfo } from 'vs/workbench/contrib/webview/browser/webview';
import { asWebviewUri } from 'vs/workbench/contrib/webview/common/webview';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { ILanguageRuntime, ILanguageRuntimeMessageOutput } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

export class PositronNotebookOutputWebviewService implements IPositronNotebookOutputWebviewService {

	readonly _serviceBrand: undefined;

	constructor(
		@IWebviewService private readonly _webviewService: IWebviewService,
		@INotebookService private readonly _notebookService: INotebookService,
		@IWorkspaceTrustManagementService private readonly _workspaceTrustManagementService: IWorkspaceTrustManagementService,
		@IExtensionService private readonly _extensionService: IExtensionService,
	) {
	}

	async createNotebookOutputWebview(runtime: ILanguageRuntime,
		output: ILanguageRuntimeMessageOutput): Promise<INotebookOutputWebview | undefined> {

		for (const mimeType of Object.keys(output.data)) {
			if (mimeType === 'text/html') {
				return this.createRawHtmlOutput(output.id, runtime, output.data[mimeType]);
			}

			const renderer = this._notebookService.getPreferredRenderer(mimeType);
			if (renderer) {
				return this.createNotebookRenderOutput(output.id,
					renderer, mimeType, output.data[mimeType]);
			}
		}

		// No renderer found
		return Promise.resolve(undefined);
	}

	async createNotebookRenderOutput(id: string,
		renderer: INotebookRendererInfo,
		mimeType: string,
		data: any): Promise<INotebookOutputWebview> {

		const rendererPath = asWebviewUri(renderer.entrypoint.path);
		const webviewInitInfo: WebviewInitInfo = {
			contentOptions: {
				allowScripts: true,
				localResourceRoots: [
					renderer.extensionLocation
				],
			},
			extension: {
				id: renderer.extensionId,
			},
			options: {},
			title: '',
		};

		const webview = this._webviewService.createWebviewOverlay(webviewInitInfo);

		webview.setHtml(`
<body>
<div id='container'></div>
<script type="module">
		import { activate } from "${rendererPath.toString()}"
		var ctx = {
			workspace: {
				isTrusted: ${this._workspaceTrustManagementService.isWorkspaceTrusted()}
			}
		}
		var renderer = activate(ctx);
		var rawData = ${JSON.stringify(data)};
		var data = {
			id: '${id}',
    		mime: '${mimeType}',
			text: () => { return rawData },
			json: () => { return JSON.parse(rawData) },
			data: () => { return new Uint8Array() },
			blob: () => { return new Blob(); },
		};

		console.log('** activated!!');
		const controller = new AbortController();
		const signal = controller.signal;
		window.onerror = function (e) {
			let pre = document.createElement('pre');
			pre.innerText = data.text();
			container.appendChild(pre);
		};
		window.onload = function() {
			let container = document.getElementById('container');
			console.log('** container: ' + container);
			renderer.renderOutputItem(data, container, signal);
			console.log('** rendered.');
		};
</script>
</body>`);

		return new NotebookOutputWebview(id, webview);
	}

	async createRawHtmlOutput(id: string, runtime: ILanguageRuntime, html: string):
		Promise<INotebookOutputWebview> {
		const jupyterExtension = await this._extensionService.getExtension('ms-toolsai.jupyter');
		if (!jupyterExtension) {
			return Promise.reject(`Jupyter extension 'ms-toolsai.jupyter' not found`);
		}
		const webviewInitInfo: WebviewInitInfo = {
			contentOptions: {
				allowScripts: true,
				localResourceRoots: [jupyterExtension.extensionLocation]
			},
			extension: {
				id: runtime.metadata.extensionId
			},
			options: {},
			title: '',
		};
		const webview = this._webviewService.createWebviewOverlay(webviewInitInfo);
		const jQueryPath = asWebviewUri(
			jupyterExtension.extensionLocation.with({
				path: jupyterExtension.extensionLocation.path +
					'/out/node_modules/jquery/dist/jquery.min.js'
			}));

		webview.setHtml(`<script src='${jQueryPath}'></script>${html}`);

		return new NotebookOutputWebview(id, webview);
	}
}

registerSingleton(IPositronNotebookOutputWebviewService,
	PositronNotebookOutputWebviewService,
	InstantiationType.Delayed);
