/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../base/common/event.js';
import { ILanguageRuntimeMessageOutput, ILanguageRuntimeMessageWebOutput, LanguageRuntimeMessageType, LanguageRuntimeSessionMode, RuntimeOutputKind } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { IPositronWebviewPreloadService, NotebookPreloadOutputResults } from '../../../services/positronWebviewPreloads/browser/positronWebviewPreloadService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IPositronNotebookOutputWebviewService, INotebookOutputWebview } from '../../positronOutputWebview/browser/notebookOutputWebviewService.js';
import { NotebookMultiMessagePlotClient } from '../../positronPlots/browser/notebookMultiMessagePlotClient.js';
import { UiFrontendEvent } from '../../../services/languageRuntime/common/positronUiComm.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { isWebviewDisplayMessage, getWebviewMessageType } from '../../../services/positronIPyWidgets/common/webviewPreloadUtils.js';
import { IPositronNotebookInstance } from '../../positronNotebook/browser/IPositronNotebookInstance.js';
import { NotebookCellsChangeType, NotebookTextModelChangedEvent } from '../../notebook/common/notebookCommon.js';
import { IPositronIPyWidgetsService } from '../../../services/positronIPyWidgets/common/positronIPyWidgetsService.js';
import { dirname } from '../../../../base/common/resources.js';
import { Schemas } from '../../../../base/common/network.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import * as path from '../../../../base/common/path.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { EditorOpenSource, EditorResolution } from '../../../../platform/editor/common/editor.js';
import { URI } from '../../../../base/common/uri.js';

/**
 * Format of output from a notebook cell
 */
type NotebookOutput = { outputId: string; outputs: { mime: string; data: VSBuffer }[] };
export class PositronWebviewPreloadService extends Disposable implements IPositronWebviewPreloadService {
	/** Needed for service branding in dependency injector. */
	_serviceBrand: undefined;

	/** Placeholder for service initialization. */
	initialize() { }

	/** Map of holoviz messages keyed by session ID. */
	private readonly _messagesBySessionId = new Map<string, ILanguageRuntimeMessageWebOutput[]>();
	private readonly _messagesByNotebookId = new Map<string, ILanguageRuntimeMessageWebOutput[]>();

	/** Map of created ipywidgets webviews keyed by output ID for Positron notebooks. */
	private readonly _widgetWebviewsByOutputId = new Map<string, Promise<INotebookOutputWebview>>();

	/** Map of created PDF webviews keyed by output ID for Positron notebooks. */
	private readonly _pdfWebviewsByOutputId = new Map<string, Promise<INotebookOutputWebview>>();

	/**
	 * Map of created overlay webviews (interactive display plots and raw HTML)
	 * keyed by output ID. Unlike widgets, these have no comm channel of their
	 * own, so the service owns their lifecycle: they are reconciled against the
	 * notebook model and disposed when their output disappears. Widget and PDF
	 * webviews are deliberately excluded -- they manage their own lifecycle.
	 */
	private readonly _overlayWebviewsByOutputId = new Map<string, Promise<INotebookOutputWebview>>();

	/** Map tracking which overlay output IDs belong to which notebook for reconciliation. */
	private readonly _overlayOutputIdsByNotebookId = new Map<string, Set<string>>();

	/** Map tracking which output IDs belong to which notebook for cache cleanup. */
	private readonly _outputIdsByNotebookId = new Map<string, Set<string>>();

	/**
	 * Map to disposeable stores for each session. Used to prevent memory leaks caused by
	 * repeatedly attaching to the same session which can happen in the case of the application
	 * closing before the session ends
	 */
	private _sessionToDisposablesMap = new Map<string, DisposableStore>();
	private _notebookToDisposablesMap = new Map<string, DisposableStore>();

	/** The emitter for the onDidCreatePlot event */
	private readonly _onDidCreatePlot = this._register(new Emitter<NotebookMultiMessagePlotClient>());

	/** Emitted when a new webview is created. */
	onDidCreatePlot = this._onDidCreatePlot.event;

