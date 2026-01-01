/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
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
import { IPositronIPyWidgetsService } from '../../../services/positronIPyWidgets/common/positronIPyWidgetsService.js';

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

	/** Map of created widget webviews keyed by output ID for Positron notebooks. */
	private readonly _widgetWebviewsByOutputId = new Map<string, Promise<INotebookOutputWebview>>();

	/** Map tracking which widget output IDs belong to which notebook for cache cleanup. */
	private readonly _widgetIdsByNotebookId = new Map<string, Set<string>>();

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

		// Initialize widget tracking for this notebook
		this._widgetIdsByNotebookId.set(notebookId, new Set());

		// Clean up widget cache entries when notebook is disposed
		disposables.add(toDisposable(() => {
			const widgetIds = this._widgetIdsByNotebookId.get(notebookId);
			if (widgetIds) {
				// Remove all cached webview promises for this notebook's widgets
				widgetIds.forEach(widgetId => this._widgetWebviewsByOutputId.delete(widgetId));
				this._widgetIdsByNotebookId.delete(notebookId);
			}
			this._messagesByNotebookId.delete(notebookId);
			this._notebookToDisposablesMap.delete(notebookId);
		}));
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
		outputs
	}: {
		instance: IPositronNotebookInstance;
		outputId: NotebookOutput['outputId'];
		outputs: NotebookOutput['outputs'];
	}): NotebookPreloadOutputResults | undefined {
		const notebookMessages = this._messagesByNotebookId.get(instance.getId());

		if (!notebookMessages) {
			throw new Error(`PositronWebviewPreloadService: Notebook ${instance.getId()} not found in messagesByNotebookId map.`);
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
				if (!this._positronIPyWidgetsService.hasWidgetInstance(runtimeOutput.id)) {
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

		// Display messages (e.g., interactive plots) need to create a new webview immediately
		// and return it for rendering
		if (messageType === 'display') {
			return {
				preloadMessageType: messageType,
				webview: this._createNotebookPlotWebview(instance, runtimeOutput)
			};
		}

		// Preload messages contain setup code or dependencies that need to be stored
		// for future webviews but don't need to be displayed themselves
		notebookMessages.push(runtimeOutput);
		return { preloadMessageType: messageType };
	}
	/**
	 * Create a webview for an IPyWidget output for a notebook.
	 * Creates a per-widget messaging channel to enable proper communication
	 * between the widget webview and the kernel.
	 *
	 * @param instance The notebook instance the widget belongs to.
	 * @param session The notebook session (already validated to exist)
	 * @param displayMessage The widget message to display.
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
			throw new Error(`PositronWebviewPreloadService: Could not find disposables for notebook ${instance.getId()}`);
		}

		// Track this widget ID for cache cleanup when notebook is disposed
		const widgetIds = this._widgetIdsByNotebookId.get(instance.getId());
		if (widgetIds) {
			widgetIds.add(displayMessage.id);
		}

		// Create the per-widget messaging and IPyWidgets instance first.
		// This must happen before the webview is created so the messaging channel
		// is ready when the webview starts communicating with the kernel
		const widgetDisposable = this._positronIPyWidgetsService.createWidgetInstance(
			session,
			displayMessage.id
		);

		// Store the widget disposable so it's cleaned up with the notebook
		disposables.add(widgetDisposable);

		// Now create the webview for the widget output
		const webview = await this._notebookOutputWebviewService.createNotebookOutputWebview({
			id: displayMessage.id,
			runtime: session,
			output: displayMessage,
			viewType: 'jupyter-notebook'
		});

		if (!webview) {
			// Clean up the widget instance if webview creation fails
			widgetDisposable.dispose();
			throw new Error(`PositronWebviewPreloadService: Failed to create webview for widget output ${displayMessage.id} in notebook ${instance.uri.toString()}`);
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


// Register service.
registerSingleton(IPositronWebviewPreloadService, PositronWebviewPreloadService, InstantiationType.Delayed);
