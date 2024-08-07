/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { generateUuid } from 'vs/base/common/uuid';
import { Event, Emitter } from 'vs/base/common/event';
import { IEditor } from 'vs/editor/common/editorCommon';
import { ILogService } from 'vs/platform/log/common/log';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { ISettableObservable, observableValue } from 'vs/base/common/observableInternal/base';
import { IViewsService } from 'vs/workbench/services/views/common/viewsService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { RuntimeItem } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItem';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ThrottledEmitter } from 'vs/workbench/services/positronConsole/browser/classes/throttledEmitter';
import { RuntimeItemTrace } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemTrace';
import { RuntimeItemExited } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemExited';
import { RuntimeItemStarted } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemStarted';
import { RuntimeItemStartup } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemStartup';
import { RuntimeItemOffline } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemOffline';
import { ActivityItemPrompt, ActivityItemPromptState } from 'vs/workbench/services/positronConsole/browser/classes/activityItemPrompt';
import { RuntimeItemStarting } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemStarting';
import { ActivityItemOutputPlot } from 'vs/workbench/services/positronConsole/browser/classes/activityItemOutputPlot';
import { RuntimeItemReconnected } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemReconnected';
import { ActivityItemOutputHtml } from 'vs/workbench/services/positronConsole/browser/classes/activityItemOutputHtml';
import { RuntimeItemPendingInput } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemPendingInput';
import { RuntimeItemRestartButton } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemRestartButton';
import { ActivityItemErrorMessage } from 'vs/workbench/services/positronConsole/browser/classes/activityItemErrorMessage';
import { ActivityItemOutputMessage } from 'vs/workbench/services/positronConsole/browser/classes/activityItemOutputMessage';
import { RuntimeItemStartupFailure } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemStartupFailure';
import { ActivityItem, RuntimeItemActivity } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemActivity';
import { ActivityItemInput, ActivityItemInputState } from 'vs/workbench/services/positronConsole/browser/classes/activityItemInput';
import { ActivityItemErrorStream, ActivityItemOutputStream } from 'vs/workbench/services/positronConsole/browser/classes/activityItemStream';
import { IPositronConsoleInstance, IPositronConsoleService, POSITRON_CONSOLE_VIEW_ID, PositronConsoleState, SessionAttachMode } from 'vs/workbench/services/positronConsole/browser/interfaces/positronConsoleService';
import { ILanguageRuntimeExit, ILanguageRuntimeMessage, ILanguageRuntimeMessageOutput, ILanguageRuntimeMetadata, LanguageRuntimeSessionMode, RuntimeCodeExecutionMode, RuntimeCodeFragmentStatus, RuntimeErrorBehavior, RuntimeExitReason, RuntimeOnlineState, RuntimeOutputKind, RuntimeState, formatLanguageRuntimeMetadata, formatLanguageRuntimeSession } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../runtimeSession/common/runtimeSessionService';
import { UiFrontendEvent } from 'vs/workbench/services/languageRuntime/common/positronUiComm';
import { IRuntimeStartupService } from 'vs/workbench/services/runtimeStartup/common/runtimeStartupService';

/**
 * The onDidChangeRuntimeItems throttle threshold and throttle interval. The throttle threshold
 * specifies how many events can be fired during the throttle interval before throttling will occur.
 * As long as fewer than throttle threshold events are occurring every throttle interval ms, events
 * will be fired in real time. When the throttle threshold is exceeded during the throttle interval
 * in ms, events will be fired at the throttle interval thereafter until event delivery slows down.
 */
const ON_DID_CHANGE_RUNTIME_ITEMS_THROTTLE_THRESHOLD = 20;
const ON_DID_CHANGE_RUNTIME_ITEMS_THROTTLE_INTERVAL = 50;

/**
 * The maximum items to display in the console.
 */
const MAX_ITEMS = 10000;

/**
 * The trim threshold.
 */
const TRIM_THRESHOLD = 500;

//#region Helper Functions

/**
 * Formats a timestamp.
 * @param timestamp The timestamp.
 * @returns The formatted timestamp.
 */
const formatTimestamp = (timestamp: Date) => {
	const toTwoDigits = (v: number) => v < 10 ? `0${v}` : v;
	const toFourDigits = (v: number) => v < 10 ? `000${v}` : v < 1000 ? `0${v}` : v;
	return `${toTwoDigits(timestamp.getHours())}:${toTwoDigits(timestamp.getMinutes())}:${toTwoDigits(timestamp.getSeconds())}.${toFourDigits(timestamp.getMilliseconds())}`;
};

/**
 * Formats callback trace.
 * @param callback The callback name.
 * @param languageRuntimeMessage The ILanguageRuntimeMessage.
 * @returns The formatted callback trace.
 */
const formatCallbackTrace = (callback: string, languageRuntimeMessage: ILanguageRuntimeMessage) =>
	`${callback} (ID: ${languageRuntimeMessage.id} Parent ID: ${languageRuntimeMessage.parent_id} When: ${formatTimestamp(new Date(languageRuntimeMessage.when))})`;

/**
 * Formats a traceback.
 * @param traceback The traceback.
 * @returns The formatted traceback.
 */
const formatOutputData = (data: Record<string, string>) => {
	let result = '\nOutput:';
	if (!data['text/plain']) {
		result += ' None';
	} else {
		result += '\n' + data['text/plain'];
	}
	return result;
};

/**
 * Formats stdout/stder output.
 *
 * @param stream The standard stream, either 'stdout' or 'stderr'.
 * @param text The text that arrived on the stream.
 * @returns The formatted text.
 */
const formatOutputStream = (stream: 'stdout' | 'stderr', text: string) => {
	return `\nStream ${stream}: "${text}"`;
};

/**
 * Formats a traceback.
 * @param traceback The traceback.
 * @returns The formatted traceback.
 */
const formatTraceback = (traceback: string[]) => {
	let result = '\nTraceback:';
	if (!traceback.length) {
		result += ' None';
	} else {
		traceback.forEach((tracebackEntry, index) => result += `\n[${index + 1}]: ${tracebackEntry}`);
	}
	return result;
};

//#endregion Helper Functions

/**
 * PositronConsoleService class.
 */
class PositronConsoleService extends Disposable implements IPositronConsoleService {
	//#region Private Properties

	/**
	 * A map of the Positron console instances by language ID.
	 */
	private readonly _positronConsoleInstancesByLanguageId = new Map<string, PositronConsoleInstance>();

	/**
	 * A map of the Positron console instances by session ID.
	 */
	private readonly _positronConsoleInstancesBySessionId = new Map<string, PositronConsoleInstance>();

	/**
	 * The active Positron console instance.
	 */
	private _activePositronConsoleInstance?: IPositronConsoleInstance;

	/**
	 * The onDidStartPositronConsoleInstance event emitter.
	 */
	private readonly _onDidStartPositronConsoleInstanceEmitter = this._register(new Emitter<IPositronConsoleInstance>);

	/**
	 * The onDidChangeActivePositronConsoleInstance event emitter.
	 */
	private readonly _onDidChangeActivePositronConsoleInstanceEmitter = this._register(new Emitter<IPositronConsoleInstance | undefined>);

	/**
	 * The onDidChangeConsoleWidth event emitter.
	 */
	private readonly _onDidChangeConsoleWidthEmitter = this._register(new Emitter<number>());