	constructor(
		@IRuntimeSessionService private _runtimeSessionService: IRuntimeSessionService,
		@IPositronNotebookOutputWebviewService private _notebookOutputWebviewService: IPositronNotebookOutputWebviewService,
		@IPositronIPyWidgetsService private _positronIPyWidgetsService: IPositronIPyWidgetsService,
		@ICommandService private _commandService: ICommandService,
		@IEditorService private _editorService: IEditorService,
	) {
		super();

		// Attach to existing sessions.
		this._runtimeSessionService.activeSessions.forEach(session => {
			this._attachSession(session);
		});

		// Attach to new sessions.
		this._register(this._runtimeSessionService.onWillStartSession((event) => {
			this._attachSession(event.session);
		}));
	}

	override dispose(): void {
		super.dispose();
		// Clean up disposables linked to any connected sessions
		this._sessionToDisposablesMap.forEach(disposables => disposables.dispose());
		this._notebookToDisposablesMap.forEach(disposables => disposables.dispose());
	}

	sessionInfo(sessionId: string) {
		const messages = this._messagesBySessionId.get(sessionId);
		if (!messages) {
			return null;
		}
		return {
			numberOfMessages: messages.length
		};
	}

	private _attachSession(session: ILanguageRuntimeSession) {
		if (this._sessionToDisposablesMap.has(session.sessionId)) {
			return;
		}

		const disposables = new DisposableStore();
		this._sessionToDisposablesMap.set(session.sessionId, disposables);
		this._messagesBySessionId.set(session.sessionId, []);

		// Only handle messages internally if in console mode. Notebooks handle
		// messages by sending them into the service themselves.
		if (session.metadata.sessionMode !== LanguageRuntimeSessionMode.Console) {
			return;
		}

		const handleMessage = (msg: ILanguageRuntimeMessageOutput) => {
			if (msg.kind !== RuntimeOutputKind.WebviewPreload) {
				return;
			}

			this._addMessageForSession(session, msg as ILanguageRuntimeMessageWebOutput);
		};

		disposables.add(session.onDidReceiveRuntimeClientEvent((e) => {
			if (e.name !== UiFrontendEvent.ClearWebviewPreloads) { return; }
			// Dump all the messages for the session so new extension can take precidence.
			this._messagesBySessionId.set(session.sessionId, []);
		}));

		disposables.add(session.onDidReceiveRuntimeMessageResult(handleMessage));
		disposables.add(session.onDidReceiveRuntimeMessageOutput(handleMessage));
	}

	public attachNotebookInstance(instance: IPositronNotebookInstance): void {
		const notebookId = instance.getId();
		if (this._notebookToDisposablesMap.has(notebookId)) {
			// Clear existing disposables
			this._notebookToDisposablesMap.get(notebookId)?.dispose();
		}

		const disposables = new DisposableStore();
		this._notebookToDisposablesMap.set(notebookId, disposables);

		const messagesForNotebook: ILanguageRuntimeMessageWebOutput[] = [];
		this._messagesByNotebookId.set(notebookId, messagesForNotebook);

		// Initialize output ID tracking for this notebook
		this._outputIdsByNotebookId.set(notebookId, new Set());
		this._overlayOutputIdsByNotebookId.set(notebookId, new Set());

		// Listen for notebook model changes so overlay webviews whose outputs
		// disappear (cleared, cell deleted, output type changed) are disposed
		// rather than left orphaned in memory. The text model can be swapped
		// out (onDidChangeModel), so re-attach the content listener each time.
		const modelDisposables = disposables.add(new MutableDisposable<DisposableStore>());
		const attachModel = () => {
			modelDisposables.clear();

			const textModel = instance.textModel;
			if (textModel) {
				const contentDisposables = new DisposableStore();
				contentDisposables.add(textModel.onDidChangeContent(event => {
					if (this._affectsNotebookOutputs(event)) {
						this._reconcileOverlayWebviews(instance);
					}
				}));
				modelDisposables.value = contentDisposables;
			}

			this._reconcileOverlayWebviews(instance);
		};
		attachModel();
		disposables.add(instance.onDidChangeModel(() => attachModel()));

		// Clean up webview cache entries when notebook is disposed
		disposables.add(toDisposable(() => {
			const outputIds = this._outputIdsByNotebookId.get(notebookId);
			if (outputIds) {
				outputIds.forEach(outputId => {
					this._widgetWebviewsByOutputId.delete(outputId);
					this._pdfWebviewsByOutputId.delete(outputId);
				});
				this._outputIdsByNotebookId.delete(notebookId);
			}
			const overlayOutputIds = this._overlayOutputIdsByNotebookId.get(notebookId);
			if (overlayOutputIds) {
				overlayOutputIds.forEach(outputId => this._disposeOverlayWebview(outputId));
				this._overlayOutputIdsByNotebookId.delete(notebookId);
			}
			this._messagesByNotebookId.delete(notebookId);
			this._notebookToDisposablesMap.delete(notebookId);
		}));
	}

