/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Schemas } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { IPositronRenderMessage, RendererMetadata, StaticPreloadMetadata } from '../../notebook/browser/view/renderers/webviewMessages.js';
import { preloadsScriptStr } from '../../notebook/browser/view/renderers/webviewPreloads.js';
import { INotebookRendererInfo, RENDERER_NOT_AVAILABLE, RendererMessagingSpec } from '../../notebook/common/notebookCommon.js';
import { INotebookService } from '../../notebook/common/notebookService.js';
import { NotebookOutputWebview } from './notebookOutputWebview.js';
import { INotebookOutputWebview, IPositronNotebookOutputWebviewService } from './notebookOutputWebviewService.js';
import { IWebviewService, WebviewInitInfo } from '../../webview/browser/webview.js';
import { asWebviewUri } from '../../webview/common/webview.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { ILanguageRuntimeMessageWebOutput } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { dirname } from '../../../../base/common/resources.js';
import { INotebookRendererMessagingService } from '../../notebook/common/notebookRendererMessagingService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { handleWebviewLinkClicksInjection } from './downloadUtils.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { webviewMessageCodeString } from '../../positronWebviewPreloads/browser/notebookOutputUtils.js';

/**
 * Processed bundle of information about a message and how to render it for a webview.
 */
type MessageRenderInfo = {
	mimeType: string;
	renderer: INotebookRendererInfo;
	output: ILanguageRuntimeMessageWebOutput;
};


export class PositronNotebookOutputWebviewService implements IPositronNotebookOutputWebviewService {

	// Required for dependency injection
	readonly _serviceBrand: undefined;

	constructor(
		@IWebviewService private readonly _webviewService: IWebviewService,
		@INotebookService private readonly _notebookService: INotebookService,
		@IWorkspaceTrustManagementService private readonly _workspaceTrustManagementService: IWorkspaceTrustManagementService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@INotebookRendererMessagingService private readonly _notebookRendererMessagingService: INotebookRendererMessagingService,
		@ILogService private _logService: ILogService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService
	) {
	}

	/**
	 * Gather the preferred renders and the mime type they are preferred for from a series of output
	 * messages.
	 * @param outputs An array of output messages to find renderers for.
	 * @returns An array of renderers and the mime type they are preferred for along with the
	 * associated output message.
	 */
	private _findRenderersForOutputs(outputs: ILanguageRuntimeMessageWebOutput[]): MessageRenderInfo[] {
		return outputs
			.map(output => {
				const info = this._findRendererForOutput(output);
				if (!info) {
					this._logService.warn(
						'Failed to find renderer for output with mime types: ' +
						Object.keys(output.data).join(', ') +
						'/nOutput will be ignored.'
					);
				}
				return info;
			})
			.filter((info): info is MessageRenderInfo => Boolean(info));
	}

	/**
	 * Get the preferred mime type and renderer for an output message.
	 *
	 * @param output An output messages to find renderers for.
	 * @returns A renderer and the mime type it is preferred for along with the output message.
	 */
	private _findRendererForOutput(output: ILanguageRuntimeMessageWebOutput, viewType?: string): MessageRenderInfo | undefined {
		// Get the preferred mime type.
		// This is the same logic used in CellOutputViewModel.resolveMimeTypes.
		const mimeTypes = this._notebookService.getMimeTypeInfo(
			viewType, undefined, Object.keys(output.data)
		);
		const pickedMimeType = mimeTypes.find(
			mimeType => mimeType.rendererId !== RENDERER_NOT_AVAILABLE && mimeType.isTrusted
		);
		if (!pickedMimeType) {
			return;
		}

		// Get the renderer for the preferred mime type.
		const renderer = this._notebookService.getRendererInfo(pickedMimeType.rendererId);
		if (!renderer) {
			return;
		}

		return { mimeType: pickedMimeType.mimeType, renderer, output };
	}

	async createMultiMessageWebview({
		runtimeId,
		preReqMessages,
		displayMessage,
		viewType
	}: {
		runtimeId: string;
		preReqMessages: ILanguageRuntimeMessageWebOutput[];
		displayMessage: ILanguageRuntimeMessageWebOutput;
		viewType?: string;
	}): Promise<INotebookOutputWebview | undefined> {

		const displayInfo = this._findRendererForOutput(displayMessage);
		if (!displayInfo) {
			this._logService.error(
				'Failed to find renderer for output message with mime types: ' +
				Object.keys(displayMessage.data).join(', ') +
				'.'
			);
			return undefined;
		}
		return this.createNotebookRenderOutput({
			id: displayMessage.id,
			runtimeId,
			displayMessageInfo: displayInfo,
			preReqMessagesInfo: this._findRenderersForOutputs(preReqMessages),
			viewType,
		});
	}

