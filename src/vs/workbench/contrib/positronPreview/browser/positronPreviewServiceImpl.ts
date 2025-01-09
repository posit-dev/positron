/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IPositronPreviewService } from './positronPreview.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { IOverlayWebview, IWebviewService, WebviewExtensionDescription, WebviewInitInfo } from '../../webview/browser/webview.js';
import { PreviewWebview } from './previewWebview.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { POSITRON_PREVIEW_HTML_VIEW_TYPE, POSITRON_PREVIEW_URL_VIEW_TYPE, POSITRON_PREVIEW_VIEW_ID } from './positronPreviewSevice.js';
import { ILanguageRuntimeMessageOutput, LanguageRuntimeSessionMode, RuntimeOutputKind } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronNotebookOutputWebviewService } from '../../positronOutputWebview/browser/notebookOutputWebviewService.js';
import { URI } from '../../../../base/common/uri.js';
import { PreviewUrl } from './previewUrl.js';
import { ShowHtmlFileEvent, ShowUrlEvent, UiFrontendEvent } from '../../../services/languageRuntime/common/positronUiComm.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { isLocalhost } from '../../positronHelp/browser/utils.js';
import { IShowHtmlUriEvent } from '../../../services/languageRuntime/common/languageRuntimeUiClient.js';
import { PreviewOverlayWebview } from './previewOverlayWebview.js';
import { PreviewHtml } from './previewHtml.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { basename } from '../../../../base/common/path.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { Schemas } from '../../../../base/common/network.js';

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

	private _editors: Map<string, { uri: URI; title?: string }> = new Map();

	constructor(
		@ICommandService private readonly _commandService: ICommandService,
		@IWebviewService private readonly _webviewService: IWebviewService,
		@IViewsService private readonly _viewsService: IViewsService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@ILogService private readonly _logService: ILogService,
		@IOpenerService private readonly _openerService: IOpenerService,
		@IPositronNotebookOutputWebviewService private readonly _notebookOutputWebviewService: IPositronNotebookOutputWebviewService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@IEditorService private readonly _editorService: IEditorService
	) {
		super();
		this.onDidCreatePreviewWebview = this._onDidCreatePreviewWebviewEmitter.event;
		this.onDidChangeActivePreviewWebview = this._onDidChangeActivePreviewWebview.event;
		this._runtimeSessionService.activeSessions.forEach(runtime => {
			this.attachRuntime(runtime);
		});
		this._register(this._runtimeSessionService.onWillStartSession(e => {
			this.attachRuntime(e.session);
		}));
		this._register(this._runtimeSessionService.onDidReceiveRuntimeEvent(e => {
			if (e.event.name === UiFrontendEvent.ShowUrl ||
				e.event.name === UiFrontendEvent.ShowHtmlFile
			) {
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

				if (e.event.name === UiFrontendEvent.ShowHtmlFile) {
					const data = e.event.data as IShowHtmlUriEvent;
					if (!data.event.is_plot) {
						this.handleShowHtmlFileEvent(session, data);
					}
				} else {
					this.handleShowUrlEvent(session, e.event.data as ShowUrlEvent);
				}
			}
		}));

		// When the extension host is about to stop, dispose all previews that
		// use HTML proxies, since these proxies live in the extension host.
		this._register(this._extensionService.onWillStop((e) => {
			for (const preview of this._items.values()) {
				if (preview instanceof PreviewHtml) {
					preview.webview.dispose();
					this._items.delete(preview.previewId);
				}
			}
		}));
	}

	createHtmlWebview(sessionId: string,
		extension: WebviewExtensionDescription | undefined,
		event: IShowHtmlUriEvent): PreviewHtml {
		const preview = this.createPreviewHtml(sessionId, `previewHtml.${PositronPreviewService._previewIdCounter++}`, extension, event.uri, event.event);
		return preview as PreviewHtml;
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
		const overlay = this.createOverlayWebview(webview);
		const preview = new PreviewWebview(viewType, previewId, title, overlay);
		this._items.set(previewId, preview);

		this.openPreviewWebview(preview, preserveFocus);

		return preview;
	}

	/**
	 * Create an overlay webview to host preview content.
	 *
	 * @param viewType The view type of the preview
	 * @param uri The URI to show in the webview
	 * @param extension Optional information about the extension that is
	 *  creating the preview
	 * @returns
	 */
	private createWebview(
		viewType: string,
		uri: URI,
		extension: WebviewExtensionDescription | undefined): PreviewOverlayWebview {
		const webviewInitInfo: WebviewInitInfo = {
			origin: DOM.getActiveWindow().origin,
			providedViewType: viewType,
			title: 'Positron Preview',
			options: {
				enableFindWidget: true,
				retainContextWhenHidden: true,
				externalUri: this.canPreviewExternalUri()
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
		const overlay = this.createOverlayWebview(webview);
		return overlay;
	}

	/**
	 * Create a URL preview.
	 */
	private createPreviewUrl(
		previewId: string,
		extension: WebviewExtensionDescription | undefined, uri: URI): PreviewUrl {
		const overlay = this.createWebview(POSITRON_PREVIEW_URL_VIEW_TYPE, uri, extension);
		return new PreviewUrl(previewId, overlay, uri);
	}

	/**
	 * Create a preview for an HTML file (being proxied at a URI).
	 */
	private createPreviewHtml(
		sessionId: string,
		previewId: string,
		extension: WebviewExtensionDescription | undefined,
		uri: URI,
		event: ShowHtmlFileEvent): PreviewHtml {
		const overlay = this.createWebview(POSITRON_PREVIEW_HTML_VIEW_TYPE, uri, extension);
		return new PreviewHtml(sessionId, previewId, overlay, uri, event);
	}

	/**
	 * Open a URI in the preview pane.
	 */
	public openUri(
		previewId: string,
		extension: WebviewExtensionDescription,
		uri: URI): PreviewWebview {
		const preview = this.createPreviewUrl(previewId, extension, uri);
		this.makeActivePreview(preview);
		return preview;
	}

	/**
	 * Makes a preview the active preview, removing other previews and opening
	 * the new preview.
	 *
	 * @param preview The preview to make active
	 */
	private makeActivePreview(preview: PreviewWebview) {
		// Remove any other previews from the item list; they can be expensive
		// to keep around.
		this._items.forEach((value) => {
			value.dispose();
		});
		this._items.clear();
		this._items.set(preview.previewId, preview);

		// Open the preview
		this.openPreviewWebview(preview);
	}

	/**
	 * Opens an HTML file in the preview pane.
	 *
	 * @param previewId The unique ID or handle of the preview.
	 * @param extension The extension that is opening the URL.
	 * @param htmlpath The path to the HTML file.
	 */
	public async openHtml(
		previewId: string,
		extension: WebviewExtensionDescription,
		htmlpath: string): Promise<PreviewHtml> {

		// Use the Positron Proxy extension to create a URL for the HTML file.
		const url = await this._commandService.executeCommand<string>(
			'positronProxy.startHtmlProxyServer',
			htmlpath
		);

		if (!url) {
			throw new Error(`Failed to start HTML file proxy server for ${htmlpath}`);
		}

		// Parse the URL and resolve it if necessary. The resolution step is
		// necessary when URI is hosted on a remote server.
		let uri = URI.parse(url);
		try {
			const resolvedUri = await this._openerService.resolveExternalUri(uri);
			uri = resolvedUri.resolved;
		} catch {
			// Noop; use the original URI
		}

		// Create a ShowFileEvent for the HTML file.
		const evt: ShowHtmlFileEvent = {
			height: 0,
			title: basename(htmlpath),
			is_plot: false,
			path: htmlpath,
		};

		// Create the preview
		const preview = this.createPreviewHtml('', previewId, extension, uri, evt);

		// Make the preview active and return it
		this.makeActivePreview(preview);
		return preview;
	}

	/**
	 * Create an overlay webview.
	 */
	protected createOverlayWebview(
		webview: IOverlayWebview): PreviewOverlayWebview {
		return new PreviewOverlayWebview(webview);
	}

	/**
	 * Indicates whether external URIs can be natively previewed in the viewer.
	 * Defaults to false; overridden to true in the Electron implementation.
	 *
	 * @returns True if external URIs can be previewed in the viewer; false otherwise
	 */
	protected canPreviewExternalUri(): boolean {
		return false;
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
				const items = this._items.values().next();
				if (items.value) {
					// If we have other items to show, select one
					this.activePreviewWebviewId = items.value.previewId;
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
		if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Notebook) {
			// Don't attach notebook sessions; they display previews inline.
			return;
		}
		const handleDidReceiveRuntimeMessageOutput = async (e: ILanguageRuntimeMessageOutput) => {
			if (e.kind === RuntimeOutputKind.ViewerWidget) {
				const webview = await
					this._notebookOutputWebviewService.createNotebookOutputWebview({
						id: e.id,
						runtime: session,
						output: e
					});
				if (webview) {
					const overlay = this.createOverlayWebview(webview.webview);
					const preview = new PreviewWebview(
						'notebookRenderer',
						e.id, session.metadata.sessionName,
						overlay);
					this._items.set(e.id, preview);
					this.openPreviewWebview(preview, false);
				}
			}
		};
		this._register(session.onDidReceiveRuntimeMessageOutput(handleDidReceiveRuntimeMessageOutput));
		this._register(session.onDidReceiveRuntimeMessageResult(handleDidReceiveRuntimeMessageOutput));
	}

	/**
	 * Handles a ShowHtmlFile event.
	 */
	private handleShowHtmlFileEvent(session: ILanguageRuntimeSession, event: IShowHtmlUriEvent) {
		// Create a unique ID for this preview.
		const previewId = `previewHtml.${PositronPreviewService._previewIdCounter++}`;

		const extension = session.runtimeMetadata.extensionId;
		const webviewExtension: WebviewExtensionDescription = {
			id: extension
		};

		// Create the preview
		const preview = this.createPreviewHtml(session.sessionId, previewId, webviewExtension, event.uri, event.event);

		this.makeActivePreview(preview);
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
		this.openUri(previewId, webviewExtension, uri);
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

	public async openEditor(uri: URI, title?: string): Promise<void> {
		// Create and store webview overlay for editor
		// We use the URI to attempt to bring focus to an editor if it already exists
		const previewId = `editorPreview.${uri.toString()}`;
		this._editors.set(previewId, {
			uri: uri,
			title: title || uri.authority || uri.path
		});

		await this._editorService.openEditor({
			resource: URI.from({
				scheme: Schemas.positronPreviewEditor,
				path: previewId
			}),
		});
	}

	public editorWebview(editorId: string): PreviewWebview | undefined {
		const uri = this._editors.get(editorId)?.uri;
		if (!uri) { return undefined; }
		return this.createPreviewUrl(editorId, undefined, uri);
	}

	public editorTitle(previewId: string): string | undefined {
		return this._editors.get(previewId)?.title;
	}

	public disposeEditor(previewId: string): void {
		// Remove the preview
		this._editors.delete(previewId);
	}
}