	/**
	 * Whether a model-content change touched cell outputs in a way that could
	 * orphan an overlay webview: outputs replaced (clear / re-run), output items
	 * changed, or cells added/removed.
	 */
	private _affectsNotebookOutputs(event: NotebookTextModelChangedEvent): boolean {
		return event.rawEvents.some(rawEvent =>
			rawEvent.kind === NotebookCellsChangeType.Output ||
			rawEvent.kind === NotebookCellsChangeType.OutputItem ||
			rawEvent.kind === NotebookCellsChangeType.ModelChange
		);
	}

	/**
	 * Dispose any tracked overlay webview whose output ID is no longer present
	 * in the notebook model. Only overlay webviews (display plots + raw HTML)
	 * are reconciled here; widget webviews own their own lifecycle via the
	 * ipywidgets comm channels and are never disposed by reconciliation.
	 */
	private _reconcileOverlayWebviews(instance: IPositronNotebookInstance): void {
		const overlayOutputIds = this._overlayOutputIdsByNotebookId.get(instance.getId());
		if (!overlayOutputIds?.size) {
			return;
		}

		const liveOutputIds = new Set(
			instance.textModel?.cells.flatMap(cell => cell.outputs.map(output => output.outputId)) ?? []
		);

		for (const outputId of Array.from(overlayOutputIds)) {
			if (!liveOutputIds.has(outputId)) {
				this._disposeOverlayWebview(outputId);
				overlayOutputIds.delete(outputId);
			}
		}
	}

	/**
	 * Dispose a tracked overlay webview and drop it from the cache. Disposal is
	 * chained off the cached Promise so a webview still being created is torn
	 * down once it resolves.
	 */
	private _disposeOverlayWebview(outputId: string): void {
		const webviewPromise = this._overlayWebviewsByOutputId.get(outputId);
		if (webviewPromise) {
			webviewPromise.then(webview => webview.dispose(), () => { /* creation failed; nothing to dispose */ });
		}
		this._overlayWebviewsByOutputId.delete(outputId);
	}

	/**
	 * Track and return an overlay webview (display plot or raw HTML) so it can
	 * be reconciled against the notebook model and disposed when orphaned.
	 */
	private _trackOverlayWebview(instance: IPositronNotebookInstance, outputId: string, webview: Promise<INotebookOutputWebview>): Promise<INotebookOutputWebview> {
		this._overlayWebviewsByOutputId.set(outputId, webview);
		this._overlayOutputIdsByNotebookId.get(instance.getId())?.add(outputId);
		return webview;
	}

	/**
	 * Drop a tracked overlay webview from the caches after creation fails, but
	 * only if it is still the current entry -- a newer create for the same
	 * output ID may have replaced it while this one was pending.
	 */
	private _untrackOverlayWebview(instance: IPositronNotebookInstance, outputId: string, webview: Promise<INotebookOutputWebview>): void {
		if (this._overlayWebviewsByOutputId.get(outputId) === webview) {
			this._overlayWebviewsByOutputId.delete(outputId);
			this._overlayOutputIdsByNotebookId.get(instance.getId())?.delete(outputId);
		}
	}

	static notebookMessageToRuntimeOutput(message: NotebookOutput, kind: RuntimeOutputKind): ILanguageRuntimeMessageWebOutput {
		return {
			id: message.outputId,
			type: LanguageRuntimeMessageType.Output,
			event_clock: 0,
			parent_id: '',
			when: '',
			kind,
			output_location: undefined,
			resource_roots: undefined,
			data: message.outputs.reduce((acc, output) => {
				acc[output.mime] = output.data.toString();
				return acc;
				// eslint-disable-next-line local/code-no-dangerous-type-assertions
			}, {} as Record<string, unknown>)
		};
	}


