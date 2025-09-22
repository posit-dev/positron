/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IWorkbenchEnvironmentService } from '../../environment/common/environmentService.js';
import { RuntimeClientState } from '../../languageRuntime/common/languageRuntimeClientInstance.js';
import { RuntimeState } from '../../languageRuntime/common/languageRuntimeService.js';
import { IUiClientMessageInput, IUiClientMessageOutput, UiClientInstance } from '../../languageRuntime/common/languageRuntimeUiClient.js';
import { UiFrontendEvent } from '../../languageRuntime/common/positronUiComm.js';
import { ILanguageRuntimeGlobalEvent, ILanguageRuntimeSession, ILanguageRuntimeSessionManager, RuntimeClientType } from './runtimeSessionService.js';

/**
 * Utility class for tracking the state and disposables associated with an
 * active language runtime session.
 */
export class ActiveRuntimeSession extends Disposable {

	public state: RuntimeState;

	public workingDirectory: string = '';

	private readonly _onDidReceiveRuntimeEventEmitter = this._register(new Emitter<ILanguageRuntimeGlobalEvent>());
	private readonly _onUiClientStartedEmitter = this._register(new Emitter<UiClientInstance>());

	/// The UI client instance, if it exists
	private _uiClient: UiClientInstance | undefined;

	/// Gets the UI client instance, if it has been started.
	get uiClient(): UiClientInstance | undefined {
		return this._uiClient;
	}

	/// The promise that resolves when the UI client is started.
	private _startingUiClient: DeferredPromise<string> | undefined;

	/**
	 * Create a new ActiveRuntimeSession.
	 *
	 * @param session The session
	 * @param manager The session's manager
	 */
	constructor(
		public session: ILanguageRuntimeSession,
		public manager: ILanguageRuntimeSessionManager,
		public hasConsole: boolean,
		private readonly _commandService: ICommandService,
		private readonly _logService: ILogService,
		private readonly _openerService: IOpenerService,
		private readonly _configurationService: IConfigurationService,
		private readonly _environmentService: IWorkbenchEnvironmentService
	) {
		super();

		// Get the initial state from the session.
		this.state = session.getRuntimeState();
	}

	/// An event that fires when a runtime receives a global event.
	readonly onDidReceiveRuntimeEvent = this._onDidReceiveRuntimeEventEmitter.event;

	/// Event that fires when the UI client has started. This allows other services
	/// to interact with the UI client, e.g. to send notifications or requests to
	/// backends.
	///
	/// Note that `UiClientInstance` is a disposable. You can attach
	/// resources to it (such as event handlers) via the `register()` method, these
	/// will be cleaned up when the UI client is torn down (e.g. after a
	/// disconnect).
	///
	/// Dev note: In the future the UI client will move to an extension-land middleware,
	/// see https://github.com/posit-dev/positron/issues/4997. Do not introduce
	/// dependencies that can't eventually be solved with regular events.
	readonly onUiClientStarted = this._onUiClientStartedEmitter.event;

	/**
	 * Register a disposable to be cleaned up when this object is disposed.
	 * @param disposable
	 */
	public register<T extends IDisposable>(disposable: T): T {
		return this._register(disposable);
	}

	/**
	 * Starts a UI client instance for the runtime session. The UI client
	 * instance is used for two-way communication of global state and events
	 * between the frontend and the backend.
	 *
	 * Resolves when the UI client instance is created, with the ID of the
	 * newly created comm.
	 */
	public async startUiClient(): Promise<string> {
		// If we already know the client ID, just return it.
		if (this._uiClient) {
			const clientState = this._uiClient.getClientState();
			if (clientState !== RuntimeClientState.Closed) {
				// This is an active client; we can use it
				return this._uiClient.getClientId();
			} else {
				// This is not an active client; forget it and start a new one.
				this._uiClient = undefined;
			}
		}

		// If we're already starting a UI comm client, return that promise.
		if (this._startingUiClient && !this._startingUiClient.isSettled) {
			return this._startingUiClient.p;
		}

		// Save and return a promise that resolves when the client has started.
		const promise = new DeferredPromise<string>();
		this._startingUiClient = promise;
		this.startUiClientImpl().then(clientId => {
			promise.complete(clientId);
		}).catch(err => {
			promise.error(err);
		});
		return this._startingUiClient.p;
	}

