/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../base/common/event.js';
import { ILanguageRuntimeMessageOutput, ILanguageRuntimeMessageWebOutput, LanguageRuntimeMessageType, LanguageRuntimeSessionMode, RuntimeOutputKind } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { IPositronWebviewPreloadService, NotebookPreloadOutputResults } from '../../../services/positronWebviewPreloads/browser/positronWebviewPreloadService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IPositronNotebookOutputWebviewService, INotebookOutputWebview } from '../../positronOutputWebview/browser/notebookOutputWebviewService.js';
import { NotebookMultiMessagePlotClient } from '../../positronPlots/browser/notebookMultiMessagePlotClient.js';
import { UiFrontendEvent } from '../../../services/languageRuntime/common/positronUiComm.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { isWebviewDisplayMessage, isWebviewReplayMessage } from './utils.js';
import { IPositronNotebookInstance } from '../../../services/positronNotebook/browser/IPositronNotebookInstance.js';
import { buildWebviewHTML, webviewMessageCodeString } from './notebookOutputUtils.js';

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
		console.log('Adding notebook instance to webview preloads knowledge', instance);
		const notebookId = instance.id;
		if (this._notebookToDisposablesMap.has(notebookId)) {
			// Clear existing disposables
			this._notebookToDisposablesMap.get(notebookId)?.dispose();
		}

		const disposables = new DisposableStore();
		this._notebookToDisposablesMap.set(notebookId, disposables);

		const messagesForNotebook: ILanguageRuntimeMessageWebOutput[] = [];
		this._messagesByNotebookId.set(notebookId, messagesForNotebook);
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

	/**
	 * Determines if a set of notebook cell outputs contains mime types that require webview handling.
	 * This is used to check if outputs need special webview processing, either for:
	 * 1. Display messages that create new webviews (e.g. interactive plots)
	 * 2. Replay messages that need to be stored for later playback in webviews
	 *
	 * @param outputs Array of output objects containing mime types to check
	 * @returns The type of webview message ('display', 'preload') or null if not handled
	 */
	static getWebviewMessageType(outputs: { mime: string }[]): NotebookPreloadOutputResults['preloadMessageType'] | 'html' | null {
		const mimeTypes = outputs.map(output => output.mime);
		if (isWebviewDisplayMessage(mimeTypes)) {
			return 'display';
		}
		if (isWebviewReplayMessage(mimeTypes)) {
			return 'preload';
		}
		if (mimeTypes.includes('text/html')) {
			return 'html';
		}
		return null;
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
		const notebookMessages = this._messagesByNotebookId.get(instance.id);

		if (!notebookMessages) {
			throw new Error(`PositronWebviewPreloadService: Notebook ${instance.id} not found in messagesByNotebookId map.`);
		}

		// Check if this output contains any mime types that require webview handling
		// Returns undefined for outputs that don't need webview processing (e.g., plain text, images)
		const messageType = PositronWebviewPreloadService.getWebviewMessageType(outputs);
		if (!messageType) {
			return undefined;
		}

		const runtimeOutput = PositronWebviewPreloadService.notebookMessageToRuntimeOutput(
			{ outputId, outputs },
			RuntimeOutputKind.WebviewPreload
		);

		// Display messages (e.g., interactive plots) need to create a new webview immediately
		// and return it for rendering
		if (messageType === 'display') {
			return {
				preloadMessageType: messageType,
				webview: this._createNotebookPlotWebview(instance, runtimeOutput)
			};
		}

		// We also want to send plain (non preload reliant) html messages to output.
		if (messageType === 'html') {
			return {
				preloadMessageType: 'display',
				webview: this._handleHtmlOutput(instance, outputId, outputs)
			};
		}

		// Preload messages contain setup code or dependencies that need to be stored
		// for future webviews but don't need to be displayed themselves
		notebookMessages.push(runtimeOutput);
		return { preloadMessageType: messageType };
	}

	/**
	 * Create a webview for a plain html output.
	 */
	private async _handleHtmlOutput(instance: IPositronNotebookInstance, outputId: NotebookOutput['outputId'], outputs: NotebookOutput['outputs']) {

		// Get the output with mime type of html
		const htmlOutput = outputs.find(output => output.mime === 'text/html');
		if (!htmlOutput) {
			throw new Error('Expected HTML output');
		}

		const notebookWebview = await this._notebookOutputWebviewService.createRawHtmlOutput({
			id: outputId,
			runtimeOrSessionId: instance.id,
			html: buildWebviewHTML({
				content: htmlOutput.data.toString(),
				script: webviewMessageCodeString,
			})
		});

		return notebookWebview;
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
		const disposables = this._notebookToDisposablesMap.get(instance.id);
		if (!disposables) {
			throw new Error(`PositronWebviewPreloadService: Could not find disposables for notebook ${instance.id}`);
		}

		// Create a plot client and fire event letting plots pane know it's good to go.
		const storedMessages = this._messagesByNotebookId.get(instance.id) ?? [];
		const webview = await this._notebookOutputWebviewService.createMultiMessageWebview({
			runtimeId: instance.id,
			preReqMessages: storedMessages,
			displayMessage: displayMessage,
			viewType: 'jupyter-notebook'
		});

		// Assert that we have a webview
		if (!webview) {
			throw new Error(`PositronWebviewPreloadService: Failed to create webview for notebook ${instance.id}`);
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