	/**
	 * Add a notebook output to service. Either for display or preload.
	 * @param instance The notebook instance the output belongs to.
	 * @param outputId The id of the output.
	 * @param outputs The outputs to add.
	 */
	public addNotebookOutput({
		instance,
		outputId,
		outputs,
		rawHtml
	}: {
		instance: IPositronNotebookInstance;
		outputId: NotebookOutput['outputId'];
		outputs: NotebookOutput['outputs'];
		rawHtml?: string;
	}): NotebookPreloadOutputResults | undefined {
		const notebookMessages = this._messagesByNotebookId.get(instance.getId());

		if (!notebookMessages) {
			throw new Error(`PositronWebviewPreloadService: Notebook ${instance.getId()} not found in messagesByNotebookId map.`);
		}

		// Raw HTML outputs bypass MIME-based type detection and are rendered
		// directly in an isolated overlay webview.
		if (rawHtml) {
			const rawHtmlBaseUri = instance.uri.scheme === Schemas.untitled
				? undefined
				: dirname(instance.uri);

			// Check if this HTML contains an iframe pointing to a PDF file.
			// If so, route through the PDF server for proper rendering. PDF
			// webviews keep their own cache and notebook-close cleanup (they
			// also unregister from the PDF HTTP server on dispose), so they are
			// not tracked for output reconciliation here.
			const pdfIframeInfo = extractPdfIframeInfo(rawHtml);
			if (pdfIframeInfo) {
				const existingWebview = this._pdfWebviewsByOutputId.get(outputId);
				if (existingWebview) {
					return { preloadMessageType: 'display', webview: existingWebview };
				}

				// Untitled notebooks have no base URI, so notebookDir is empty and a
				// relative PDF src cannot be resolved (it will 404). Only absolute
				// PDF paths render for unsaved notebooks.
				const notebookDir = rawHtmlBaseUri?.fsPath ?? '';
				const webviewPromise = this._createPdfNotebookWebview(instance, outputId, pdfIframeInfo, notebookDir, rawHtmlBaseUri)
					.catch(err => {
						this._pdfWebviewsByOutputId.delete(outputId);
						throw err;
					});
				this._pdfWebviewsByOutputId.set(outputId, webviewPromise);
				return { preloadMessageType: 'display', webview: webviewPromise };
			}

			// Reuse a tracked overlay if one already exists for this output:
			// parseCellOutputs() re-runs on every output change, so recreating
			// here would churn (and orphan) the webview. The tracked webview is
			// reconciled against the model and disposed when its output is gone.
			const existingOverlay = this._overlayWebviewsByOutputId.get(outputId);
			if (existingOverlay) {
				return { preloadMessageType: 'display', webview: existingOverlay };
			}

			const webviewPromise = this._notebookOutputWebviewService.createRawHtmlOutputWebview(outputId, rawHtml, rawHtmlBaseUri)
				.catch(err => {
					this._untrackOverlayWebview(instance, outputId, webviewPromise);
					throw err;
				});
			return {
				preloadMessageType: 'display',
				webview: this._trackOverlayWebview(instance, outputId, webviewPromise),
			};
		}

		// Check if this output contains any mime types that require webview handling
		// Returns undefined for outputs that don't need webview processing (e.g., plain text, images)
		const messageType = getWebviewMessageType(outputs);
		if (!messageType) {
			return undefined;
		}

		const runtimeOutput = PositronWebviewPreloadService.notebookMessageToRuntimeOutput(
			{ outputId, outputs },
			RuntimeOutputKind.WebviewPreload
		);

		// Widget messages (e.g., ipywidgets) need to create a widget webview
		if (messageType === 'widget') {
			// Check if we already have a webview for this output (from previous creation)
			const existingWebview = this._widgetWebviewsByOutputId.get(runtimeOutput.id);
			if (existingWebview) {
				// Double-check that the widget instance was also successfully created
				if (!this._positronIPyWidgetsService.hasPositronNotebookWidgetInstance(runtimeOutput.id)) {
					this._widgetWebviewsByOutputId.delete(runtimeOutput.id);
				} else {
					return {
						preloadMessageType: messageType,
						webview: existingWebview
					};
				}
			}

			// Check if session is available before attempting widget creation
			const session = this._runtimeSessionService.getNotebookSessionForNotebookUri(instance.uri);
			if (!session) {
				// Session doesn't exist yet - skip widget creation, will retry when session attaches
				return undefined;
			}

			// Create webview and handle failures by removing from cache
			const webviewPromise = this._createNotebookWidgetWebview(instance, session, runtimeOutput)
				.catch(err => {
					// Remove from cache on failure to allow retry
					this._widgetWebviewsByOutputId.delete(runtimeOutput.id);
					throw err;
				});

			// Cache the webview Promise for subsequent calls
			this._widgetWebviewsByOutputId.set(runtimeOutput.id, webviewPromise);
			return {
				preloadMessageType: messageType,
				webview: webviewPromise
			};
		}

		// Display messages (e.g., interactive plots) need their own overlay
		// webview. Reuse a tracked one if it already exists -- parseCellOutputs()
		// re-runs on every output change, so recreating here would churn (and
		// orphan) the webview. The tracked webview is reconciled against the
		// model and disposed when its output disappears.
		if (messageType === 'display') {
			const existingOverlay = this._overlayWebviewsByOutputId.get(runtimeOutput.id);
			if (existingOverlay) {
				return { preloadMessageType: messageType, webview: existingOverlay };
			}

			const webviewPromise = this._createNotebookPlotWebview(instance, runtimeOutput)
				.catch(err => {
					this._untrackOverlayWebview(instance, runtimeOutput.id, webviewPromise);
					throw err;
				});
			return {
				preloadMessageType: messageType,
				webview: this._trackOverlayWebview(instance, runtimeOutput.id, webviewPromise),
			};
		}

		// Preload messages contain setup code or dependencies that need to be stored
		// for future webviews but don't need to be displayed themselves
		notebookMessages.push(runtimeOutput);
		return { preloadMessageType: messageType };
	}
	/**
	 * Create a webview that renders a PDF inline in a notebook cell using the
	 * positron-pdf-server extension's full viewer with "Open With..." support.
	 */
	private async _createPdfNotebookWebview(
		instance: IPositronNotebookInstance,
		outputId: string,
		pdfInfo: { src: string; width?: string; height?: string },
		notebookDir: string,
		baseUri: URI | undefined,
	): Promise<INotebookOutputWebview> {
		// Track this output ID for cache cleanup when notebook is disposed.
		const outputIds = this._outputIdsByNotebookId.get(instance.getId());
		if (outputIds) {
			outputIds.add(outputId);
		}

		// Resolve relative paths against the notebook's directory.
		const pdfPath = path.isAbsolute(pdfInfo.src)
			? pdfInfo.src
			: path.join(notebookDir, pdfInfo.src);

		// Call the pdf-server extension command to register the PDF and get a viewer URL.
		// Tradeoff: the IDE theme is baked into the viewer URL here and the webview is
		// cached per output, so switching the IDE theme leaves already-rendered PDFs
		// stale until recompute. A full fix would subscribe to onDidChangeActiveColorTheme
		// and refresh; left as a follow-up.
		let result: { viewerUrl: string; pdfId: string } | undefined;
		try {
			result = await this._commandService.executeCommand<{ viewerUrl: string; pdfId: string }>(
				'positron.pdfServer.getViewerUrl',
				pdfPath
			);
		} catch {
			// Extension not available or command failed.
		}

		if (!result) {
			return this._notebookOutputWebviewService.createRawHtmlOutputWebview(
				outputId,
				`<p>Unable to render PDF: ${pdfInfo.src}</p>`,
				baseUri
			);
		}

		const height = pdfInfo.height || '600';
		const width = pdfInfo.width ? `${pdfInfo.width}px` : '100%';

		const html = `<!DOCTYPE html>
<html>
<head>
<style>
	body, html { margin: 0; padding: 0; overflow: hidden; }
	iframe { border: none; width: ${width}; height: ${height}px; display: block; }
</style>
</head>
<body>
<iframe id="pdf-frame" src="${result.viewerUrl}"></iframe>
<script>
	(function() {
		var vscode = acquireVsCodeApi();
		var expectedOrigin = new URL(${JSON.stringify(result.viewerUrl)}).origin;
		window.addEventListener('message', function(event) {
			if (event.origin !== expectedOrigin) { return; }
			if (event.data && event.data.channel === 'pdf-open-with') {
				vscode.postMessage({
					__vscode_notebook_message: true,
					type: 'positron-open-pdf-with',
					path: ${JSON.stringify(pdfPath)}
				});
			}
		});
	})();
</script>
</body>
</html>`;

		const webview = await this._notebookOutputWebviewService.createRawHtmlOutputWebview(outputId, html, baseUri);

		// Tie disposables to the notebook's lifecycle, not the service singleton.
		// The store is created in attachNotebookInstance, so its absence here is a
		// programming error rather than an expected state.
		const disposables = this._notebookToDisposablesMap.get(instance.getId());
		if (!disposables) {
			throw new Error(`[PositronWebviewPreloadService]: Could not find disposables for notebook ${instance.getId()}`);
		}

		disposables.add(webview.webview.onMessage((event) => {
			const msg = event.message;
			if (msg?.__vscode_notebook_message && msg.type === 'positron-open-pdf-with' && msg.path) {
				this._editorService.openEditor({
					resource: URI.file(msg.path),
					options: { override: EditorResolution.PICK, source: EditorOpenSource.USER }
				});
			}
		}));

		// Unregister the PDF from the HTTP server when the notebook is disposed.
		disposables.add(toDisposable(() => {
			this._commandService.executeCommand('positron.pdfServer.unregisterPdf', result.pdfId);
		}));

		return webview;
	}