	/**
	 * The debounce timer for the onDidChangeConsoleWidth event.
	 */
	private _consoleWidthDebounceTimer: NodeJS.Timeout | undefined;

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param _instantiationService The instantiation service.
	 * @param _runtimeStartupService The runtime affiliation service.
	 * @param _runtimeSessionService The runtime session service.
	 * @param _logService The log service service.
	 * @param _viewsService The views service.
	 * @param _layoutService The workbench layout service.
	 * @param _configurationService The configuration service.
	 */
	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IRuntimeStartupService private readonly _runtimeStartupService: IRuntimeStartupService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@ILogService private readonly _logService: ILogService,
		@IViewsService private readonly _viewsService: IViewsService,
	) {
		// Call the disposable constrcutor.
		super();

		// Start a Positron console instance for each running runtime.
		this._runtimeSessionService.activeSessions.forEach(session => {
			if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Console) {
				this.startPositronConsoleInstance(session, SessionAttachMode.Connected);
			}
		});

		// Get the foreground session. If there is one, set the active Positron console instance.
		if (this._runtimeSessionService.foregroundSession) {
			const positronConsoleInstance = this._positronConsoleInstancesBySessionId.get(
				this._runtimeSessionService.foregroundSession.sessionId);
			if (positronConsoleInstance) {
				this.setActivePositronConsoleInstance(positronConsoleInstance);
			}
		}

		// Register the onWillStartSessiopn event handler so we start a new
		// Positron console instance before a runtime starts up.
		this._register(this._runtimeSessionService.onWillStartSession(e => {
			// Ignore non-console sessions
			if (e.session.metadata.sessionMode !== LanguageRuntimeSessionMode.Console) {
				return;
			}

			const attachMode = e.isNew ? SessionAttachMode.Starting : SessionAttachMode.Reconnecting;

			// If there is already a Positron console instance for the runtime,
			// just reattach
			const existingInstance = this._positronConsoleInstancesBySessionId.get(
				e.session.sessionId);
			if (existingInstance) {
				// Reattach the runtime; runtimes always detach on exit and are
				// reattached on startup.
				existingInstance.setRuntimeSession(e.session, attachMode);
				return;
			}

			// If no instance exists, see if we can reuse an instance from an
			// exited runtime with a matching language.
			const positronConsoleInstance = this._positronConsoleInstancesByLanguageId.get(e.session.runtimeMetadata.languageId);
			if (positronConsoleInstance && positronConsoleInstance.state === PositronConsoleState.Exited) {
				positronConsoleInstance.setRuntimeSession(e.session, attachMode);
				this._positronConsoleInstancesBySessionId.delete(positronConsoleInstance.session.sessionId);
				this._positronConsoleInstancesBySessionId.set(e.session.sessionId, positronConsoleInstance);
			} else {
				// New runtime with a new language, so start a new Positron console instance.
				this.startPositronConsoleInstance(e.session,
					e.isNew ? SessionAttachMode.Starting : SessionAttachMode.Reconnecting);
			}
		}));

		// Register the onDidStartRuntime event handler so we activate the new Positron console instance when the runtime starts up.
		this._register(this._runtimeSessionService.onDidStartRuntime(session => {
			const positronConsoleInstance = this._positronConsoleInstancesBySessionId.get(session.runtimeMetadata.runtimeId);
			if (positronConsoleInstance) {
				positronConsoleInstance.setState(PositronConsoleState.Ready);
			}
		}));

		// Register the onDidFailStartRuntime event handler so we activate the new Positron console instance when the runtime starts up.
		this._register(this._runtimeSessionService.onDidFailStartRuntime(session => {
			const positronConsoleInstance = this._positronConsoleInstancesBySessionId.get(session.runtimeMetadata.runtimeId);
			if (positronConsoleInstance) {
				positronConsoleInstance.setState(PositronConsoleState.Exited);
			}
		}));

		// Register the onDidChangeRuntimeState event handler so we can activate the REPL for the active runtime.
		this._register(this._runtimeSessionService.onDidChangeRuntimeState(languageRuntimeStateEvent => {
			const positronConsoleInstance = this._positronConsoleInstancesBySessionId.get(languageRuntimeStateEvent.session_id);
			if (!positronConsoleInstance) {
				// TODO@softwarenerd... Handle this in some special way.
				return;
			}

			switch (languageRuntimeStateEvent.new_state) {
				case RuntimeState.Uninitialized:
				case RuntimeState.Initializing:
					break;

				case RuntimeState.Starting:
					positronConsoleInstance.setState(PositronConsoleState.Starting);
					break;

				case RuntimeState.Ready:
					positronConsoleInstance.setState(PositronConsoleState.Ready);
					break;

				case RuntimeState.Offline:
					positronConsoleInstance.setState(PositronConsoleState.Offline);
					break;

				case RuntimeState.Exiting:
					positronConsoleInstance.setState(PositronConsoleState.Exiting);
					break;

				case RuntimeState.Exited:
					positronConsoleInstance.setState(PositronConsoleState.Exited);
					break;
			}
		}));

		// Register the onDidChangeActiveRuntime event handler so we can activate the REPL for the active runtime.
		this._register(this._runtimeSessionService.onDidChangeForegroundSession(session => {
			if (!session) {
				this.setActivePositronConsoleInstance();
			} else {
				const positronConsoleInstance = this._positronConsoleInstancesBySessionId.get(
					session.sessionId);
				if (positronConsoleInstance) {
					this.setActivePositronConsoleInstance(positronConsoleInstance);
				} else {
					this._logService.error(
						`Cannot show Console: ${formatLanguageRuntimeSession(session)} ` +
						`became active, but a REPL instance for it is not running.`);
				}
			}
		}));
	}

	//#endregion Constructor & Dispose

	//#region IPositronConsoleService Implementation

	// Needed for service branding in dependency injector.
	declare readonly _serviceBrand: undefined;

	// An event that is fired when a REPL instance is started.
	readonly onDidStartPositronConsoleInstance = this._onDidStartPositronConsoleInstanceEmitter.event;

	// An event that is fired when the active REPL instance changes.
	readonly onDidChangeActivePositronConsoleInstance = this._onDidChangeActivePositronConsoleInstanceEmitter.event;

	// An event that is fired when the width of the console changes.
	readonly onDidChangeConsoleWidth = this._onDidChangeConsoleWidthEmitter.event;

	// Gets the repl instances.
	get positronConsoleInstances(): IPositronConsoleInstance[] {
		return Array.from(this._positronConsoleInstancesBySessionId.values());
	}

	// Gets the active REPL instance.
	get activePositronConsoleInstance(): IPositronConsoleInstance | undefined {
		return this._activePositronConsoleInstance;
	}

	// Gets the active input text editor.
	get activeInputTextEditor(): IEditor | undefined {
		return this._activePositronConsoleInstance?.inputTextEditor;
	}

	/**
	 * Placeholder that gets called to "initialize" the PositronConsoleService.
	 */
	initialize() {
	}

	/**
	 * Executes code in a PositronConsoleInstance.
	 * @param languageId The language ID.
	 * @param code The code.
	 * @param focus A value which indicates whether to focus the Positron console instance.
	 * @param allowIncomplete Whether to bypass runtime code completeness checks. If true, the `code`
	 *   will be executed by the runtime even if it is incomplete or invalid. Defaults to false
	 * @returns A value which indicates whether the code could be executed.
	 */
	async executeCode(languageId: string, code: string, focus: boolean, allowIncomplete?: boolean) {
		// When code is executed in the console service, open the console view. This opens
		// the relevant pane composite if needed.
		await this._viewsService.openView(POSITRON_CONSOLE_VIEW_ID, false);

		// Get the running runtimes for the language.
		const runningLanguageRuntimes = this._runtimeSessionService.activeSessions.filter(
			session => session.runtimeMetadata.languageId === languageId);

		// If there isn't a running runtime for the language, start one.
		if (!runningLanguageRuntimes.length) {
			// Get the preferred runtime for the language.
			let languageRuntime: ILanguageRuntimeMetadata;
			try {
				languageRuntime = this._runtimeStartupService.getPreferredRuntime(languageId);
			} catch {
				return false;
			}

			// Start the preferred runtime.
			this._logService.trace(`Language runtime ` +
				`${formatLanguageRuntimeMetadata(languageRuntime)} automatically starting`);
			await this._runtimeSessionService.startNewRuntimeSession(languageRuntime.runtimeId,
				languageRuntime.runtimeName,
				LanguageRuntimeSessionMode.Console,
				undefined, // No notebook URI (console sesion)
				`User executed code in language ${languageId}, and no running runtime was found ` +
				`for the language.`);
		}

		// Get the Positron console instance for the language ID.
		const positronConsoleInstance = this._positronConsoleInstancesByLanguageId.get(languageId);
		if (!positronConsoleInstance) {
			return false;
		}

		// Activate the Positron console instance.
		if (positronConsoleInstance !== this._activePositronConsoleInstance) {
			this.setActivePositronConsoleInstance(positronConsoleInstance);

			// Set the foreground session so that other panes (e.g. Variables)
			// will show the results of the code we're about to evaluate.
			this._runtimeSessionService.foregroundSession = positronConsoleInstance.session;
		}

		// Focus the Positron console instance, if we're supposed to.
		if (focus) {
			positronConsoleInstance.focusInput();
		}

		// Enqueue the code in the Positron console instance.
		await positronConsoleInstance.enqueueCode(code, allowIncomplete);

		// Success.
		return Promise.resolve(true);
	}

	//#endregion IPositronConsoleService Implementation

	//#region Private Methods

	/**
	 * Starts a Positron console instance for the specified runtime session.
	 *
	 * @param runtime The runtime for the new Positron console instance.
	 * @param attachMode A value which indicates the mode in which to attach the
	 * session.
	 *
	 * @returns The new Positron console instance.
	 */
	private startPositronConsoleInstance(
		session: ILanguageRuntimeSession,
		attachMode: SessionAttachMode
	): IPositronConsoleInstance {
		// Create the new Positron console instance.
		const positronConsoleInstance = this._instantiationService.createInstance(
			PositronConsoleInstance,
			session,
			attachMode
		);

		// Add the Positron console instance.
		this._positronConsoleInstancesByLanguageId.set(
			session.runtimeMetadata.languageId,
			positronConsoleInstance
		);
		this._positronConsoleInstancesBySessionId.set(
			session.sessionId,
			positronConsoleInstance
		);

		// Fire the onDidStartPositronConsoleInstance event.
		this._onDidStartPositronConsoleInstanceEmitter.fire(positronConsoleInstance);

		// Set the active positron console instance.
		this._activePositronConsoleInstance = positronConsoleInstance;

		// Fire the onDidChangeActivePositronConsoleInstance event.
		this._onDidChangeActivePositronConsoleInstanceEmitter.fire(positronConsoleInstance);

		// Listen for console width changes.
		this._register(positronConsoleInstance.onDidChangeWidthInChars(width => {
			this.onConsoleWidthChange(width);
		}));

		// Return the instance.
		return positronConsoleInstance;
	}

	/**
	 * Gets the current console input width, in characters; throws an error if there is no active
	 * Positron console instance.
	 *
	 * @returns The current console input width, in characters.
	 */
	getConsoleWidth(): number {
		if (this._activePositronConsoleInstance) {
			return this._activePositronConsoleInstance.getWidthInChars();
		}
		throw new Error('No active Positron console instance; cannot get width.');
	}

	private onConsoleWidthChange(newWidth: number) {
		// Clear the previous debounce timer, if any.
		if (this._consoleWidthDebounceTimer) {
			clearTimeout(this._consoleWidthDebounceTimer);
		}

		// When the debounce timer fires, fire the onDidChangeConsoleWidth
		// event.
		this._consoleWidthDebounceTimer = setTimeout(() => {
			this._onDidChangeConsoleWidthEmitter.fire(newWidth);
		}, 500);
	}

	/**
	 * Sets the active Positron console instance.
	 * @param positronConsoleInstance
	 */
	private setActivePositronConsoleInstance(positronConsoleInstance?: IPositronConsoleInstance) {
		// Set the active instance and fire the onDidChangeActivePositronConsoleInstance event.
		this._activePositronConsoleInstance = positronConsoleInstance;
		this._onDidChangeActivePositronConsoleInstanceEmitter.fire(positronConsoleInstance);
	}

	//#endregion Private Methods
}