	async createNotebookOutputWebview(
		{ id, runtime, output, viewType }:
			{
				id: string;
				runtime: ILanguageRuntimeSession;
				output: ILanguageRuntimeMessageWebOutput;
				viewType?: string;
			}
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
				return this.createNotebookRenderOutput({
					id,
					runtimeId: runtime.sessionId,
					displayMessageInfo: { mimeType, renderer, output },
					viewType,
				});
			}
		}

		// If no dedicated renderer is found, check to see if there is a raw
		// HTML representation of the output.
		for (const mimeType of Object.keys(output.data)) {
			if (mimeType === 'text/html') {
				return this.createRawHtmlOutput({
					id,
					runtimeOrSessionId: runtime,
					html: output.data[mimeType],
				});
			}
		}

		// No renderer found
		return Promise.resolve(undefined);
	}

	/**
	 * Gets renderer data. This is used to inject renderer contexts into the webview.
	 *
	 * @returns An array of renderer metadata.
	 */
	private getRendererData(): RendererMetadata[] {
		return this._notebookService.getRenderers()
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
	 * Gets the resource roots for a given messages and view type.
	 */
	private getResourceRoots(
		messages: ILanguageRuntimeMessageWebOutput[],
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
		for (const message of messages) {
			if (message.resource_roots) {
				for (const root of message.resource_roots) {
					resourceRoots.push(URI.revive(root));
				}
			}
		}
		return resourceRoots;
	}

	private async createNotebookRenderOutput({
		id,
		runtimeId,
		displayMessageInfo,
		preReqMessagesInfo,
		viewType
	}: {
		id: string;
		runtimeId: string;
		displayMessageInfo: MessageRenderInfo;
		preReqMessagesInfo?: MessageRenderInfo[];
		viewType?: string;
	}): Promise<INotebookOutputWebview> {

		// Make message info into an array if it isn't already
		const messagesInfo = [...preReqMessagesInfo ?? [], displayMessageInfo];

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
			this.getRendererData(),
			await this.getStaticPreloadsData(viewType),
			this._workspaceTrustManagementService.isWorkspaceTrusted(),
			id);

		// Create the metadata for the webview
		const webviewInitInfo: WebviewInitInfo = {
			// TODO: This is what the Viewer pane does. The back layer webview creates a UUID
			//       per viewType. Not sure what we should do.
			// Use the active window's origin. All webviews with the same origin will reuse the same
			// service worker.
			origin: DOM.getActiveWindow().origin,
			contentOptions: {
				allowScripts: true,
				// Needed since we use the API ourselves, and it's also used by
				// preload scripts
				allowMultipleAPIAcquire: true,
				localResourceRoots: this.getResourceRoots(messagesInfo.map(info => info.output), viewType),
			},
			extension: {
				// Just choose last renderer for now. This may be insufficient in the future.
				id: displayMessageInfo.renderer.extensionId,
			},
			options: {
				retainContextWhenHidden: true,
			},
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
	${PositronNotebookOutputWebviewService.CssAddons}
	<script>
		window.prompt = (message, _default) => {
			return _default ?? 'Untitled';
		};
		${webviewMessageCodeString}
	</script>
</head>
<body>
<div id='container'></div>
<div id="_defaultColorPalatte"></div>
<script type="module">${preloads}</script>
				</body>
					`);

		const scopedRendererMessaging = this._notebookRendererMessagingService.getScoped(id);

		const notebookOutputWebview = this._instantiationService.createInstance(
			NotebookOutputWebview,
			{
				id,
				sessionId: runtimeId,
				webview,
				rendererMessaging: scopedRendererMessaging
			},
		);

		// When the webview is ready to receive messages, send the render requests.
		notebookOutputWebview.onDidInitialize(() => {
			// Loop through all the messages and render them in the webview
			for (let i = 0; i < messagesInfo.length; i++) {
				const { output: message, mimeType, renderer } = messagesInfo[i];
				const data = message.data[mimeType];
				// Send a message to the webview to render the output.
				const valueBytes = typeof (data) === 'string' ? VSBuffer.fromString(data) :
					VSBuffer.fromString(JSON.stringify(data));
				// TODO: We may need to pass valueBytes.buffer (or some version of it) as the `transfer`
				//   argument to postMessage.
				const transfer: ArrayBuffer[] = [];
				const webviewMessage: IPositronRenderMessage = {
					type: 'positronRender',
					outputId: message.id,
					elementId: `positron-container-${i}`,
					rendererId: renderer.id,
					mimeType,
					metadata: message.metadata,
					valueBytes: valueBytes.buffer,
				};
				webview.postMessage(webviewMessage, transfer);
			}
		});

		return notebookOutputWebview;
	}

	async createRawHtmlOutput({ id, html, runtimeOrSessionId }: {
		id: string;
		html: string;
		runtimeOrSessionId: ILanguageRuntimeSession | string;
	}): Promise<INotebookOutputWebview> {

		// Load the Jupyter extension. Many notebook HTML outputs have a dependency on jQuery,
		// which is provided by the Jupyter extension.
		const jupyterExtension = await this._extensionService.getExtension('ms-toolsai.jupyter');
		if (!jupyterExtension) {
			return Promise.reject(`Jupyter extension 'ms-toolsai.jupyter' not found`);
		}

		// Create the metadata for the webview
		const webviewInitInfo: WebviewInitInfo = {
			// Use the active window's origin. All webviews with the same origin will reuse the same
			// service worker.
			origin: DOM.getActiveWindow().origin,
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

		const webview = this._webviewService.createWebviewOverlay(webviewInitInfo);

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

	${handleWebviewLinkClicksInjection};
};
</script>`);

		return this._instantiationService.createInstance(
			NotebookOutputWebview,
			{
				id,
				sessionId: typeof runtimeOrSessionId === 'string' ? runtimeOrSessionId : runtimeOrSessionId.sessionId,
				webview
			}
		);
	}

	/**
	 * A set of CSS addons to inject into the HTML of the webview. Used to do things like
	 * hide elements that are not functional in the context of positron such as links to
	 * pages that can't be opened.
	 */
	static readonly CssAddons = `
<style>
	/* Hide actions button that try and open external pages like opening source code as they don't currently work (See #2829)
	/* We do support download link clicks, so keep those. */
	.vega-actions a:not([download]) {
		display: none;
	}

	/* Hide the logo and 'loaded' message for bokeh plots */
	div:has(> .bk-notebook-logo) {
		display: none;
	}
</style>`;
}