	/**
	 * Create a webview for an IPyWidget output from a Positron Notebook.
	 * Creates a per-output messaging channel to enable proper communication
	 * between the output's webview and the kernel.
	 *
	 * @param instance The notebook instance the output belongs to.
	 * @param session The notebook session (already validated to exist)
	 * @param displayMessage The output message to display.
	 * @returns The created webview
	 */
	private async _createNotebookWidgetWebview(
		instance: IPositronNotebookInstance,
		session: ILanguageRuntimeSession,
		displayMessage: ILanguageRuntimeMessageWebOutput
	): Promise<INotebookOutputWebview> {
		// Grab disposables for this notebook
		const disposables = this._notebookToDisposablesMap.get(instance.getId());
		if (!disposables) {
			throw new Error(`[PositronWebviewPreloadService]: Could not find disposables for notebook ${instance.getId()}`);
		}

		// Track this output ID for cache cleanup when notebook is disposed
		const outputIds = this._outputIdsByNotebookId.get(instance.getId());
		if (outputIds) {
			outputIds.add(displayMessage.id);
		}

		// Create the per-output messaging and IPyWidgets instance first.
		// This must happen before the webview is created so the messaging channel
		// is ready when the webview starts communicating with the kernel
		const widgetDisposable = this._positronIPyWidgetsService.createPositronNotebookWidgetInstance(
			session,
			displayMessage.id
		);

		// Store the ipywidgets instance disposable so it is cleaned up with the notebook
		disposables.add(widgetDisposable);

		// Now create the webview for the output
		const webview = await this._notebookOutputWebviewService.createNotebookOutputWebview({
			id: displayMessage.id,
			runtime: session,
			output: displayMessage,
			viewType: 'jupyter-notebook'
		});

		if (!webview) {
			// Clean up the ipywidgets instance if webview creation fails
			widgetDisposable.dispose();
			throw new Error(`[PositronWebviewPreloadService]: Failed to create webview for output ${displayMessage.id} in notebook ${instance.uri.toString()}`);
		}

		// Track the webview for disposal when the notebook closes
		disposables.add(webview);

		// Also clean up cache entry when webview is disposed
		disposables.add(toDisposable(() => {
			this._widgetWebviewsByOutputId.delete(displayMessage.id);
		}));

		return webview;
	}