/**
* PositronConsoleInstance class.
*/
class PositronConsoleInstance extends Disposable implements IPositronConsoleInstance {
	//#region Private Properties

	/**
	 * Gets or sets the runtime.
	 */
	private _session: ILanguageRuntimeSession;

	/**
	 * Gets or sets the disposable store. This contains things that are disposed when a runtime is
	 * detached.
	 */
	private _runtimeDisposableStore = new DisposableStore();

	/**
	 * Gets or sets the runtime state.
	 */
	private _runtimeState: RuntimeState = RuntimeState.Uninitialized;

	/**
	 * Whether or not we are currently attached to the runtime.
	 */
	private _runtimeAttached = false;

	/**
	 * Gets or sets the state.
	 */
	private _state = PositronConsoleState.Uninitialized;

	/**
	 * Gets or sets a value which indicates whether trace is enabled.
	 */
	private _trace = false;

	/**
	 * Gets or sets a value which indicates whether word wrap is enabled.
	 */
	private _wordWrap = true;

	/**
	 * Gets or sets the pending code.
	 */
	private _pendingCode?: string;

	/**
	 * The RuntimeItemPendingInput.
	 */
	private _runtimeItemPendingInput?: RuntimeItemPendingInput;

	/**
	 * Gets or sets the trim counter.
	 */
	private _trimCounter = 0;

	/**
	 * Gets or sets the runtime items.
	 */
	private _runtimeItems: RuntimeItem[] = [];

	/**
	 * Gets or sets the runtime item activities. This is keyed by parent ID.
	 */
	private _runtimeItemActivities = new Map<string, RuntimeItemActivity>();

	/**
	 * Gets or sets a value which indicates whether a prompt is active.
	 */
	private _promptActive = false;

	/**
	 * Is scroll-lock engaged?
	 */
	private _scrollLocked = false;

	/**
	 * Last saved scroll top.
	 */
	private _lastScrollTop = 0;

	/**
	 * The _onFocusInput event emitter.
	 */
	private readonly _onFocusInputEmitter = this._register(new Emitter<void>);

	/**
	 * The onDidChangeState event emitter.
	 */
	private readonly _onDidChangeStateEmitter = this._register(new Emitter<PositronConsoleState>);

	/**
	 * The onDidChangeTrace event emitter.
	 */
	private readonly _onDidChangeTraceEmitter = this._register(new Emitter<boolean>);

	/**
	 * The onDidChangeWordWrap event emitter.
	 */
	private readonly _onDidChangeWordWrapEmitter = this._register(new Emitter<boolean>);

	/**
	 * The onDidChangeRuntimeItems throttled event emitter.
	 */
	private readonly _onDidChangeRuntimeItemsEmitter = this._register(new ThrottledEmitter<void>(
		ON_DID_CHANGE_RUNTIME_ITEMS_THROTTLE_THRESHOLD,
		ON_DID_CHANGE_RUNTIME_ITEMS_THROTTLE_INTERVAL
	));

	/**
	 * The onDidPasteText event emitter.
	 */
	private readonly _onDidPasteTextEmitter = this._register(new Emitter<string>);

	/**
	 * The onDidSelectAll event emitter.
	 */
	private readonly _onDidSelectAllEmitter = this._register(new Emitter<void>);

	/**
	 * The onDidClearConsole event emitter.
	 */
	private readonly _onDidClearConsoleEmitter = this._register(new Emitter<void>);

	/**
	 * The onDidClearInputHistory event emitter.
	 */
	private readonly _onDidClearInputHistoryEmitter = this._register(new Emitter<void>);

	/**
	 * The onDidSetPendingCode event emitter.
	 */
	private readonly _onDidSetPendingCodeEmitter = this._register(new Emitter<string | undefined>);

	/**
	 * The onDidExecuteCode event emitter.
	 */
	private readonly _onDidExecuteCodeEmitter = this._register(new Emitter<string>);

	/**
	 * The onDidSelectPlot event emitter.
	 */
	private readonly _onDidSelectPlotEmitter = this._register(new Emitter<string>);

	/**
	 * The onDidRequestRestart event emitter.
	 */
	private readonly _onDidRequestRestart = this._register(new Emitter<void>);

	/**
	 * The onDidAttachRuntime event emitter.
	 */
	private readonly _onDidAttachRuntime = this._register(
		new Emitter<ILanguageRuntimeSession | undefined>);

	/**
	 * Provides access to the input text editor, if it's available. Note that we generally prefer to
	 * interact with this editor indirectly, since its state is managed by React.
	 */
	private _inputTextEditor: IEditor | undefined;

	/**
	 * An observable value representing the current console width in characters
	 */
	private readonly _widthInChars: ISettableObservable<number>;

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 *
	 * @param runtimeSession The language runtime session.
	 * @param attachMode The mode in which to attach to the session.
	 * @param _notificationService The notification service.
	 */
	constructor(
		runtimeSession: ILanguageRuntimeSession,
		attachMode: SessionAttachMode,
		@INotificationService private readonly _notificationService: INotificationService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) {
		// Call the base class's constructor.
		super();

		// Set the runtime.
		this._session = runtimeSession;

		// Attach to the runtime.
		this.attachRuntime(attachMode);

		// Initialize the width in characters.
		this._widthInChars = observableValue<number>('console-width', 80);
		this.onDidChangeWidthInChars = Event.fromObservable(this._widthInChars);
	}

	/**
	 * Gets the current input text editor, if any.
	 */
	get inputTextEditor(): IEditor | undefined {
		return this._inputTextEditor;
	}

	/**
	 * Sets the input text editor. This is called from the React component after
	 * the editor (a `CodeEditorWidget`) is created and mounted.
	 */
	set inputTextEditor(value: IEditor | undefined) {
		this._inputTextEditor = value;
	}

	/**
	 * Sets the console input's width in characters.
	 *
	 * @param newWidth The new width, in characters.
	 */
	setWidthInChars(newWidth: number): void {
		this._widthInChars.set(newWidth, undefined);
	}

	/**
	 * Gets the console input's width in characters.
	 *
	 * @returns The console input's current width in characters.
	 */
	getWidthInChars(): number {
		return this._widthInChars.get();
	}

	/**
	 * Gets the currently attached runtime session, or undefined if there is no runtime attached.
	 */
	get attachedRuntimeSession(): ILanguageRuntimeSession | undefined {
		return this.runtimeAttached ? this._session : undefined;
	}

	/**
	 * Disposes of the PositronConsoleInstance.
	 */
	override dispose() {
		// If trace is enabled, add a trace runtime item.
		if (this._trace) {
			this.addRuntimeItemTrace('dispose()');
		}

		// Call Disposable's dispose.
		super.dispose();

		// Dispose of the runtime event handlers.
		this._runtimeDisposableStore.dispose();
	}

	//#endregion Constructor & Dispose

	//#region IPositronConsoleInstance Implementation

	/**
	 * Gets the runtime session.
	 */
	get session(): ILanguageRuntimeSession {
		return this._session;
	}

	/**
	 * Gets the state.
	 */
	get state(): PositronConsoleState {
		return this._state;
	}

	/**
	 * Gets a value which indicates whether trace is enabled.
	 */
	get trace(): boolean {
		return this._trace;
	}

	/**
	 * Gets a value which indicates whether word wrap is enabled.
	 */
	get wordWrap(): boolean {
		return this._wordWrap;
	}

	/**
	 * Gets the runtime items.
	 */
	get runtimeItems(): RuntimeItem[] {
		return this._runtimeItems;
	}

	/**
	 * Gets a value which indicates whether a prompt is active.
	 */
	get promptActive(): boolean {
		return this._promptActive;
	}

	/**
	 * Gets a value which indicates whether a runtime is attached.
	 */
	get runtimeAttached(): boolean {
		return this._runtimeAttached;
	}

