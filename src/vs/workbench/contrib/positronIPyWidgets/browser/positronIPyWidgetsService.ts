/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { LanguageRuntimeSessionMode, RuntimeOutputKind, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { ILanguageRuntimeSession, IRuntimeClientInstance, IRuntimeSessionService, RuntimeClientType } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { Emitter, Event } from 'vs/base/common/event';
import { IPositronIPyWidgetsService } from 'vs/workbench/services/positronIPyWidgets/common/positronIPyWidgetsService';
import { INotebookEditorService } from 'vs/workbench/contrib/notebook/browser/services/notebookEditorService';
import { isEqual } from 'vs/base/common/resources';
import { ILogService } from 'vs/platform/log/common/log';
import { FromWebviewMessage, ICommOpenFromWebview, ToWebviewMessage } from '../../../services/languageRuntime/common/positronIPyWidgetsWebviewMessages';
import { IPositronNotebookOutputWebviewService } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService';
import { WebviewPlotClient } from 'vs/workbench/contrib/positronPlots/browser/webviewPlotClient';
import { IIPyWidgetsWebviewMessaging, IPyWidgetClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeIPyWidgetClient';
import { INotebookRendererMessagingService } from 'vs/workbench/contrib/notebook/common/notebookRendererMessagingService';

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
	private readonly _onDidCreatePlot = new Emitter<WebviewPlotClient>();

	/** Emitted when a new IPyWidgets webview plot is created. */
	onDidCreatePlot: Event<WebviewPlotClient> = this._onDidCreatePlot.event;

	/**
	 * @param _runtimeSessionService The runtime session service.
	 * @param _notebookEditorService The notebook editor service.
	 * @param _notebookRendererMessagingService The notebook renderer messaging service.
	 * @param _logService The log service.
	 */
	constructor(
		@IRuntimeSessionService private _runtimeSessionService: IRuntimeSessionService,
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

	private attachSession(session: ILanguageRuntimeSession) {
		switch (session.metadata.sessionMode) {
			case LanguageRuntimeSessionMode.Console:
				this.attachConsoleSession(session);
				break;
			case LanguageRuntimeSessionMode.Notebook:
				this.attachNotebookSession(session);
				break;
		}
	}

	private attachConsoleSession(session: ILanguageRuntimeSession) {
		const disposableStore = new DisposableStore();

		disposableStore.add(session.onDidReceiveRuntimeMessageOutput(async (message) => {
			// Only handle IPyWidget output messages.
			if (message.kind !== RuntimeOutputKind.IPyWidget) {
				return;
			}

			// Create a webview to display the widget.
			const webview = await this._notebookOutputWebviewService.createNotebookOutputWebview(
				session, message, 'jupyter-notebook');

			if (!webview) {
				throw new Error(`Could not create webview for IPyWidget message: ${JSON.stringify(message)}`);
			}

			// Create the ipywidgets instance.
			const ipywidgetsInstance = new IPyWidgetsInstance(
				session,
				webview.id,
				this._notebookRendererMessagingService,
				this._logService,
			);
			this._consoleInstancesByMessageId.set(message.id, ipywidgetsInstance);
			disposableStore.add(ipywidgetsInstance);

			// Unregister the instance when the session is disposed.
			disposableStore.add({
				dispose: () => {
					this._consoleInstancesByMessageId.delete(message.id);
				}
			});

			// TODO: We probably need to dispose in more cases...

			// Fire the onDidCreatePlot event.
			const client = new WebviewPlotClient(webview, message);
			this._onDidCreatePlot.fire(client);
		}));

		// Dispose when the session ends.
		disposableStore.add(session.onDidEndSession((e) => {
			disposableStore.dispose();
		}));
	}

	private attachNotebookSession(session: ILanguageRuntimeSession) {
		// Find the session's notebook editor by its notebook URI.
		const notebookEditor = this._notebookEditorService.listNotebookEditors().find(
			(editor) => isEqual(session.metadata.notebookUri, editor.textModel?.uri));

		if (!notebookEditor) {
			this._logService.error(`Could not find a notebook editor for session '${session.sessionId}'`);
			return;
		}

		this._logService.debug(`Found an existing notebook editor for session '${session.sessionId}, starting ipywidgets instance`);

		const disposableStore = new DisposableStore();

		// We found a matching notebook editor, create an ipywidgets instance.
		const ipywidgetsInstance = new IPyWidgetsInstance(
			session,
			notebookEditor.getId(),
			this._notebookRendererMessagingService,
			this._logService,
		);
		this._notebookInstancesBySessionId.set(session.sessionId, ipywidgetsInstance);
		disposableStore.add(ipywidgetsInstance);

		// Unregister the instance when the session is disposed.
		disposableStore.add({
			dispose: () => {
				this._notebookInstancesBySessionId.delete(session.sessionId);
			},
		});

		// Dispose when the notebook text model changes.
		disposableStore.add(notebookEditor.onDidChangeModel((e) => {
			if (isEqual(session.metadata.notebookUri, e?.uri)) {
				return;
			}
			this._logService.debug(`Editor model changed for session '${session.sessionId}, disposing ipywidgets instance`);
			disposableStore.dispose();
		}));

		// Dispose when the notebook editor is removed.
		disposableStore.add(this._notebookEditorService.onDidRemoveNotebookEditor((e) => {
			if (e !== notebookEditor) {
				return;
			}
			this._logService.debug(`Notebook editor removed for session '${session.sessionId}, disposing ipywidgets instance`);
			disposableStore.dispose();
		}));

		// Dispose when the session ends.
		disposableStore.add(session.onDidEndSession((e) => {
			disposableStore.dispose();
		}));
	}

	/**
	 * Placeholder for service initialization.
	 */
	initialize() {
	}
}

class IPyWidgetsInstance extends Disposable {

	/** Map of IPyWidget runtime clients (aka comms), keyed by client ID. */
	private readonly _clients = new Map<string, IPyWidgetClientInstance>();

	/** The IPyWidgets webview messaging interface. */
	private readonly _messaging: IIPyWidgetsWebviewMessaging;

	/**
	 * @param session The language runtime session.
	 * @param editorId The editor ID for which the IPyWidgets instance is created.
	 * @param _notebookRendererMessagingService The notebook renderer messaging service.
	 * @param _logService The log service.
	 */
	constructor(
		private readonly _session: ILanguageRuntimeSession,
		editorId: string,
		notebookRendererMessagingService: INotebookRendererMessagingService,
		private readonly _logService: ILogService,
	) {
		super();

		// Create the IPyWidgets webview messaging interface.
		this._messaging = new IPyWidgetsWebviewMessaging(editorId, notebookRendererMessagingService);

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
		const ipywidgetsClient = new IPyWidgetClientInstance(
			client,
			this._messaging,
			this._logService,
			rpcMethods,
		);
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
}

/**
 * IPyWidgetsWebviewMessaging is used to communicate with an IPyWidgets renderer.
 */
class IPyWidgetsWebviewMessaging extends Disposable implements IIPyWidgetsWebviewMessaging {
	/** The renderer ID for which messages are scoped. */
	private readonly _rendererId = 'positron-ipywidgets';

	private readonly _messageEmitter = new Emitter<FromWebviewMessage>();

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
	postMessage(message: ToWebviewMessage) {
		this._notebookRendererMessagingService.receiveMessage(
			this._editorId, this._rendererId, message
		);
	}
}
