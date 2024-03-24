/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IPositronPreviewService } from 'vs/workbench/contrib/positronPreview/browser/positronPreview';
import { Event, Emitter } from 'vs/base/common/event';
import { IWebviewService, WebviewExtensionDescription, WebviewInitInfo } from 'vs/workbench/contrib/webview/browser/webview';
import { PreviewWebview } from 'vs/workbench/contrib/positronPreview/browser/previewWebview';
import { IViewsService } from 'vs/workbench/services/views/common/viewsService';
import { POSITRON_PREVIEW_URL_VIEW_TYPE, POSITRON_PREVIEW_VIEW_ID } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewSevice';
import { RuntimeOutputKind } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { ILanguageRuntimeSession, IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { IPositronNotebookOutputWebviewService } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService';
import { URI } from 'vs/base/common/uri';
import { PreviewUrl } from 'vs/workbench/contrib/positronPreview/browser/previewUrl';
import { ShowUrlEvent, UiFrontendEvent } from 'vs/workbench/services/languageRuntime/common/positronUiComm';
import { ILogService } from 'vs/platform/log/common/log';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { isLocalhost } from 'vs/workbench/contrib/positronHelp/browser/utils';

/**
 * Positron preview service; keeps track of the set of active previews and
 * notifies listeners when the active preview changes.
 */
export class PositronPreviewService extends Disposable implements IPositronPreviewService {

	declare readonly _serviceBrand: undefined;

	private _items: Map<string, PreviewWebview> = new Map();

	private static _previewIdCounter = 0;

	private _selectedItemId = '';

	private _onDidCreatePreviewWebviewEmitter = new Emitter<PreviewWebview>();

	private _onDidChangeActivePreviewWebview = new Emitter<string>;

	constructor(
		@IWebviewService private readonly _webviewService: IWebviewService,
		@IViewsService private readonly _viewsService: IViewsService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@ILogService private readonly _logService: ILogService,
		@IOpenerService private readonly _openerService: IOpenerService,
		@IPositronNotebookOutputWebviewService private readonly _notebookOutputWebviewService: IPositronNotebookOutputWebviewService,
	) {
		super();
		this.onDidCreatePreviewWebview = this._onDidCreatePreviewWebviewEmitter.event;
		this.onDidChangeActivePreviewWebview = this._onDidChangeActivePreviewWebview.event;
		this._runtimeSessionService.activeSessions.forEach(runtime => {
			this.attachRuntime(runtime);
		});
		this._runtimeSessionService.onWillStartSession(e => {
			this.attachRuntime(e.session);
		});
		this._runtimeSessionService.onDidReceiveRuntimeEvent(e => {
			if (e.event.name === UiFrontendEvent.ShowUrl) {
				// We need to figure out which extension is responsible for this
				// URL. First, look up the session.
				const session = this._runtimeSessionService.getSession(e.session_id);

				if (!session) {
					// This should never happen since we just received an event from
					// this session.
					this._logService.error(`No session ${e.session_id} found for ShowUrl event; ` +
						`ignoring URL ${e.event.data.url}`);
					return;
				}

				this.handleShowUrlEvent(session, e.event.data as ShowUrlEvent);
			}
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

	clearAllPreviews(): void {
		// Set the active preview to nothing; this has the side effect of
		// clearing the preview pane.
		this.activePreviewWebviewId = '';

		// Dispose all active webviews
		for (const item of this._items.values()) {
			item.webview.dispose();
		}

		// Clear the map
		this._items.clear();
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

		this.openPreviewWebview(preview, preserveFocus);

		return preview;
	}

	openUri(previewId: string, origin: string, extension: WebviewExtensionDescription, uri: URI): PreviewWebview {
		const webviewInitInfo: WebviewInitInfo = {
			origin,
			providedViewType: 'positron.previewUrl',
			title: '',
			options: {
				enableFindWidget: true,
				retainContextWhenHidden: true,
			},
			contentOptions: {
				allowScripts: true,
				allowForms: true,
				enableCommandUris: false,
				localResourceRoots: [uri]
			},
			extension
		};

		const webview = this._webviewService.createWebviewOverlay(webviewInitInfo);
		const preview = new PreviewUrl(previewId, webview, uri);

		// Remove any other preview URLs from the item list; they can be expensive
		// to keep around.
		this._items.forEach((value, key) => {
			if (value instanceof PreviewUrl) {
				value.dispose();
				this._items.delete(key);
			}
		});
		this._items.set(previewId, preview);

		// Open the preview
		this.openPreviewWebview(preview);

		return preview;
	}

	openPreviewWebview(
		preview: PreviewWebview,
		preserveFocus?: boolean | undefined
	) {
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
	 * Attaches to a runtime session and listens for messages that should be rendered.
	 *
	 * @param session The runtime session to attach to
	 */
	private attachRuntime(session: ILanguageRuntimeSession) {
		this._register(session.onDidReceiveRuntimeMessageOutput(async (e) => {
			if (e.kind === RuntimeOutputKind.ViewerWidget) {
				const webview = await
					this._notebookOutputWebviewService.createNotebookOutputWebview(session, e);
				if (webview) {
					const preview = new PreviewWebview(
						'notebookRenderer',
						e.id, session.metadata.sessionName,
						webview.webview);
					this._items.set(e.id, preview);
					this.openPreviewWebview(preview, false);
				}
			}
		}));
	}

	/**
	 * Handles a ShowUrl event from a runtime session.
	 *
	 * @param session The runtime session that sent the event
	 * @param event The event to handle
	 */
	private handleShowUrlEvent(session: ILanguageRuntimeSession, event: ShowUrlEvent) {
		// Attempt to parse the URL. If it's not a valid URL, log an error
		// and ignore it.
		//
		// Currently showUrl is implemented as an event (rather than an RPC) so there's no mechanism for
		// delivering this error code back to the caller.
		let uri: URI;
		try {
			uri = URI.parse(event.url);
		} catch (e) {
			this._logService.error(`Invalid URL ${event.url} from session ${session.sessionId}: ` +
				`${e}`);
			return;
		}

		// Check to see whether we can handle this URL in the viewer; if we
		// can't, hand it over to the opener service.
		if (!this.canOpenInViewer(uri)) {
			this._openerService.open(uri, {
				openExternal: true,
			});
			return;
		}

		// Look up the extension. For accounting purposes, we need to
		// know which extension is responsible for this URL.
		const extension = session.runtimeMetadata.extensionId;
		const webviewExtension: WebviewExtensionDescription = {
			id: extension
		};

		// Create a unique ID for this preview.
		const previewId = `previewUrl.${PositronPreviewService._previewIdCounter++}`;

		// Open the requested URI.
		this.openUri(previewId, POSITRON_PREVIEW_URL_VIEW_TYPE, webviewExtension, uri);
	}

	/**
	 * Given a URI, attempts to determine whether it can be opened in the viewer.
	 *
	 * @param uri The URI to test
	 * @returns Whether it is appropriate to open the URI in the viewer
	 */
	private canOpenInViewer(uri: URI): boolean {
		// If the URI doesn't have an http or https scheme, we can't handle it
		// in the viewer.
		if (uri.scheme !== 'http' && uri.scheme !== 'https') {
			return false;
		}

		// Extract the hostname; if it's not localhost, we can't handle it in
		// the viewer.
		const hostname = new URL(uri.toString(true)).hostname;
		if (!isLocalhost(hostname)) {
			return false;
		}

		// It's a localhost http or https URL; we can handle it in the viewer.
		return true;
	}
}