	/**
	 * Is scroll-lock engaged?
	 */
	get scrollLocked(): boolean {
		return this._scrollLocked;
	}
	set scrollLocked(value: boolean) {
		this._scrollLocked = value;
	}

	/**
	 * Last saved scroll top.
	 */
	get lastScrollTop(): number {
		return this._lastScrollTop;
	}
	set lastScrollTop(value: number) {
		this._lastScrollTop = value;
	}

	/**
	 * onFocusInput event.
	 */
	readonly onFocusInput = this._onFocusInputEmitter.event;

	/**
	 * onDidChangeState event.
	 */
	readonly onDidChangeState = this._onDidChangeStateEmitter.event;

	/**
	 * onDidChangeTrace event.
	 */
	readonly onDidChangeTrace = this._onDidChangeTraceEmitter.event;

	/**
	 * onDidChangeWordWrap event.
	 */
	readonly onDidChangeWordWrap = this._onDidChangeWordWrapEmitter.event;

	/**
	 * onDidChangeRuntimeItems event.
	 */
	readonly onDidChangeRuntimeItems = this._onDidChangeRuntimeItemsEmitter.event;

	/**
	 * onDidPasteText event.
	 */
	readonly onDidPasteText = this._onDidPasteTextEmitter.event;

	/**
	 * onDidSelectAll event.
	 */
	readonly onDidSelectAll = this._onDidSelectAllEmitter.event;

	/**
	 * onDidClearConsole event.
	 */
	readonly onDidClearConsole = this._onDidClearConsoleEmitter.event;

	/**
	 * onDidClearInputHistory event.
	 */
	readonly onDidClearInputHistory = this._onDidClearInputHistoryEmitter.event;

	/**
	 * onDidSetPendingCode event.
	 */
	readonly onDidSetPendingCode = this._onDidSetPendingCodeEmitter.event;

	/**
	 * onDidExecuteCode event.
	 */
	readonly onDidExecuteCode = this._onDidExecuteCodeEmitter.event;

	/**
	 * onDidSelectPlot event.
	 */
	readonly onDidSelectPlot = this._onDidSelectPlotEmitter.event;

	/**
	 * onDidRequestRestart event.
	 */
	readonly onDidRequestRestart = this._onDidRequestRestart.event;

	/**
	 * onDidAttachRuntime event.
	 */
	readonly onDidAttachRuntime = this._onDidAttachRuntime.event;

	/**
	 * Emitted when the width of the console changes.
	 */
	readonly onDidChangeWidthInChars: Event<number>;

	/**
	 * Focuses the input for the console.
	 */
	focusInput() {
		this._onFocusInputEmitter.fire();
	}

	/**
	 * Toggles trace.
	 */
	toggleTrace() {
		this._trace = !this._trace;
		if (this._trace) {
			this.addRuntimeItemTrace('Trace enabled');
		}
		this._onDidChangeTraceEmitter.fire(this._trace);
	}

	/**
	 * Toggles word wrap.
	 */
	toggleWordWrap() {
		this._wordWrap = !this._wordWrap;
		this._onDidChangeWordWrapEmitter.fire(this._wordWrap);
	}

	/**
	 * Pastes text into the console.
	 */
	pasteText(text: string) {
		this.focusInput();
		this._onDidPasteTextEmitter.fire(text);
	}

	/**
	 * Select all text in the console.
	 */
	selectAll() {
		this._onDidSelectAllEmitter.fire();
	}

	/**
	 * Clears the console.
	 */
	clearConsole() {
		// When a prompt is active, we cannot clear the console.
		if (this._promptActive) {
			// Notify the user that we cannot clear the console.
			this._notificationService.notify({
				severity: Severity.Info,
				message: localize('positron.clearConsole.promptActive', "Cannot clear console. A prompt is active."),
				sticky: false
			});
		} else {
			// Clear the console.
			this._runtimeItems = [];
			this._runtimeItemActivities.clear();
			this._onDidChangeRuntimeItemsEmitter.fire();
			this._onDidClearConsoleEmitter.fire();
		}
	}

	/**
	 * Clears the input history.
	 */
	clearInputHistory() {
		this._onDidClearInputHistoryEmitter.fire();
	}

	/**
	 * Interrupts the console.
	 */
	interrupt(code: string) {
		// Get the runtime state.
		const runtimeState = this._session.getRuntimeState();

		this._session.interrupt();

		// Clear pending input and pending code.
		this.clearPendingInput();
		this.setPendingCode();

		// If the runtime wasn't busy, add a runtime item activity with and empty ActivityItemInput
		// so there is feedback that the interrupt was processed.
		if (runtimeState === RuntimeState.Ready || runtimeState === RuntimeState.Idle) {
			const id = generateUuid();
			this.addOrUpdateUpdateRuntimeItemActivity(
				id,
				new ActivityItemInput(
					ActivityItemInputState.Cancelled,
					id,
					id,
					new Date(),
					this._session.dynState.inputPrompt,
					this._session.dynState.continuationPrompt,
					code,
				)
			);
		}
	}

	/**
	 * Enqueues code.
	 * @param code The code to enqueue.
	 * @param allowIncomplete Whether to bypass runtime code completeness checks. If true, the `code`
	 *   will be executed by the runtime even if it is incomplete or invalid. Defaults to false
	 */
	async enqueueCode(code: string, allowIncomplete?: boolean) {
		// If there is a pending input runtime item, all the code in it was enqueued before this
		// code, so add this code to it and wait for it to be processed the next time the runtime
		// becomes idle.
		if (this._runtimeItemPendingInput) {
			this.addPendingInput(code);
			return;
		}

		// If the runtime isn't idle or ready, we can't check on whether this code is complete, so
		// add this code as a pending input runtime item and wait for it to be processed the next
		// time the runtime becomes idle.
		const runtimeState = this.session.getRuntimeState();
		if (!(runtimeState === RuntimeState.Idle || runtimeState === RuntimeState.Ready)) {
			this.addPendingInput(code);
			return;
		}

		// Code should be executed if the caller skips checks, or if the runtime says the code is complete.
		const shouldExecuteCode = async (code: string) => {
			if (allowIncomplete) {
				return true;
			}
			const codeStatus = await this.session.isCodeFragmentComplete(code);
			return codeStatus === RuntimeCodeFragmentStatus.Complete;
		};

		// If there is pending code, evaluate what to do.
		if (this._pendingCode) {
			// Figure out whether adding this code to the pending code results in pending code that
			// can be executed. If so, execute it.
			const pendingCode = this._pendingCode + '\n' + code;
			if (await shouldExecuteCode(pendingCode)) {
				this.setPendingCode(undefined);
				this.doExecuteCode(pendingCode);
				return;
			}

			// Update the pending code. More will be revealed.
			this.setPendingCode(pendingCode);
			return;
		}

		// Figure out whether this code can be executed. If it can be, execute it immediately.
		if (await shouldExecuteCode(code)) {
			this.doExecuteCode(code);
			return;
		}

		// The code cannot be executed. Set the pending code.
		this.setPendingCode(code);
	}

	/**
	 * Executes code.
	 * @param code The code to execute.
	 */
	executeCode(code: string) {
		this.setPendingCode(undefined);
		this.doExecuteCode(code);
	}

	/**
	 * Replies to a prompt.
	 * @param activityItemPrompt The prompt activity item.
	 * @param value The value.
	 */
	replyToPrompt(activityItemPrompt: ActivityItemPrompt, value: string) {
		// Update the prompt state.
		activityItemPrompt.state = ActivityItemPromptState.Answered;
		activityItemPrompt.answer = !activityItemPrompt.password ? value : '';
		this._onDidChangeRuntimeItemsEmitter.fire();

		// Reply to the prompt.
		if (this._promptActive) {
			this._promptActive = false;
			this._session.replyToPrompt(activityItemPrompt.id, value);
		}
	}

	/**
	 * Interrupts a prompt.
	 * @param activityItemPrompt The prompt activity item.
	 */
	interruptPrompt(activityItemPrompt: ActivityItemPrompt) {
		// Update the prompt state.
		activityItemPrompt.state = ActivityItemPromptState.Interrupted;
		this._onDidChangeRuntimeItemsEmitter.fire();

		// Reply to the prompt.
		if (this._promptActive) {
			this._promptActive = false;
			this._session.interrupt();
		}
	}

	//#endregion IPositronConsoleInstance Implementation

	//#region Public Methods

	/**
	 * Sets the runtime session.
	 *
	 * @param runtime The runtime session.
	 *
	 * @param attachMode A value which indicates the attachment mode for the session.
	 */
	setRuntimeSession(session: ILanguageRuntimeSession, attachMode: SessionAttachMode) {
		// Is this the same runtime we're currently attached to?
		if (this._session && this._session.sessionId === session.sessionId) {
			if (this.runtimeAttached) {
				// Yes, it's the same one. If we're already attached, we're
				// done; just let the user know we're starting up if we are
				// currently showing as Exited.
				if (this._state === PositronConsoleState.Exited) {
					this.emitStartRuntimeItems(attachMode);
				}
			} else {
				// It's the same one, but it isn't attached. Reattach it. Note
				// that even though the IDs match we may still need to update
				// our reference to the session object (it changes during e.g.
				// extension host restarts)
				this._session = session;
				this.attachRuntime(attachMode);
			}
			return;
		}
		// Set the new runtime.
		this._session = session;

		// Attach the new runtime.
		this.attachRuntime(attachMode);
	}

