/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { Emitter } from 'vs/base/common/event';
import { ILanguageRuntimeMessageOutput, ILanguageRuntimeMessageWebOutput, LanguageRuntimeMessageType, LanguageRuntimeSessionMode, RuntimeOutputKind } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IPositronWebviewPreloadService, MIME_TYPE_BOKEH_EXEC, MIME_TYPE_HOLOVIEWS_EXEC, NotebookPreloadOutputResults } from 'vs/workbench/services/positronWebviewPreloads/common/positronWebviewPreloadService';
import { ILanguageRuntimeSession, IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IPositronNotebookOutputWebviewService } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService';
import { NotebookMultiMessagePlotClient } from 'vs/workbench/contrib/positronPlots/browser/notebookMultiMessagePlotClient';
import { UiFrontendEvent } from 'vs/workbench/services/languageRuntime/common/positronUiComm';
import { VSBuffer } from 'vs/base/common/buffer';
import { isWebviewReplayMessage } from 'vs/workbench/contrib/positronWebviewPreloads/browser/utils';
import { IPositronNotebookInstance } from 'vs/workbench/services/positronNotebook/browser/IPositronNotebookInstance';

const MIME_TYPE_HTML = 'text/html';
const MIME_TYPE_PLAIN = 'text/plain';

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

			this.addMessageForSession(session, msg as ILanguageRuntimeMessageWebOutput);
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
		console.log('Adding notebook instance to webview preloads knowledge', instance);
		if (this._notebookToDisposablesMap.has(instance.id)) {
			// Clear existing disposables
			this._notebookToDisposablesMap.get(instance.id)?.dispose();
		}

		const disposables = new DisposableStore();
		this._notebookToDisposablesMap.set(instance.id, disposables);

		const messagesForNotebook: ILanguageRuntimeMessageWebOutput[] = [];
		this._messagesByNotebookId.set(instance.id, messagesForNotebook);

		// Start by processing every cell in order on initialization
		console.log('instance cells', instance.cells.get());

		// Next listen for new cells runs and then process that cell's output as it happens.
		// instance.cells.addObserver({});

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
			}, {} as Record<string, any>)
		};
	}

	public addNotebookOutput(instance: IPositronNotebookInstance, outputId: NotebookOutput['outputId'], outputs: NotebookOutput['outputs']): NotebookPreloadOutputResults | undefined {
		const notebookMessages = this._messagesByNotebookId.get(instance.id);

		if (!notebookMessages) {
			throw new Error(`PositronWebviewPreloadService: Notebook ${instance.id} not found in messagesByNotebookId map.`);
		}

		// Check if we're working with a webview replay message
		const mimeTypes = outputs.map(output => output.mime);
		const isReplay = isWebviewReplayMessage(mimeTypes);
		if (PositronWebviewPreloadService.isDisplayMessage(mimeTypes)) {
			// Create a new plot client.
			this._createNotebookPlotClient(instance, PositronWebviewPreloadService.notebookMessageToRuntimeOutput({ outputId, outputs }, RuntimeOutputKind.WebviewPreload));

			return { preloadMessageType: 'display' };
		} else if (isReplay) {

			// Store the message for later playback.
			notebookMessages.push(PositronWebviewPreloadService.notebookMessageToRuntimeOutput({ outputId, outputs }, RuntimeOutputKind.WebviewPreload));
			return { preloadMessageType: 'preload' };
		}

		return undefined;
	}

	/**
	 * Create a plot client for a display message by replaying all the associated previous messages.
	 * Alerts the plots pane that a new plot is ready.
	 * @param runtime Runtime session associated with the message.
	 * @param displayMessage The message to display.
	 */
	private async _createNotebookPlotClient(
		instance: IPositronNotebookInstance,
		displayMessage: ILanguageRuntimeMessageWebOutput,
	) {
		// Grab disposables for this session
		const disposables = this._notebookToDisposablesMap.get(instance.id);
		if (!disposables) {
			throw new Error(`PositronWebviewPreloadService: Could not find disposables for notebook ${instance.id}`);
		}

		// Create a plot client and fire event letting plots pane know it's good to go.
		const storedMessages = this._messagesByNotebookId.get(instance.id) ?? [];
		console.log('storedMessages', storedMessages);
		const output = await this._notebookOutputWebviewService.createMultiMessageWebview({
			runtimeId: instance.id,
			preReqMessages: storedMessages,
			displayMessage: displayMessage,
			viewType: 'jupyter-notebook'
		});
		console.log({ output });

		// const client = disposables.add(new NotebookMultiMessagePlotClient(
		// 	this._notebookOutputWebviewService, runtime, storedMessages, displayMessage,
		// ));
		// this._onDidCreatePlot.fire(client);
	}

	/**
	 * Record a message to the store keyed by session.
	 * @param session The session that the message is associated with.
	 * @param msg The message to process
	 */
	public addMessageForSession(session: ILanguageRuntimeSession, msg: ILanguageRuntimeMessageWebOutput) {
		const sessionId = session.sessionId;

		// Check if a message is a message that should be displayed rather than simply stored as
		// dependencies for future display messages.
		if (PositronWebviewPreloadService.isDisplayMessage(Object.keys(msg))) {
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

	static isDisplayMessage(mimeTypes: string[]): boolean {

		const isHoloViewsDisplayMessage = [
			MIME_TYPE_HOLOVIEWS_EXEC,
			MIME_TYPE_HTML,
			MIME_TYPE_PLAIN,
		].every(mime => mimeTypes.includes(mime));

		const isBokehDisplayMessage = mimeTypes.includes(MIME_TYPE_BOKEH_EXEC);

		return isHoloViewsDisplayMessage || isBokehDisplayMessage;
	}
}


// Register service.
registerSingleton(IPositronWebviewPreloadService, PositronWebviewPreloadService, InstantiationType.Delayed);
