/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableMap } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { PositronVariablesInstance } from './positronVariablesInstance.js';
import { IPositronVariablesService } from './interfaces/positronVariablesService.js';
import { IPositronVariablesInstance } from './interfaces/positronVariablesInstance.js';
import { LanguageRuntimeSessionMode, RuntimeState } from '../../languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../runtimeSession/common/runtimeSessionService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { RuntimeClientState } from '../../languageRuntime/common/languageRuntimeClientInstance.js';
import { isEqual } from '../../../../base/common/resources.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';
import { IEditorService } from '../../editor/common/editorService.js';
import { NotebookEditorInput } from '../../../contrib/notebook/common/notebookEditorInput.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IPositronConsoleService } from '../../positronConsole/browser/interfaces/positronConsoleService.js';
import { PositronNotebookEditorInput } from '../../../contrib/positronNotebook/browser/PositronNotebookEditorInput.js';
import { IRuntimeNotebookKernelService } from '../../../contrib/runtimeNotebookKernel/common/interfaces/runtimeNotebookKernelService.js';
import { ILanguageRuntimeCodeExecutedEvent } from '../../positronConsole/common/positronConsoleCodeExecution.js';

/**
 * PositronVariablesService class.
 */
export class PositronVariablesService extends Disposable implements IPositronVariablesService {
	//#region Private Properties

	/**
	 * Gets a map of the Positron variables instances by session ID.
	 */
	private readonly _positronVariablesInstancesBySessionId =
		this._register(new DisposableMap<string, PositronVariablesInstance>());

	/**
	 * Gets or sets the active Positron variables instance.
	 */
	private _activePositronVariablesInstance?: IPositronVariablesInstance;

	/**
	 * Whether the Variables pane is currently visible.
	 * When false, no instances should be created or maintained.
	 */
	private _viewVisible = false;

	/**
	 * The onDidStartPositronVariablesInstance event emitter.
	 */
	private readonly _onDidStartPositronVariablesInstanceEmitter =
		this._register(new Emitter<IPositronVariablesInstance>);

	/**
	 * The onDidStopPositronVariablesInstance event emitter.
	 */
	private readonly _onDidStopPositronVariablesInstanceEmitter =
		this._register(new Emitter<IPositronVariablesInstance>());

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
	 * @param _runtimeNotebookKernelService The runtime notebook kernel service.
	 * @param _logService The log service.
	 * @param _notificationService The notification service.
	 * @param _accessibilityService The accessibility service.
	 * @param _editorService The editor service.
	 * @param _configurationService The configuration service.
	 */
	constructor(
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IRuntimeNotebookKernelService private readonly _runtimeNotebookKernelService: IRuntimeNotebookKernelService,
		@ILogService private readonly _logService: ILogService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IAccessibilityService private readonly _accessibilityService: IAccessibilityService,
		@IEditorService private readonly _editorService: IEditorService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IPositronConsoleService private readonly _positronConsoleService: IPositronConsoleService
	) {
		// Call the disposable constructor.
		super();

		// Register the onWillStartSession event handler so we start a new Positron variables
		// instance before a runtime starts up (only if the view is visible).
		this._register(this._runtimeSessionService.onWillStartSession(e => {
			this.createOrAssignPositronVariablesInstance(e.session, e.activate);
		}));

		// Register session cleanup handler
		this._register(this._runtimeSessionService.onDidChangeRuntimeState(e => {
			if (e.new_state === RuntimeState.Exited) {
				this.cleanupSession(e.session_id);
			}
		}));

		// Register the onDidChangeActiveRuntime event handler.
		this._register(this._runtimeSessionService.onDidChangeForegroundSession(session => {
			this._setActivePositronVariablesBySession(session?.sessionId);
		}));

		// Listen for notebook URI updates from session remapping
		// When a notebook changes URI (during save), the variables view needs to update its UI.
		// This maintains a consistent user experience by showing the correct file path in the variables view
		// The event-based approach allows loose coupling between the session service and variables service
		// which if we directly called the variables session method it would cause a circular dependency.
		this._register(this._runtimeSessionService.onDidUpdateNotebookSessionUri(e => {
			// Respond to URI changes by setting the appropriate session as active in the variables view
			// This ensures that the variables view context stays consistent with the file system
			this._logService.debug(`Setting active variables session for notebook URI update: ${e.sessionId}`);
			this.setActivePositronVariablesSession(e.sessionId);
		}));

		// Listen for console code execution events
		this._register(this._positronConsoleService.onDidExecuteCode(e => {
			this._watchForCodeExecution(e);
		}));

		// List for notebook code execution events
		this._register(this._runtimeNotebookKernelService.onDidExecuteCode(e => {
			this._watchForCodeExecution(e);
		}));

		// Listen for editor changes
		this._register(this._editorService.onDidActiveEditorChange(() => {
			this._syncToActiveEditor();
		}));
	}

	//#endregion Constructor & Dispose

	//#region IPositronVariablesService Implementation