	/**
	 * Interior implementation of the UI client start method.
	 */
	private async startUiClientImpl(): Promise<string> {
		// Create the frontend client. The second argument is empty for now; we
		// could use this to pass in any initial state we want to pass to the
		// frontend client (such as information on window geometry, etc.)
		const client = await this.session.createClient<IUiClientMessageInput, IUiClientMessageOutput>
			(RuntimeClientType.Ui, {});

		// Create the UI client instance wrapping the client instance.
		const uiClient = new UiClientInstance(client, this._commandService, this._logService, this._openerService, this._configurationService,
			this._environmentService
		);
		this._uiClient = uiClient;
		this._register(this._uiClient);

		const sessionId = this.session.sessionId;

		// When the UI client instance emits an event, broadcast
		// it to Positron with the corresponding runtime ID.
		this._register(uiClient.onDidBusy(event => {
			this._onDidReceiveRuntimeEventEmitter.fire({
				session_id: sessionId,
				event: {
					name: UiFrontendEvent.Busy,
					data: event
				}
			});
		}));
		this._register(uiClient.onDidClearConsole(event => {
			this._onDidReceiveRuntimeEventEmitter.fire({
				session_id: sessionId,
				event: {
					name: UiFrontendEvent.ClearConsole,
					data: event
				}
			});
		}));
		this._register(uiClient.onDidSetEditorSelections(event => {
			this._onDidReceiveRuntimeEventEmitter.fire({
				session_id: sessionId,
				event: {
					name: UiFrontendEvent.SetEditorSelections,
					data: event
				}
			});
		}));
		this._register(uiClient.onDidOpenEditor(event => {
			this._onDidReceiveRuntimeEventEmitter.fire({
				session_id: sessionId,
				event: {
					name: UiFrontendEvent.OpenEditor,
					data: event
				}
			});
		}));
		this._register(uiClient.onDidOpenWorkspace(event => {
			this._onDidReceiveRuntimeEventEmitter.fire({
				session_id: sessionId,
				event: {
					name: UiFrontendEvent.OpenWorkspace,
					data: event
				}
			});
		}));
		this._register(uiClient.onDidShowMessage(event => {
			this._onDidReceiveRuntimeEventEmitter.fire({
				session_id: sessionId,
				event: {
					name: UiFrontendEvent.ShowMessage,
					data: event
				}
			});
		}));
		this._register(uiClient.onDidPromptState(event => {
			this._onDidReceiveRuntimeEventEmitter.fire({
				session_id: sessionId,
				event: {
					name: UiFrontendEvent.PromptState,
					data: event
				}
			});
		}));
		this._register(uiClient.onDidWorkingDirectory(event => {
			// Track the working directory
			this.workingDirectory = event.directory;
			this._onDidReceiveRuntimeEventEmitter.fire({
				session_id: sessionId,
				event: {
					name: UiFrontendEvent.WorkingDirectory,
					data: event
				}
			});
		}));
		this._register(uiClient.onDidShowUrl(event => {
			this._onDidReceiveRuntimeEventEmitter.fire({
				session_id: sessionId,
				event: {
					name: UiFrontendEvent.ShowUrl,
					data: event
				}
			});
		}));
		this._register(uiClient.onDidShowHtmlFile(event => {
			this._onDidReceiveRuntimeEventEmitter.fire({
				session_id: sessionId,
				event: {
					name: UiFrontendEvent.ShowHtmlFile,
					data: event
				}
			});
		}));
		this._register(uiClient.onDidOpenWithSystem(event => {
			this._onDidReceiveRuntimeEventEmitter.fire({
				session_id: sessionId,
				event: {
					name: UiFrontendEvent.OpenWithSystem,
					data: event
				}
			});
		}));
		this._register(uiClient.onDidClearWebviewPreloads(event => {
			this._onDidReceiveRuntimeEventEmitter.fire({
				session_id: sessionId,
				event: {
					name: UiFrontendEvent.ClearWebviewPreloads,
					data: event
				}
			});
		}));

		// Forward UI client to interested services
		this._onUiClientStartedEmitter.fire(uiClient);

		return client.getClientId();
	}
}
