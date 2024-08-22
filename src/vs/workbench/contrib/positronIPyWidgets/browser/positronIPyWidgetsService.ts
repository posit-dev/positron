/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { Disposable, DisposableStore, toDisposable } from 'vs/base/common/lifecycle';
import { ILanguageRuntimeMessageOutput, LanguageRuntimeSessionMode, RuntimeOutputKind, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { ILanguageRuntimeSession, IRuntimeClientInstance, IRuntimeSessionService, RuntimeClientType } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { Emitter, Event } from 'vs/base/common/event';
import { IPositronIPyWidgetsService } from 'vs/workbench/services/positronIPyWidgets/common/positronIPyWidgetsService';
import { INotebookEditorService } from 'vs/workbench/contrib/notebook/browser/services/notebookEditorService';
import { isEqual } from 'vs/base/common/resources';
import { ILogService } from 'vs/platform/log/common/log';
import { FromWebviewMessage, ICommOpenFromWebview, IGetPreferredRendererFromWebview, ToWebviewMessage } from '../../../services/languageRuntime/common/positronIPyWidgetsWebviewMessages';
import { IPositronNotebookOutputWebviewService } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService';
import { IIPyWidgetsWebviewMessaging, IPyWidgetClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeIPyWidgetClient';
import { INotebookRendererMessagingService } from 'vs/workbench/contrib/notebook/common/notebookRendererMessagingService';
import { NotebookOutputPlotClient } from 'vs/workbench/contrib/positronPlots/browser/notebookOutputPlotClient';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';

/**
 * The PositronIPyWidgetsService is responsible for managing IPyWidgetsInstances.
 */
export class PositronIPyWidgetsService extends Disposable implements IPositronIPyWidgetsService {
	/** Needed for service branding in dependency injector. */
	declare readonly _serviceBrand: undefined;

	/** Map of notebook IPyWidgetsInstances keyed by notebook session ID. */
	private readonly _notebookInstancesBySessionId = new Map<string, IPyWidgetsInstance>();

	/** Map of console IPyWidgetsInstances keyed by the language runtime output message ID that initiated the instance. */
	private readonly _consoleInstancesByMessageId = new Map<string, IPyWidgetsInstance>();

	/** The emitter for the onDidCreatePlot event */
	private readonly _onDidCreatePlot = this._register(new Emitter<NotebookOutputPlotClient>());

	/** Emitted when a new IPyWidgets webview plot is created. */
	onDidCreatePlot: Event<NotebookOutputPlotClient> = this._onDidCreatePlot.event;

	/**
	 * @param _runtimeSessionService The runtime session service.
	 * @param _notebookService The notebook service.
	 * @param _notebookEditorService The notebook editor service.
	 * @param _notebookRendererMessagingService The notebook renderer messaging service.
	 * @param _logService The log service.
	 */
	constructor(
		@IRuntimeSessionService private _runtimeSessionService: IRuntimeSessionService,
		@INotebookService private _notebookService: INotebookService,
		@INotebookEditorService private _notebookEditorService: INotebookEditorService,
		@INotebookRendererMessagingService private _notebookRendererMessagingService: INotebookRendererMessagingService,
		@IPositronNotebookOutputWebviewService private _notebookOutputWebviewService: IPositronNotebookOutputWebviewService,
		@ILogService private _logService: ILogService,
	) {
		super();

		// Attach to existing sessions.
		this._runtimeSessionService.activeSessions.forEach(session => {
			this.attachSession(session);
		});

		// Attach to new sessions.
		this._register(this._runtimeSessionService.onWillStartSession((event) => {
			this.attachSession(event.session);
		}));
	}

	override dispose(): void {
		super.dispose();
		// Clean up disposables linked to any connected sessions
		this._sessionToDisposablesMap.forEach(disposables => disposables.dispose());
	}

	hasInstance(id: string): boolean {
		return this._notebookInstancesBySessionId.has(id) ||
			this._consoleInstancesByMessageId.has(id);
	}

	/**
	 * Map to disposeable stores for each session. Used to preventing memory leaks caused by
	 * repeatedly attaching to the same session which can happen in the case of the application
	 * closing before the session ends
	 */
	private _sessionToDisposablesMap = new Map<string, DisposableStore>();

	private attachSession(session: ILanguageRuntimeSession) {
		// Check if we're already attached here
		const existingSessionDisposables = this._sessionToDisposablesMap.get(session.sessionId);
		if (existingSessionDisposables && !existingSessionDisposables.isDisposed) {
			this._logService.warn(`Already attached to session, disposing existing listeners before reattaching: ${session.metadata.sessionId}`);
			existingSessionDisposables.dispose();
		}
		const disposables = new DisposableStore();
		this._sessionToDisposablesMap.set(session.sessionId, disposables);
		// Cleanup from map when disposed.
		disposables.add(toDisposable(() => this._sessionToDisposablesMap.delete(session.sessionId)));

		switch (session.metadata.sessionMode) {
			case LanguageRuntimeSessionMode.Console:
				this.attachConsoleSession(session, disposables);
				break;
			case LanguageRuntimeSessionMode.Notebook:
				this.attachNotebookSession(session, disposables);
				break;
			default:
				this._logService.error(`Unexpected session mode: ${session.metadata.sessionMode}`);
				disposables.dispose();
		}
	}

	private attachConsoleSession(session: ILanguageRuntimeSession, disposables: DisposableStore) {
		const handleMessageOutput = async (message: ILanguageRuntimeMessageOutput) => {
			// Only handle IPyWidget output messages.
			if (message.kind !== RuntimeOutputKind.IPyWidget) {
				return;
			}

			// Create the plot client.
			const client = disposables.add(new NotebookOutputPlotClient(
				this._notebookOutputWebviewService, session, message
			));

			// Create the ipywidgets instance.
			const messaging = disposables.add(new IPyWidgetsWebviewMessaging(
				client.id, this._notebookRendererMessagingService
			));
			const ipywidgetsInstance = disposables.add(
				new IPyWidgetsInstance(session, messaging, this._notebookService, this._logService)
			);
			this._consoleInstancesByMessageId.set(message.id, ipywidgetsInstance);

			// Unregister the instance when the session is disposed.
			disposables.add(toDisposable(() => {
				this._consoleInstancesByMessageId.delete(message.id);
			}));

			// TODO: We probably need to dispose in more cases...

			// Fire the onDidCreatePlot event.
			this._onDidCreatePlot.fire(client);
		};

		disposables.add(session.onDidReceiveRuntimeMessageResult(handleMessageOutput));
		disposables.add(session.onDidReceiveRuntimeMessageOutput(handleMessageOutput));

		// Dispose when the session ends.
		disposables.add(session.onDidEndSession((e) => {
			disposables.dispose();
		}));
	}

	private attachNotebookSession(session: ILanguageRuntimeSession, disposables: DisposableStore) {
		// Find the session's notebook editor by its notebook URI.
		const notebookEditor = this._notebookEditorService.listNotebookEditors().find(
			(editor) => isEqual(session.metadata.notebookUri, editor.textModel?.uri));

		if (!notebookEditor) {
			this._logService.error(`Could not find a notebook editor for session '${session.sessionId}'`);
			return;
		}

		this._logService.debug(`Found an existing notebook editor for session '${session.sessionId}, starting ipywidgets instance`);

		// We found a matching notebook editor, create an ipywidgets instance.
		const messaging = disposables.add(new IPyWidgetsWebviewMessaging(
			notebookEditor.getId(), this._notebookRendererMessagingService
		));
		const ipywidgetsInstance = disposables.add(new IPyWidgetsInstance(
			session, messaging, this._notebookService, this._logService
		));
		this._notebookInstancesBySessionId.set(session.sessionId, ipywidgetsInstance);

		// Unregister the instance when the session is disposed.
		disposables.add(toDisposable(() => {
			this._notebookInstancesBySessionId.delete(session.sessionId);
		}));

		// Dispose when the notebook text model changes.
		disposables.add(notebookEditor.onDidChangeModel((e) => {
			if (isEqual(session.metadata.notebookUri, e?.uri)) {
				return;
			}
			this._logService.debug(`Editor model changed for session '${session.sessionId}, disposing ipywidgets instance`);
			disposables.dispose();
		}));

		// Dispose when the notebook editor is removed.
		disposables.add(this._notebookEditorService.onDidRemoveNotebookEditor((e) => {
			if (e !== notebookEditor) {
				return;
			}
			this._logService.debug(`Notebook editor removed for session '${session.sessionId}, disposing ipywidgets instance`);
			disposables.dispose();
		}));

		// Dispose when the session ends.
		disposables.add(session.onDidEndSession((e) => {
			disposables.dispose();
		}));
	}

	/**
	 * Placeholder for service initialization.
	 */
	initialize() {
	}
}

export class IPyWidgetsInstance extends Disposable {

	/** Map of IPyWidget runtime clients (aka comms), keyed by client ID. */
	private readonly _clients = new Map<string, IPyWidgetClientInstance>();

	/**
	 * @param _session The language runtime session.
	 * @param _messaging The IPyWidgets webview messaging interface.
	 * @param _notebookService The notebook service.
	 * @param _logService The log service.
	 */
	constructor(
		private readonly _session: ILanguageRuntimeSession,
		private readonly _messaging: IIPyWidgetsWebviewMessaging,
		private readonly _notebookService: INotebookService,
		private readonly _logService: ILogService,
	) {
		super();

		// Configure existing widget clients.
		if (_session.getRuntimeState() !== RuntimeState.Uninitialized) {
			_session.listClients(RuntimeClientType.IPyWidget).then((clients) => {
				for (const client of clients) {
					this.createClient(client);
				}
			});
		}

		// Forward comm_open messages from the runtime to the webview.
		this._register(_session.onDidCreateClientInstance(({ client, message }) => {
			// Only handle IPyWidget clients.
			if (client.getClientType() !== RuntimeClientType.IPyWidget &&
				client.getClientType() !== RuntimeClientType.IPyWidgetControl) {
				return;
			}

			// Create and register the client.
			this.createClient(client);

			// Notify the webview about the new client instance.
			this._messaging.postMessage({
				type: 'comm_open',
				comm_id: client.getClientId(),
				target_name: client.getClientType(),
				data: message.data,
				metadata: message.metadata,
			});
		}));

		// Handle messages from the webview.
		this._register(this._messaging.onDidReceiveMessage(async (message) => {
			switch (message.type) {
				case 'initialize_request': {
					await this.sendInitializeResultToWebview();
					break;
				}
				case 'comm_open':
					this.handleCommOpenFromWebview(message);
					break;
				case 'get_preferred_renderer':
					this.handleGetPreferredRendererFromWebview(message);
					break;
			}
		}));

		// Notify the webview that we're ready - in case we initialized after the webview.
		// Otherwise, we'll reply to its initialize_request message.
		this.sendInitializeResultToWebview().catch((e) => {
			this._logService.error(`Error sending ready message to webview: ${e.message}`);
		});
	}

	private createClient(client: IRuntimeClientInstance<any, any>) {
		// Determine the list of RPC methods by client type.
		let rpcMethods: string[];
		switch (client.getClientType()) {
			case RuntimeClientType.IPyWidget:
				rpcMethods = ['update'];
				break;
			case RuntimeClientType.IPyWidgetControl:
				rpcMethods = ['request_states'];
				break;
			default:
				throw new Error(`Unexpected client type: ${client.getClientType()}`);
		}

		// Create the IPyWidget client.
		const ipywidgetsClient = this._register(new IPyWidgetClientInstance(
			client,
			this._messaging,
			this._logService,
			rpcMethods,
		));
		this._clients.set(client.getClientId(), ipywidgetsClient);

		// Unregister the client when it is closed.
		this._register(ipywidgetsClient.onDidClose(() => {
			this._clients.delete(client.getClientId());
		}));
	}

	private async sendInitializeResultToWebview() {
		this._messaging.postMessage({ type: 'initialize_result' });
	}

	private async handleCommOpenFromWebview(message: ICommOpenFromWebview) {
		// Only handle IPyWidget control clients.
		if (message.target_name !== RuntimeClientType.IPyWidgetControl) {
			return;
		}

		// Create the client.
		const client = await this._session.createClient(
			RuntimeClientType.IPyWidgetControl, message.data, message.metadata, message.comm_id);
		this.createClient(client);
	}

	private handleGetPreferredRendererFromWebview(message: IGetPreferredRendererFromWebview) {
		// TODO: Better way to handle this?
		const mimeType = message.mime_type === 'application/vnd.jupyter.stdout' ?
			'application/vnd.code.notebook.stdout' : message.mime_type;

		let rendererId: string | undefined;
		try {
			const renderer = this._notebookService.getPreferredRenderer(mimeType);
			rendererId = renderer?.id;
		} catch {
			this._logService.error(`Error while getting preferred renderer for mime type: ${message.mime_type}`);
		}

		this._messaging.postMessage({
			type: 'get_preferred_renderer_result',
			parent_id: message.msg_id,
			renderer_id: rendererId,
		});
	}

	hasClient(clientId: string) {
		return this._clients.has(clientId);
	}
}

/**
 * IPyWidgetsWebviewMessaging is used to communicate with an IPyWidgets renderer.
 */
class IPyWidgetsWebviewMessaging extends Disposable implements IIPyWidgetsWebviewMessaging {
	/** The renderer ID for which messages are scoped. */
	private readonly _rendererId = 'positron-ipywidgets';

	private readonly _messageEmitter = this._register(new Emitter<FromWebviewMessage>());

	/** Emitted when a message is received from the renderer. */
	onDidReceiveMessage = this._messageEmitter.event;

	/**
	 * @param _editorId The editor ID for which renderer messages are scoped.
	 * @param _notebookRendererMessagingService The notebook renderer messaging service.
	 */
	constructor(
		private readonly _editorId: string,
		private readonly _notebookRendererMessagingService: INotebookRendererMessagingService,
	) {
		super();

		// Emit messages from the renderer.
		this._register(_notebookRendererMessagingService.onShouldPostMessage(event => {
			if (event.editorId !== this._editorId || event.rendererId !== this._rendererId) {
				return;
			}
			this._messageEmitter.fire(event.message as FromWebviewMessage);
		}));
	}

	/**
	 * Send a message from the editor to the renderer.
	 *
	 * @param message The message.
	 */
	postMessage(message: ToWebviewMessage): Promise<boolean> {
		return this._notebookRendererMessagingService.receiveMessage(
			this._editorId, this._rendererId, message
		);
	}
}
