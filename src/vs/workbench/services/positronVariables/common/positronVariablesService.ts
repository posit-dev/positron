/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { PositronVariablesInstance } from 'vs/workbench/services/positronVariables/common/positronVariablesInstance';
import { IPositronVariablesService } from 'vs/workbench/services/positronVariables/common/interfaces/positronVariablesService';
import { IPositronVariablesInstance, PositronVariablesInstanceState } from 'vs/workbench/services/positronVariables/common/interfaces/positronVariablesInstance';
import { LanguageRuntimeSessionMode, RuntimeState, formatLanguageRuntimeSession } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../runtimeSession/common/runtimeSessionService';
import { INotificationService } from 'vs/platform/notification/common/notification';

/**
 * PositronVariablesService class.
 */
class PositronVariablesService extends Disposable implements IPositronVariablesService {
	//#region Private Properties

	/**
	 * Gets a map of the Positron variables instances by session ID.
	 */
	private readonly _positronVariablesInstancesBySessionId =
		new Map<string, PositronVariablesInstance>();

	/**
	 * Gets or sets the active Positron variables instance.
	 */
	private _activePositronVariablesInstance?: IPositronVariablesInstance;

	/**
	 * The onDidStartPositronVariablesInstance event emitter.
	 */
	private readonly _onDidStartPositronVariablesInstanceEmitter =
		this._register(new Emitter<IPositronVariablesInstance>);

	/**
	 * The onDidChangeActivePositronVariablesInstance event emitter.
	 */
	private readonly _onDidChangeActivePositronVariablesInstanceEmitter =
		this._register(new Emitter<IPositronVariablesInstance | undefined>);

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param _runtimeSessionService The language runtime service.
	 * @param _languageService The language service.
	 * @param _logService The log service.
	 * @param _notificationService The notification service.
	 */
	constructor(
		@IRuntimeSessionService private _runtimeSessionService: IRuntimeSessionService,
		@ILanguageService _languageService: ILanguageService,
		@ILogService private _logService: ILogService,
		@INotificationService private _notificationService: INotificationService
	) {
		// Call the disposable constrcutor.
		super();

		// Start a Positron variables instance for each running runtime.
		this._runtimeSessionService.activeSessions.forEach(session => {
			this.startPositronVariablesInstance(session);
		});

		// Get the foreground session. If there is one, set the active Positron variables instance.
		if (this._runtimeSessionService.foregroundSession) {
			const positronVariablesInstance = this._positronVariablesInstancesBySessionId.get(
				this._runtimeSessionService.foregroundSession.sessionId
			);
			if (positronVariablesInstance) {
				this.setActivePositronVariablesInstance(positronVariablesInstance);
			}
		}

		// Register the onWillStartSession event handler so we start a new Positron variables
		// instance before a runtime starts up.
		this._register(this._runtimeSessionService.onWillStartSession(e => {
			this.createOrAssignPositronVariablesInstance(e.session);
		}));

		// Register the onDidStartRuntime event handler so we activate the new Positron variables
		// instance when the runtime starts up.
		this._register(this._runtimeSessionService.onDidStartRuntime(session => {
			const positronVariablesInstance = this._positronVariablesInstancesBySessionId.get(
				session.sessionId
			);
			if (positronVariablesInstance) {
				positronVariablesInstance.setState(PositronVariablesInstanceState.Ready);
			}
		}));

		// Register the onDidFailStartRuntime event handler.
		this._register(this._runtimeSessionService.onDidFailStartRuntime(session => {
			const positronVariablesInstance = this._positronVariablesInstancesBySessionId.get(
				session.sessionId
			);
			if (positronVariablesInstance) {
				positronVariablesInstance.setState(PositronVariablesInstanceState.Exited);
			}
		}));

		// Register the onDidReconnectRuntime event handler.
		this._register(this._runtimeSessionService.onDidReconnectRuntime(runtime => {
			this.createOrAssignPositronVariablesInstance(runtime);
		}));

		// Register the onDidChangeRuntimeState event handler.
		this._register(
			this._runtimeSessionService.onDidChangeRuntimeState(languageRuntimeStateEvent => {
				// Find the Positron variables instance.
				const positronVariablesInstance = this._positronVariablesInstancesBySessionId.get(
					languageRuntimeStateEvent.session_id
				);
				if (!positronVariablesInstance) {
					// TODO@softwarenerd... Handle this in some special way.
					return;
				}

				// Handle the state change.
				switch (languageRuntimeStateEvent.new_state) {
					case RuntimeState.Uninitialized:
					case RuntimeState.Initializing:
						break;

					case RuntimeState.Starting:
						positronVariablesInstance.setState(PositronVariablesInstanceState.Starting);
						break;

					case RuntimeState.Ready:
						positronVariablesInstance.setState(PositronVariablesInstanceState.Ready);
						break;

					case RuntimeState.Idle:
						positronVariablesInstance.setState(PositronVariablesInstanceState.Ready);
						break;

					case RuntimeState.Busy:
						positronVariablesInstance.setState(PositronVariablesInstanceState.Busy);
						break;

					case RuntimeState.Exiting:
						positronVariablesInstance.setState(PositronVariablesInstanceState.Exiting);
						break;

					case RuntimeState.Exited:
						positronVariablesInstance.setState(PositronVariablesInstanceState.Exited);
						break;

					case RuntimeState.Offline:
						positronVariablesInstance.setState(PositronVariablesInstanceState.Offline);
						break;

					case RuntimeState.Interrupting:
						break;
				}
			}));

		// Register the onDidChangeActiveRuntime event handler.
		this._register(this._runtimeSessionService.onDidChangeForegroundSession(session => {
			if (!session) {
				this.setActivePositronVariablesInstance();
			} else {
				const positronVariablesInstance = this._positronVariablesInstancesBySessionId.get(
					session.sessionId
				);
				if (positronVariablesInstance) {
					this.setActivePositronVariablesInstance(positronVariablesInstance);
				} else {
					this._logService.error(
						`Language runtime ${formatLanguageRuntimeSession(session)} became active, ` +
						`but a REPL instance for it is not running.`);
				}
			}
		}));
	}

