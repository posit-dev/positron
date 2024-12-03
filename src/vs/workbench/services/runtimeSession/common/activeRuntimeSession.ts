/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise } from 'vs/base/common/async';
import { Emitter } from 'vs/base/common/event';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ILogService } from 'vs/platform/log/common/log';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { RuntimeClientState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';
import { RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IUiClientMessageInput, IUiClientMessageOutput, UiClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeUiClient';
import { UiFrontendEvent } from 'vs/workbench/services/languageRuntime/common/positronUiComm';
import { ILanguageRuntimeGlobalEvent, ILanguageRuntimeSession, ILanguageRuntimeSessionManager, RuntimeClientType } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';

/**
 * Utility class for tracking state changes in a language runtime session.
 *
 * We keep our own copy of the state so we can fire an event with both the old
 * and new state values when the state changes.
 */
export class ActiveRuntimeSession extends Disposable {
	public state: RuntimeState;

	// The event emitter for the onDidReceiveRuntimeEvent event.
	private readonly _onDidReceiveRuntimeEventEmitter =
		this._register(new Emitter<ILanguageRuntimeGlobalEvent>());

	/// The UI client instance, if it exists
	private _uiClient: UiClientInstance | undefined;

	private _startingUiClient: DeferredPromise<string> | undefined;

	/**
	 * Create a new LanguageRuntimeSessionInfo.
	 *
	 * @param session The session
	 * @param manager The session's manager
	 */
	constructor(
		public session: ILanguageRuntimeSession,
		public manager: ILanguageRuntimeSessionManager,
		private readonly _commandService: ICommandService,
		private readonly _logService: ILogService,
		private readonly _openerService: IOpenerService,
		private readonly _configurationService: IConfigurationService
	) {
		super();
		this.state = session.getRuntimeState();
	}

	/// An event that fires when a runtime receives a global event.
	readonly onDidReceiveRuntimeEvent = this._onDidReceiveRuntimeEventEmitter.event;

	/**
	 * Register a disposable to be cleaned up when this object is disposed.
	 * @param disposable
	 */
	public register(disposable: IDisposable): void {
		this._register(disposable);
	}

	/**
	 * Starts a UI client instance for the specified runtime session. The
	 * UI client instance is used for two-way communication of
	 * global state and events between the frontend and the backend.
	 *
	 * Resolves when the UI client instance is created, with the ID of the
	 * newly created comm.
	 */
	public async startUiClient(): Promise<string> {
		// If we already know the client ID, just return it.
		if (this._uiClient) {
			const clientState = this._uiClient.getClientState();
			if (clientState === RuntimeClientState.Connected ||
				clientState === RuntimeClientState.Opening) {
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
		const uiClient = new UiClientInstance(client, this._commandService, this._logService, this._openerService, this._configurationService);
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
		this._register(uiClient.onDidClearWebviewPreloads(event => {
			this._onDidReceiveRuntimeEventEmitter.fire({
				session_id: sessionId,
				event: {
					name: UiFrontendEvent.ClearWebviewPreloads,
					data: event
				}
			});
		}));

		return client.getClientId();
	}
}