	/**
	 * Create a plot client for a display message by replaying all the associated previous messages.
	 * Alerts the plots pane that a new plot is ready.
	 * @param runtime Runtime session associated with the message.
	 * @param displayMessage The message to display.
	 */
	private async _createNotebookPlotWebview(
		instance: IPositronNotebookInstance,
		displayMessage: ILanguageRuntimeMessageWebOutput,
	): Promise<INotebookOutputWebview> {
		// Grab disposables for this session
		const disposables = this._notebookToDisposablesMap.get(instance.getId());
		if (!disposables) {
			throw new Error(`PositronWebviewPreloadService: Could not find disposables for notebook ${instance.getId()}`);
		}

		// Create a plot client and fire event letting plots pane know it's good to go.
		const storedMessages = this._messagesByNotebookId.get(instance.getId()) ?? [];
		const webview = await this._notebookOutputWebviewService.createMultiMessageWebview({
			runtimeId: instance.getId(),
			preReqMessages: storedMessages,
			displayMessage: displayMessage,
			viewType: 'jupyter-notebook'
		});

		// Assert that we have a webview
		if (!webview) {
			throw new Error(`PositronWebviewPreloadService: Failed to create webview for notebook ${instance.getId()}`);
		}

		return webview;
	}

	/**
	 * Record a message to the store keyed by session.
	 * @param session The session that the message is associated with.
	 * @param msg The message to process
	 */
	private _addMessageForSession(session: ILanguageRuntimeSession, msg: ILanguageRuntimeMessageWebOutput) {
		const sessionId = session.sessionId;

		// Check if a message is a message that should be displayed rather than simply stored as
		// dependencies for future display messages.
		if (isWebviewDisplayMessage(msg)) {
			// Create a new plot client.
			this._createPlotClient(session, msg);
			return;
		}

		// Save the message for later playback. One thing we should be aware of is that the messages
		// for setup don't seem to be replayed if they are called again. This causes an issue for
		// this technique as if we reload positron the service starts up again and the messages are
		// lost which will cause very confusing failures of plots not showing up.
		const messagesForSession = this._messagesBySessionId.get(sessionId);

		if (!messagesForSession) {
			throw new Error(`PositronWebviewPreloadService: Session ${sessionId} not found in messagesBySessionId map.`);
		}
		messagesForSession.push(msg);
	}

