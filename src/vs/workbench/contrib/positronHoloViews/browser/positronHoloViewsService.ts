/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { Emitter } from 'vs/base/common/event';
import { ILanguageRuntimeMessageOutput, ILanguageRuntimeMessageWebOutput, LanguageRuntimeSessionMode, RuntimeOutputKind } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IPositronHoloViewsService, MIME_TYPE_HOLOVIEWS_EXEC } from 'vs/workbench/services/positronHoloViews/common/positronHoloViewsService';
import { ILanguageRuntimeSession, IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IPositronNotebookOutputWebviewService } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService';
import { NotebookMultiMessagePlotClient } from 'vs/workbench/contrib/positronPlots/browser/notebookMultiMessagePlotClient';
import { UiFrontendEvent } from 'vs/workbench/services/languageRuntime/common/positronUiComm';

const MIME_TYPE_HTML = 'text/html';
const MIME_TYPE_PLAIN = 'text/plain';

export class PositronHoloViewsService extends Disposable implements IPositronHoloViewsService {
	/** Needed for service branding in dependency injector. */
	_serviceBrand: undefined;

	/** Placeholder for service initialization. */
	initialize() { }

	/** Map of holoviz messages keyed by session ID. */
	private readonly _messagesBySessionId = new Map<string, ILanguageRuntimeMessageWebOutput[]>();

	/**
	 * Map to disposeable stores for each session. Used to prevent memory leaks caused by
	 * repeatedly attaching to the same session which can happen in the case of the application
	 * closing before the session ends
	 */
	private _sessionToDisposablesMap = new Map<string, DisposableStore>();

	/** The emitter for the onDidCreatePlot event */
	private readonly _onDidCreatePlot = this._register(new Emitter<NotebookMultiMessagePlotClient>());

	/** Emitted when a new HoloViews webview is created. */
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
		// Only attach to new console sessions.
		if (
			session.metadata.sessionMode !== LanguageRuntimeSessionMode.Console ||
			this._sessionToDisposablesMap.has(session.sessionId)
		) {
			return;
		}

		const disposables = new DisposableStore();
		this._sessionToDisposablesMap.set(session.sessionId, disposables);
		this._messagesBySessionId.set(session.sessionId, []);


		const handleMessage = (msg: ILanguageRuntimeMessageOutput) => {
			if (msg.kind !== RuntimeOutputKind.HoloViews) {
				return;
			}

			this._addMessageForSession(session, msg as ILanguageRuntimeMessageWebOutput);
		};

		disposables.add(session.onDidReceiveRuntimeClientEvent((e) => {
			if (e.name !== UiFrontendEvent.LoadHoloviewsExtension) { return; }
			// Dump all the messages for the session so new extension can take precidence.
			this._messagesBySessionId.set(session.sessionId, []);
		}));

		disposables.add(session.onDidReceiveRuntimeMessageResult(handleMessage));
		disposables.add(session.onDidReceiveRuntimeMessageOutput(handleMessage));
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
		const isHoloViewDisplayMessage = MIME_TYPE_HOLOVIEWS_EXEC in msg.data &&
			MIME_TYPE_HTML in msg.data &&
			MIME_TYPE_PLAIN in msg.data;

		if (isHoloViewDisplayMessage) {
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
			throw new Error(`PositronHoloViewsService: Session ${sessionId} not found in messagesBySessionId map.`);
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
			throw new Error(`PositronHoloViewsService: Could not find disposables for session ${runtime.sessionId}`);
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
registerSingleton(IPositronHoloViewsService, PositronHoloViewsService, InstantiationType.Delayed);

