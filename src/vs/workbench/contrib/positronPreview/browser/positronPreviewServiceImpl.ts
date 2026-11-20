/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { IPositronPreviewService, PreviewOpenTarget } from './positronPreview.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { IOverlayWebview, IWebviewService, WebviewExtensionDescription, WebviewInitInfo } from '../../webview/browser/webview.js';
import { PreviewWebview } from './previewWebview.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { POSITRON_PREVIEW_HTML_VIEW_TYPE, POSITRON_PREVIEW_NOTEBOOK_RENDERER_VIEW_TYPE, POSITRON_PREVIEW_URL_VIEW_TYPE, POSITRON_PREVIEW_VIEW_ID, POSITRON_VIEWER_USE_INTEGRATED_BROWSER } from './positronPreviewSevice.js';
import { IPreviewSurface } from './previewSurface.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { BrowserViewUri } from '../../../../platform/browserView/common/browserViewUri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ILanguageRuntimeMessageOutput, ILanguageRuntimeMessageUpdateOutput, LanguageRuntimeSessionMode, RuntimeOutputKind } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronNotebookOutputWebviewService } from '../../positronOutputWebview/browser/notebookOutputWebviewService.js';
import { URI } from '../../../../base/common/uri.js';
import { PreviewUrl } from './previewUrl.js';
import { ShowHtmlFileDestination, ShowHtmlFileEvent, ShowUrlEvent, UiFrontendEvent } from '../../../services/languageRuntime/common/positronUiComm.js';
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
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';

/** The key used to store the Viewer's default "Open in..." target. */
const DefaultOpenTargetStorageKey = 'positronPreview.defaultOpenTarget';

/** The runtime output a widget preview shows, to show it again. */
interface IWidgetOutput {
	readonly session: ILanguageRuntimeSession;
	readonly message: ILanguageRuntimeMessageOutput | ILanguageRuntimeMessageUpdateOutput;
}

/**
 * An entry in the Viewer's history. Only the active entry's preview is live;
 * the others are disposed, and are opened again from what they showed.
 */
interface IHistoryEntry {
	preview: PreviewWebview;
	output?: IWidgetOutput;
}

/**
 * Positron preview service; keeps track of the preview the Viewer shows and
 * the history of previews before and after it.
 */
export class PositronPreviewService extends Disposable implements IPositronPreviewService {

	declare readonly _serviceBrand: undefined;

	// Disposed before the active preview, so disposing the service doesn't
	// read as the preview going away on its own.
	private readonly _activeListeners = this._register(new MutableDisposable<DisposableStore>());

	private readonly _active = this._register(new MutableDisposable<PreviewWebview>());

	private _history: IHistoryEntry[] = [];

	/** The index of the active preview's entry in the history. */
	private _index = -1;

	/** Counts navigations, so a slow one that's been overtaken is dropped. */
	private _navigation = 0;

	private static _previewIdCounter = 0;

	private _onDidCreatePreviewWebviewEmitter = new Emitter<PreviewWebview>();

	private _onDidChangeActivePreviewWebview = new Emitter<string>;

	private readonly _onDidChangeNavigationState = this._register(new Emitter<void>());
	readonly onDidChangeNavigationState = this._onDidChangeNavigationState.event;

	private _editors: Map<string, { uri: URI; title?: string }> = new Map();

	constructor(
		@ICommandService private readonly _commandService: ICommandService,
		@IWebviewService private readonly _webviewService: IWebviewService,
		@IViewsService private readonly _viewsService: IViewsService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@ILogService private readonly _logService: ILogService,
		@IOpenerService private readonly _openerService: IOpenerService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IPositronNotebookOutputWebviewService private readonly _notebookOutputWebviewService: IPositronNotebookOutputWebviewService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@IEditorService private readonly _editorService: IEditorService,
		@IConfigurationService protected readonly _configurationService: IConfigurationService,
		@IStorageService private readonly _storageService: IStorageService,
		@IInstantiationService protected readonly _instantiationService: IInstantiationService,
	) {
		super();
		this._register(this._onDidCreatePreviewWebviewEmitter);
		this._register(this._onDidChangeActivePreviewWebview);
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
					const eventData = e.event.data as ShowUrlEvent;
					this._logService.error(`No session ${e.session_id} found for ShowUrl event; ` +
						`ignoring URL ${eventData?.url ?? 'unknown'}`);
					return;
				}

