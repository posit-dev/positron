/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer, encodeBase64 } from 'vs/base/common/buffer';
import { Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { IWorkspaceTrustManagementService } from 'vs/platform/workspace/common/workspaceTrust';
import { RendererMetadata, StaticPreloadMetadata } from 'vs/workbench/contrib/notebook/browser/view/renderers/webviewMessages';
import { preloadsScriptStr } from 'vs/workbench/contrib/notebook/browser/view/renderers/webviewPreloads';
import { INotebookRendererInfo, RendererMessagingSpec } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { NotebookOutputWebview, RENDER_COMPLETE } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebview';
import { INotebookOutputWebview, IPositronNotebookOutputWebviewService } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService';
import { IWebviewService, WebviewInitInfo } from 'vs/workbench/contrib/webview/browser/webview';
import { asWebviewUri } from 'vs/workbench/contrib/webview/common/webview';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { ILanguageRuntime, ILanguageRuntimeMessageWebOutput } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { MIME_TYPE_WIDGET_STATE, MIME_TYPE_WIDGET_VIEW, IPyWidgetViewSpec } from 'vs/workbench/services/positronIPyWidgets/common/positronIPyWidgetsService';

export class PositronNotebookOutputWebviewService implements IPositronNotebookOutputWebviewService {

	// Required for dependency injection
	readonly _serviceBrand: undefined;

	constructor(
		@IWebviewService private readonly _webviewService: IWebviewService,
		@INotebookService private readonly _notebookService: INotebookService,
		@IWorkspaceTrustManagementService private readonly _workspaceTrustManagementService: IWorkspaceTrustManagementService,
		@IExtensionService private readonly _extensionService: IExtensionService,
	) {
	}


	async createNotebookOutputWebview(
		runtime: ILanguageRuntime,
		output: ILanguageRuntimeMessageWebOutput
	): Promise<INotebookOutputWebview | undefined> {
		// Check to see if any of the MIME types have a renderer associated with
		// them. If they do, prefer the renderer.
		for (const mimeType of Object.keys(output.data)) {
			if (mimeType === MIME_TYPE_WIDGET_STATE || mimeType === MIME_TYPE_WIDGET_VIEW) {
				return this.createWidgetHtmlOutput(output.id, runtime, output.data);
			}

			if (mimeType === 'text/plain') {
				continue;
			}
			const renderer = this._notebookService.getPreferredRenderer(mimeType);
			if (renderer) {
				return this.createNotebookRenderOutput(output.id, runtime,
					renderer, mimeType, output);
			}
		}

		// If no dedicated renderer is found, check to see if there is a raw
		// HTML representation of the output.
		for (const mimeType of Object.keys(output.data)) {
			if (mimeType === 'text/html') {
				return this.createRawHtmlOutput(output.id, runtime, output.data[mimeType]);
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
	 * Gets the static preloads for a given extension.
	 */
	private async getStaticPreloadsData(ext: ExtensionIdentifier):
		Promise<StaticPreloadMetadata[]> {
		const preloads = await this._notebookService.getStaticPreloadsForExt(ext);
		return Array.from(preloads, preload => {
			return {
				entrypoint: this.asWebviewUri(preload.entrypoint, preload.extensionLocation)
					.toString()
					.toString()
			};
		});
	}

	private async createNotebookRenderOutput(id: string,
		runtime: ILanguageRuntime,
		renderer: INotebookRendererInfo,
		mimeType: string,
		message: ILanguageRuntimeMessageWebOutput
	): Promise<INotebookOutputWebview> {

		const data = message.data[mimeType] as any;

		// Get the renderer's entrypoint and convert it to a webview URI
		const rendererPath = asWebviewUri(renderer.entrypoint.path);

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
			outputWordWrap: false
		},
			this.getRendererData(mimeType),
			await this.getStaticPreloadsData(renderer.extensionId),
			this._workspaceTrustManagementService.isWorkspaceTrusted(),
			id);

		// Get auxiliary resource roots from the runtime service and convert
		// them to webview URIs
		const resourceRoots = new Array<URI>();
		if (message.resource_roots) {
			for (const root of message.resource_roots) {
				resourceRoots.push(URI.revive(root));
			}
		}

		// Create the metadata for the webview
		const webviewInitInfo: WebviewInitInfo = {
			contentOptions: {
				allowScripts: true,
				// Needed since we use the API ourselves, and it's also used by
				// preload scripts
				allowMultipleAPIAcquire: true,
				localResourceRoots: [
					// Ensure that the renderer can load local resources from
					// the extension that provides it
					renderer.extensionLocation,
					...resourceRoots
				],
			},
			extension: {
				id: renderer.extensionId,
			},
			options: {},
			title: '',
		};

		// Create the webview itself
		const webview = this._webviewService.createWebviewOverlay(webviewInitInfo);

		// Encode the data as base64, as either a raw string or JSON object
		const rawData = encodeBase64(
			typeof (data) === 'string' ? VSBuffer.fromString(data) :
				VSBuffer.fromString(JSON.stringify(data)));

		// Form the HTML to send to the webview. Currently, this is a very simplified version
		// of the HTML that the notebook renderer API creates, but it works for many renderers.
		//
		// Some features known to be NYI:
		// - Message passing between the renderer and the host (RendererContext)
		// - Extending another renderer (RendererContext)
		// - State management (RendererContext)
		// - Raw Uint8Array data and blobs

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
<script type="module">
	const vscode = acquireVsCodeApi();
	import { activate } from "${rendererPath.toString()}"

	// A stub implementation of RendererContext
	var ctx = {
		workspace: {
			isTrusted: ${this._workspaceTrustManagementService.isWorkspaceTrusted()}
		}
	}

	// Activate the renderer and create the data object
	var renderer = activate(ctx);
	var rawData = atob('${rawData}');
	var data = {
		id: '${id}',
		mime: '${mimeType}',
		text: () => { return rawData },
		json: () => { return JSON.parse(rawData) },
		data: () => { return new Uint8Array() /* NYI */ },
		blob: () => { return new Blob(); /* NYI */ },
	};

	const controller = new AbortController();
	const signal = controller.signal;

	// Render the widget when the page is loaded, then post a message to the
	// host letting it know that render is complete.
	window.onload = function() {
		let container = document.getElementById('container');
		renderer.renderOutputItem(data, container, signal);
		vscode.postMessage('${RENDER_COMPLETE}');
	};
</script>
<script type="module">${preloads}</script>
</body>
`);

		return new NotebookOutputWebview(id, runtime.metadata.runtimeId, webview);
	}

	/**
	 * Renders raw HTML in a webview.
	 *
	 * @param id The ID of the notebook output
	 * @param runtime The runtime that emitted the output
	 * @param html The HTML to render
	 *
	 * @returns A promise that resolves to the new webview.
	 */
	async createRawHtmlOutput(id: string, runtime: ILanguageRuntime, html: string):
		Promise<INotebookOutputWebview> {

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
			extension: {
				id: runtime.metadata.extensionId
			},
			options: {},
			title: '',
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
${html}
<script>
const vscode = acquireVsCodeApi();
window.onload = function() {
	vscode.postMessage('${RENDER_COMPLETE}');
};
</script>`);
		return new NotebookOutputWebview(id, runtime.metadata.runtimeId, webview);
	}

	/**
	 * Renders widget HTML in a webview.
	 *
	 * @param id The ID of the notebook output
	 * @param runtime The runtime that emitted the output
	 * @param data A set of records containing the widget state and view mimetype data
	 *
	 * @returns A promise that resolves to the new webview.
	 */
	async createWidgetHtmlOutput(id: string, runtime: ILanguageRuntime, data: Record<string, string>):
		Promise<INotebookOutputWebview> {
		const managerState = data[MIME_TYPE_WIDGET_STATE];
		const widgetViews = JSON.parse(data[MIME_TYPE_WIDGET_VIEW]) as IPyWidgetViewSpec[];

		// load positron-python extension, which has modules needed to load ipywidgets
		const pythonExtension = await this._extensionService.getExtension('ms-python.python');
		if (!pythonExtension) {
			return Promise.reject(`positron-python not found`);
		}
		// Form the path to the necessary libraries and inject it into the HTML
		const requiresPath = asWebviewUri(
			URI.joinPath(pythonExtension.extensionLocation, 'resources/js/requirejs/require.js'));

		const htmlManagerPath = asWebviewUri(
			URI.joinPath(pythonExtension.extensionLocation, 'resources/js/@jupyter-widgets/html-manager/dist/embed-amd.js'));

		const jupyterMatplotlibPath = asWebviewUri(
			URI.joinPath(pythonExtension.extensionLocation, 'resources/js/jupyter-matplotlib/dist/index.js'));

		const renderer = this._notebookService.getPreferredRenderer(MIME_TYPE_WIDGET_VIEW);
		if (!renderer) {
			return Promise.reject(`No renderer found for ${MIME_TYPE_WIDGET_VIEW}`);
		}
		const rawData = encodeBase64(
			VSBuffer.fromString(JSON.stringify(data)));

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
			outputWordWrap: false
		},
			this.getRendererData(MIME_TYPE_WIDGET_VIEW),
			await this.getStaticPreloadsData(renderer.extensionId),
			this._workspaceTrustManagementService.isWorkspaceTrusted(),
			id);

		// Create the metadata for the webview
		const webviewInitInfo: WebviewInitInfo = {
			contentOptions: {
				allowScripts: true,
				localResourceRoots: [
					// Ensure that the renderer can load local resources from
					// the extension that provides it (jupyter extension for ipywidgets)
					renderer.extensionLocation,
					pythonExtension.extensionLocation
				]
			},
			extension: {
				id: runtime.metadata.extensionId
			},
			options: {},
			title: '',
		};
		const webview = this._webviewService.createWebviewOverlay(webviewInitInfo);
		const rendererPath = asWebviewUri(renderer.entrypoint.path);
		const kernelPath = asWebviewUri(URI.joinPath(rendererPath, '../../ipywidgetsKernel/ipywidgetsKernel.js'));

		const createWidgetDiv = (widgetView: IPyWidgetViewSpec) => {
			const model_id = widgetView.model_id;
			const viewString = JSON.stringify(widgetView);
			return (`
<div id="widget-${model_id}">
	<script type="${MIME_TYPE_WIDGET_VIEW}">
		${viewString}
	</script>
</div>`
			);
		};
		const widgetDivs = widgetViews.map(view => createWidgetDiv(view)).join('\n');

		webview.setHtml(`
<html>
<head>

<script type="module">
	const vscode = acquireVsCodeApi();
	import { activate } from "${rendererPath.toString()}"
	import { activate as activateKernel } from "${kernelPath.toString()}"

	// Activate the renderer and create the data object
	// borrowed from notebook/browser/view/renderers/webviewPreloads.ts:
	// createRendererContext, createKernelContext, and createEmitter functions
	// (typescript converted to vanilla javascript)
	function createEmitter(listenerChange = () => undefined) {
		const listeners = new Set();
		return {
			fire(data) {
				for (const listener of [...listeners]) {
					listener.fn.call(listener.thisArg, data);
				}
			},
			event(fn, thisArg, disposables) {
				const listenerObj = { fn, thisArg };
				const disposable = {
					dispose: () => {
						listeners.delete(listenerObj);
						listenerChange(listeners);
					},
				};

				listeners.add(listenerObj);
				listenerChange(listeners);

				if (disposables instanceof Array) {
					disposables.push(disposable);
				} else if (disposables) {
					disposables.add(disposable);
				}

				return disposable;
			},
		};
	}

	const onMessageEmitter = createEmitter();
	const onKernelMessageEmitter = createEmitter();

	const rendererContext = {
		setState: newState => vscode.setState({ ...vscode.getState(), [${renderer.id}]: newState }),
		getState: () => {
			const state = vscode.getState();
			return typeof state === 'object' && state ? state[${renderer.id}] : undefined;
		},
		getRenderer: async (_id) => {
			const renderer = {
				id: '${renderer.id}',
				displayName: '${renderer.displayName}',
				entrypoint: {
					extends: undefined,
					path: '${rendererPath.toString()}'
				},
				mimeTypes: ['${MIME_TYPE_WIDGET_VIEW}'],
				messaging: true,
				isBuiltin: false
			};
			return renderer;
		},
		workspace: {
			isTrusted: ${this._workspaceTrustManagementService.isWorkspaceTrusted()}
		},
		postMessage: (message) => {
			vscode.postMessage({
				__vscode_notebook_message: true,
				type: 'custom_renderer_message',
				rendererId: '${renderer.id}',
				...message
			});
		},

		onDidReceiveMessage: onMessageEmitter.event
	};

	const kernelContext = {
		postKernelMessage: (message) => {
			vscode.postMessage({
				__vscode_notebook_message: true,
				type: 'custom_kernel_message',
				...message
			});
		},
		onDidReceiveKernelMessage: onKernelMessageEmitter.event
	};

	window.addEventListener('message', async event => {

		switch (event.data.type) {
			case 'custom_kernel_message':
				onKernelMessageEmitter.fire(event.data.message);
				break;
			case 'custom_renderer_message':
				onMessageEmitter.fire(event.data.message);
				break;
		}
	});

	const renderer = activate(rendererContext);
	const kernel = activateKernel(kernelContext);
	const controller = new AbortController();
	const signal = controller.signal;
	var rawData = atob('${rawData}');
	var data = {
		id: '${id}',
		mime: '${MIME_TYPE_WIDGET_VIEW}',
		text: () => { return rawData },
		json: () => { return JSON.parse(rawData) },
		data: () => { return new Uint8Array() /* NYI */ },
		blob: () => { return new Blob(); /* NYI */ },
	};

	// Render the widget when the page is loaded, then post a message to the
	// host letting it know that render is complete.
	window.onload = function() {
		let container = document.getElementById('container');
		renderer.renderOutputItem(data, container, signal);
	};

</script>
<script type="module">${preloads}</script>

<!-- Load RequireJS, used by the IPywidgets for dependency management -->
<script src='${requiresPath}'></script>

<!-- Load the HTML manager, which is used to render the widgets -->
<script src='${htmlManagerPath}'></script>

<!-- Load jupyter-matplotlib, which is used to render matplotlib widgets -->
<script src='${jupyterMatplotlibPath}'></script>

<!-- The state of all the widget models on the page -->
<script type="${MIME_TYPE_WIDGET_STATE}">
${managerState}
</script>

</head>

<body>
	<!-- The view specs of the primary widget models only -->
	${widgetDivs}
</body>
</html>
		`);
		return new NotebookOutputWebview(id, runtime.metadata.runtimeId, webview);
	}
}