	//#endregion Constructor & Dispose

	//#region IPositronVariablesService Implementation

	// Needed for service branding in dependency injector.
	declare readonly _serviceBrand: undefined;

	// An event that is fired when a REPL instance is started.
	readonly onDidStartPositronVariablesInstance =
		this._onDidStartPositronVariablesInstanceEmitter.event;

	// An event that is fired when the active REPL instance changes.
	readonly onDidChangeActivePositronVariablesInstance =
		this._onDidChangeActivePositronVariablesInstanceEmitter.event;

	// Gets the repl instances.
	get positronVariablesInstances(): IPositronVariablesInstance[] {
		return Array.from(this._positronVariablesInstancesBySessionId.values());
	}

	// Gets the active REPL instance.
	get activePositronVariablesInstance(): IPositronVariablesInstance | undefined {
		return this._activePositronVariablesInstance;
	}

	/**
	 * Sets the active variables instance to the one with the given session ID.
	 *
	 * @param sessionId The session ID.
	 */
	setActivePositronVariablesSession(sessionId: string): void {
		// Find the Positron variables instance associated with the session ID.
		const positronVariablesInstance =
			this._positronVariablesInstancesBySessionId.get(sessionId);
		if (positronVariablesInstance) {
			// Found it; make it active.
			this.setActivePositronVariablesInstance(positronVariablesInstance);
		} else {
			// Did not find it; log a warning.
			this._logService.warn(
				`Attempted to set the active Positron variables instance to a session ` +
				`(${sessionId}) that does not have a corresponding Positron variables instance.`);
		}
	}

	/**
	 * Placeholder that gets called to "initialize" the PositronVariablesService.
	 */
	initialize() {
	}

	//#endregion IPositronVariablesService Implementation

	//#region Private Methods

	/**
	 * Ensures that the given session has a corresponding Positron variables instance, either by
	 * attaching it to an existing Positron variables instance or by creating a new one. Has no
	 * effect if there's already a live Positron variables instance for the runtime.
	 * @param session The session to create or assign a Positron variables instance for.
	 */
	private createOrAssignPositronVariablesInstance(session: ILanguageRuntimeSession) {
		// Ignore background sessions
		if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Background) {
			return;
		}

		// Look for a matching Positron variables instance for this session
		const positronVariablesInstance = this._positronVariablesInstancesBySessionId.get(
			session.sessionId
		);

		if (positronVariablesInstance) {

			const state = positronVariablesInstance.state;
			if (state !== PositronVariablesInstanceState.Uninitialized &&
				state !== PositronVariablesInstanceState.Exited &&
				positronVariablesInstance.session.sessionId ===
				session.sessionId) {
				// We already have a live Positron variables instance for this session, so just
				// return.
				return;
			}

			if (state === PositronVariablesInstanceState.Exited) {
				// The Positron variables instance has exited, so attach it to this new session.
				positronVariablesInstance.setRuntime(session);
				this._positronVariablesInstancesBySessionId.delete(
					positronVariablesInstance.session.sessionId
				);
				this._positronVariablesInstancesBySessionId.set(
					positronVariablesInstance.session.sessionId,
					positronVariablesInstance
				);

				return;
			}
		}

		// If we got here, we need to start a new Positron variables instance.
		this.startPositronVariablesInstance(session);
	}

	/**
	 * Starts a Positron variables instance for the specified runtime.
	 * @param session The runtime session for the new Positron variables instance.
	 * @returns The new Positron variables instance.
	 */
	private startPositronVariablesInstance(session: ILanguageRuntimeSession): IPositronVariablesInstance {
		// Create the new Positron variables instance.
		const positronVariablesInstance = new PositronVariablesInstance(
			session, this._logService, this._notificationService);

		this._positronVariablesInstancesBySessionId.set(
			session.sessionId,
			positronVariablesInstance
		);

		// Fire the onDidStartPositronVariablesInstance event.
		this._onDidStartPositronVariablesInstanceEmitter.fire(positronVariablesInstance);

		// Set the active Positron variables instance.
		this._activePositronVariablesInstance = positronVariablesInstance;

		// Fire the onDidChangeActivePositronVariablesInstance event.
		this._onDidChangeActivePositronVariablesInstanceEmitter.fire(positronVariablesInstance);

		// Return the instance.
		return positronVariablesInstance;
	}

	/**
	 * Sets the active Positron variables instance.
	 * @param positronVariablesInstance The Positron variables instance.
	 */
	private setActivePositronVariablesInstance(
		positronVariablesInstance?: IPositronVariablesInstance
	) {
		// Set the active instance and fire the onDidChangeActivePositronVariablesInstance event.
		this._activePositronVariablesInstance = positronVariablesInstance;
		this._onDidChangeActivePositronVariablesInstanceEmitter.fire(positronVariablesInstance);
	}

	//#endregion Private Methods
}

// Register the Positron variables service.
registerSingleton(IPositronVariablesService, PositronVariablesService, InstantiationType.Delayed);
