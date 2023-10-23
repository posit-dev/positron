/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IPositronPreviewService } from 'vs/workbench/contrib/positronPreview/browser/positronPreview';
import { Event, Emitter } from 'vs/base/common/event';
import { IWebviewService, WebviewInitInfo } from 'vs/workbench/contrib/webview/browser/webview';
import { PreviewWebview } from 'vs/workbench/contrib/positronPreview/browser/previewWebview';
import { IViewsService } from 'vs/workbench/common/views';
import { POSITRON_PREVIEW_VIEW_ID } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewSevice';
import { ILanguageRuntime, ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { INotebookRendererInfo } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { asWebviewUri } from 'vs/workbench/contrib/webview/common/webview';
import { IWorkspaceTrustManagementService } from 'vs/platform/workspace/common/workspaceTrust';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';

/**
 * Positron preview service; keeps track of the set of active previews and
 * notifies listeners when the active preview changes.
 */
export class PositronPreviewService extends Disposable implements IPositronPreviewService {

	declare readonly _serviceBrand: undefined;

	private _items: Map<string, PreviewWebview> = new Map();

	private _selectedItemId = '';

	private _onDidCreatePreviewWebviewEmitter = new Emitter<PreviewWebview>();

	private _onDidChangeActivePreviewWebview = new Emitter<string>;

	constructor(
		@IWebviewService private readonly _webviewService: IWebviewService,
		@IViewsService private readonly _viewsService: IViewsService,
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService,
		@INotebookService private readonly _notebookService: INotebookService,
		@IWorkspaceTrustManagementService private readonly _workspaceTrustManagementService: IWorkspaceTrustManagementService,
		@IExtensionService private readonly _extensionService: IExtensionService,
	) {
		super();
		this.onDidCreatePreviewWebview = this._onDidCreatePreviewWebviewEmitter.event;
		this.onDidChangeActivePreviewWebview = this._onDidChangeActivePreviewWebview.event;
		this._languageRuntimeService.registeredRuntimes.forEach(runtime => {
			this.attachRuntime(runtime);
		});
		this._languageRuntimeService.onDidRegisterRuntime(runtime => {
			this.attachRuntime(runtime);
		});
	}

	get previewWebviews(): PreviewWebview[] {
		return Array.from(this._items.values());
	}

	get activePreviewWebviewId(): string {
		return this._selectedItemId;
	}

	get activePreviewWebview(): PreviewWebview | undefined {
		if (!this._selectedItemId) {
			return undefined;
		}
		return this._items.get(this._selectedItemId);
	}

	/**
	 * Set the active preview webview.
	 *
	 * @param id The id of the preview to set as active, or a falsey value to
	 *   set no preview as active.
	 */
	set activePreviewWebviewId(id: string) {
		// Don't do anything if the requested preview is already active
		if (this._selectedItemId === id) {
			return;
		}

		// If we were given an ID, make sure it's valid
		if (id && !this._items.has(id)) {
			throw new Error(`Invalid preview id: ${id}`);
		}

		// Notify previous preview that it is no longer active
		if (this._items.has(this._selectedItemId)) {
			this._items.get(this._selectedItemId)!.active = false;
		}

		// Swap to new preview
		this._selectedItemId = id;
		this._onDidChangeActivePreviewWebview.fire(id);

		// Notify new preview that it is active
		if (id) {
			this._items.get(id)!.active = true;
		}
	}

	onDidChangeActivePreviewWebview: Event<string>;

	onDidCreatePreviewWebview: Event<PreviewWebview>;

	openPreview(previewId: string,
		webviewInitInfo: WebviewInitInfo,
		viewType: string,
		title: string,
		preserveFocus?: boolean | undefined): PreviewWebview {

		const webview = this._webviewService.createWebviewOverlay(webviewInitInfo);
		const preview = new PreviewWebview(viewType, previewId, title, webview);

		this._items.set(previewId, preview);

		this._onDidCreatePreviewWebviewEmitter.fire(preview);
		this.activePreviewWebviewId = preview.previewId;

		// Ensure we clean up the preview webview when it is closed.
		this._register(preview.webview.onDidDispose(() => {

			const wasActive = this.activePreviewWebviewId === preview.previewId;

			this._items.delete(preview.previewId);

			// Select a new preview webview if the closed one was active
			if (wasActive) {
				if (this._items.size > 0) {
					// If we have other items to show, select one
					this.activePreviewWebviewId =
						this._items.values().next().value.providedId;
				} else {
					// Nothing else to show; set the the active preview to undefined
					this.activePreviewWebviewId = '';
				}
			}
		}));

		// Open the preview pane if it is not already open so the
		// user can see the preview. Send focus to the pane if we weren't
		// asked to preserve focus.
		this._viewsService.openView(POSITRON_PREVIEW_VIEW_ID, !!preserveFocus);

		return preview;
	}

	attachRuntime(runtime: ILanguageRuntime) {
		runtime.onDidReceiveRuntimeMessageOutput(e => {
			for (const mimeType of Object.keys(e.data)) {

				if (mimeType === 'text/html') {
					if (e.data[mimeType].indexOf('<script') !== -1) {
						this.createRawHtmlOutput(e.id, runtime, e.data[mimeType]);
					}
				}
				// Ignore plaintext output; handled by the Console
				if (mimeType.startsWith('text/')) {
					continue;
				}

				// Ignore image output; handled by the Plots pane
				if (mimeType.startsWith('image/')) {
					continue;
				}

				// Check to see if we have a renderer for this MIME type
				const renderer = this._notebookService.getPreferredRenderer(mimeType);
				if (renderer) {
					this.createNotebookRenderOutput(e.id, renderer, mimeType, e.data[mimeType]);
					break;
				}
			}
		});
	}

	async createRawHtmlOutput(id: string, runtime: ILanguageRuntime, html: string) {
		const jupyterExtension = await this._extensionService.getExtension('ms-toolsai.jupyter');
		if (!jupyterExtension) {
			return;
		}
		const webview: WebviewInitInfo = {
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
		const preview = this.openPreview(id, webview, 'htmlRenderer', runtime.metadata.runtimeName);
		const jQueryPath = asWebviewUri(
			jupyterExtension.extensionLocation.with({
				path: jupyterExtension.extensionLocation.path +
					'/out/node_modules/jquery/dist/jquery.min.js'
			}));
		preview.webview.setHtml(`<script src='${jQueryPath}'></script>${html}`);
	}

	createNotebookRenderOutput(id: string, renderer: INotebookRendererInfo, mimeType: string, data: any) {
		const rendererPath = asWebviewUri(renderer.entrypoint.path);
		const webview: WebviewInitInfo = {
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

		const preview = this.openPreview(id, webview, 'notebookRenderer', renderer.displayName);
		preview.webview.setHtml(`
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
		window.onload = function() {
			let container = document.getElementById('container');
			console.log('** container: ' + container);
			renderer.renderOutputItem(data, container, signal);
			console.log('** rendered.');
		};
</script>
</body>`);
	}
}