	/**
	 * Marks the Input activity item that matches the given parent ID as busy or
	 * not busy.
	 *
	 * @param parentId The parent ID of the input activity.
	 * @param busy Whether the input is busy.
	 */
	markInputBusyState(parentId: string, busy: boolean) {
		// Look up all the activities that match the given parent ID
		const activity = this._runtimeItemActivities.get(parentId);
		if (!activity) {
			return;
		}

		// Loop over each and look for the Input activity
		for (const item of activity.activityItems) {
			if (item instanceof ActivityItemInput) {
				// This is an input activity; update its busy state.
				const input = item as ActivityItemInput;
				if (input.state !== ActivityItemInputState.Provisional) {
					input.state = busy ?
						ActivityItemInputState.Executing :
						ActivityItemInputState.Completed;
				}

				// Found the input, so we're done.
				break;
			}
		}
	}

	/**
	 * Sets the state.
	 * @param state The new state.
	 */
	setState(state: PositronConsoleState) {
		// If trace is enabled, add a trace runtime item.
		if (this._trace && this._state !== state) {
			this.addRuntimeItemTrace(`Console state change: ${this._state} => ${state}`);
		}

		// Process the state change.
		switch (state) {
			case PositronConsoleState.Uninitialized:
			case PositronConsoleState.Starting:
				break;

			case PositronConsoleState.Ready:
				switch (this._state) {
					// Remove the starting runtime item when we transition from starting to running.
					case PositronConsoleState.Starting:
						for (let i = this._runtimeItems.length - 1; i >= 0; i--) {
							if (this._runtimeItems[i] instanceof RuntimeItemStarting) {
								const runtimeItem = this._runtimeItems[i] as RuntimeItemStarting;
								let msg = '';
								// Create a localized message from the past
								// tense of the attach mode.
								switch (runtimeItem.attachMode) {
									case SessionAttachMode.Starting:
										msg = localize('positronConsole.started', "{0} started.", this._session.metadata.sessionName);
										break;
									case SessionAttachMode.Restarting:
										msg = localize('positronConsole.restarted', "{0} restarted.", this._session.metadata.sessionName);
										break;
									case SessionAttachMode.Reconnecting:
										msg = localize('positronConsole.reconnected', "{0} reconnected.", this._session.metadata.sessionName);
										break;
									case SessionAttachMode.Connected:
										msg = localize('positronConsole.connected', "{0} connected.", this._session.metadata.sessionName);
										break;
								}
								this._runtimeItems[i] = new RuntimeItemStarted(
									generateUuid(), msg);
								this._onDidChangeRuntimeItemsEmitter.fire();
							}
						}
						break;

					case PositronConsoleState.Offline:
						this.addRuntimeItem(
							new RuntimeItemReconnected(
								generateUuid(),
								`${this._session.metadata.sessionName} reconnected.`
							)
						);
						break;
				}
				break;

			case PositronConsoleState.Offline:
				this.addRuntimeItem(
					new RuntimeItemOffline(
						generateUuid(),
						`${this._session.metadata.sessionName} offline. Waiting to reconnect.`
					)
				);
				break;
		}

		// Set the new state and raise the onDidChangeState event.
		this._state = state;
		this._onDidChangeStateEmitter.fire(this._state);
	}

	//#endregion Public Methods

	//#region Private Methods

	/**
	 * Emits start runtime items.
	 *
	 * @param attachMode A value which indicates the attachment mode.
	 */
	private emitStartRuntimeItems(attachMode: SessionAttachMode) {
		// Set the state and add the appropriate runtime item to indicate whether the Positron
		// console instance is is starting or is reconnected.
		if (attachMode === SessionAttachMode.Starting ||
			attachMode === SessionAttachMode.Reconnecting) {
			let switchingRuntime = false;
			for (let i = 0; i < this._runtimeItems.length; i++) {
				if (this._runtimeItems[i] instanceof RuntimeItemExited) {
					const runtimeItem = this._runtimeItems[i] as RuntimeItemExited;
					switchingRuntime =
						runtimeItem.reason === RuntimeExitReason.SwitchRuntime ||
						runtimeItem.reason === RuntimeExitReason.ExtensionHost;
				}
			}
			const restart = this._state === PositronConsoleState.Exited && !switchingRuntime;
			this.setState(PositronConsoleState.Starting);
			if (restart) {
				this.addRuntimeItem(new RuntimeItemStarting(
					generateUuid(),
					localize('positronConsole.starting.restart', "{0} restarting.", this._session.metadata.sessionName),
					SessionAttachMode.Restarting));
			} else if (attachMode === SessionAttachMode.Starting) {
				this.addRuntimeItem(new RuntimeItemStarting(
					generateUuid(),
					localize('positronConsole.starting.start', "{0} starting.", this._session.metadata.sessionName),
					attachMode));
			} else if (attachMode === SessionAttachMode.Reconnecting) {
				this.addRuntimeItem(new RuntimeItemStarting(
					generateUuid(),
					localize('positronConsole.starting.reconnect', "{0} reconnecting.", this._session.metadata.sessionName),
					attachMode));
			}
		} else {
			this.setState(PositronConsoleState.Ready);
			this.addRuntimeItem(new RuntimeItemReconnected(
				generateUuid(),
				`${this._session.metadata.sessionName} reconnected.`
			));
		}
	}