	/**
	 * Create a plot client for a display message by replaying all the associated previous messages.
	 * Alerts the plots pane that a new plot is ready.
	 * @param runtime Runtime session associated with the message.
	 * @param displayMessage The message to display.
	 */
	private async _createPlotClient(
		runtime: ILanguageRuntimeSession,
		displayMessage: ILanguageRuntimeMessageWebOutput,
	) {
		// Grab disposables for this session
		const disposables = this._sessionToDisposablesMap.get(runtime.sessionId);
		if (!disposables) {
			throw new Error(`PositronWebviewPreloadService: Could not find disposables for session ${runtime.sessionId}`);
		}

		// Create a plot client and fire event letting plots pane know it's good to go.
		const storedMessages = this._messagesBySessionId.get(runtime.sessionId) ?? [];
		const client = disposables.add(new NotebookMultiMessagePlotClient(
			this._notebookOutputWebviewService, runtime, storedMessages, displayMessage,
		));
		this._onDidCreatePlot.fire(client);
	}



}

/**
 * Extract PDF iframe info from HTML content.
 * Detects patterns like `<iframe src="file.pdf" width="800" height="600">`.
 */
export function extractPdfIframeInfo(html: string): { src: string; width?: string; height?: string } | undefined {
	const iframeMatch = html.match(/<iframe[^>]*\ssrc=["']([^"']*\.pdf)["'][^>]*>/i);
	if (!iframeMatch) {
		return undefined;
	}
	const src = iframeMatch[1];
	// Scan width/height against the matched iframe tag only, so attributes from a
	// different (non-PDF) iframe elsewhere in the HTML are not mixed in.
	const iframeTag = iframeMatch[0];
	const widthMatch = iframeTag.match(/\swidth=["'](\d+)["']/i);
	const heightMatch = iframeTag.match(/\sheight=["'](\d+)["']/i);
	return {
		src,
		width: widthMatch?.[1],
		height: heightMatch?.[1],
	};
}

// Register service.
registerSingleton(IPositronWebviewPreloadService, PositronWebviewPreloadService, InstantiationType.Delayed);