				if (e.event.name === UiFrontendEvent.ShowHtmlFile) {
					const data = e.event.data as IShowHtmlUriEvent;
					if (data.event.destination === ShowHtmlFileDestination.Viewer) {
						this.handleShowHtmlFileEvent(session, data);
					} else if (data.event.destination === ShowHtmlFileDestination.Editor) {
						this.openEditor(data.uri, data.event.title).catch(err => {
							this._notificationService.error(localize('positronPreviewFailedToOpenHtmlFileInEditor', "Failed to open {1} in editor: {0}", data.uri.toString(), err.message));
						});
					}
				} else {
					this.handleShowUrlEvent(session, e.event.data as ShowUrlEvent);
				}
			}
		}));

		// Show the active preview on the backend the setting now chooses.
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(POSITRON_VIEWER_USE_INTEGRATED_BROWSER)) {
				this.recreateActivePreview();
			}
		}));

		// When the extension host is about to stop, drop the previews that
		// use HTML proxies, since these proxies live in the extension host.
		this._register(this._extensionService.onWillStop(() => {
			const active = this._history[this._index];
			this._history = this._history.filter(entry => entry === active || !(entry.preview instanceof PreviewHtml));
			this._index = active ? this._history.indexOf(active) : -1;
			this._onDidChangeNavigationState.fire();
			if (this.activePreviewWebview instanceof PreviewHtml) {
				this.activePreviewWebview.dispose();
			}
		}));
	}

	createHtmlWebview(sessionId: string,
		extension: WebviewExtensionDescription | undefined,
		event: IShowHtmlUriEvent): PreviewHtml<PreviewOverlayWebview> {
		const previewId = `previewHtml.${PositronPreviewService._previewIdCounter++}`;
		const overlay = this.createWebview(POSITRON_PREVIEW_HTML_VIEW_TYPE, event.uri, extension);
		return new PreviewHtml(sessionId, previewId, overlay, event.uri, event.event);
	}

	get activePreviewWebviewId(): string {
		return this._active.value?.previewId ?? '';
	}

	get activePreviewWebview(): PreviewWebview | undefined {
		return this._active.value;
	}

	clearAllPreviews(): void {
		this._navigation++;
		this._history = [];
		this._index = -1;
		this.setActive(undefined);
	}

	get canGoBack(): boolean {
		return this.pageCanGo('back') || this._index > 0;
	}

	get canGoForward(): boolean {
		return this.pageCanGo('forward') || this._index < this._history.length - 1;
	}

	goBack(): void {
		if (this.pageCanGo('back')) {
			this._active.value!.surface.goBack();
		} else if (this._index > 0) {
			this.navigateTo(this._index - 1);
		}
	}

	goForward(): void {
		if (this.pageCanGo('forward')) {
			this._active.value!.surface.goForward();
		} else if (this._index < this._history.length - 1) {
			this.navigateTo(this._index + 1);
		}
	}

	/**
	 * Whether back or forward moves within the active preview's page. When
	 * the surface can't tell (a webview), it does for a URL, and never
	 * moves to another preview.
	 */
	private pageCanGo(direction: 'back' | 'forward'): boolean {
		const preview = this._active.value;
		if (!preview) {
			return false;
		}
		const canGo = direction === 'back' ? preview.surface.canGoBack : preview.surface.canGoForward;
		return canGo ?? preview instanceof PreviewUrl;
	}

	/** Whether an entry's preview can be opened again once it's been disposed. */
	private canReopen(entry: IHistoryEntry): boolean {
		return !!entry.output || entry.preview instanceof PreviewUrl || entry.preview instanceof PreviewHtml;
	}

	/**
	 * Opens a preview of what a disposed URL or HTML preview showed, on the
	 * backend the setting chooses.
	 */
	private reopen(preview: PreviewWebview): PreviewWebview | undefined {
		if (preview instanceof PreviewUrl) {
			return this.createPreviewUrl(`previewUrl.${PositronPreviewService._previewIdCounter++}`, undefined, preview.currentUri, preview.source);
		} else if (preview instanceof PreviewHtml) {
			return this.createPreviewHtml(preview.sessionId, `previewHtml.${PositronPreviewService._previewIdCounter++}`, undefined, preview.uri, preview.html);
		}
		return undefined;
	}

	/** Opens the history entry at `target` again and makes it active. */
	private async navigateTo(target: number): Promise<void> {
		const navigation = ++this._navigation;
		const entry = this._history[target];
		const preview = entry.output ? await this.createWidget(entry.preview.previewId, entry.output) : this.reopen(entry.preview);
		// The history can change while the widget is created.
		target = this._history.indexOf(entry);
		if (navigation !== this._navigation || target < 0) {
			preview?.dispose();
			return;
		}
		if (!preview) {
			this._logService.warn(`[Viewer] Could not show ${entry.preview.previewId} again; removing it from history`);
			this._history.splice(target, 1);
			if (target <= this._index) {
				this._index--;
			}
			this._onDidChangeNavigationState.fire();
			return;
		}

		// A preview that can't be opened again leaves the history once left.
		const current = this._history[this._index];
		if (current?.preview === this._active.value && !this.canReopen(current)) {
			this._history.splice(this._index, 1);
			if (target > this._index) {
				target--;
			}
		}
		entry.preview = preview;
		this._index = target;
		this.setActive(preview, true);
	}

	/**
	 * Shows new content: adds it to the history after the active entry, in
	 * place of any entries that were after it.
	 */
	private makeActivePreview(preview: PreviewWebview, preserveFocus?: boolean, output?: IWidgetOutput) {
		this._navigation++;
		this._history.splice(this._index + 1);
		const current = this._history[this._index];
		if (current && !this.canReopen(current)) {
			this._history.pop();
		}
		this._history.push({ preview, output });
		this._index = this._history.length - 1;
		this._onDidCreatePreviewWebviewEmitter.fire(preview);
		this.setActive(preview, preserveFocus);
	}

	/**
	 * Makes a preview the one the Viewer shows, disposing the one it showed,
	 * and opens the Viewer to show it.
	 */
	private setActive(preview: PreviewWebview | undefined, preserveFocus?: boolean): void {
		const previous = this._active.clearAndLeak();
		this._activeListeners.clear();
		if (preview) {
			this._active.value = preview;
			const listeners = this._activeListeners.value = new DisposableStore();
			listeners.add(preview.surface.onDidNavigate(() => this._onDidChangeNavigationState.fire()));
			listeners.add(preview.surface.onDidDispose(() => this.onActiveDisposed(preview)));
			preview.active = true;
		}
		this._onDidChangeActivePreviewWebview.fire(this.activePreviewWebviewId);
		this._onDidChangeNavigationState.fire();
		if (previous) {
			previous.active = false;
			previous.dispose();
		}
		if (preview) {
			// Send focus to the Viewer unless asked to preserve it.
			this._viewsService.openView(POSITRON_PREVIEW_VIEW_ID, !!preserveFocus);
		}
	}

	/**
	 * Handles the active preview going away on its own: drops it from the
	 * history and shows the entry before it, if any.
	 */
	private onActiveDisposed(preview: PreviewWebview): void {
		const index = this._history.findIndex(entry => entry.preview === preview);
		if (index >= 0) {
			this._history.splice(index, 1);
			if (index <= this._index) {
				this._index--;
			}
		}
		this.setActive(undefined);
		if (this._index >= 0) {
			this.navigateTo(this._index);
		}
	}

	onDidChangeActivePreviewWebview: Event<string>;

	onDidCreatePreviewWebview: Event<PreviewWebview>;

	openPreview(previewId: string,
		webviewInitInfo: WebviewInitInfo,
		viewType: string,
		title: string,
		preserveFocus?: boolean | undefined): PreviewWebview<PreviewOverlayWebview> {
		const webview = this._webviewService.createWebviewOverlay(webviewInitInfo);
		const preview = this.createPreviewWebview(previewId, webview, viewType, title);
		this.makeActivePreview(preview, preserveFocus);
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
				externalUri: this.canPreviewExternalUri(),
				customClasses: 'positron-preview-webview',
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
	 * Create a surface to show content that has an address: a webview, or on
	 * Desktop, the integrated browser.
	 */
	protected createAddressableSurface(
		viewType: string,
		uri: URI,
		extension: WebviewExtensionDescription | undefined): IPreviewSurface {
		return this.createWebview(viewType, uri, extension);
	}

	/**
	 * Create a URL preview.
	 */
	private createPreviewUrl(
		previewId: string,
		extension: WebviewExtensionDescription | undefined,
		uri: URI,
		source?: { type: string; id: string }): PreviewUrl {
		const surface = this.createAddressableSurface(POSITRON_PREVIEW_URL_VIEW_TYPE, uri, extension);
		return new PreviewUrl(previewId, surface, uri, source);
	}

	/**
	 * Create a preview for an HTML file (being proxied at a URI).
	 */
	private createPreviewHtml(
		sessionId: string,
		previewId: string,
		extension: WebviewExtensionDescription | undefined,
		uri: URI,
		event?: ShowHtmlFileEvent): PreviewHtml {
		const surface = this.createAddressableSurface(POSITRON_PREVIEW_HTML_VIEW_TYPE, uri, extension);
		return new PreviewHtml(sessionId, previewId, surface, uri, event);
	}

	/**
	 * Shows the active preview again on a new surface, if it has an address.
	 * Other previews keep their surface until they're replaced, as does a
	 * stoppable one, whose stop button is linked to its owner.
	 */
	private recreateActivePreview(): void {
		const entry = this._history[this._index];
		if (!entry || entry.preview.stoppable) {
			return;
		}
		const preview = this.reopen(entry.preview);
		if (preview) {
			entry.preview = preview;
			this.setActive(preview, true);
		}
	}

	/** Create a preview for a webview. */
	private createPreviewWebview(previewId: string, webview: IOverlayWebview, viewType: string, title: string): PreviewWebview<PreviewOverlayWebview> {
		return new PreviewWebview(viewType, previewId, title, this.createOverlayWebview(webview));
	}

	/**
	 * Open a URI in the preview pane.
	 */
	public openUri(
		previewId: string,
		extension: WebviewExtensionDescription,
		uri: URI,
		source?: { type: string; id: string },
		preserveFocus?: boolean): PreviewWebview {
		const preview = this.createPreviewUrl(previewId, extension, uri, source);
		this.makeActivePreview(preview, preserveFocus);
		return preview;
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
		const uri = await this.proxy('positronProxy.startHtmlProxyServer', htmlpath, htmlpath);

		// Create a ShowFileEvent for the HTML file.
		const evt: ShowHtmlFileEvent = {
			height: 0,
			title: basename(htmlpath),
			destination: ShowHtmlFileDestination.Viewer,
			path: htmlpath,
		};

		// Create the preview
		const preview = this.createPreviewHtml('', previewId, extension, uri, evt);

		// Make the preview active and return it
		this.makeActivePreview(preview);
		return preview;
	}

	/**
	 * Serves content through the Positron Proxy extension, and returns its URL,
	 * resolved so it can be reached when the proxy runs on a remote host.
	 *
	 * @param what Names the content in an error.
	 */
	private async proxy(command: string, content: string, what: string): Promise<URI> {
		const url = await this._commandService.executeCommand<string>(command, content);
		if (!url) {
			throw new Error(`Failed to start the HTML proxy server for ${what}`);
		}
		const uri = URI.parse(url);
		try {
			return (await this._openerService.resolveExternalUri(uri)).resolved;
		} catch {
			return uri;
		}
	}

	/**
	 * Whether content with an address is shown in the integrated browser
	 * rather than a webview. Overridden on Desktop, where the setting chooses.
	 */
	protected useIntegratedBrowser(): boolean {
		return false;
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
				const previewId = this.previewWebviewId(session, e);
				await this.handleRuntimeOutputMessage(previewId, e, session);
			}
		};
		this._register(session.onDidReceiveRuntimeMessageOutput(handleDidReceiveRuntimeMessageOutput));
		this._register(session.onDidReceiveRuntimeMessageResult(handleDidReceiveRuntimeMessageOutput));

		this._register(session.onDidReceiveRuntimeMessageUpdateOutput(async e => {
			if (e.kind === RuntimeOutputKind.ViewerWidget) {
				const previewId = this.previewWebviewId(session, e);
				const entry = this._history.find(entry => entry.preview.previewId === previewId);
				if (entry?.preview === this._active.value) {
					await this.handleRuntimeOutputMessage(previewId, e, session);
				} else if (entry) {
					// An update to a widget that isn't showing is kept to show later.
					entry.output = { session, message: e };
				}
			}
		}));
	}

	/** Create a unique ID for a webview preview. */
	private previewWebviewId(session: ILanguageRuntimeSession, message: ILanguageRuntimeMessageOutput | ILanguageRuntimeMessageUpdateOutput): string {
		return `previewWebview.${session.sessionId}.${message.output_id ?? message.id}`;
	}

	/** Handles a language runtime output message. */
	private async handleRuntimeOutputMessage(previewId: string, message: ILanguageRuntimeMessageOutput | ILanguageRuntimeMessageUpdateOutput, session: ILanguageRuntimeSession) {
		const output = { session, message };
		const preview = await this.createWidget(previewId, output);
		if (!preview) {
			return;
		}

		// Replace the widget in place if it's showing; otherwise show it as
		// new content, dropping its old entry.
		const index = this._history.findIndex(e => e.preview.previewId === previewId);
		if (index >= 0 && index === this._index) {
			this._history[index] = { preview, output };
			this.setActive(preview);
			return;
		}
		if (index >= 0) {
			this._history.splice(index, 1);
			if (index < this._index) {
				this._index--;
			}
		}
		this.makeActivePreview(preview, false, output);
	}

	/** Creates a preview of a widget a runtime sent. */
	private async createWidget(previewId: string, { session, message }: IWidgetOutput): Promise<PreviewWebview | undefined> {
		// viewType ensures renderers registered for the jupyter-notebook type
		// are resolved (e.g. Plotly) and that notebook static preloads (e.g.
		// RequireJS from ms-toolsai.jupyter-renderers) are injected.
		const webview = await this._notebookOutputWebviewService.createNotebookOutputWebview({
			id: message.id,
			runtime: session,
			output: message,
			viewType: 'jupyter-notebook',
		});
		return webview && this.createPreviewWebview(
			previewId,
			webview.webview,
			POSITRON_PREVIEW_NOTEBOOK_RENDERER_VIEW_TYPE,
			session.dynState.sessionName
		);
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

		// If the user prefers to open localhost URLs in the browser, hand
		// it over to the opener service.
		if (!this._configurationService.getValue<boolean>('positron.viewer.openLocalhostUrls')) {
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
		this.openUri(previewId, webviewExtension, uri, event.source);
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
		// Open the integrated browser's own editor, as its Open Browser command does.
		if (this.useIntegratedBrowser()) {
			await this._editorService.openEditor({
				resource: BrowserViewUri.forId(generateUuid()),
				options: { viewState: { url: uri.toString(true) } },
			});
			return;
		}

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

	public getDefaultOpenTarget(): PreviewOpenTarget {
		const target = this._storageService.get(DefaultOpenTargetStorageKey, StorageScope.WORKSPACE);
		switch (target) {
			case PreviewOpenTarget.Browser:
			case PreviewOpenTarget.EditorTab:
				return target;
		}
		return PreviewOpenTarget.Browser;
	}

	public setDefaultOpenTarget(target: PreviewOpenTarget): void {
		this._storageService.store(DefaultOpenTargetStorageKey, target, StorageScope.WORKSPACE, StorageTarget.MACHINE);
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

	/**
	 * Opens an existing overlay webview in the Viewer pane.
	 * Used for displaying notebook output webviews that have already been created.
	 */
	public openWebview(previewId: string, webview: IOverlayWebview, title: string): PreviewWebview<PreviewOverlayWebview> {
		const preview = this.createPreviewWebview(previewId, webview, POSITRON_PREVIEW_NOTEBOOK_RENDERER_VIEW_TYPE, title);
		this.makeActivePreview(preview);
		return preview;
	}

	/**
	 * Opens an HTML string directly in the Viewer pane without writing to a
	 * temp file. The integrated browser shows it as a page the Positron Proxy
	 * serves; a webview renders it inside an iframe using the srcdoc
	 * attribute, which works consistently across Electron and browser
	 * environments.
	 */
	public async openHtmlString(previewId: string, html: string, title: string): Promise<PreviewWebview> {
		if (this.useIntegratedBrowser()) {
			const uri = await this.proxy('positronProxy.startHtmlStringServer', html, title);
			const preview = this.createPreviewHtml('', previewId, undefined, uri, { height: 0, title, destination: ShowHtmlFileDestination.Viewer, path: '' });
			this.makeActivePreview(preview);
			return preview;
		}

		const webviewInitInfo: WebviewInitInfo = {
			origin: DOM.getActiveWindow().origin,
			providedViewType: POSITRON_PREVIEW_HTML_VIEW_TYPE,
			title,
			options: {
				enableFindWidget: true,
				retainContextWhenHidden: true,
				customClasses: 'positron-preview-webview',
			},
			contentOptions: {
				allowScripts: true,
				allowForms: true,
				enableCommandUris: false,
				localResourceRoots: []
			},
			extension: undefined,
		};

		const webview = this._webviewService.createWebviewOverlay(webviewInitInfo);
		const overlay = this.createOverlayWebview(webview);

		// Use srcdoc to render the HTML inline in an iframe. This is the same
		// approach as loadUri (iframe wrapper), but uses srcdoc instead of src
		// to avoid needing a URL/file. The srcdoc attribute sets the content
		// directly, working in both Electron and browser environments.
		const escapedHtml = html
			.replace(/&/g, '&amp;')
			.replace(/"/g, '&quot;');
		overlay.webview.setHtml(`
		<html>
			<head>
				<style>
					html, body {
						padding: 0;
						margin: 0;
						height: 100%;
						min-height: 100%;
					}
					iframe {
						width: 100%;
						height: 100%;
						border: none;
						display: block;
					}
				</style>
			</head>
			<body>
				<iframe id="preview-iframe" title="Preview Content" srcdoc="${escapedHtml}"></iframe>
			</body>
		</html>`);

		const preview = new PreviewWebview(POSITRON_PREVIEW_HTML_VIEW_TYPE, previewId, title, overlay);
		this.makeActivePreview(preview);
		return preview;
	}
}