	/**
	 * Attaches to a runtime.
	 *
	 * @param attachMode A value which indicates the mode in which to attach the session.
	 */
	private attachRuntime(attachMode: SessionAttachMode) {
		// Mark the runtime as attached.
		this._runtimeAttached = true;

		// If trace is enabled, add a trace runtime item.
		if (this._trace) {
			this.addRuntimeItemTrace(`Attach session ${this._session.metadata.sessionName} ` +
				`(attach mode = ${attachMode})`);
		}

		// Emit the start runtime items.
		this.emitStartRuntimeItems(attachMode);

		// Add the onDidChangeRuntimeState event handler.
		this._runtimeDisposableStore.add(this._session.onDidChangeRuntimeState(async runtimeState => {
			// If trace is enabled, add a trace runtime item.
			if (this._trace) {
				this.addRuntimeItemTrace(`onDidChangeRuntimeState (${runtimeState})`);
			}

			// When the runtime goes idle or ready, process pending input.
			if (runtimeState === RuntimeState.Idle || runtimeState === RuntimeState.Ready) {
				this.processPendingInput();
			}

			// When the runtime is ready, clear out any old restart buttons that
			// may have been used to bring it online.
			if (runtimeState === RuntimeState.Ready) {
				this.clearRestartItems();
			}

			if (runtimeState === RuntimeState.Exited || runtimeState === RuntimeState.Uninitialized) {
				if (this._runtimeState === RuntimeState.Starting ||
					this._runtimeState === RuntimeState.Initializing) {
					// If we moved directly from Starting or Initializing to
					// Exited or Uninitialized, then we probably encountered a startup
					// failure, and will be receiving a
					// `onDidEncounterStartupFailure` event shortly.  In this
					// case, we don't want to detach the runtime, because we
					// want to keep the onDidEncounterStartupFailure event
					// handler attached.
					//
					// We don't want to wait forever, though, so we'll set a
					// timeout to detach the runtime if we don't receive a
					// onDidEncounterStartupFailure event within a reasonable
					// amount of time.
					setTimeout(() => {
						// If we're still in the Exited state and haven't
						// disposed, then do it now.
						if ((this._runtimeState === RuntimeState.Exited ||
							this._runtimeState === RuntimeState.Uninitialized) &&
							this.runtimeAttached) {
							this.detachRuntime();

							this.addRuntimeItem(new RuntimeItemExited(
								generateUuid(),
								RuntimeExitReason.StartupFailed,
								`${this._session.metadata.sessionName} failed to start.`
							));
						}
					}, 1000);
				}
			}

			// If the kernel was offline but is now online, then add a runtime item to indicate
			// that it is reconnected.
			if (this._state === PositronConsoleState.Offline &&
				(runtimeState === RuntimeState.Busy || runtimeState === RuntimeState.Idle)) {
				this.setState(PositronConsoleState.Ready);
			}

			// Remember this runtime state so we know which state we are transitioning from when the
			// next state change occurs.
			this._runtimeState = runtimeState;
		}));

		// Add the onDidCompleteStartup event handler.
		this._runtimeDisposableStore.add(this._session.onDidCompleteStartup(languageRuntimeInfo => {
			this.setState(PositronConsoleState.Ready);

			// If trace is enabled, add a trace runtime item.
			if (this._trace) {
				this.addRuntimeItemTrace(`onDidCompleteStartup`);
			}

			// Add the item startup. Omit the banner if reconnecting.
			this.addRuntimeItem(new RuntimeItemStartup(
				generateUuid(),
				attachMode === SessionAttachMode.Reconnecting ? '' :
					languageRuntimeInfo.banner,
				languageRuntimeInfo.implementation_version,
				languageRuntimeInfo.language_version
			));
		}));

		// Add the onDidEncounterStartupFailure event handler. This can arrive before or after
		// the state change to Exited, so we need to handle it in both places.
		this._runtimeDisposableStore.add(this._session.onDidEncounterStartupFailure(startupFailure => {
			// If trace is enabled, add a trace runtime item.
			if (this._trace) {
				this.addRuntimeItemTrace(`onDidEncounterStartupFailure`);
			}

			// Add the item startup.
			this.addRuntimeItem(new RuntimeItemStartupFailure(
				generateUuid(),
				startupFailure.message,
				startupFailure.details,
			));

			// If we haven't already detached the runtime, do it now.
			if ((this._runtimeState === RuntimeState.Exited ||
				this._runtimeState === RuntimeState.Uninitialized) && this.runtimeAttached) {
				this.detachRuntime();
			}
		}));

		// Add the onDidReceiveRuntimeMessageInput event handler.
		this._runtimeDisposableStore.add(this._session.onDidReceiveRuntimeMessageInput(languageRuntimeMessageInput => {
			// If trace is enabled, add a trace runtime item.
			if (this._trace) {
				this.addRuntimeItemTrace(
					formatCallbackTrace('onDidReceiveRuntimeMessageInput', languageRuntimeMessageInput) +
					'\nCode:\n' +
					languageRuntimeMessageInput.code
				);
			}

			// Add or update the runtime item activity.
			this.addOrUpdateUpdateRuntimeItemActivity(
				languageRuntimeMessageInput.parent_id,
				new ActivityItemInput(
					ActivityItemInputState.Executing,
					languageRuntimeMessageInput.id,
					languageRuntimeMessageInput.parent_id,
					new Date(languageRuntimeMessageInput.when),
					this._session.dynState.inputPrompt,
					this._session.dynState.continuationPrompt,
					languageRuntimeMessageInput.code
				)
			);
		}));

		// Add the onDidReceiveRuntimeMessagePrompt event handler.
		this._runtimeDisposableStore.add(this._session.onDidReceiveRuntimeMessagePrompt(languageRuntimeMessagePrompt => {
			// If trace is enabled, add a trace runtime item.
			if (this._trace) {
				this.addRuntimeItemTrace(
					formatCallbackTrace('onDidReceiveRuntimeMessagePrompt', languageRuntimeMessagePrompt) +
					`\nPrompt: ${languageRuntimeMessagePrompt.prompt}` +
					`\nPassword: ${languageRuntimeMessagePrompt.password}`
				);
			}

			// Set the prompt active flag.
			this._promptActive = true;

			// Add or update the runtime item activity.
			this.addOrUpdateUpdateRuntimeItemActivity(
				languageRuntimeMessagePrompt.parent_id,
				new ActivityItemPrompt(
					languageRuntimeMessagePrompt.id,
					languageRuntimeMessagePrompt.parent_id,
					new Date(languageRuntimeMessagePrompt.when),
					languageRuntimeMessagePrompt.prompt,
					languageRuntimeMessagePrompt.password
				)
			);
		}));

		// Add the onDidReceiveRuntimeMessageOutput event handler.
		const handleDidReceiveRuntimeMessageOutput = (
			(languageRuntimeMessageOutput: ILanguageRuntimeMessageOutput) => {
				// If trace is enabled, add a trace runtime item.
				if (this._trace) {
					this.addRuntimeItemTrace(
						formatCallbackTrace('onDidReceiveRuntimeMessageOutput', languageRuntimeMessageOutput) +
						formatOutputData(languageRuntimeMessageOutput.data)
					);
				}

				if (
					languageRuntimeMessageOutput.kind === RuntimeOutputKind.ViewerWidget ||
					languageRuntimeMessageOutput.kind === RuntimeOutputKind.IPyWidget
				) {
					// If this message will be handled by the viewer or plots pane, we can break
					// early to avoid displaying potentially long output in the console.
					return;
				}

				// Check to see if the data contains an image by checking the record for the
				// "image/" mime type.
				const images = Object.keys(languageRuntimeMessageOutput.data).find(
					key => key.startsWith('image/'));

				// Check to see if the data contains any HTML
				let html = Object.hasOwnProperty.call(languageRuntimeMessageOutput.data,
					'text/html');
				if (html) {
					const htmlContent = languageRuntimeMessageOutput.data['text/html'].toLowerCase();
					if (htmlContent.indexOf('<script') >= 0 ||
						htmlContent.indexOf('<body') >= 0 ||
						htmlContent.indexOf('<html') >= 0 ||
						htmlContent.indexOf('<iframe') >= 0) {
						// We only want to render HTML fragments for now; if it has
						// scripts or looks like it is a self-contained document,
						// hard pass. In the future, we'll need to render those in a
						// sandboxed environment.
						html = false;
					}
				}

				if (images) {
					// It's an image, so create a plot activity item.
					this.addOrUpdateUpdateRuntimeItemActivity(
						languageRuntimeMessageOutput.parent_id,
						new ActivityItemOutputPlot(
							languageRuntimeMessageOutput.id,
							languageRuntimeMessageOutput.parent_id,
							new Date(languageRuntimeMessageOutput.when),
							languageRuntimeMessageOutput.data, () => {
								// This callback runs when the user clicks on the
								// plot; when they do this, we'll select it in the
								// Plots pane.
								this._onDidSelectPlotEmitter.fire(languageRuntimeMessageOutput.id);
							}
						)
					);
				} else if (html) {
					// It's HTML, so show the HTML.
					this.addOrUpdateUpdateRuntimeItemActivity(
						languageRuntimeMessageOutput.parent_id,
						new ActivityItemOutputHtml(
							languageRuntimeMessageOutput.id,
							languageRuntimeMessageOutput.parent_id,
							new Date(languageRuntimeMessageOutput.when),
							languageRuntimeMessageOutput.data['text/html']
						)
					);
				} else {
					// It's a plain old text output, so create a text activity item.
					this.addOrUpdateUpdateRuntimeItemActivity(
						languageRuntimeMessageOutput.parent_id,
						new ActivityItemOutputMessage(
							languageRuntimeMessageOutput.id,
							languageRuntimeMessageOutput.parent_id,
							new Date(languageRuntimeMessageOutput.when),
							languageRuntimeMessageOutput.data
						)
					);
				}
			});
		this._runtimeDisposableStore.add(this._session.onDidReceiveRuntimeMessageOutput(handleDidReceiveRuntimeMessageOutput));
		this._runtimeDisposableStore.add(this._session.onDidReceiveRuntimeMessageResult(handleDidReceiveRuntimeMessageOutput));

		// Add the onDidReceiveRuntimeMessageStream event handler.
		this._runtimeDisposableStore.add(this._session.onDidReceiveRuntimeMessageStream(
			languageRuntimeMessageStream => {
				// Sanitize the trace output.
				let traceOutput = languageRuntimeMessageStream.text;
				traceOutput = traceOutput.replaceAll('\t', '[HT]');
				traceOutput = traceOutput.replaceAll('\n', '[LF]');
				traceOutput = traceOutput.replaceAll('\r', '[CR]');
				traceOutput = traceOutput.replaceAll('\x9B', 'CSI');
				traceOutput = traceOutput.replaceAll('\x1b', 'ESC');
				traceOutput = traceOutput.replaceAll('\x9B', 'CSI');

				// If trace is enabled, add a trace runtime item.
				if (this._trace) {
					this.addRuntimeItemTrace(
						formatCallbackTrace('onDidReceiveRuntimeMessageStream', languageRuntimeMessageStream) +
						formatOutputStream(languageRuntimeMessageStream.name, traceOutput)
					);
				}

				// Handle stdout and stderr.
				if (languageRuntimeMessageStream.name === 'stdout') {
					this.addOrUpdateUpdateRuntimeItemActivity(
						languageRuntimeMessageStream.parent_id,
						new ActivityItemOutputStream(
							languageRuntimeMessageStream.id,
							languageRuntimeMessageStream.parent_id,
							new Date(languageRuntimeMessageStream.when),
							languageRuntimeMessageStream.text
						)
					);
				} else if (languageRuntimeMessageStream.name === 'stderr') {
					this.addOrUpdateUpdateRuntimeItemActivity(
						languageRuntimeMessageStream.parent_id,
						new ActivityItemErrorStream(
							languageRuntimeMessageStream.id,
							languageRuntimeMessageStream.parent_id,
							new Date(languageRuntimeMessageStream.when),
							languageRuntimeMessageStream.text
						)
					);
				}
			}));

		// Add the onDidReceiveRuntimeMessageError event handler.
		this._runtimeDisposableStore.add(this._session.onDidReceiveRuntimeMessageError(
			languageRuntimeMessageError => {
				// If trace is enabled, add a trace runtime item.
				if (this._trace) {
					this.addRuntimeItemTrace(
						formatCallbackTrace('onDidReceiveRuntimeMessageError', languageRuntimeMessageError) +
						`\nName: ${languageRuntimeMessageError.name}` +
						'\nMessage:\n' +
						languageRuntimeMessageError.message +
						formatTraceback(languageRuntimeMessageError.traceback)
					);
				}

				// Add or update the runtime item activity.
				this.addOrUpdateUpdateRuntimeItemActivity(
					languageRuntimeMessageError.parent_id,
					new ActivityItemErrorMessage(
						languageRuntimeMessageError.id,
						languageRuntimeMessageError.parent_id,
						new Date(languageRuntimeMessageError.when),
						languageRuntimeMessageError.name,
						languageRuntimeMessageError.message,
						languageRuntimeMessageError.traceback
					)
				);
			}));

		// Add the onDidReceiveRuntimeMessageState event handler.
		this._runtimeDisposableStore.add(this._session.onDidReceiveRuntimeMessageState(
			languageRuntimeMessageState => {
				// If trace is enabled, add a trace runtime item.
				if (this._trace) {
					this.addRuntimeItemTrace(
						formatCallbackTrace('onDidReceiveRuntimeMessageState', languageRuntimeMessageState) +
						`\nState: ${languageRuntimeMessageState.state}`);
				}

				switch (languageRuntimeMessageState.state) {
					case RuntimeOnlineState.Starting: {
						break;
					}

					case RuntimeOnlineState.Busy: {
						// Generally speaking, we only want to set Busy/Idle state
						// when that state is a result of processing one of our own
						// messages, which begin with `fragment-`. However, if we
						// are currently in the Offline state, the message that
						// brings us back online may not be one of our own messages.
						if (languageRuntimeMessageState.parent_id.startsWith('fragment-') ||
							this.state === PositronConsoleState.Offline) {
							this.setState(PositronConsoleState.Busy);
						}
						// Mark the associated input as busy.
						this.markInputBusyState(languageRuntimeMessageState.parent_id, true);
						break;
					}

					case RuntimeOnlineState.Idle: {
						if (languageRuntimeMessageState.parent_id.startsWith('fragment-') ||
							this.state === PositronConsoleState.Offline) {
							this.setState(PositronConsoleState.Ready);
						}
						// Mark the associated input as idle.
						this.markInputBusyState(languageRuntimeMessageState.parent_id, false);
						break;
					}
				}
			}));

		// Add the onDidReceiveRuntimeClientEvent event handler.
		this._runtimeDisposableStore.add(this._session.onDidReceiveRuntimeClientEvent((event) => {
			if (event.name === UiFrontendEvent.ClearConsole) {
				this.clearConsole();
			}
		}));

		this._runtimeDisposableStore.add(this._session.onDidEndSession((exit) => {
			// If trace is enabled, add a trace runtime item.
			if (this._trace) {
				this.addRuntimeItemTrace(`onDidEndSession (code ${exit.exit_code}, reason '${exit.reason}')`);
			}

			// Add a message explaining that the exit occurred, and why.
			const exited = new RuntimeItemExited(generateUuid(),
				exit.reason,
				this.formatExit(exit));
			this.addRuntimeItem(exited);

			// Show restart button if crashed and user has disabled automatic restarts
			const crashedAndNeedRestartButton = exit.reason === RuntimeExitReason.Error &&
				!this._configurationService.getValue<boolean>('positron.interpreters.restartOnCrash');

			// In the case of a forced quit, normal shutdown, or unknown shutdown where the exit
			// code was `0`, we don't attempt to automatically start the runtime again. In this
			// case, we add an activity item that shows a button the user can use to start the
			// runtime manually.
			if (exit.reason === RuntimeExitReason.ForcedQuit ||
				exit.reason === RuntimeExitReason.Shutdown ||
				exit.reason === RuntimeExitReason.Unknown ||
				crashedAndNeedRestartButton) {
				const restartButton = new RuntimeItemRestartButton(generateUuid(),
					this._session.runtimeMetadata.languageName,
					() => {
						this._onDidRequestRestart.fire();
					});
				this.addRuntimeItem(restartButton);
			}
			this.detachRuntime();
		}));

		this._onDidAttachRuntime.fire(this._session);
	}

