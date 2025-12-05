/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Disposable, DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { ISettableObservable, observableValue } from '../../../../base/common/observable.js';
import { IViewsService } from '../../views/common/viewsService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { RuntimeItem } from './classes/runtimeItem.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ThrottledEmitter } from './classes/throttledEmitter.js';
import { RuntimeItemTrace } from './classes/runtimeItemTrace.js';
import { RuntimeItemExited } from './classes/runtimeItemExited.js';
import { RuntimeItemStarted } from './classes/runtimeItemStarted.js';
import { RuntimeItemStartup } from './classes/runtimeItemStartup.js';
import { RuntimeItemOffline } from './classes/runtimeItemOffline.js';
import { ActivityItemPrompt, ActivityItemPromptState } from './classes/activityItemPrompt.js';
import { RuntimeItemStarting } from './classes/runtimeItemStarting.js';
import { ActivityItemOutputPlot } from './classes/activityItemOutputPlot.js';
import { RuntimeItemReconnected } from './classes/runtimeItemReconnected.js';
import { ActivityItemOutputHtml } from './classes/activityItemOutputHtml.js';
import { RuntimeItemPendingInput } from './classes/runtimeItemPendingInput.js';
import { RuntimeItemRestartButton } from './classes/runtimeItemRestartButton.js';
import { ActivityItemErrorMessage } from './classes/activityItemErrorMessage.js';
import { ActivityItemOutputMessage } from './classes/activityItemOutputMessage.js';
import { RuntimeItemStartupFailure } from './classes/runtimeItemStartupFailure.js';
import { ActivityItem, ActivityItemOutput, RuntimeItemActivity } from './classes/runtimeItemActivity.js';
import { ActivityItemInput, ActivityItemInputState } from './classes/activityItemInput.js';
import { ActivityItemStream, ActivityItemStreamType } from './classes/activityItemStream.js';
import { DidNavigateInputHistoryUpEventArgs, IPositronConsoleInstance, IPositronConsoleService, POSITRON_CONSOLE_VIEW_ID, PositronConsoleState, SessionAttachMode } from './interfaces/positronConsoleService.js';
import { ILanguageRuntimeExit, ILanguageRuntimeInfo, ILanguageRuntimeMessage, ILanguageRuntimeMessageOutput, ILanguageRuntimeMessageOutputData, ILanguageRuntimeMessageUpdateOutput, ILanguageRuntimeMetadata, LanguageRuntimeSessionMode, RuntimeCodeExecutionMode, RuntimeCodeFragmentStatus, RuntimeErrorBehavior, RuntimeExitReason, RuntimeOnlineState, RuntimeOutputKind, RuntimeState, formatLanguageRuntimeMetadata, formatLanguageRuntimeSession } from '../../languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionMetadata, IRuntimeSessionService, RuntimeStartMode } from '../../runtimeSession/common/runtimeSessionService.js';
import { UiFrontendEvent } from '../../languageRuntime/common/positronUiComm.js';
import { IRuntimeStartupService, ISessionRestoreFailedEvent, SerializedSessionMetadata } from '../../runtimeStartup/common/runtimeStartupService.js';
import { ExecutionEntryType, IExecutionHistoryEntry, IExecutionHistoryService } from '../../positronHistory/common/executionHistoryService.js';
import { Extensions as ConfigurationExtensions, IConfigurationNode, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { CodeAttributionSource, IConsoleCodeAttribution, ILanguageRuntimeCodeExecutedEvent } from '../common/positronConsoleCodeExecution.js';
import { EDITOR_FONT_DEFAULTS } from '../../../../editor/common/config/fontInfo.js';
import { URI } from '../../../../base/common/uri.js';

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
 * The trace output max length.
 */
const TRACE_OUTPUT_MAX_LENGTH = 1000;

/**
 * The prefix for execution IDs affiliated with the Positron Console
 */
export const POSITRON_CONSOLE_EXEC_PREFIX = 'fragment-';

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
 * Formats an output message.
 * @param message The message to format.
 * @returns The formatted output message.
 */
const formatOutputMessage = (message: ILanguageRuntimeMessageOutput | ILanguageRuntimeMessageUpdateOutput) =>
	message.output_id ? `Output ID: ${message.output_id}` : '' + formatOutputData(message.data);

/**
 * Formats output data.
 * @param data The output data.
 * @returns The formatted output data.
 */
const formatOutputData = (data: ILanguageRuntimeMessageOutputData) => {
	let result = '\nOutput:';
	if (!data['text/plain']) {
		result += ' None';
	} else {
		result += '\n' + data['text/plain'];
	}
	return result;
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

/**
 * Sanitizes trace output.
 * @param traceOutput The trace output.
 * @returns The sanitized trace output.
 */
const sanitizeTraceOutput = (traceOutput: string) => {
	// Sanitize the trace output. This involves trimming it to a maximum length and replacing
	// certain characters with a text representation.
	traceOutput = traceOutput.slice(0, TRACE_OUTPUT_MAX_LENGTH);
	traceOutput = traceOutput.replaceAll('\t', '[HT]');
	traceOutput = traceOutput.replaceAll('\n', '[LF]');
	traceOutput = traceOutput.replaceAll('\r', '[CR]');
	traceOutput = traceOutput.replaceAll('\x9B', 'CSI');
	traceOutput = traceOutput.replaceAll('\x1b', 'ESC');
	traceOutput = traceOutput.replaceAll('\x9B', 'CSI');

	// If the trace output was trimmed, add an ellipsis to indicate that.
	if (traceOutput.length > TRACE_OUTPUT_MAX_LENGTH) {
		traceOutput += '...';
	}

	// Return the sanitized trace output.
	return traceOutput;
};

/**
 * Formats the stream length.
 * @param length The stream length.
 * @returns The formatted stram length.
 */
const formattedLength = (length: number) => {
	if (length < 1000) {
		return `${length} chars`;
	}
	if (length < 1000 * 1000) {
		return `${(length / 1000).toFixed(1)} KB`;
	}
	return `${(length / 1000 / 1000).toFixed(1)} MB`;
};

//#endregion Helper Functions

// Configuration registry.
const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);

/**
 * The console service configuration base node for confugurations settings below.
 */
const consoleServiceConfigurationBaseNode = Object.freeze<IConfigurationNode>({
	id: 'console',
	order: 100,
	type: 'object',
	title: localize('consoleConfigurationTitle', "Console"),
});

/**
 * Console configuration settings.
 */
export const scrollbackSizeSettingId = 'console.scrollbackSize';
configurationRegistry.registerConfiguration({
	...consoleServiceConfigurationBaseNode,
	properties: {
		// Font family.
		'console.fontFamily': {
			type: 'string',
			'default': EDITOR_FONT_DEFAULTS.fontFamily,
			description: localize('console.fontFamily', "Controls the font family."),
		},
		// Font ligatures.
		'console.fontLigatures': {
			anyOf: [
				{
					type: 'boolean',
					description: localize('console.fontLigatures', "Enables/Disables font ligatures ('calt' and 'liga' font features). Change this to a string for fine-grained control of the 'font-feature-settings' CSS property."),
				},
				{
					type: 'string',
					description: localize('console.fontFeatureSettings', "Explicit 'font-feature-settings' CSS property. A boolean can be passed instead if one only needs to turn on/off ligatures.")
				}
			],
			description: localize('console.fontLigaturesGeneral', "Configures font ligatures or font features. Can be either a boolean to enable/disable ligatures or a string for the value of the CSS 'font-feature-settings' property."),
			default: false
		},
		// Font size.
		'console.fontSize': {
			type: 'number',
			minimum: 6,
			maximum: 100,
			default: EDITOR_FONT_DEFAULTS.fontSize,
			description: localize('console.fontSize', "Controls the font size in pixels."),
		},
		// Font variations.
		'console.fontVariations': {
			anyOf: [
				{
					type: 'boolean',
					description: localize('console.fontVariations', "Enables/Disables the translation from font-weight to font-variation-settings. Change this to a string for fine-grained control of the 'font-variation-settings' CSS property."),
				},
				{
					type: 'string',
					description: localize('console.fontVariationSettings', "Explicit 'font-variation-settings' CSS property. A boolean can be passed instead if one only needs to translate font-weight to font-variation-settings.")
				}
			],
			description: localize('console.fontVariationsGeneral', "Configures font variations. Can be either a boolean to enable/disable the translation from font-weight to font-variation-settings or a string for the value of the CSS 'font-variation-settings' property."),
			default: false
		},
		// Font weight.
		'console.fontWeight': {
			type: 'string',
			enum: ['normal', 'bold'],
			enumDescriptions: [
				localize('console.fontWeight.normal', "Normal font weight."),
				localize('console.fontWeight.bold', "Bold font weight.")
			],
			default: EDITOR_FONT_DEFAULTS.fontWeight,
			description: localize('console.fontWeight', "Controls the font weight."),
		},
		// Letter spacing.
		'console.letterSpacing': {
			type: 'number',
			minimum: -5,
			maximum: 20,
			default: EDITOR_FONT_DEFAULTS.letterSpacing,
			markdownDescription: localize('console.letterSpacing', "Controls the letter spacing in pixels."),
		},
		// Line height.
		'console.lineHeight': {
			type: 'number',
			minimum: 0,
			maximum: 150,
			default: EDITOR_FONT_DEFAULTS.lineHeight,
			description: localize('console.lineHeight', "Controls the line height."),
			markdownDescription: localize('console.lineHeight2', "Controls the line height. \n - Use 0 to automatically compute the line height from the font size.\n - Values between 0 and 8 will be used as a multiplier with the font size.\n - Values greater than or equal to 8 will be used as effective values."),
		},
		// Scrollback size.
		'console.scrollbackSize': {
			type: 'number',
			'minimum': 500,
			'maximum': 5000,
			'default': 1000,
			markdownDescription: localize('console.scrollbackSize', "The number of console output items to display."),
		},
		// Whether to show notebook consoles
		'console.showNotebookConsoles': {
			type: 'boolean',
			default: false,
			markdownDescription: localize('console.showNotebookConsoles', "Whether to show consoles for open notebooks."),
		}
	}
});

/**
 * PositronConsoleService class.
 */
export class PositronConsoleService extends Disposable implements IPositronConsoleService {
	//#region Private Properties

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
	 * The onDidDeletePositronConsoleInstance event emitter.
	 */
	private readonly _onDidDeletePositronConsoleInstanceEmitter = this._register(new Emitter<IPositronConsoleInstance>);

	/**
	 * The onDidChangeActivePositronConsoleInstance event emitter.
	 */
	private readonly _onDidChangeActivePositronConsoleInstanceEmitter = this._register(new Emitter<IPositronConsoleInstance | undefined>);

	/**
	 * The onDidChangeConsoleWidth event emitter.
	 */
	private readonly _onDidChangeConsoleWidthEmitter = this._register(new Emitter<number>());

	/**
	 * The onDidExecuteCode event emitter.
	 */
	private readonly _onDidExecuteCodeEmitter = this._register(new Emitter<ILanguageRuntimeCodeExecutedEvent>);

	/**
	 * The debounce timer for the onDidChangeConsoleWidth event.
	 */
	private _consoleWidthDebounceTimer: Timeout | undefined;

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param _configurationService The configuration service.
	 * @param _executionHistoryService The execution history service.
	 * @param _instantiationService The instantiation service.
	 * @param _logService The log service service.
	 * @param _runtimeSessionService The runtime session service.
	 * @param _runtimeStartupService The runtime affiliation service.
	 * @param _viewsService The views service.
	 */
	constructor(
		@IExecutionHistoryService private readonly _executionHistoryService: IExecutionHistoryService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IRuntimeStartupService private readonly _runtimeStartupService: IRuntimeStartupService,
		@IViewsService private readonly _viewsService: IViewsService,
		@INotificationService private readonly _notificationService: INotificationService
	) {
		// Call the disposable constructor.
		super();

		// Start a Positron console instance for each session that will be restored.
		//
		// These are provisional instances not backed by a live session; they
		// are placeholders shown during startup while the session attempts to
		// restore.
		this._runtimeStartupService.getRestoredSessions().then(restoredSessions => {
			let first = true;
			const hasActiveSession = !!this.activePositronConsoleInstance;
			restoredSessions.forEach(session => {
				// Activate the first restored console session, if no session
				// is active.
				const activate = first && !hasActiveSession;
				if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Console ||
					session.hasConsole) {
					first = false;
					try {
						this.restorePositronConsole(session, activate);
					} catch (err) {
						this._logService.error(
							`Error restoring ${session.metadata.sessionId}: ${err}`);
					}
				}
			});
		}).catch(err => {
			// Survivable, we'll just log the error.
			this._logService.error('Error restoring Positron console sessions:', err);
		});

		// Start a Positron console instance for each running runtime. Only
		// activate the first one.
		let first = true;
		this._runtimeSessionService.activeSessions.forEach(s => {
			const session = this._runtimeSessionService.getActiveSession(s.sessionId);
			if (!session) {
				this._logService.warn(`No active session found for ${s.sessionId}`);
				return;
			}
			if (session.hasConsole) {
				// The instance should be activated if it is the foreground
				// session.
				let activate = false;
				if (this._runtimeSessionService.foregroundSession &&
					s.sessionId === this._runtimeSessionService.foregroundSession.sessionId) {
					activate = true;
				}

				// The instance should also be activated if it is the first
				// session and there is no designated foreground session.
				if (first && !this._runtimeSessionService.foregroundSession) {
					activate = true;
				}

				this.startPositronConsoleInstance(s, SessionAttachMode.Connected, activate);
				first = false;
			}
		});

		// Register the onWillStartSessiopn event handler so we start a new
		// Positron console instance before a runtime starts up.
		this._register(this._runtimeSessionService.onWillStartSession(e => {
			// Ignore non-console sessions
			if (!e.hasConsole) {
				return;
			}

			let attachMode: SessionAttachMode;
			if (e.startMode === RuntimeStartMode.Starting) {
				attachMode = SessionAttachMode.Starting;
			} else if (e.startMode === RuntimeStartMode.Restarting) {
				attachMode = SessionAttachMode.Restarting;
			} else if (e.startMode === RuntimeStartMode.Reconnecting) {
				attachMode = SessionAttachMode.Reconnecting;
			} else if (e.startMode === RuntimeStartMode.Switching) {
				attachMode = SessionAttachMode.Switching;
			} else {
				throw new Error(`Unexpected runtime start mode: ${e.startMode}`);
			}

			// If there is already a Positron console instance for the runtime,
			// just reattach
			const existingInstance = this._positronConsoleInstancesBySessionId.get(
				e.session.sessionId);
			if (existingInstance) {
				// Reattach the runtime; runtimes always detach on exit and are
				// reattached on startup.
				existingInstance.attachRuntimeSession(e.session, attachMode);
				return;
			}

			/**
			 * Reuse an instance for the same runtime if we have one. This needs to happen when
			 * the extension host is disconnected and we have disconnected sessions that need to be
			 * restored.
			 *
			 * NOTE: This logic for re-using a console instance has issues!
			 * - If a user attempts to start a session for a specific console instance there is no
			 * gaurantee the session will be attached to that console instance.
			 * - If a user attempts to create a new console session while there is a console instance
			 * whose session has exited, that console instance will be repurposed instead of creating
			 * a new one. This is problematic because the user's intention was to creat a new console
			 * instance with a new session.
			 */
			const positronConsoleInstance = this._positronConsoleInstancesBySessionId.get(e.session.sessionId);

			if (positronConsoleInstance) {
				this._positronConsoleInstancesBySessionId.delete(positronConsoleInstance.sessionId);
				positronConsoleInstance.attachRuntimeSession(e.session, attachMode);
				this._positronConsoleInstancesBySessionId.set(e.session.sessionId, positronConsoleInstance);
			} else {
				// Create a new Positron console instance if we don't have a console instance we can reuse
				this.startPositronConsoleInstance(e.session, attachMode, e.activate);
			}
		}));

		// Register the onDidFailStartRuntime event handler so we activate the new Positron console instance when the runtime starts up.
		this._register(this._runtimeSessionService.onDidFailStartRuntime(session => {
			const positronConsoleInstance = this._positronConsoleInstancesBySessionId.get(session.sessionId);

			if (positronConsoleInstance) {
				positronConsoleInstance.setState(PositronConsoleState.Exited);
			}
		}));

		// Register the onSessionRestoreFailure event handler so we can show
		// the restore failure in the console.
		this._register(this._runtimeStartupService.onSessionRestoreFailure(evt => {
			const positronConsoleInstance =
				this._positronConsoleInstancesBySessionId.get(evt.sessionId);
			if (positronConsoleInstance) {
				positronConsoleInstance.showRestoreFailure(evt);
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

		this._register(this._runtimeSessionService.onDidDeleteRuntimeSession(sessionId => {
			this.deletePositronConsoleSession(sessionId);
		}));
	}

	//#endregion Constructor & Dispose

	//#region IPositronConsoleService Implementation

	// Needed for service branding in dependency injector.
	declare readonly _serviceBrand: undefined;

	// An event that is fired when a REPL instance is started.
	readonly onDidStartPositronConsoleInstance = this._onDidStartPositronConsoleInstanceEmitter.event;

	// An event that is fired when a REPL instance is deleted.
	readonly onDidDeletePositronConsoleInstance = this._onDidDeletePositronConsoleInstanceEmitter.event;

	// An event that is fired when the active REPL instance changes.
	readonly onDidChangeActivePositronConsoleInstance = this._onDidChangeActivePositronConsoleInstanceEmitter.event;

	// An event that is fired when the width of the console changes.
	readonly onDidChangeConsoleWidth = this._onDidChangeConsoleWidthEmitter.event;

	// An event that is fired when code is executed in a REPL instance.
	readonly onDidExecuteCode = this._onDidExecuteCodeEmitter.event;

	// Gets the repl instances.
	get positronConsoleInstances(): IPositronConsoleInstance[] {
		return Array.from(this._positronConsoleInstancesBySessionId.values());
	}

	// Gets the active REPL instance.
	get activePositronConsoleInstance(): IPositronConsoleInstance | undefined {
		return this._activePositronConsoleInstance;
	}

	// Gets the active code editor.
	get activeCodeEditor(): ICodeEditor | undefined {
		return this._activePositronConsoleInstance?.codeEditor;
	}

	/**
	 * Placeholder that gets called to "initialize" the PositronConsoleService.
	 */
	initialize() {
	}

	/**
	 * Begins the process of restoring a Positron console.
	 *
	 * @param session The session to restore.
	 * @param activate Whether to activate the console instance immediately.
	 */
	private restorePositronConsole(session: SerializedSessionMetadata, activate: boolean) {
		// Create a provisional console from the serialized metadata. This
		// console won't be connected to a live session until the runtime
		// successfully reconnects.
		const sessionId = session.metadata.sessionId;
		const console = this.createPositronConsoleInstance(
			session.sessionName,
			session.metadata,
			session.runtimeMetadata,
			activate
		);

		// Set the initial working directory to the session's working directory.
		console.initialWorkingDirectory = session.workingDirectory;

		// Replay all the execution entries for the session.
		const entries = this._executionHistoryService.getExecutionEntries(sessionId);
		console.replayExecutions(entries);
	}

	/**
	 * Executes code in a PositronConsoleInstance.
	 * @param languageId The language ID.
	 * @param sessionId An optional session ID. If provided, the code will be executed in the
	 *  Positron console instance for the specified session. If not provided, the code will be
	 *   executed in the active Positron console instance for the language, or a new Positron
	 *   console instance will be created if there is no active instance for the language.
	 * @param code The code.
	 * @param attribution Attribution naming the origin of the code.
	 * @param focus A value which indicates whether to focus the Positron console instance.
	 * @param allowIncomplete Whether to bypass runtime code completeness checks. If true, the `code`
	 *   will be executed by the runtime even if it is incomplete or invalid. Defaults to false
	 * @param mode Possible code execution modes for a language runtime
	 * @param errorBehavior Possible error behavior for a language runtime
	 * @param executionId An optional ID that can be used to identify the execution
	 *   (e.g. for tracking execution history). If not provided, one will be assigned.
	 * @returns The session ID that will be used to execute the code.
	 */
	async executeCode(languageId: string,
		sessionId: string | undefined,
		code: string,
		attribution: IConsoleCodeAttribution,
		focus: boolean,
		allowIncomplete?: boolean,
		mode?: RuntimeCodeExecutionMode,
		errorBehavior?: RuntimeErrorBehavior,
		executionId?: string): Promise<string> {
		// When code is executed in the console service, open the console view. This opens
		// the relevant pane composite if needed.
		await this._viewsService.openView(POSITRON_CONSOLE_VIEW_ID, false);

		let positronConsoleInstance: PositronConsoleInstance | undefined;

		if (sessionId) {
			const existingInstance = this._positronConsoleInstancesBySessionId.get(sessionId);
			// Just a sanity check
			if (existingInstance) {
				const existingLanguageId = existingInstance.runtimeMetadata.languageId;
				// It's possible that someone could try to execute code in a
				// session that is for a different language than the code being
				// executed. It's arguable whether we should allow this or not, but
				// for now we'll just log a warning and send the code along.
				if (existingLanguageId !== languageId) {
					this._logService.warn(
						`Code is being executed in a Positron console instance for language ` +
						`${existingLanguageId} (session ${sessionId}), not for requested language ` +
						`${languageId}.`);
				}
				positronConsoleInstance = existingInstance;
			} else {
				throw new Error(
					`Cannot execute code because the requested session ID ${sessionId} ` +
					`does not have a Positron console instance.`);
			}
		}

		// If no session was provided and the language desired is the language
		// of the current console session, prefer that
		if (!positronConsoleInstance) {
			if (this._activePositronConsoleInstance?.runtimeMetadata.languageId === languageId &&
				this._activePositronConsoleInstance?.sessionMetadata.sessionMode === LanguageRuntimeSessionMode.Console) {
				positronConsoleInstance = this._positronConsoleInstancesBySessionId.get(
					this._activePositronConsoleInstance.sessionId);
				sessionId = positronConsoleInstance?.sessionId;
			}
		}

		// No session provided and the active console instance is not for the
		// desired language, so look for *any* existing console instance for the
		// desired language.
		if (!positronConsoleInstance) {
			const allInstances = Array.from(this._positronConsoleInstancesBySessionId.values());
			// Sort the array by most recently used (MRU) so that we prefer the
			// most recently created session
			allInstances.sort((a, b) => b.sessionMetadata.createdTimestamp - a.sessionMetadata.createdTimestamp);
			for (const instance of allInstances) {
				if (instance.runtimeMetadata.languageId === languageId &&
					instance.sessionMetadata.sessionMode === LanguageRuntimeSessionMode.Console
				) {
					positronConsoleInstance = instance;
					break;
				}
			}
		}

		// No existing Positron console instance was found, so create a new one
		if (!positronConsoleInstance) {
			// Get the preferred runtime for the language and start it
			const languageRuntime = this._runtimeStartupService.getPreferredRuntime(languageId);
			if (languageRuntime) {
				// Start the preferred runtime.
				this._logService.trace(`Language runtime ` +
					`${formatLanguageRuntimeMetadata(languageRuntime)} automatically starting`);
				sessionId = await this._runtimeSessionService.startNewRuntimeSession(
					languageRuntime.runtimeId,
					languageRuntime.runtimeName,
					LanguageRuntimeSessionMode.Console,
					undefined, // No notebook URI (console sesion)
					`User executed code in language ${languageId}, and no running runtime session was found ` +
					`for the language.`,
					RuntimeStartMode.Starting,
					true
				);
			} else {
				// There is no registered runtime for the language, so we can't execute code.
				throw new Error(
					`Cannot execute code because there is no registered runtime for the '${languageId}' language.`);
			}

			// If the runtime was started successfully, we should now have an entry for it
			positronConsoleInstance = this._positronConsoleInstancesBySessionId.get(sessionId);
		}

		// If we still don't have a Positron console instance, something went wrong.
		if (!positronConsoleInstance) {
			throw new Error(
				`Could not find or create console for language ID ${languageId} ` +
				`(attempting to execute ${code})`);
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
		await positronConsoleInstance.enqueueCode(code, attribution, allowIncomplete, mode, errorBehavior, executionId);
		return Promise.resolve(positronConsoleInstance.sessionId);
	}

	/**
	 * Show or create a notebook console
	 *
	 * @param notebookUri The URI of the notebook
	 * @param focus Whether to focus the console input
	 */
	showNotebookConsole(notebookUri: URI, focus: boolean): void {
		// Check to see if we have a session to back this console
		const session = this._runtimeSessionService.getNotebookSessionForNotebookUri(notebookUri);
		if (!session) {
			this._notificationService.warn(localize('positron.noNotebookSession', "No session is running for notebook {0}", notebookUri.toString()));
			return;
		}

		const positronConsoleInstance = this._positronConsoleInstancesBySessionId.get(session.sessionId);
		if (positronConsoleInstance) {
			// We already have a console instance! Focus it
			this._viewsService.openView(POSITRON_CONSOLE_VIEW_ID);
			this.setActivePositronConsoleInstance(positronConsoleInstance);
			if (focus) {
				positronConsoleInstance.focusInput();
			}
			return;
		}

		// No console instance yet; start one
		this._viewsService.openView(POSITRON_CONSOLE_VIEW_ID);
		this.startPositronConsoleInstance(session, SessionAttachMode.Connected, focus);
	}

	//#endregion IPositronConsoleService Implementation

	//#region Private Methods

	/**
	 * Starts a Positron console instance for the specified runtime session.
	 *
	 * @param session The session for the new Positron console instance.
	 * @param attachMode A value which indicates the mode in which to attach the session.
	 * @param activate Whether to activate the console instance immediately
	 *
	 * @returns The new Positron console instance.
	 */
	private startPositronConsoleInstance(
		session: ILanguageRuntimeSession,
		attachMode: SessionAttachMode,
		activate: boolean
	): IPositronConsoleInstance {
		// Create the instance
		const instance = this.createPositronConsoleInstance(
			session.dynState.sessionName,
			session.metadata,
			session.runtimeMetadata,
			activate
		);

		// Attach it to the session
		instance.attachRuntimeSession(session, attachMode);
		return instance;
	}

	/**
	 * Creates a new Positron console instance given the metadata of the
	 * runtime and session.
	 *
	 * This creates a detached (provisional) instance that is not connected to
	 * the session; use the `attachRuntimeSession` method to connect it to a
	 * live session.
	 *
	 * @param sessionName The name of the session.
	 * @param sessionMetadata The session metadata.
	 * @param runtimeMetadata The runtime metadata.
	 * @param activate Whether to activate the console instance immediately.
	 * @returns The new Positron console instance.
	 */
	private createPositronConsoleInstance(
		sessionName: string,
		sessionMetadata: IRuntimeSessionMetadata,
		runtimeMetadata: ILanguageRuntimeMetadata,
		activate: boolean): IPositronConsoleInstance {
		// Create the new Positron console instance.
		const positronConsoleInstance = this._register(this._instantiationService.createInstance(
			PositronConsoleInstance,
			sessionName,
			sessionMetadata,
			runtimeMetadata,
		));

		this._positronConsoleInstancesBySessionId.set(
			sessionMetadata.sessionId,
			positronConsoleInstance
		);

		// Fire the onDidStartPositronConsoleInstance event.
		this._onDidStartPositronConsoleInstanceEmitter.fire(positronConsoleInstance);

		// Set the active positron console instance, if requested
		if (activate) {
			this._activePositronConsoleInstance = positronConsoleInstance;

			// Fire the onDidChangeActivePositronConsoleInstance event.
			this._onDidChangeActivePositronConsoleInstanceEmitter.fire(positronConsoleInstance);
		}

		// Listen for console width changes.
		this._register(positronConsoleInstance.onDidChangeWidthInChars(width => {
			this.onConsoleWidthChange(width);
		}));

		// Listen for code executions and forward them.
		this._register(positronConsoleInstance.onDidExecuteCode(codeExecution => {
			this._onDidExecuteCodeEmitter.fire(codeExecution);
		}));

		// When the console is cleared, clear the execution history for the console.
		this._register(positronConsoleInstance.onDidClearConsole(() => {
			this._executionHistoryService.clearExecutionEntries(positronConsoleInstance.sessionId);
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
	 * Sets the active Positron console session.
	 *
	 * @param sessionId The session ID to set as active.
	 */
	setActivePositronConsoleSession(sessionId: string): void {
		// Find the console instance with the given session ID.
		const consoleInstance = this._positronConsoleInstancesBySessionId.get(sessionId);
		if (consoleInstance) {
			this.setActivePositronConsoleInstance(consoleInstance);
		}
	}

	/**
	 * Deletes the Positron console instance corresponding to the given session ID.
	 *
	 * @param sessionId The session ID to delete.
	 */
	deletePositronConsoleSession(sessionId: string): void {
		const consoleInstance = this._positronConsoleInstancesBySessionId.get(sessionId);
		if (!consoleInstance) {
			return;
		}

		// Update the foreground session.
		// First try to use the last created console session for the runtime.
		let runtimeSession = this._runtimeSessionService.getConsoleSessionForRuntime(
			consoleInstance.runtimeMetadata.runtimeId
		);
		if (!runtimeSession) {
			// Otherwise, select the next available runtime session.
			const sessions = Array.from(this._positronConsoleInstancesBySessionId.values());
			const currentIndex = sessions.indexOf(consoleInstance);
			if (currentIndex !== -1) {
				const nextSession = sessions[currentIndex + 1] || sessions[currentIndex - 1];
				runtimeSession = nextSession?.session;
			}
		}
		this._runtimeSessionService.foregroundSession = runtimeSession;
		this._positronConsoleInstancesBySessionId.delete(sessionId);

		consoleInstance.dispose();

		this._onDidDeletePositronConsoleInstanceEmitter.fire(consoleInstance);
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
 * Pending code fragment with its execution metadata.
 */
interface IPendingCodeFragment {
	code: string;
	attribution: IConsoleCodeAttribution;
	executionId: string | undefined;
	mode: RuntimeCodeExecutionMode;
	errorBehavior: RuntimeErrorBehavior;
}

/**
 * PositronConsoleInstance class.
 */
class PositronConsoleInstance extends Disposable implements IPositronConsoleInstance {
	//#region Private Properties

	/**
	 * Maps pending code fragments to their execution IDs.
	 * This allows us to associate execution observer callbacks with the right code
	 * when it is eventually executed.
	 */
	private _pendingExecutionIds: Map<string, string> = new Map<string, string>();

	/**
	 * The set of external execution IDs. This is used to track execution
	 * requests that did not initiate from the console but are nonetheless run
	 * in the console.
	 */
	private _externalExecutionIds: Set<string> = new Set<string>();

	/**
	 * Queue of pending code fragments waiting to be executed.
	 */
	private _pendingCodeQueue: IPendingCodeFragment[] = [];

	/**
	 * Gets or sets the session, if attached.
	 */
	private _session: ILanguageRuntimeSession | undefined;

	/**
	 * The name of the session when the console instance was created.
	 * This is used as a fallback when the session is not attached.
	 */
	private _initialSessionName: string;

	/**
	 * Gets or sets the disposable store. This contains things that are disposed when a runtime is
	 * detached.
	 */
	private readonly _runtimeDisposableStore = new DisposableStore();

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
	 * The RuntimeItemPendingInput.
	 */
	private _runtimeItemPendingInput?: RuntimeItemPendingInput;

	/**
	 * Determines whether or not pending input is currently being processed.
	 */
	private _pendingInputState: 'Idle' | 'Processing' | 'Interrupted' = 'Idle';

	/**
	 * Gets or sets the runtime items.
	 */
	private _runtimeItems: RuntimeItem[] = [];

	/**
	 * Gets or sets the runtime item activities. This is keyed by parent ID.
	 */
	private _runtimeItemActivities = new Map<string, RuntimeItemActivity>();

	/**
	 * Gets or sets the active activity item prompt.
	 */
	private _activeActivityItemPrompt?: ActivityItemPrompt;

	/**
	 * Gets or sets the scrollback size.
	 */
	private _scrollbackSize: number;

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
	 * The last text that was pasted into the console.
	 */
	private _lastPastedText: string = '';

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
	 * The onDidNavigateInputHistoryDown event emitter.
	 */
	private readonly _onDidNavigateInputHistoryDownEmitter = this._register(new Emitter<void>());

	/**
	 * The onDidNavigateInputHistoryUp event emitter.
	 */
	private readonly _onDidNavigateInputHistoryUpEmitter = this._register(new Emitter<DidNavigateInputHistoryUpEventArgs>());

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
	private readonly _onDidExecuteCodeEmitter = this._register(new Emitter<ILanguageRuntimeCodeExecutedEvent>);

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
	 * Provides access to the code editor, if it's available. Note that we generally prefer to
	 * interact with this editor indirectly, since its state is managed by React.
	 */
	private _codeEditor: ICodeEditor | undefined;

	/**
	 * An observable value representing the current console width in characters
	 */
	private readonly _widthInChars: ISettableObservable<number>;

	/**
	 * The initial working directory.
	 */
	private _initialWorkingDirectory: string = '';

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 *
	 * @param sessionName The name of the session.
	 * @param _sessionMetadata The metadata for the session.
	 * @param _runtimeMetadata The metadata for the runtime.
	 * @param _notificationService The notification service.
	 */
	constructor(
		sessionName: string,
		private _sessionMetadata: IRuntimeSessionMetadata,
		private _runtimeMetadata: ILanguageRuntimeMetadata,
		@INotificationService private readonly _notificationService: INotificationService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) {
		// Call the base class's constructor.
		super();

		// Initialize the session name.
		this._initialSessionName = sessionName;

		// Initialize the scrollback configuration.
		this._scrollbackSize = this._configurationService.getValue<number>(scrollbackSizeSettingId);

		// Register the onDidChangeConfiguration event handler so we can update the console scrollback
		// configuration.
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(scrollbackSizeSettingId)) {
				this._scrollbackSize = this._configurationService.getValue<number>(scrollbackSizeSettingId);
			}
		}));

		// Initialize the width in characters.
		this._widthInChars = observableValue<number>('console-width', 80);
		this.onDidChangeWidthInChars = Event.fromObservable(this._widthInChars);
	}

	/**
	 * Gets the code editor.
	 */
	get codeEditor(): ICodeEditor | undefined {
		return this._codeEditor;
	}

	/**
	 * Sets the code editor. This is called from the React component after the editor (a
	 * `CodeEditorWidget`) is created and mounted.
	 */
	set codeEditor(value: ICodeEditor | undefined) {
		this._codeEditor = value;
	}

	get sessionMetadata(): IRuntimeSessionMetadata {
		return this._sessionMetadata;
	}

	get runtimeMetadata(): ILanguageRuntimeMetadata {
		return this._runtimeMetadata;
	}

	get sessionId(): string {
		return this._sessionMetadata.sessionId;
	}

	/**
	 * Gets the name of the runtime session associated with the console instance.
	 *
	 * If there is no session associated with the console, we fallback to the
	 * session name provided when the console was created.
	 */
	get sessionName(): string {
		return this._session?.dynState.sessionName || this._initialSessionName;
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

	/**
	 * Adds disposables that should be cleaned up when this instance is disposed.
	 * @param disposables The disposables to add.
	 */
	addDisposables(disposables: IDisposable): void {
		this._register(disposables);
	}

	//#endregion Constructor & Dispose

	//#region IPositronConsoleInstance Implementation

	/**
	 * Gets the runtime session.
	 */
	get session(): ILanguageRuntimeSession | undefined {
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
		return this._activeActivityItemPrompt !== undefined;
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
	 * onDidNavigateInputHistoryDown event.
	 */
	readonly onDidNavigateInputHistoryDown = this._onDidNavigateInputHistoryDownEmitter.event;

	/**
	 * onDidNavigateInputHistoryUp event.
	 */
	readonly onDidNavigateInputHistoryUp = this._onDidNavigateInputHistoryUpEmitter.event;

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
	readonly onDidAttachSession = this._onDidAttachRuntime.event;

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
			this.addRuntimeItemTrace(`Trace enabled; console state is '${this._state}'`);
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
		this._lastPastedText = text;
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
		if (this._activeActivityItemPrompt) {
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
	 * Navigates the input history down.
	 */
	navigateInputHistoryDown(): void {
		this._onDidNavigateInputHistoryDownEmitter.fire();
	}

	/**
	 * Navigates the input history up.
	 * @param usingPrefixMatch A value which indicates whether to use the prefix match strategy.
	 */
	navigateInputHistoryUp(usingPrefixMatch: boolean): void {
		this._onDidNavigateInputHistoryUpEmitter.fire({
			usingPrefixMatch,
		});
	}

	/**
	 * Clears the input history.
	 */
	clearInputHistory() {
		this._onDidClearInputHistoryEmitter.fire();
	}

	/**
	 * Interrupts the console.
	 * @param code The optional code to interrupt.
	 */
	interrupt(code?: string) {
		// No session to interrupt.
		if (!this._session) {
			return;
		}

		// Get the runtime state.
		const runtimeState = this._session.getRuntimeState();

		// If there's a prompt active, interrupt it.
		if (this._activeActivityItemPrompt) {
			this._activeActivityItemPrompt.state = ActivityItemPromptState.Interrupted;
			this._onDidChangeRuntimeItemsEmitter.fire();
			this._activeActivityItemPrompt = undefined;
		}

		// Interrupt the runtime session.
		this._session.interrupt();

		// Clear pending input and pending code.
		this.clearPendingInput();
		this.setPendingCode();

		// If the runtime wasn't busy, add a runtime item activity with and empty ActivityItemInput
		// so there is feedback that the interrupt was processed.
		if (runtimeState === RuntimeState.Ready || runtimeState === RuntimeState.Idle) {
			const id = generateUuid();
			this.addOrUpdateRuntimeItemActivity(
				id,
				new ActivityItemInput(
					id,
					id,
					new Date(),
					ActivityItemInputState.Cancelled,
					this._session.dynState.inputPrompt,
					this._session.dynState.continuationPrompt,
					code ?? '',
				)
			);
		}

		// Drive focus to the input.
		setTimeout(() => {
			this.focusInput();
		}, 0);
	}

	/**
	 * Enqueues code.
	 * @param code The code to enqueue.
	 * @param attribution Attribution naming the origin of the code.
	 * @param allowIncomplete Whether to bypass runtime code completeness checks. If true, the `code`
	 *  will be executed by the runtime even if it is incomplete or invalid. Defaults to false
	 * @param mode Possible code execution modes for a language runtime.
	 * @param errorBehavior Possible error behavior for a language runtime
	 * @param executionId An optional ID that can be used to identify the execution
	 *   (e.g. for tracking execution history). If not provided, one will be assigned.
	 */
	async enqueueCode(code: string,
		attribution: IConsoleCodeAttribution,
		allowIncomplete?: boolean,
		mode?: RuntimeCodeExecutionMode,
		errorBehavior?: RuntimeErrorBehavior,
		executionId?: string) {
		// If a manually assigned execution ID is provided, add it to the set of
		// external execution IDs.
		if (executionId) {
			this._externalExecutionIds.add(executionId);
		}

		// If there is a pending input runtime item, all the code in it was enqueued before this
		// code, so add this code to it and wait for it to be processed the next time the runtime
		// becomes idle.
		if (this._runtimeItemPendingInput) {
			this.addPendingInput(
				code,
				attribution,
				executionId,
				mode ?? RuntimeCodeExecutionMode.Interactive,
				errorBehavior ?? RuntimeErrorBehavior.Continue
			);
			return;
		}

		// If the runtime isn't idle or ready, we can't check on whether this code is complete, so
		// add this code as a pending input runtime item and wait for it to be processed the next
		// time the runtime becomes idle.
		const runtimeState = this.session?.getRuntimeState() || RuntimeState.Uninitialized;
		if (!(runtimeState === RuntimeState.Idle || runtimeState === RuntimeState.Ready)) {
			this.addPendingInput(
				code,
				attribution,
				executionId,
				mode ?? RuntimeCodeExecutionMode.Interactive,
				errorBehavior ?? RuntimeErrorBehavior.Continue
			);
			return;
		}

		// Code should be executed if the caller skips checks, or if the runtime says the code is complete.
		const shouldExecuteCode = async (codeToCheck: string) => {
			// If there is no session, we cannot check if the code is complete or execute it,
			// so return false.
			if (!this.session) {
				return false;
			}

			// If allow incomplete is true, skip the code completeness check and return true.
			if (allowIncomplete) {
				return true;
			}

			// Return true if the code fragment is complete, false otherwise.
			return await this.session.isCodeFragmentComplete(codeToCheck) === RuntimeCodeFragmentStatus.Complete;
		};

		// Handle interactive mode first.
		if (mode === RuntimeCodeExecutionMode.Interactive) {
			// If there is pending code in the code editor, see if adding this code to it creates
			// code that can be executed.
			let pendingCode = this.codeEditor?.getValue();
			if (pendingCode) {
				// No ID supplied; check if there's a stored execution ID for this code.
				if (!executionId) {
					const storedExecutionId = this._pendingExecutionIds.get(code);
					if (storedExecutionId) {
						executionId = storedExecutionId;
					}
				}

				// Figure out whether adding this code to the pending code results in code that can
				// be executed. If so, execute it.
				pendingCode += '\n' + code;
				if (await shouldExecuteCode(pendingCode)) {
					this.setPendingCode();
					this.doExecuteCode(pendingCode, attribution, mode, errorBehavior, executionId);
				} else {
					// Update the pending code. More will be revealed.
					this.setPendingCode(pendingCode, executionId);
				}

				// In either case, return.
				return;
			}
		}

		// Execute the code if it is complete, or set it as pending if it is not.
		if (await shouldExecuteCode(code)) {
			this.doExecuteCode(code, attribution, mode, errorBehavior, executionId);
		} else {
			this.setPendingCode(code, executionId);
		}
	}

	/**
	 * Replays execution history. This is called when restoring a session to
	 * restore the console's contents after a reload/reconnect.
	 *
	 * @param entries The execution history entries to replay.
	 */
	replayExecutions(entries: IExecutionHistoryEntry<unknown>[]): void {
		for (const entry of entries) {
			if (entry.outputType === ExecutionEntryType.Execution) {
				// Create the activity and the first item (the input)
				const inputActivityItem =
					new ActivityItemInput(
						entry.id + '-input',
						entry.id,
						new Date(entry.when),
						ActivityItemInputState.Completed,
						entry.prompt,
						' '.repeat(entry.prompt.length),
						entry.input
					);

				const inputItem = new RuntimeItemActivity(entry.id, inputActivityItem);
				this._runtimeItemActivities.set(entry.id, inputItem);
				this._runtimeItems.push(inputItem);

				if (entry.output) {
					// Add the second item (the output)
					const outputActivityItem =
						new ActivityItemOutputMessage(
							entry.id + '-output',
							entry.id,
							new Date(entry.when),
							{ 'text/plain': entry.output as string }
						);
					inputItem.addActivityItem(outputActivityItem);
				}
				if (entry.error) {
					// If errors were omitted, add them at the end
					const errorActivityItem =
						new ActivityItemErrorMessage(
							entry.id + '-error',
							entry.id,
							new Date(entry.when),
							entry.error.name,
							entry.error.message,
							entry.error.traceback
						);
					inputItem.addActivityItem(errorActivityItem);
				}
			} else if (entry.outputType === ExecutionEntryType.Startup) {
				const info = entry.output as ILanguageRuntimeInfo;
				const startupItem = new RuntimeItemStartup(
					entry.id,
					info.banner,
					info.implementation_version,
					info.language_version,
				);
				this._runtimeItems.push(startupItem);
			}
		}

		// Enter the reconnecting state.
		this.emitStartRuntimeItems(SessionAttachMode.Reconnecting);
		this.setState(PositronConsoleState.Starting);
	}

	/**
	 * Executes code.
	 * @param code The code to execute.
	 * @param attribution Attribution of the code's origin.
	 * @param mode Possible code execution modes for a language runtime.
	 * @param errorBehavior Possible error behavior for a language runtime.
	 * @param executionId An optional ID that can be used to identify the execution.
	 */
	executeCode(code: string,
		attribution: IConsoleCodeAttribution,
		mode?: RuntimeCodeExecutionMode,
		errorBehavior?: RuntimeErrorBehavior,
		executionId?: string) {
		this.setPendingCode();
		this.doExecuteCode(code, attribution, mode, errorBehavior, executionId);
	}

	/**
	 * Replies to a prompt.
	 * @param value The value.
	 */
	replyToPrompt(value: string) {
		// If there is a session and a prompt, reply to the prompt.
		if (this._session && this._activeActivityItemPrompt) {
			// Get the ID of the prompt.
			const id = this._activeActivityItemPrompt.id;

			// Update the prompt state.
			this._activeActivityItemPrompt.state = ActivityItemPromptState.Answered;
			this._activeActivityItemPrompt.answer = !this._activeActivityItemPrompt.password ? value : '';
			this._activeActivityItemPrompt = undefined;
			this._onDidChangeRuntimeItemsEmitter.fire();

			// Reply to the prompt.
			this._session.replyToPrompt(id, value);
		}
	}

	/**
	 * Gets the clipboard representation of the console instance.
	 * @param commentPrefix The comment prefix to use.
	 * @returns The clipboard representation of the console instance.
	 */
	getClipboardRepresentation(commentPrefix: string): string[] {
		return this._runtimeItems.flatMap(runtimeItem =>
			runtimeItem.getClipboardRepresentation(commentPrefix)
		);
	}

	//#endregion IPositronConsoleInstance Implementation

	//#region Public Methods

	/**
	 * Attaches the runtime session.
	 *
	 * @param runtime The runtime session.
	 *
	 * @param attachMode A value which indicates the attachment mode for the session.
	 */
	attachRuntimeSession(session: ILanguageRuntimeSession, attachMode: SessionAttachMode) {
		// Is this the same session we're currently attached to?
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
				this.attachRuntime(session, attachMode);
			}
			return;
		}
		// Attach the new runtime.
		this.attachRuntime(session, attachMode);
	}


	set initialWorkingDirectory(workingDirectory: string) {
		this._initialWorkingDirectory = workingDirectory;
	}

	get initialWorkingDirectory(): string {
		return this._initialWorkingDirectory;
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
	 * Find and remove the runtime item marking the runtime as Starting, if it
	 * exists.
	 */
	clearStartingItem() {
		// Remove the item indicating that the runtime is starting.
		for (let i = this._runtimeItems.length - 1; i >= 0; i--) {
			if (this._runtimeItems[i] instanceof RuntimeItemStarting) {
				this._runtimeItems.splice(i, 1);
				break;
			}
		}
	}

	/**
	 * Updates the console in the case of a session restore failure.
	 *
	 * @param evt The event with error details.
	 */
	showRestoreFailure(evt: ISessionRestoreFailedEvent) {
		// If trace is enabled, add a trace runtime item.
		if (this._trace) {
			this.addRuntimeItemTrace(`Restore failure: ${evt.error.toString()}`);
		}

		// Remove the item indicating that the runtime is starting.
		this.clearStartingItem();

		// Add a runtime item indicating the failure.
		this.addRuntimeItem(new RuntimeItemStartupFailure(
			generateUuid(),
			evt.error.toString(),
			''
		));

		this.setState(PositronConsoleState.Exited);
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
					case PositronConsoleState.Busy:
						for (let i = this._runtimeItems.length - 1; i >= 0; i--) {
							if (this._runtimeItems[i] instanceof RuntimeItemStarting) {
								const runtimeItem = this._runtimeItems[i] as RuntimeItemStarting;
								let msg = '';
								// Create a localized message from the past
								// tense of the attach mode.
								switch (runtimeItem.attachMode) {
									case SessionAttachMode.Starting:
									case SessionAttachMode.Switching:
										msg = localize('positronConsole.started', "{0} started.", this.sessionName);
										break;
									case SessionAttachMode.Restarting:
										msg = localize('positronConsole.restarted', "{0} restarted.", this.sessionName);
										break;
									case SessionAttachMode.Connected:
										msg = localize('positronConsole.connected', "{0} connected.", this.sessionName);
										break;
								}
								if (msg) {
									this._runtimeItems[i] = new RuntimeItemStarted(
										generateUuid(), msg);
									this._onDidChangeRuntimeItemsEmitter.fire();
								} else {
									this._runtimeItems.splice(i, 1);
									this._onDidChangeRuntimeItemsEmitter.fire();
								}
							}
						}
						break;

					case PositronConsoleState.Offline:
						this.addRuntimeItem(
							new RuntimeItemReconnected(
								generateUuid(),
								`${this.sessionName} reconnected.`
							)
						);
						break;
				}
				break;

			case PositronConsoleState.Offline:
				this.addRuntimeItem(
					new RuntimeItemOffline(
						generateUuid(),
						`${this.sessionName} offline. Waiting to reconnect.`
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
		const sessionName = this.sessionName;
		// Set the state and add the appropriate runtime item indicating the session attach mode.
		if (attachMode === SessionAttachMode.Restarting ||
			// Consider starting from an exited state a restart.
			(attachMode === SessionAttachMode.Starting && this._state === PositronConsoleState.Exited)) {
			this.setState(PositronConsoleState.Starting);
			this.addRuntimeItem(new RuntimeItemStarting(
				generateUuid(),
				localize('positronConsole.starting.restart', "{0} restarting.", sessionName),
				SessionAttachMode.Restarting));
		} else if (attachMode === SessionAttachMode.Starting ||
			attachMode === SessionAttachMode.Switching) {
			this.setState(PositronConsoleState.Starting);
			this.addRuntimeItem(new RuntimeItemStarting(
				generateUuid(),
				localize('positronConsole.starting.start', "{0} starting.", sessionName),
				attachMode));
		} else if (attachMode === SessionAttachMode.Reconnecting) {
			this.setState(PositronConsoleState.Starting);
			this.addRuntimeItem(new RuntimeItemStarting(
				generateUuid(),
				localize('positronConsole.starting.reconnect', "{0} reconnecting.", sessionName),
				attachMode));
		} else if (attachMode === SessionAttachMode.Connected) {
			this.setState(PositronConsoleState.Ready);
			this.addRuntimeItem(new RuntimeItemReconnected(
				generateUuid(),
				localize('positronConsole.starting.reconnected', "{0} reconnected.", sessionName),
			));
		}
	}

	/**
	 * Attaches to a runtime session.
	 *
	 * @param session The runtime session to attach to.
	 * @param attachMode A value which indicates the mode in which to attach the session.
	 */
	private attachRuntime(
		session: ILanguageRuntimeSession,
		attachMode: SessionAttachMode) {

		// Mark the runtime as attached.
		this._session = session;
		this._runtimeAttached = true;

		// If trace is enabled, add a trace runtime item.
		if (this._trace) {
			this.addRuntimeItemTrace(`Attach session ${this.sessionName} ` +
				`(attach mode = ${attachMode})`);
		}

		// Emit the start runtime items. Note that in the case of a reconnect
		// these items will already be present.
		if (attachMode !== SessionAttachMode.Reconnecting) {
			this.emitStartRuntimeItems(attachMode);
		}

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

			// If we moved directly from Starting to Busy, we just reattached to
			// a busy session. Update the state accordingly.
			if (this._state === PositronConsoleState.Starting &&
				runtimeState === RuntimeState.Busy) {
				this.setState(PositronConsoleState.Busy);
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
						// Remove any Starting runtime items since we're no
						// longer Starting
						this.clearStartingItem();

						// If we're still in the Exited state and haven't
						// disposed, then do it now.
						if ((this._runtimeState === RuntimeState.Exited ||
							this._runtimeState === RuntimeState.Uninitialized) &&
							this.runtimeAttached) {
							this.detachRuntime();

							this.addRuntimeItem(new RuntimeItemExited(
								generateUuid(),
								RuntimeExitReason.StartupFailed,
								`${session.dynState.sessionName} failed to start.`
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
			// If trace is enabled, add a trace runtime item.
			if (this._trace) {
				this.addRuntimeItemTrace(`onDidCompleteStartup`);
			}

			// Add the item startup, if not reconnecting.
			if (attachMode !== SessionAttachMode.Reconnecting) {
				this.addRuntimeItem(new RuntimeItemStartup(
					generateUuid(),
					languageRuntimeInfo.banner,
					languageRuntimeInfo.implementation_version,
					languageRuntimeInfo.language_version
				));
			}
		}));

		// Add the onDidEncounterStartupFailure event handler. This can arrive before or after
		// the state change to Exited, so we need to handle it in both places.
		this._runtimeDisposableStore.add(this._session.onDidEncounterStartupFailure(startupFailure => {
			// If trace is enabled, add a trace runtime item.
			if (this._trace) {
				this.addRuntimeItemTrace(`onDidEncounterStartupFailure`);
			}

			// Add the item startup.
			this.addRuntimeItem(new RuntimeItemExited(
				generateUuid(),
				RuntimeExitReason.StartupFailed,
				`${session.dynState.sessionName} failed to start.`
			));
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

			// Mark the console as exited so it can be reused
			this.clearStartingItem();
			this.setState(PositronConsoleState.Exited);
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
			this.addOrUpdateRuntimeItemActivity(
				languageRuntimeMessageInput.parent_id,
				new ActivityItemInput(
					languageRuntimeMessageInput.id,
					languageRuntimeMessageInput.parent_id,
					new Date(languageRuntimeMessageInput.when),
					ActivityItemInputState.Executing,
					session.dynState.inputPrompt,
					session.dynState.continuationPrompt,
					languageRuntimeMessageInput.code
				)
			);

			// As a temporary measure, to be replaced soon with an event from the runtime, detect code
			// that was injected into the runtime directly (not via the console input). When this happens,
			// fire the onDidExecuteCode event so the code gets added to the console history.
			if (languageRuntimeMessageInput.parent_id.startsWith('direct-injection-')) {
				// Get the session's language ID. It will always be defined for a runtime session.
				const languageId = this.session?.runtimeMetadata?.languageId;
				if (!languageId) {
					return;
				}

				// Fire the onDidExecuteCode event so the code gets added to the console history.
				this._onDidExecuteCodeEmitter.fire({
					executionId: languageRuntimeMessageInput.parent_id,
					sessionId: this.sessionId,
					languageId,
					code: languageRuntimeMessageInput.code,
					attribution: {
						source: CodeAttributionSource.Interactive,
					},
					runtimeName: this._runtimeMetadata.runtimeName,
					mode: RuntimeCodeExecutionMode.Interactive,
					errorBehavior: RuntimeErrorBehavior.Continue
				});
			}
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

			// Set the active activity item prompt.
			this._activeActivityItemPrompt = new ActivityItemPrompt(
				languageRuntimeMessagePrompt.id,
				languageRuntimeMessagePrompt.parent_id,
				new Date(languageRuntimeMessagePrompt.when),
				languageRuntimeMessagePrompt.prompt,
				languageRuntimeMessagePrompt.password
			);

			// Add or update the runtime item activity.
			this.addOrUpdateRuntimeItemActivity(
				languageRuntimeMessagePrompt.parent_id,
				this._activeActivityItemPrompt
			);
		}));

		// Add the onDidReceiveRuntimeMessageOutput event handler.
		const handleDidReceiveRuntimeMessageOutput = (
			(languageRuntimeMessageOutput: ILanguageRuntimeMessageOutput) => {
				// If trace is enabled, add a trace runtime item.
				if (this._trace) {
					this.addRuntimeItemTrace(
						formatCallbackTrace('onDidReceiveRuntimeMessageOutput', languageRuntimeMessageOutput) +
						formatOutputMessage(languageRuntimeMessageOutput)
					);
				}

				// Create an activity item representing the message.
				const activityItemOutput = this.createActivityItemOutput(languageRuntimeMessageOutput);
				if (!activityItemOutput) {
					// No activity item for this message.
					return;
				}

				// Add/update the output activity item to this runtime item.
				this.addOrUpdateRuntimeItemActivity(languageRuntimeMessageOutput.parent_id, activityItemOutput);
			});
		this._runtimeDisposableStore.add(this._session.onDidReceiveRuntimeMessageOutput(handleDidReceiveRuntimeMessageOutput));
		this._runtimeDisposableStore.add(this._session.onDidReceiveRuntimeMessageResult(handleDidReceiveRuntimeMessageOutput));

		// Add the onDidReceiveRuntimeMessageStream event handler.
		this._runtimeDisposableStore.add(this._session.onDidReceiveRuntimeMessageStream(languageRuntimeMessageStream => {
			// If trace is enabled, add a trace runtime item.
			if (this._trace) {
				// Get the sanitized trace output.
				const traceOutput = sanitizeTraceOutput(languageRuntimeMessageStream.text);

				// Add the trace runtime item.
				this.addRuntimeItemTrace(
					formatCallbackTrace('onDidReceiveRuntimeMessageStream', languageRuntimeMessageStream) +
					`\nStream ${languageRuntimeMessageStream.name}: "${traceOutput}" ${formattedLength(languageRuntimeMessageStream.text.length)}`
				);
			}

			// Handle stdout and stderr.
			if (languageRuntimeMessageStream.name === 'stdout') {
				this.addOrUpdateRuntimeItemActivity(
					languageRuntimeMessageStream.parent_id,
					new ActivityItemStream(
						languageRuntimeMessageStream.id,
						languageRuntimeMessageStream.parent_id,
						new Date(languageRuntimeMessageStream.when),
						ActivityItemStreamType.OUTPUT,
						languageRuntimeMessageStream.text
					)
				);
			} else if (languageRuntimeMessageStream.name === 'stderr') {
				this.addOrUpdateRuntimeItemActivity(
					languageRuntimeMessageStream.parent_id,
					new ActivityItemStream(
						languageRuntimeMessageStream.id,
						languageRuntimeMessageStream.parent_id,
						new Date(languageRuntimeMessageStream.when),
						ActivityItemStreamType.ERROR,
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
				this.addOrUpdateRuntimeItemActivity(
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
						// Generally speaking, we only want to set Busy/Idle
						// state when that state is a result of processing one
						// of our own messages, which begin with `fragment-`.
						if (languageRuntimeMessageState.parent_id.startsWith(POSITRON_CONSOLE_EXEC_PREFIX) ||
							this._externalExecutionIds.has(languageRuntimeMessageState.parent_id) ||
							this.state === PositronConsoleState.Offline ||
							this.state === PositronConsoleState.Starting) {
							this.setState(PositronConsoleState.Busy);
						}
						// Mark the associated input as busy.
						this.markInputBusyState(languageRuntimeMessageState.parent_id, true);
						break;
					}

					case RuntimeOnlineState.Idle: {
						if (languageRuntimeMessageState.parent_id.startsWith(POSITRON_CONSOLE_EXEC_PREFIX) ||
							this._externalExecutionIds.has(languageRuntimeMessageState.parent_id) ||
							this.state === PositronConsoleState.Offline) {
							this.setState(PositronConsoleState.Ready);
						}
						// Mark the associated input as idle.
						this.markInputBusyState(languageRuntimeMessageState.parent_id, false);
						// This external execution ID has completed, so we can remove it.
						this._externalExecutionIds.delete(languageRuntimeMessageState.parent_id);
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

			// Clear any starting item still present.
			this.clearStartingItem();

			if (exit.reason === RuntimeExitReason.ExtensionHost) {
				this.setState(PositronConsoleState.Disconnected);
				// The runtime must be detached, so that when it is reconnected, it is reattached
				// to the new extension host.
				this.detachRuntime();
				return;
			}

			// Add a message explaining that the exit occurred, and why.
			let message = this.formatExit(exit);
			if (exit.message) {
				message += `\n\n${exit.message}`;
			}
			const exited = new RuntimeItemExited(generateUuid(),
				exit.reason,
				message);
			this.addRuntimeItem(exited);

			// Show restart button if crashed and user has disabled automatic restarts
			const crashedAndNeedRestartButton = exit.reason === RuntimeExitReason.Error &&
				!this._configurationService.getValue<boolean>('interpreters.restartOnCrash');

			// In the case of a forced quit, normal shutdown, or unknown shutdown where the exit
			// code was `0`, we don't attempt to automatically start the session again. In this
			// case, we add an activity item that shows a button the user can use to start the
			// session manually.
			// NOTE: The `showRestartButton` is always false for now, until
			// https://github.com/posit-dev/positron/issues/6796 is resolved
			const showRestartButton = false && (exit.reason === RuntimeExitReason.ForcedQuit ||
				exit.reason === RuntimeExitReason.Shutdown ||
				exit.reason === RuntimeExitReason.Unknown ||
				crashedAndNeedRestartButton);

			if (showRestartButton) {
				const restartButton = new RuntimeItemRestartButton(
					generateUuid(),
					this._session?.dynState.sessionName || this.runtimeMetadata.runtimeName,
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
				return localize('positronConsole.exit.forcedQuit', "{0} was forced to quit.", exit.session_name);

			case RuntimeExitReason.Restart:
				return localize('positronConsole.exit.restart', "{0} exited (preparing for restart)", exit.session_name);

			case RuntimeExitReason.Shutdown:
			case RuntimeExitReason.SwitchRuntime:
				return localize('positronConsole.exit.shutdown', "{0} shut down successfully.", exit.session_name);

			case RuntimeExitReason.Transferred:
				return localize('positronConsole.exit.transfer', "{0} was opened in another window.", exit.runtime_name);

			case RuntimeExitReason.Error:
				return localize('positronConsole.exit.error', "{0} exited unexpectedly: {1}", exit.session_name, this.formatExitCode(exit.exit_code));

			case RuntimeExitReason.StartupFailed:
				return localize('positronConsole.exit.startupFailed', "{0} failed to start up (exit code {1})", exit.session_name, exit.exit_code);

			case RuntimeExitReason.ExtensionHost:
				return localize('positronConsole.exit.extensionHost', "{0} was disconnected from the extension host.", exit.session_name);

			default:
			case RuntimeExitReason.Unknown:
				return localize('positronConsole.exit.unknown', "{0} exited (exit code {1})", exit.session_name, exit.exit_code);
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
			this.addRuntimeItemTrace(`Detach session ${this.sessionName} with ID: ${this.sessionMetadata.sessionId}`);
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
			this._runtimeDisposableStore.clear();
		} else {
			// We are not currently attached; warn.
			console.warn(
				`Attempt to detach already detached session ${this.sessionName} with ID: ${this.sessionMetadata.sessionId}.`);
		}
	}

	/**
	 * Sets pending code.
	 * @param pendingCode The pending code to set.
	 */
	setPendingCode(pendingCode?: string, executionId?: string) {
		// If we have both pending code and an execution ID, store it for later use
		if (pendingCode && executionId) {
			this._pendingExecutionIds.set(pendingCode, executionId);
		} else if (!pendingCode) {
			// Clear any pending execution IDs when clearing pending code
			this._pendingExecutionIds.clear();
		}

		this._onDidSetPendingCodeEmitter.fire(pendingCode);
	}

	/**
	 * Adds pending input.
	 * @param code The code for the pending input.
	 * @param attribution The attribution for the pending input.
	 * @param executionId The execution ID for the pending input.
	 * @param mode The code execution mode.
	 * @param errorBehavior The error behavior.
	 */
	private addPendingInput(code: string,
		attribution: IConsoleCodeAttribution,
		executionId: string | undefined,
		mode: RuntimeCodeExecutionMode,
		errorBehavior: RuntimeErrorBehavior) {
		// Add to the pending code queue.
		this._pendingCodeQueue.push({
			code,
			attribution,
			executionId,
			mode,
			errorBehavior
		});

		// Only create/update visual pending input for interactive mode.
		if (mode === RuntimeCodeExecutionMode.Silent) {
			// Silent code should not be displayed, so we're done.
			return;
		}

		// If there is a pending input runtime item, we need to recreate it with the concatenated code
		// of all interactive items.
		if (this._runtimeItemPendingInput) {
			// Remove the old pending input runtime item.
			const index = this.runtimeItems.indexOf(this._runtimeItemPendingInput);
			if (index > -1) {
				this._runtimeItems.splice(index, 1);
			}

			// Concatenate only the interactive code fragments from the queue.
			const interactiveCode = this._pendingCodeQueue
				.filter(item => item.mode === RuntimeCodeExecutionMode.Interactive)
				.map(item => item.code)
				.join('\n');

			// Create a new pending input runtime item with the concatenated interactive code.
			this._runtimeItemPendingInput = new RuntimeItemPendingInput(
				generateUuid(),
				this._session?.dynState.inputPrompt ?? '',
				attribution,
				executionId,
				interactiveCode,
				mode
			);

			// Add it back to the runtime items.
			this.addRuntimeItem(this._runtimeItemPendingInput);
		} else {
			// Create the pending input runtime item for the first interactive code fragment.
			this._runtimeItemPendingInput = new RuntimeItemPendingInput(
				generateUuid(),
				this._session?.dynState.inputPrompt ?? '',
				attribution,
				executionId,
				code,
				mode
			);

			// Add the pending input runtime item.
			this.addRuntimeItem(this._runtimeItemPendingInput);
		}
	}

	/**
	 * Clears pending input.
	 */
	private clearPendingInput() {
		// Clear the pending code queue.
		this._pendingCodeQueue = [];

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

			// If `processPendingInput()` is running, let it know that it has been interrupted.
			if (this._pendingInputState === 'Processing') {
				this._pendingInputState = 'Interrupted';
			}
		}
	}

	/**
	 * Create an output activity item from a runtime message.
	 * @param id The activity item ID.
	 * @param message The runtime message.
	 * @returns The output activity item.
	 */
	private createActivityItemOutput(
		message: ILanguageRuntimeMessageOutput | ILanguageRuntimeMessageUpdateOutput,
	): ActivityItemOutput | undefined {
		// Don't handle outputs routed to the viewer or plots pane.
		// They likely have long outputs that are not suitable for the console.
		if (message.kind === RuntimeOutputKind.ViewerWidget ||
			message.kind === RuntimeOutputKind.IPyWidget) {
			return undefined;
		}

		// Check to see if the data contains an image by checking the record for the
		// "image/" mime type.
		const images = Object.keys(message.data).find(
			key => key.startsWith('image/'));

		// Check to see if the data contains any HTML
		let html = Object.hasOwnProperty.call(message.data,
			'text/html');
		if (html) {
			const htmlContent = message.data['text/html']!.toLowerCase();
			if (htmlContent.indexOf('<script') >= 0 ||
				htmlContent.indexOf('<body') >= 0 ||
				htmlContent.indexOf('<html') >= 0 ||
				htmlContent.indexOf('<iframe') >= 0 ||
				htmlContent.indexOf('<!doctype') >= 0) {
				// We only want to render HTML fragments for now; if it has
				// scripts or looks like it is a self-contained document,
				// hard pass. In the future, we'll need to render those in a
				// sandboxed environment.
				html = false;
			}
		}

		if (images) {
			// It's an image, so create a plot activity item.
			return new ActivityItemOutputPlot(
				message.id,
				message.parent_id,
				new Date(message.when),
				message.data, () => {
					// This callback runs when the user clicks on the
					// plot; when they do this, we'll select it in the
					// Plots pane.
					this._onDidSelectPlotEmitter.fire(message.id);
				},
				message.output_id
			);
		} else if (html) {
			// It's HTML, so show the HTML.
			return new ActivityItemOutputHtml(
				message.id,
				message.parent_id,
				new Date(message.when),
				message.data['text/html']!,
				message.data['text/plain'],
				message.output_id
			);
		} else {
			// It's a plain old text output, so create a text activity item.
			return new ActivityItemOutputMessage(
				message.id,
				message.parent_id,
				new Date(message.when),
				message.data,
				message.output_id
			);
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
		// If we are already processing pending input and the `await` below allowed us to loop
		// back into here, refuse to process anything else right now.
		if (this._pendingInputState !== 'Idle') {
			return;
		}

		this._pendingInputState = 'Processing';

		try {
			// Need to `await` inside the `try` so that the `finally` only runs once
			// `processPendingInputImpl()` has completely finished. Can't just return the promise.
			await this.processPendingInputImpl();
		} finally {
			this._pendingInputState = 'Idle';
		}
	}

	private async processPendingInputImpl(): Promise<void> {
		// If there isn't a pending code queue or it's empty, return.
		if (this._pendingCodeQueue.length === 0) {
			return;
		}

		// If there's no session, return.
		if (!this._session) {
			return;
		}

		// Process the first item in the queue.
		const pendingItem = this._pendingCodeQueue[0];

		// Check if the code fragment is complete.
		const codeFragmentStatus = await this._session.isCodeFragmentComplete(pendingItem.code);

		// If we have been interrupted, then `clearPendingInput()` has cleared the queue.
		if (this._pendingInputState === 'Interrupted') {
			return;
		}

		// If the code fragment is not complete, wait for more input.
		// Move the incomplete code to pending code for user editing.
		if (codeFragmentStatus !== RuntimeCodeFragmentStatus.Complete) {
			// Remove the item from the queue.
			this._pendingCodeQueue.shift();

			// Remove the pending input visual item if it exists.
			if (this._runtimeItemPendingInput) {
				const index = this.runtimeItems.indexOf(this._runtimeItemPendingInput);
				if (index > -1) {
					this._runtimeItems.splice(index, 1);
				}
				this._onDidChangeRuntimeItemsEmitter.fire();
			}

			// Set as pending code for user to complete.
			this.setPendingCode(pendingItem.code, pendingItem.executionId);

			// Clear the pending input item.
			this._runtimeItemPendingInput = undefined;

			return;
		}

		// The code is complete, so execute it.
		const id = pendingItem.executionId || this.generateExecutionId(pendingItem.code);

		// Add the provisional ActivityItemInput for the code fragment only if it's not a silent execution.
		if (pendingItem.mode !== RuntimeCodeExecutionMode.Silent) {
			const runtimeItemActivity = new RuntimeItemActivity(
				id,
				new ActivityItemInput(
					id,
					id,
					new Date(),
					ActivityItemInputState.Provisional,
					this._session.dynState.inputPrompt,
					this._session.dynState.continuationPrompt,
					pendingItem.code
				)
			);
			this._runtimeItems.push(runtimeItemActivity);
			this._runtimeItemActivities.set(id, runtimeItemActivity);
		}

		// Remove the processed item from the queue.
		this._pendingCodeQueue.shift();

		// Remove the pending input visual item if this was the last item or update it for remaining items.
		if (this._runtimeItemPendingInput) {
			const index = this.runtimeItems.indexOf(this._runtimeItemPendingInput);
			if (index > -1) {
				this._runtimeItems.splice(index, 1);
			}

			if (this._pendingCodeQueue.length > 0) {
				// There are more items in the queue, create a new pending input visual
				// for the next item if it's not silent.
				const nextItem = this._pendingCodeQueue[0];
				if (nextItem.mode !== RuntimeCodeExecutionMode.Silent) {
					this._runtimeItemPendingInput = new RuntimeItemPendingInput(
						generateUuid(),
						this._session.dynState.inputPrompt,
						nextItem.attribution,
						nextItem.executionId,
						nextItem.code,
						nextItem.mode
					);
					this._runtimeItems.push(this._runtimeItemPendingInput);
				} else {
					this._runtimeItemPendingInput = undefined;
				}
			} else {
				// No more items in the queue.
				this._runtimeItemPendingInput = undefined;
			}
		}

		// Fire the runtime items changed event.
		this._onDidChangeRuntimeItemsEmitter.fire();

		// Execute the code fragment.
		this._session.execute(
			pendingItem.code,
			id,
			pendingItem.mode,
			pendingItem.errorBehavior,
		);

		// Create and fire the onDidExecuteCode event.
		const event: ILanguageRuntimeCodeExecutedEvent = {
			executionId: id,
			sessionId: this._session.sessionId,
			code: pendingItem.code,
			mode: pendingItem.mode,
			attribution: pendingItem.attribution,
			errorBehavior: pendingItem.errorBehavior,
			languageId: this._session.runtimeMetadata.languageId,
			runtimeName: this._session.runtimeMetadata.runtimeName
		};
		this._onDidExecuteCodeEmitter.fire(event);
	}

	/**
	 * Gets or generates an execution ID for the given code.
	 *
	 * @param code The code to check for a stored execution ID.
	 * @returns
	 */
	private generateExecutionId(code: string): string {
		const storedExecutionId = this._pendingExecutionIds.get(code);
		if (storedExecutionId) {
			// Clear it from the map as we're about to use it
			this._pendingExecutionIds.delete(code);
			return storedExecutionId;
		}

		return `${POSITRON_CONSOLE_EXEC_PREFIX}-${generateUuid()}`;
	}

	/**
	 * Executes code.
	 * @param code The code to execute.
	 * @param attribution The attribution for the code.
	 * @param mode Possible code execution modes for a language runtime
	 * @param errorBehavior Possible error behavior for a language runtime
	 */
	private doExecuteCode(
		code: string,
		attribution: IConsoleCodeAttribution,
		mode: RuntimeCodeExecutionMode = RuntimeCodeExecutionMode.Interactive,
		errorBehavior: RuntimeErrorBehavior = RuntimeErrorBehavior.Continue,
		executionId?: string
	) {
		// Use the supplied execution ID if known; otherwise, generate one
		const id = executionId || this.generateExecutionId(code);

		if (!this._session) {
			return;
		}

		/**
		 * If the code execution mode is silent, an ActivityItem for the code fragment
		 * should not be added to avoid UI side effects from the code execution.
		 */
		if (mode !== RuntimeCodeExecutionMode.Silent) {
			// Create the provisional ActivityItemInput.
			const activityItemInput = new ActivityItemInput(
				id,
				id,
				new Date(),
				ActivityItemInputState.Provisional,
				this._session.dynState.inputPrompt,
				this._session.dynState.continuationPrompt,
				code
			);

			// Add the provisional ActivityItemInput. This provisional ActivityItemInput will be
			// replaced with the real ActivityItemInput when the runtime sends it (which can take a
			// moment or two to happen).
			this.addOrUpdateRuntimeItemActivity(id, activityItemInput);
		}

		// If this is an interactive submission, check to see the text we just executed is
		// the text that was last pasted, so we can attribute it to the clipboard if
		// appropriate.
		if (attribution.source === CodeAttributionSource.Interactive) {
			const lastPastedText = this._lastPastedText.trim();
			if (lastPastedText && code.trim() === lastPastedText) {
				attribution.source = CodeAttributionSource.Paste;
			}

			// In any case, clear the last pasted text when executing code interactively.
			this._lastPastedText = '';
		}

		/**
		 * Execute the code.
		 *
		 * The jupyter protocol advises kernels to rebroadcast execution inputs.
		 * The kernels don't rebroadcast silent input and thus will not be
		 * added back into the runtimeItemActivities list which powers the UI.
		 */

		this._session.execute(
			code,
			id,
			mode,
			errorBehavior);

		// Create and fire the onDidExecuteCode event.
		const event: ILanguageRuntimeCodeExecutedEvent = {
			executionId: id,
			sessionId: this._session.sessionId,
			code,
			mode,
			attribution,
			errorBehavior,
			languageId: this._session.runtimeMetadata.languageId,
			runtimeName: this._session.runtimeMetadata.runtimeName
		};
		this._onDidExecuteCodeEmitter.fire(event);
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
	private addOrUpdateRuntimeItemActivity(parentId: string, activityItem: ActivityItem) {
		// Find the activity runtime item. If it was found, add the activity item to it. If not, add
		// a new activity runtime item.
		const runtimeItemActivity = this._runtimeItemActivities.get(parentId);
		if (runtimeItemActivity) {
			// Add the activity item to the activity runtime item.
			runtimeItemActivity.addActivityItem(activityItem);

			// Optimize scrollback.
			this.optimizeScrollback();

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

		// Optimize scrollback.
		this.optimizeScrollback();

		// Fire the onDidChangeRuntimeItems event.
		this._onDidChangeRuntimeItemsEmitter.fire();
	}

	/**
	 * Optimizes scrollback.
	 */
	private optimizeScrollback() {
		// Optimize scrollback for each runtime item in reverse order.
		for (let scrollbackSize = this._scrollbackSize, i = this._runtimeItems.length - 1; i >= 0; i--) {
			scrollbackSize = this._runtimeItems[i].optimizeScrollback(scrollbackSize);
		}
	}

	//#endregion Private Methods
}

// Register the Positron console service.
registerSingleton(IPositronConsoleService, PositronConsoleService, InstantiationType.Delayed);
