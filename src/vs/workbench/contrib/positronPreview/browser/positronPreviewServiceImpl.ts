/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IPositronPreviewService } from 'vs/workbench/contrib/positronPreview/browser/positronPreview';
import { Event, Emitter } from 'vs/base/common/event';
import { IOverlayWebview, IWebviewService, WebviewInitInfo } from 'vs/workbench/contrib/webview/browser/webview';
import { PreviewWebview } from 'vs/workbench/contrib/positronPreview/browser/previewWebview';
import { IViewsService } from 'vs/workbench/common/views';
import { POSITRON_PREVIEW_VIEW_ID } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewSevice';
import { ILanguageRuntime, ILanguageRuntimeService, RuntimeOutputKind } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IPositronNotebookOutputWebviewService } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService';

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
		@IPositronNotebookOutputWebviewService private readonly _notebookOutputWebviewService: IPositronNotebookOutputWebviewService,
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

		return this.openPreviewWebview(previewId,
			this._webviewService.createWebviewOverlay(webviewInitInfo),
			viewType,
			title,
			preserveFocus);
	}

	openPreviewWebview(
		previewId: string,
		webview: IOverlayWebview,
		viewType: string,
		title: string,
		preserveFocus?: boolean | undefined
	) {

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

	/**
	 * Attaches to a runtime and listens for messages that should be rendered.
	 *
	 * @param runtime The runtime to attach to
	 */
	attachRuntime(runtime: ILanguageRuntime) {
		this._register(runtime.onDidReceiveRuntimeMessageOutput(async (e) => {
			if (e.kind === RuntimeOutputKind.ViewerWidget) {
				const webview = await
					this._notebookOutputWebviewService.createNotebookOutputWebview(runtime, e);
				if (webview) {
					this.openPreviewWebview(e.id,
						webview.webview, 'notebookRenderer', runtime.metadata.runtimeName);
				}
			}
		}));
	}
}