	private formatExit(exit: ILanguageRuntimeExit): string {
		switch (exit.reason) {
			case RuntimeExitReason.ForcedQuit:
				return localize('positronConsole.exit.forcedQuit', "{0} was forced to quit.", exit.runtime_name);

			case RuntimeExitReason.Restart:
				return localize('positronConsole.exit.restart', "{0} exited (preparing for restart)", exit.runtime_name);

			case RuntimeExitReason.Shutdown:
			case RuntimeExitReason.SwitchRuntime:
				return localize('positronConsole.exit.shutdown', "{0} shut down successfully.", exit.runtime_name);

			case RuntimeExitReason.Error:
				return localize('positronConsole.exit.error', "{0} exited unexpectedly: {1}", exit.runtime_name, this.formatExitCode(exit.exit_code));

			case RuntimeExitReason.StartupFailed:
				return localize('positronConsole.exit.startupFailed', "{0} failed to start up (exit code {1})", exit.runtime_name, exit.exit_code);

			case RuntimeExitReason.ExtensionHost:
				return localize('positronConsole.exit.extensionHost', "{0} was disconnected from the extension host.", exit.runtime_name);

			default:
			case RuntimeExitReason.Unknown:
				return localize('positronConsole.exit.unknown', "{0} exited (exit code {1})", exit.runtime_name, exit.exit_code);
		}
	}

	private formatExitCode(exitCode: number): string {
		if (exitCode === 1) {
			return localize('positronConsole.exitCode.error', "exit code 1 (error)");
		} else if (exitCode === 126) {
			return localize('positronConsole.exitCode.cannotExit', "exit code 126 (not an executable or no permissions)");
		} else if (exitCode === 127) {
			return localize('positronConsole.exitCode.notFound', "exit code 127 (command not found)");
		} else if (exitCode === 130) {
			return localize('positronConsole.exitCode.interrupted', "exit code 130 (interrupted)");
		} else if (exitCode > 128 && exitCode < 160) {
			// Extract the signal from the exit code
			const signal = exitCode - 128;

			// Provide a human-readable signal name
			let formattedSignal = this.formatSignal(signal);
			if (formattedSignal.length > 0) {
				formattedSignal = ` (${formattedSignal})`;
			}

			return localize('positronConsole.exitCode.killed', "killed with signal {0}{1}", signal, formattedSignal);
		}
		return localize('positronConsole.exitCode.genericError', "exit code {0}", exitCode);
	}

	/**
	 * Formats a signal code for display. These signal codes are intentionally
	 * not localized, and not every signal is listed here (only those commonly
	 * associated with error conditions).
	 *
	 * @param signal The signal code
	 * @returns A string representing the signal, or an empty string if the signal is unknown.
	 */
	private formatSignal(signal: number): string {
		let name: string = '';
		if (signal === 1) {
			name = 'SIGHUP';
		} else if (signal === 2) {
			name = 'SIGINT';
		} else if (signal === 3) {
			name = 'SIGQUIT';
		} else if (signal === 4) {
			name = 'SIGILL';
		} else if (signal === 5) {
			name = 'SIGTRAP';
		} else if (signal === 6) {
			name = 'SIGABRT';
		} else if (signal === 7) {
			name = 'SIGBUS';
		} else if (signal === 9) {
			name = 'SIGKILL';
		} else if (signal === 11) {
			name = 'SIGSEGV';
		} else if (signal === 13) {
			name = 'SIGPIPE';
		} else if (signal === 15) {
			name = 'SIGTERM';
		} else if (signal === 19) {
			name = 'SIGSTOP';
		}
		return name;
	}

	/**
	 * Detaches from a runtime.
	 */
	private detachRuntime() {
		// If trace is enabled, add a trace runtime item.
		if (this._trace) {
			this.addRuntimeItemTrace(`Detach session ${this._session.metadata.sessionName}`);
		}

		if (this.runtimeAttached) {
			// We are currently attached; detach.
			this._runtimeAttached = false;
			this._onDidAttachRuntime.fire(undefined);

			// Clear the executing state of all ActivityItemInputs inputs. When a runtime exits, it
			// may not send an Idle message corresponding to the command that caused it to exit (for
			// instance if the command causes the runtime to crash).
			for (const activity of this._runtimeItemActivities.values()) {
				for (const item of activity.activityItems) {
					if (item instanceof ActivityItemInput) {
						item.state = ActivityItemInputState.Completed;
					}
				}
			}

			// Dispose of the runtime event handlers.
			this._runtimeDisposableStore.dispose();
			this._runtimeDisposableStore = new DisposableStore();
		} else {
			// We are not currently attached; warn.
			console.warn(`Attempt to detach already detached session ${this._session.metadata.sessionName}.`);
		}
	}

	/**
	 * Sets pending code.
	 * @param pendingCode The pending code to set.
	 */
	setPendingCode(pendingCode?: string) {
		this._pendingCode = pendingCode;
		this._onDidSetPendingCodeEmitter.fire(this._pendingCode);
	}