	// Needed for service branding in dependency injector.
	declare readonly _serviceBrand: undefined;

	// An event that is fired when a REPL instance is started.
	readonly onDidStartPositronVariablesInstance =
		this._onDidStartPositronVariablesInstanceEmitter.event;

	// An event that is fired when a REPL instance is stopped.
	readonly onDidStopPositronVariablesInstance =
		this._onDidStopPositronVariablesInstanceEmitter.event;

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
			this._setActivePositronVariablesInstance(positronVariablesInstance);
		} else {
			// Did not find it; log a warning.
			this._logService.warn(
				`Attempted to set the active Positron variables instance to a session ` +
				`(${sessionId}) that does not have a corresponding Positron variables instance.`);
		}
	}

	/**
	 * Sets whether the Variables pane is visible.
	 * When the pane becomes hidden, all instances are disposed.
	 * When the pane becomes visible, instances are created for all active sessions.
	 *
	 * @param visible Whether the Variables pane is visible.
	 */
	setViewVisible(visible: boolean): void {
		// No-op if visibility hasn't changed
		if (this._viewVisible === visible) {
			return;
		}

		this._viewVisible = visible;

		if (!visible) {
			// Dispose all instances when the view is hidden
			this._disposeAllInstances();
		} else {
			// Create instances for all active sessions
			const activeSessions = this._runtimeSessionService.activeSessions;
			const foregroundSession = this._runtimeSessionService.foregroundSession;

			// Create instances for all sessions, activating only the foreground one
			for (const session of activeSessions) {
				const isActivate = foregroundSession?.sessionId === session.sessionId;
				this.createOrAssignPositronVariablesInstance(session, isActivate);
			}

			// If we have a foreground session, ensure its instance is populated
			if (foregroundSession) {
				const activeInstance = this._positronVariablesInstancesBySessionId.get(
					foregroundSession.sessionId
				);
				if (activeInstance) {
					// Set as active (this will trigger a refresh)
					this._setActivePositronVariablesInstance(activeInstance);
				}
			}

			// Sync to the active editor to handle notebook scenarios
			this._syncToActiveEditor();
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
	 * Cleans up resources associated with a session.
	 * @param session The session to clean up.
	 */
	private cleanupSession(sessionId: string): void {
		const instance = this._positronVariablesInstancesBySessionId.get(sessionId);
		if (instance) {
			// If this was the active instance, clear it
			if (this._activePositronVariablesInstance === instance) {
				this._setActivePositronVariablesInstance(undefined);
			}

			// Dispose the instance and remove it from our map
			this._positronVariablesInstancesBySessionId.deleteAndDispose(sessionId);
			this._onDidStopPositronVariablesInstanceEmitter.fire(instance);
		}
	}

	/**
	 * Disposes all variables instances.
	 * Called when the Variables pane is hidden.
	 */
	private _disposeAllInstances(): void {
		// Clear the active instance first
		this._setActivePositronVariablesInstance(undefined);

		// Fire stop events for all instances before disposing
		for (const instance of this._positronVariablesInstancesBySessionId.values()) {
			this._onDidStopPositronVariablesInstanceEmitter.fire(instance);
		}

		// Clear and dispose all instances
		this._positronVariablesInstancesBySessionId.clearAndDisposeAll();
	}

	/**
	 * Gets whether the follow mode is enabled.
	 * @returns Whether the follow mode is enabled.
	 */
	private get _inFollowMode(): boolean {
		return this._configurationService.getValue('positron.variables.followMode');
	}

	/**
	 * Syncs the active variables instance to the active editor.
	 * This is called when the active editor changes or the service is initialized.
	 */
	private _syncToActiveEditor() {
		// Check for feature flag for session following editor being on before proceeding
		if (!this._inFollowMode) {
			return;
		}

		const editorInput = this._editorService.activeEditor;
		if (editorInput instanceof NotebookEditorInput || editorInput instanceof PositronNotebookEditorInput) {
			// If this is a notebook editor try and set the active variables session to the one
			// that corresponds with it.
			const notebookSession = this._runtimeSessionService.activeSessions.find(
				s => s.metadata.notebookUri && isEqual(s.metadata.notebookUri, editorInput.resource)
			);
			// If the editor is not for a jupyter notebook, just leave variables session as is.
			if (!notebookSession) { return; }
			this._setActivePositronVariablesBySession(notebookSession.sessionId);
		} else if (this._runtimeSessionService.foregroundSession) {
			// Revert to the most recent console session if we're not in a notebook editor
			this._setActivePositronVariablesBySession(
				this._runtimeSessionService.foregroundSession.sessionId);
		} else {
			// All else fails, just reset to the default
			this._setActivePositronVariablesInstance();
		}
	}

	/**
	 * Handles code execution by updating the active variables if follow mode is enabled.
	 * @param event The code executed event
	 */
	private _watchForCodeExecution(event: ILanguageRuntimeCodeExecutedEvent): void {
		// Check for feature flag for session following editor being on before proceeding
		if (!this._inFollowMode) {
			return;
		}
		this._setActivePositronVariablesBySession(event.sessionId);
	}

	/**
	 * Creates or assigns a Positron variables instance for the specified session.
	 *
	 * @param session The session to create or assign a Positron variables
	 * instance for.
	 * @param activate Whether to activate the Positron variables instance
	 * after creating it.
	 */
	private createOrAssignPositronVariablesInstance(
		session: ILanguageRuntimeSession,
		activate: boolean) {

		// Don't create instances if the view is not visible
		if (!this._viewVisible) {
			return;
		}

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
			if (state === RuntimeClientState.Closed || state === RuntimeClientState.Uninitialized) {
				// The Positron variables instance has exited, so attach it to
				// this session instance. (This is most likely a restart of
				// the runtime session.)
				positronVariablesInstance.setRuntimeSession(session);
			}
			// The Positron variables instance is still running,
			// so we don't need to do anything else.
			return;
		}

		// Reuse variable instances for notebook sessions ONLY instead of creating new ones
		// by finding old instances for the same runtime ID and notebook URI.
		if (session.metadata.notebookUri) {
			const allInstances = Array.from(this._positronVariablesInstancesBySessionId.values());
			const existingInstance = allInstances.find(variableInstance => {
				// Check the runtime ID and notebook URI for a match.
				return variableInstance.session.runtimeMetadata.runtimeId ===
					session.runtimeMetadata.runtimeId &&
					isEqual(variableInstance.session.metadata.notebookUri, session.metadata.notebookUri);
			});

			if (existingInstance) {
				// Clean up the old session ID mapping
				this._positronVariablesInstancesBySessionId.deleteAndDispose(
					existingInstance.session.sessionId
				);

				// Update the map of Positron variables instances by session ID.
				this._positronVariablesInstancesBySessionId.set(
					session.sessionId,
					existingInstance
				);

				// Attach the new session to the existing instance.
				existingInstance.setRuntimeSession(session);
				return;
			}
		}

		// If we got here, we need to start a new Positron variables instance.
		this.startPositronVariablesInstance(session, activate);
	}

	/**
	 * Starts a Positron variables instance for the specified runtime.
	 *
	 * @param session The runtime session for the new Positron variables instance.
	 * @param activate Whether to activate the Positron variables instance after creating it.
	 *
	 * @returns The new Positron variables instance.
	 */
	private startPositronVariablesInstance(
		session: ILanguageRuntimeSession,
		activate: boolean): IPositronVariablesInstance {
		// Create the new Positron variables instance.
		const positronVariablesInstance = this._register(new PositronVariablesInstance(
			session, this._logService, this._notificationService, this._accessibilityService));

		this._positronVariablesInstancesBySessionId.set(
			session.sessionId,
			positronVariablesInstance
		);

		// Fire the onDidStartPositronVariablesInstance event.
		this._onDidStartPositronVariablesInstanceEmitter.fire(positronVariablesInstance);

		if (activate) {
			// Set the active Positron variables instance.
			this._activePositronVariablesInstance = positronVariablesInstance;

			// Fire the onDidChangeActivePositronVariablesInstance event.
			this._onDidChangeActivePositronVariablesInstanceEmitter.fire(positronVariablesInstance);
		}

		// Return the instance.
		return positronVariablesInstance;
	}

	/**
	 * Sets the active Positron variables instance.
	 * @param positronVariablesInstance The Positron variables instance.
	 */
	private _setActivePositronVariablesInstance(
		positronVariablesInstance?: IPositronVariablesInstance
	) {
		// Set the active instance and fire the onDidChangeActivePositronVariablesInstance event.
		this._activePositronVariablesInstance = positronVariablesInstance;
		this._activePositronVariablesInstance?.requestRefresh();
		this._onDidChangeActivePositronVariablesInstanceEmitter.fire(positronVariablesInstance);
	}

	/**
	 * Set the active Positron variables instance based on a session.
	 * @param sessionId The session to set the active Positron variables
	 * instance for. If not provided, the active Positron variables instance
	 * will be set to undefined.
	 */
	private _setActivePositronVariablesBySession(sessionId?: string) {

		if (!sessionId) {
			this._setActivePositronVariablesInstance();
			return;
		}

		// No-op if this is already the active instance. Setting the active
		// instance below triggers a refresh, so avoid it if if the instance is
		// already active.
		if (this._activePositronVariablesInstance?.session.sessionId === sessionId) {
			return;
		}

		const positronVariablesInstance = this._positronVariablesInstancesBySessionId.get(
			sessionId
		);

		if (positronVariablesInstance) {
			this._setActivePositronVariablesInstance(positronVariablesInstance);
			return;
		}

		this._logService.error(`Cannot show Variables: ${sessionId} became active, but a Variables instance for it is not running.`);
	}

	//#endregion Private Methods
}

// Register the Positron variables service.
registerSingleton(IPositronVariablesService, PositronVariablesService, InstantiationType.Delayed);
