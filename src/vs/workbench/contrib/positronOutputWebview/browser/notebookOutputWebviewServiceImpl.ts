/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from 'vs/base/common/buffer';
import { Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import { IWorkspaceTrustManagementService } from 'vs/platform/workspace/common/workspaceTrust';
import { IPositronRenderMessage, RendererMetadata, StaticPreloadMetadata } from 'vs/workbench/contrib/notebook/browser/view/renderers/webviewMessages';
import { preloadsScriptStr } from 'vs/workbench/contrib/notebook/browser/view/renderers/webviewPreloads';
import { INotebookRendererInfo, RendererMessagingSpec } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { NotebookOutputWebview } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebview';
import { INotebookOutputWebview, IPositronNotebookOutputWebviewService, WebviewType } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService';
import { IOverlayWebview, IWebviewElement, IWebviewService, WebviewInitInfo } from 'vs/workbench/contrib/webview/browser/webview';
import { asWebviewUri } from 'vs/workbench/contrib/webview/common/webview';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { ILanguageRuntimeMessageWebOutput } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { ILanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { dirname } from 'vs/base/common/resources';
import { INotebookRendererMessagingService } from 'vs/workbench/contrib/notebook/common/notebookRendererMessagingService';

export class PositronNotebookOutputWebviewService implements IPositronNotebookOutputWebviewService {

	// Required for dependency injection
	readonly _serviceBrand: undefined;

	constructor(
		@IWebviewService private readonly _webviewService: IWebviewService,
		@INotebookService private readonly _notebookService: INotebookService,
		@IWorkspaceTrustManagementService private readonly _workspaceTrustManagementService: IWorkspaceTrustManagementService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@INotebookRendererMessagingService private readonly _notebookRendererMessagingService: INotebookRendererMessagingService,
	) {
	}


	async createNotebookOutputWebview(
		runtime: ILanguageRuntimeSession,
		output: ILanguageRuntimeMessageWebOutput,
		viewType?: string,
	): Promise<INotebookOutputWebview | undefined> {
		// Check to see if any of the MIME types have a renderer associated with
		// them. If they do, prefer the renderer.
		for (const mimeType of Object.keys(output.data)) {
			// Don't use a renderer for non-widget MIME types
			if (mimeType === 'text/plain' ||
				mimeType === 'text/html' ||
				mimeType === 'image/png') {
				continue;
			}

			const renderer = this._notebookService.getPreferredRenderer(mimeType);
			if (renderer) {
				return this.createNotebookRenderOutput(output.id, runtime,
					renderer, mimeType, output, viewType);
			}
		}

		// If no dedicated renderer is found, check to see if there is a raw
		// HTML representation of the output.
		for (const mimeType of Object.keys(output.data)) {
			if (mimeType === 'text/html') {
				return this.createRawHtmlOutput({
					id: output.id,
					runtimeOrSessionId: runtime,
					html: output.data[mimeType],
					webviewType: WebviewType.Overlay
				});
			}
		}

		// No renderer found
		return Promise.resolve(undefined);
	}

	/**
	 * Gets renderer data for a given MIME type. This is used to inject only the
	 * needed renderers into the webview.
	 *
	 * @param mimeType The MIME type to get renderers for
	 * @returns An array of renderers that can render the given MIME type
	 */
	private getRendererData(mimeType: string): RendererMetadata[] {
		return this._notebookService.getRenderers()
			.filter(renderer => renderer.mimeTypes.includes(mimeType))
			.map((renderer): RendererMetadata => {
				const entrypoint = {
					extends: renderer.entrypoint.extends,
					path: this.asWebviewUri(renderer.entrypoint.path, renderer.extensionLocation).toString()
				};
				return {
					id: renderer.id,
					entrypoint,
					mimeTypes: renderer.mimeTypes,
					messaging: renderer.messaging !== RendererMessagingSpec.Never,
					isBuiltin: renderer.isBuiltin
				};
			});
	}

	/**
	 * Convert a URI to a webview URI.
	 */
	private asWebviewUri(uri: URI, fromExtension: URI | undefined) {
		return asWebviewUri(uri, fromExtension?.scheme === Schemas.vscodeRemote ? { isRemote: true, authority: fromExtension.authority } : undefined);
	}

	/**
	 * Gets the static preloads for a given view type.
	 */
	private async getStaticPreloadsData(viewType: string | undefined):
		Promise<StaticPreloadMetadata[]> {
		if (!viewType) {
			return [];
		}
		const preloads = this._notebookService.getStaticPreloads(viewType);
		return Array.from(preloads, preload => {
			return {
				entrypoint: this.asWebviewUri(preload.entrypoint, preload.extensionLocation)
					.toString()
					.toString()
			};
		});
	}

	/**
	 * Gets the resource roots for a given message and view type.
	 */
	private getResourceRoots(
		message: ILanguageRuntimeMessageWebOutput,
		viewType: string | undefined,
	): URI[] {

		const resourceRoots = new Array<URI>();

		for (const renderer of this._notebookService.getRenderers()) {
			// Add each renderer's parent folder
			resourceRoots.push(dirname(renderer.entrypoint.path));
		}

		if (viewType) {
			for (const preload of this._notebookService.getStaticPreloads(viewType)) {
				// Add each preload's parent folder
				resourceRoots.push(dirname(preload.entrypoint));

				// Add each preload's local resource roots
				resourceRoots.push(...preload.localResourceRoots);
			}
		}

		// Add auxiliary resource roots contained in the runtime message
		// These are currently used by positron-r's htmlwidgets renderer
		if (message.resource_roots) {
			for (const root of message.resource_roots) {
				resourceRoots.push(URI.revive(root));
			}
		}
		return resourceRoots;
	}

	private async createNotebookRenderOutput(id: string,
		runtime: ILanguageRuntimeSession,
		renderer: INotebookRendererInfo,
		mimeType: string,
		message: ILanguageRuntimeMessageWebOutput,
		viewType?: string,
	): Promise<INotebookOutputWebview> {

		// Create the preload script contents. This is a simplified version of the
		// preloads script that the notebook renderer API creates.
		const preloads = preloadsScriptStr({
			// PreloadStyles
			outputNodeLeftPadding: 0,
			outputNodePadding: 0,
			tokenizationCss: '',
		}, {
			// PreloadOptions
			dragAndDropEnabled: false
		}, {
			lineLimit: 1000,
			outputScrolling: true,
			outputWordWrap: false,
			linkifyFilePaths: false,
			minimalError: false,
		},
			this.getRendererData(mimeType),
			await this.getStaticPreloadsData(viewType),
			this._workspaceTrustManagementService.isWorkspaceTrusted(),
			id);

		// Create the metadata for the webview
		const webviewInitInfo: WebviewInitInfo = {
			contentOptions: {
				allowScripts: true,
				// Needed since we use the API ourselves, and it's also used by
				// preload scripts
				allowMultipleAPIAcquire: true,
				localResourceRoots: this.getResourceRoots(message, viewType),
			},
			extension: {
				id: renderer.extensionId,
			},
			options: {},
			title: '',
		};

		// Create the webview itself
		const webview = this._webviewService.createWebviewOverlay(webviewInitInfo);

		// Form the HTML to send to the webview. Currently, this is a very simplified version
		// of the HTML that the notebook renderer API creates, but it works for many renderers.
		webview.setHtml(`
<head>
	<style nonce="${id}">
		#_defaultColorPalatte {
			color: var(--vscode-editor-findMatchHighlightBackground);
			background-color: var(--vscode-editor-findMatchBackground);
		}
	</style>
</head>
<body>
<div id='container'></div>
<div id="_defaultColorPalatte"></div>
<script type="module">${preloads}</script>
</body>
`);

		const render = () => {
			const data = message.data[mimeType];
			// Send a message to the webview to render the output.
			const valueBytes = typeof (data) === 'string' ? VSBuffer.fromString(data) :
				VSBuffer.fromString(JSON.stringify(data));
			// TODO: We may need to pass valueBytes.buffer (or some version of it) as the `transfer`
			//   argument to postMessage.
			const transfer: ArrayBuffer[] = [];
			const webviewMessage: IPositronRenderMessage = {
				type: 'positronRender',
				outputId: id,
				elementId: 'container',
				rendererId: renderer.id,
				mimeType,
				metadata: message.metadata,
				valueBytes: valueBytes.buffer,
			};
			webview.postMessage(webviewMessage, transfer);
		};

		const scopedRendererMessaging = this._notebookRendererMessagingService.getScoped(id);
		return new NotebookOutputWebview(
			id, runtime.sessionId, webview, render, scopedRendererMessaging);
	}

	async createRawHtmlOutput<WType extends WebviewType>({ id, html, webviewType, runtimeOrSessionId }: {
		id: string;
		html: string;
		webviewType: WType;
		runtimeOrSessionId: ILanguageRuntimeSession | string;
	}): Promise<
		INotebookOutputWebview<WType extends WebviewType.Overlay ? IOverlayWebview : IWebviewElement>
	> {
		// Load the Jupyter extension. Many notebook HTML outputs have a dependency on jQuery,
		// which is provided by the Jupyter extension.
		const jupyterExtension = await this._extensionService.getExtension('ms-toolsai.jupyter');
		if (!jupyterExtension) {
			return Promise.reject(`Jupyter extension 'ms-toolsai.jupyter' not found`);
		}

		// Create the metadata for the webview
		const webviewInitInfo: WebviewInitInfo = {
			contentOptions: {
				allowScripts: true,
				localResourceRoots: [jupyterExtension.extensionLocation]
			},
			options: {},
			title: '',
			// Sometimes we don't have an active runtime (e.g. rendering html for a notebook pre
			// runtime start) so we can't get the extension id from the runtime.
			extension: typeof runtimeOrSessionId === 'string' ? undefined : { id: runtimeOrSessionId.runtimeMetadata.extensionId }
		};

		const webview = webviewType === WebviewType.Overlay
			? this._webviewService.createWebviewOverlay(webviewInitInfo)
			: this._webviewService.createWebviewElement(webviewInitInfo);

		// Form the path to the jQuery library and inject it into the HTML
		const jQueryPath = asWebviewUri(
			jupyterExtension.extensionLocation.with({
				path: jupyterExtension.extensionLocation.path +
					'/out/node_modules/jquery/dist/jquery.min.js'
			}));

		webview.setHtml(`
<script src='${jQueryPath}'></script>
${PositronNotebookOutputWebviewService.CssAddons}
${html}
<script>
const vscode = acquireVsCodeApi();
window.onload = function() {
	vscode.postMessage({
		__vscode_notebook_message: true,
		type: 'positronRenderComplete',
	});
};
</script>`);

		return new NotebookOutputWebview(
			id,
			typeof runtimeOrSessionId === 'string' ? runtimeOrSessionId : runtimeOrSessionId.sessionId,
			// The unfortunate cast is necessary because typescript isn't capable of figuring out that
			// the type of the webview was determined by the type of the webviewType parameter.
			webview as WType extends WebviewType.Overlay ? IOverlayWebview : IWebviewElement
		);
	}

	/**
	 * A set of CSS addons to inject into the HTML of the webview. Used to do things like
	 * hide elements that are not functional in the context of positron such as links to
	 * pages that can't be opened.
	 */
	static readonly CssAddons = `
<style>
	/* Hide actions button that does things like opening source code etc.. (See #2829) */
	.vega-embed details[title="Click to view actions"] {display: none;}
</style>`;

}