	/**
	 * Adds pending input.
	 * @param code The code for the pending input.
	 */
	private addPendingInput(code: string) {
		// If there is a pending input runtime item, remove it.
		if (this._runtimeItemPendingInput) {
			// Get the index of the pending input runtime item.
			const index = this.runtimeItems.indexOf(this._runtimeItemPendingInput);

			// This index should always be > -1, but be defensive. Remove the pending input runtime
			// item.
			if (index > -1) {
				this._runtimeItems.splice(index, 1);
			}

			// Set the code.
			code = this._runtimeItemPendingInput.code + '\n' + code;
		}

		// Create the pending input runtime item.
		this._runtimeItemPendingInput = new RuntimeItemPendingInput(
			generateUuid(),
			this._session.dynState.inputPrompt,
			code
		);

		// Add the pending input runtime item.
		this.addRuntimeItem(this._runtimeItemPendingInput);
	}

	/**
	 * Clears pending input.
	 */
	private clearPendingInput() {
		// If there is a pending input runtime item, remove it.
		if (this._runtimeItemPendingInput) {
			// Get the index of the pending input runtime item.
			const index = this.runtimeItems.indexOf(this._runtimeItemPendingInput);

			// This index should always be > -1, but be defensive. Remove the pending input runtime
			// item.
			if (index > -1) {
				this._runtimeItems.splice(index, 1);
			}

			// Clear the pending input runtime item.
			this._runtimeItemPendingInput = undefined;
		}
	}

	/**
	 * Remove all restart buttons from the console. We do this once a runtime
	 * has become ready, since at that point the restart is complete.
	 */
	private clearRestartItems() {
		const itemCount = this._runtimeItems.length;

		// Remove all restart buttons from the console.
		this._runtimeItems = this.runtimeItems.filter(
			item => !(item instanceof RuntimeItemRestartButton));

		// If we removed buttons, fire the runtime items changed event.
		if (this._runtimeItems.length !== itemCount) {
			this._onDidChangeRuntimeItemsEmitter.fire();
		}
	}

	/**
	 * Processes pending input.
	 */
	private async processPendingInput(): Promise<void> {
		// If there isn't a pending input runtime item, return.
		if (!this._runtimeItemPendingInput) {
			return;
		}

		// Get the index of the pending input runtime item.
		const index = this.runtimeItems.indexOf(this._runtimeItemPendingInput);

		// This index should always be > -1, but be defensive.
		if (index > -1) {
			this._runtimeItems.splice(index, 1);
		}

		// Get the pending input lines and clear the pending input runtime item.
		const pendingInputLines = this._runtimeItemPendingInput.code.split('\n');
		this._runtimeItemPendingInput = undefined;

		// Find a complete code fragment to execute.
		const codeLines: string[] = [];
		for (let i = 0; i < pendingInputLines.length; i++) {
			// Push the pending input line to the code lines.
			codeLines.push(pendingInputLines[i]);

			// Determine whether the code lines are a complete code fragment. If they are, execute
			// the code fragment.
			const codeFragment = codeLines.join('\n');
			const codeFragmentStatus = await this.session.isCodeFragmentComplete(codeFragment);
			if (codeFragmentStatus === RuntimeCodeFragmentStatus.Complete) {
				// Create the ID for the code fragment that will be executed.
				const id = `fragment-${generateUuid()}`;

				// Add the provisional ActivityItemInput for the code fragment.
				const runtimeItemActivity = new RuntimeItemActivity(
					id,
					new ActivityItemInput(
						ActivityItemInputState.Provisional,
						id,
						id,
						new Date(),
						this._session.dynState.inputPrompt,
						this._session.dynState.continuationPrompt,
						codeFragment
					)
				);
				this._runtimeItems.push(runtimeItemActivity);
				this._runtimeItemActivities.set(id, runtimeItemActivity);

				// If there are remaining pending input lines, add them in a new pending input
				// runtime item so they are processed the next time the runtime becomes idle.
				if (i + 1 < pendingInputLines.length) {
					// Create the pending input runtime item.
					this._runtimeItemPendingInput = new RuntimeItemPendingInput(
						generateUuid(),
						this._session.dynState.inputPrompt,
						pendingInputLines.slice(i + 1).join('\n')
					);

					// Add the pending input runtime item.
					this._runtimeItems.push(this._runtimeItemPendingInput);
				}

				// Fire the runtime items changed event once, now, after everything is set up.
				this._onDidChangeRuntimeItemsEmitter.fire();

				// Execute the code fragment.
				this.session.execute(
					codeFragment,
					id,
					RuntimeCodeExecutionMode.Interactive,
					RuntimeErrorBehavior.Continue);

				// Fire the onDidExecuteCode event.
				this._onDidExecuteCodeEmitter.fire(codeFragment);

				// Return.
				return;
			}
		}

		// Fire the onDidChangeRuntimeItems event because we removed the pending input runtime item.
		this._onDidChangeRuntimeItemsEmitter.fire();

		// The pending input line(s) now become the pending code.
		this.setPendingCode(pendingInputLines.join('\n'));
	}

	/**
	 * Executes code.
	 * @param code The code to execute.
	 */
	private doExecuteCode(code: string) {
		// Create the ID for the code that will be executed.
		const id = `fragment-${generateUuid()}`;

		// Create the provisional ActivityItemInput.
		const activityItemInput = new ActivityItemInput(
			ActivityItemInputState.Provisional,
			id,
			id,
			new Date(),
			this._session.dynState.inputPrompt,
			this._session.dynState.continuationPrompt,
			code
		);

		// Add the provisional ActivityItemInput. This provisional ActivityItemInput will be
		// replaced with the real ActivityItemInput when the runtime sends it (which can take a
		// moment or two to happen).
		this.addOrUpdateUpdateRuntimeItemActivity(id, activityItemInput);

		// Execute the code.
		this.session.execute(
			code,
			id,
			RuntimeCodeExecutionMode.Interactive,
			RuntimeErrorBehavior.Continue);

		// Fire the onDidExecuteCode event.
		this._onDidExecuteCodeEmitter.fire(code);
	}

	/**
	 * Adds a trace runtime item.
	 * @param trace The text.
	 */
	private addRuntimeItemTrace(trace: string) {
		this.addRuntimeItem(new RuntimeItemTrace(generateUuid(), trace));
	}

	/**
	 * Adds or updates an activity runtime item.
	 * @param parentId The parent identifier.
	 * @param activityItem The activity item.
	 */
	private addOrUpdateUpdateRuntimeItemActivity(parentId: string, activityItem: ActivityItem) {
		// Find the activity runtime item. If it was found, add the activity item to it. If not, add
		// a new activity runtime item.
		const runtimeItemActivity = this._runtimeItemActivities.get(parentId);
		if (runtimeItemActivity) {
			// Add the activity item to the activity runtime item.
			runtimeItemActivity.addActivityItem(activityItem);

			// Trim items.
			this.trimItems();

			// Fire the onDidChangeRuntimeItems event.
			this._onDidChangeRuntimeItemsEmitter.fire();
		} else {
			const runtimeItemActivity = new RuntimeItemActivity(parentId, activityItem);
			this._runtimeItemActivities.set(parentId, runtimeItemActivity);
			this.addRuntimeItem(runtimeItemActivity);
		}
	}

	/**
	 * Adds a runtime item.
	 * @param runtimeItem The runtime item.
	 */
	private addRuntimeItem(runtimeItem: RuntimeItem) {
		// Add the runtime item.
		this._runtimeItems.push(runtimeItem);
		if (runtimeItem instanceof RuntimeItemActivity) {
			this._runtimeItemActivities.set(runtimeItem.id, runtimeItem);
		}

		// Trim items.
		this.trimItems();

		// Fire the onDidChangeRuntimeItems event.
		this._onDidChangeRuntimeItemsEmitter.fire();
	}

	/**
	 * Trims items displayed in the console.
	 */
	private trimItems() {
		// Increment the trim counter. Trim items when we reach the trim threshold.
		if (++this._trimCounter < TRIM_THRESHOLD) {
			return;
		}

		// Reset the trim counter.
		this._trimCounter = 0;

		// Trim items.
		let remainingItems = MAX_ITEMS;
		let runtimeItemIndex = this._runtimeItems.length;
		while (remainingItems > 0 && runtimeItemIndex > 0) {
			// Get the runtime item.
			const runtimeItem = this._runtimeItems[--runtimeItemIndex];

			// If the runtime item is a RuntimeItemActivity, trim its activity items; otherwise,
			// decrement the remaining items counter.
			if (runtimeItem instanceof RuntimeItemActivity) {
				remainingItems -= runtimeItem.trimActivityItems(remainingItems);
			} else {
				remainingItems--;
			}
		}

		// If no runtime items were trimmed, return.
		if (!runtimeItemIndex) {
			return;
		}

		// Trim the runtime items.
		const trimmedRuntimeItems = this._runtimeItems.slice(0, runtimeItemIndex);
		this._runtimeItems = this._runtimeItems.slice(runtimeItemIndex);

		// Remove runtime item activities that were trimmed.
		trimmedRuntimeItems.filter(trimmedRuntimeItem =>
			trimmedRuntimeItem instanceof RuntimeItemActivity
		).forEach(runtimeItemActivity =>
			this._runtimeItemActivities.delete(runtimeItemActivity.id)
		);
	}

	//#endregion Private Methods
}

// Register the Positron console service.
registerSingleton(IPositronConsoleService, PositronConsoleService, InstantiationType.Delayed);
