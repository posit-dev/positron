/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { generateUuid } from 'vs/base/common/uuid';
import { ILogService } from 'vs/platform/log/common/log';
import { IViewsService } from 'vs/workbench/common/views';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { RuntimeItem } from 'vs/workbench/services/positronConsole/common/classes/runtimeItem';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { RuntimeItemTrace } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemTrace';
import { ActivityItemInput } from 'vs/workbench/services/positronConsole/common/classes/activityItemInput';
import { RuntimeItemExited } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemExited';
import { RuntimeItemStarted } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemStarted';
import { RuntimeItemStartup } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemStartup';
import { RuntimeItemOffline } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemOffline';
import { ActivityItemPrompt } from 'vs/workbench/services/positronConsole/common/classes/activityItemPrompt';
import { RuntimeItemStarting } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemStarting';
import { ActivityItemOutputPlot } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputPlot';
import { RuntimeItemReconnected } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemReconnected';
import { ActivityItemOutputHtml } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputHtml';
import { RuntimeItemPendingInput } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemPendingInput';
import { ActivityItemErrorStream } from 'vs/workbench/services/positronConsole/common/classes/activityItemErrorStream';
import { ActivityItemOutputStream } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputStream';
import { ActivityItemErrorMessage } from 'vs/workbench/services/positronConsole/common/classes/activityItemErrorMessage';
import { ActivityItemOutputMessage } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputMessage';
import { RuntimeItemStartupFailure } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemStartupFailure';
import { ActivityItem, RuntimeItemActivity } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemActivity';
import { IPositronConsoleInstance, IPositronConsoleService, POSITRON_CONSOLE_VIEW_ID, PositronConsoleState } from 'vs/workbench/services/positronConsole/common/interfaces/positronConsoleService';
import { formatLanguageRuntime, ILanguageRuntime, ILanguageRuntimeMessage, ILanguageRuntimeService, LanguageRuntimeStartupBehavior, RuntimeCodeExecutionMode, RuntimeCodeFragmentStatus, RuntimeErrorBehavior, RuntimeOnlineState, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

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
	 * A map of the Positron console instances by runtime ID.
	 */
	private readonly _positronConsoleInstancesByRuntimeId = new Map<string, PositronConsoleInstance>();

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

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param _languageRuntimeService The language runtime service.
	 * @param _languageService The language service.
	 * @param _logService The log service.
	 */
	constructor(
		@ILanguageRuntimeService private _languageRuntimeService: ILanguageRuntimeService,
		@ILanguageService _languageService: ILanguageService,
		@ILogService private _logService: ILogService,
		@IViewsService private _viewsService: IViewsService,
	) {
		// Call the disposable constrcutor.
		super();

		// Start a Positron console instance for each running runtime.
		this._languageRuntimeService.runningRuntimes.forEach(runtime => {
			this.startPositronConsoleInstance(runtime, false);
		});

		// Get the active runtime. If there is one, set the active Positron console instance.
		if (this._languageRuntimeService.activeRuntime) {
			const positronConsoleInstance = this._positronConsoleInstancesByRuntimeId.get(this._languageRuntimeService.activeRuntime.metadata.runtimeId);
			if (positronConsoleInstance) {
				this.setActivePositronConsoleInstance(positronConsoleInstance);
			}
		}

		// Register the onWillStartRuntime event handler so we start a new Positron console instance before a runtime starts up.
		this._register(this._languageRuntimeService.onWillStartRuntime(runtime => {
			const positronConsoleInstance = this._positronConsoleInstancesByLanguageId.get(runtime.metadata.languageId);
			if (positronConsoleInstance && positronConsoleInstance.state === PositronConsoleState.Exited) {
				positronConsoleInstance.setRuntime(runtime, true);
				this._positronConsoleInstancesByRuntimeId.delete(positronConsoleInstance.runtime.metadata.runtimeId);
				this._positronConsoleInstancesByRuntimeId.set(positronConsoleInstance.runtime.metadata.runtimeId, positronConsoleInstance);
			} else {
				this.startPositronConsoleInstance(runtime, true);
			}
		}));

		// Register the onDidStartRuntime event handler so we activate the new Positron console instance when the runtime starts up.
		this._register(this._languageRuntimeService.onDidStartRuntime(runtime => {
			const positronConsoleInstance = this._positronConsoleInstancesByRuntimeId.get(runtime.metadata.runtimeId);
			if (positronConsoleInstance) {
				positronConsoleInstance.setState(PositronConsoleState.Ready);
			}
		}));

		// Register the onDidFailStartRuntime event handler so we activate the new Positron console instance when the runtime starts up.
		this._register(this._languageRuntimeService.onDidFailStartRuntime(runtime => {
			const positronConsoleInstance = this._positronConsoleInstancesByRuntimeId.get(runtime.metadata.runtimeId);
			if (positronConsoleInstance) {
				positronConsoleInstance.setState(PositronConsoleState.Exited);
			}
		}));

		// Register the onDidReconnectRuntime event handler so we start a new Positron console instance when a runtime is reconnected.
		this._register(this._languageRuntimeService.onDidReconnectRuntime(runtime => {
			const positronConsoleInstance = this._positronConsoleInstancesByRuntimeId.get(runtime.metadata.runtimeId);
			if (!positronConsoleInstance) {
				this.startPositronConsoleInstance(runtime, false);
			}
		}));

		// Register the onDidChangeRuntimeState event handler so we can activate the REPL for the active runtime.
		this._register(this._languageRuntimeService.onDidChangeRuntimeState(languageRuntimeStateEvent => {
			const positronConsoleInstance = this._positronConsoleInstancesByRuntimeId.get(languageRuntimeStateEvent.runtime_id);
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
		this._register(this._languageRuntimeService.onDidChangeActiveRuntime(runtime => {
			if (!runtime) {
				this.setActivePositronConsoleInstance();
			} else {
				const positronConsoleInstance = this._positronConsoleInstancesByRuntimeId.get(runtime.metadata.runtimeId);
				if (positronConsoleInstance) {
					this.setActivePositronConsoleInstance(positronConsoleInstance);
				} else {
					this._logService.error(`Language runtime ${formatLanguageRuntime(runtime)} became active, but a REPL instance for it is not running.`);
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

	// Gets the repl instances.
	get positronConsoleInstances(): IPositronConsoleInstance[] {
		return Array.from(this._positronConsoleInstancesByRuntimeId.values());
	}

	// Gets the active REPL instance.
	get activePositronConsoleInstance(): IPositronConsoleInstance | undefined {
		return this._activePositronConsoleInstance;
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
	 * @param activate A value which indicates whether the REPL should be activated.
	 * @returns A value which indicates whether the code could be executed.
	 */
	async executeCode(languageId: string, code: string, activate: boolean) {
		// If the console is to be activated, make sure we raise the console pane before we
		// start attempting to run the code. We do this before we attempt to run anything so the
		// user can see what's going on in the console (e.g. a language runtime starting up
		// in order to handle the code that's about to be executed)
		if (activate) {
			await this._viewsService.openView(POSITRON_CONSOLE_VIEW_ID, false);
		}

		// Get the running runtimes for the language.
		const runningLanguageRuntimes = this._languageRuntimeService.runningRuntimes.filter(
			runtime => runtime.metadata.languageId === languageId);

		// If there isn't a running runtime for the language, start one.
		if (!runningLanguageRuntimes.length) {
			// Get the registered runtimes for the language.
			const languageRuntimes = this._languageRuntimeService.registeredRuntimes.filter(
				runtime => (runtime.metadata.languageId === languageId &&
					runtime.metadata.startupBehavior === LanguageRuntimeStartupBehavior.Implicit ||
					runtime.metadata.startupBehavior === LanguageRuntimeStartupBehavior.Immediate));
			if (!languageRuntimes.length) {
				return false;
			}

			// Start the first runtime that was found.
			const languageRuntime = languageRuntimes[0];
			this._logService.trace(`Language runtime ${formatLanguageRuntime(languageRuntime)} automatically starting`);
			await this._languageRuntimeService.startRuntime(languageRuntime.metadata.runtimeId,
				`User executed code in language ${languageId}, and no running runtime was found ` +
				`for the language.`);
		}

		// Get the Positron console instance for the language ID.
		const positronConsoleInstance = this._positronConsoleInstancesByLanguageId.get(languageId);
		if (!positronConsoleInstance) {
			return false;
		}

		// If we're supposed to, activate the Positron console instance, if it isn't active.
		if (activate && positronConsoleInstance !== this._activePositronConsoleInstance) {
			this.setActivePositronConsoleInstance(positronConsoleInstance);
		}

		// Enqueue the code in the Positron console instance.
		await positronConsoleInstance.enqueueCode(code);

		// Success.
		return Promise.resolve(true);
	}

	//#endregion IPositronConsoleService Implementation

	//#region Private Methods

	/**
	 * Starts a Positron console instance for the specified runtime.
	 * @param runtime The runtime for the new Positron console instance.
	 * @param starting A value which indicates whether the runtime is starting.
	 * @returns The new Positron console instance.
	 */
	private startPositronConsoleInstance(runtime: ILanguageRuntime, starting: boolean): IPositronConsoleInstance {
		// Create the new Positron console instance.
		const positronConsoleInstance = new PositronConsoleInstance(runtime, starting);

		// Add the Positron console instance.
		this._positronConsoleInstancesByLanguageId.set(runtime.metadata.languageId, positronConsoleInstance);
		this._positronConsoleInstancesByRuntimeId.set(runtime.metadata.runtimeId, positronConsoleInstance);

		// Fire the onDidStartPositronConsoleInstance event.
		this._onDidStartPositronConsoleInstanceEmitter.fire(positronConsoleInstance);

		// Set the active positron console instance.
		this._activePositronConsoleInstance = positronConsoleInstance;

		// Fire the onDidChangeActivePositronConsoleInstance event.
		this._onDidChangeActivePositronConsoleInstanceEmitter.fire(positronConsoleInstance);

		// Return the instance.
		return positronConsoleInstance;
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
	private _runtime: ILanguageRuntime;

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
	 * The onDidChangeRuntimeItems event emitter.
	 */
	private readonly _onDidChangeRuntimeItemsEmitter = this._register(new Emitter<RuntimeItem[]>);

	/**
	 * The onDidPasteText event emitter.
	 */
	private readonly _onDidPasteTextEmitter = this._register(new Emitter<string>);

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
	private readonly _onDidExecuteCodeEmitter = this._register(new Emitter<void>);

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param runtime The language runtime.
	 * @param starting A value which indicates whether the Positron console instance is starting.
	 */
	constructor(runtime: ILanguageRuntime, starting: boolean) {
		// Call the base class's constructor.
		super();

		// Set the runtime.
		this._runtime = runtime;

		// Attach to the runtime.
		this.attachRuntime(starting);
	}

	/**
	 * Disposes of the PositronConsoleInstance.
	 */
	override dispose() {
		// Call Disposable's dispose.
		super.dispose();

		// Dispose of the runtime event handlers.
		this._runtimeDisposableStore.dispose();
	}

	//#endregion Constructor & Dispose

	//#region IPositronConsoleInstance Implementation

	/**
	 * Gets the runtime.
	 */
	get runtime(): ILanguageRuntime {
		return this._runtime;
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
		this._onFocusInputEmitter.fire();
		this._onDidPasteTextEmitter.fire(text);
	}

	/**
	 * Clears the console.
	 */
	clearConsole() {
		this._runtimeItems = [];
		this._runtimeItemActivities.clear();
		this._onDidChangeRuntimeItemsEmitter.fire(this._runtimeItems);
		this._onDidClearConsoleEmitter.fire();
	}

	/**
	 * Clears the input history.
	 */
	clearInputHistory() {
		this._onDidClearInputHistoryEmitter.fire();
	}

	/**
	 * Enqueues code.
	 * @param code The code to enqueue.
	 */
	async enqueueCode(code: string) {
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
		const runtimeState = this.runtime.getRuntimeState();
		if (!(runtimeState === RuntimeState.Idle || runtimeState === RuntimeState.Ready)) {
			this.addPendingInput(code);
			return;
		}

		// If there is pending code, evaluate what to do.
		if (this._pendingCode) {
			// Figure out whether adding this code to the pending code results in pending code that
			// can be executed. If so, execute it.
			const pendingCode = this._pendingCode + '\n' + code;
			const codeStatus = await this.runtime.isCodeFragmentComplete(pendingCode);
			if (codeStatus === RuntimeCodeFragmentStatus.Complete) {
				this.setPendingCode(undefined);
				this.doExecuteCode(pendingCode);
				return;
			}

			// Update the pending code. More will be revealed.
			this.setPendingCode(pendingCode);
			return;
		}

		// Figure out whether this code can be executed. If it can be, execute it immediately.
		const codeStatus = await this.runtime.isCodeFragmentComplete(code);
		if (codeStatus === RuntimeCodeFragmentStatus.Complete) {
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
	 * @param id The prompt identifier.
	 * @param value The value.
	 */
	replyToPrompt(id: string, value: string) {
		if (this._promptActive) {
			this._promptActive = false;
			this._runtime.replyToPrompt(id, value);
		}
	}

	/**
	 * Interrupts a prompt.
	 * @param id The prompt identifier.
	 */
	interruptPrompt(id: string) {
		if (this._promptActive) {
			this._promptActive = false;
			this._runtime.interrupt();
		}
	}

	//#endregion IPositronConsoleInstance Implementation

	//#region Public Methods

	/**
	 * Sets the runtime.
	 * @param runtime The runtime.
	 * @param starting A value which indicates whether the runtime is starting.
	 */
	setRuntime(runtime: ILanguageRuntime, starting: boolean) {
		// Set the runtime.
		this._runtime = runtime;

		// Attach the runtime.
		this.attachRuntime(starting);
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
				// This is the input activity; update its busy state.
				const input = item as ActivityItemInput;
				input.executing = busy;

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
								this._runtimeItems[i] = new RuntimeItemStarted(
									generateUuid(),
									`${this._runtime.metadata.runtimeName} ` +
									`${this._runtime.metadata.languageVersion} ` +
									`${runtimeItem.isRestart ? 'restarted' : 'started'}.`
								);
								this._onDidChangeRuntimeItemsEmitter.fire(this._runtimeItems);
							}
						}
						break;

					case PositronConsoleState.Offline:
						this.addRuntimeItem(
							new RuntimeItemReconnected(
								generateUuid(),
								`${this._runtime.metadata.runtimeName} ${this._runtime.metadata.languageVersion} reconnected.`
							)
						);
						break;
				}
				break;

			case PositronConsoleState.Offline:
				this.addRuntimeItem(
					new RuntimeItemOffline(
						generateUuid(),
						`${this._runtime.metadata.runtimeName} ${this._runtime.metadata.languageVersion} offline. Waiting to reconnect.`
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
	 * Attaches to a runtime.
	 * @param starting A value which indicates whether the runtime is starting.
	 */
	private attachRuntime(starting: boolean) {
		// Mark the runtime as attached.
		this._runtimeAttached = true;

		// Set the state and add the appropriate runtime item to indicate whether the Positron
		// console instance is is starting or is reconnected.
		if (starting) {
			const restart = this._state === PositronConsoleState.Exited;
			this.setState(PositronConsoleState.Starting);
			this.addRuntimeItem(new RuntimeItemStarting(
				generateUuid(),
				`${this._runtime.metadata.runtimeName} ${this._runtime.metadata.languageVersion} ` +
				`${restart ? 'restarting' : 'starting'}.`,
				restart
			));
		} else {
			this.setState(PositronConsoleState.Ready);
			this.addRuntimeItem(new RuntimeItemReconnected(
				generateUuid(),
				`${this._runtime.metadata.runtimeName} ${this._runtime.metadata.languageVersion} reconnected.`
			));
		}

		// Add the onDidChangeRuntimeState event handler.
		this._runtimeDisposableStore.add(this._runtime.onDidChangeRuntimeState(async runtimeState => {
			// Add a trace item.
			this.addRuntimeItemTrace(`onDidChangeRuntimeState (${runtimeState})`);

			// When the runtime goes idle or ready, process pending input.
			if (runtimeState === RuntimeState.Idle || runtimeState === RuntimeState.Ready) {
				this.processPendingInput();
			}

			if (runtimeState === RuntimeState.Exited) {
				if (this._runtimeState === RuntimeState.Starting ||
					this._runtimeState === RuntimeState.Initializing) {
					// If we moved directly from Starting or Initializing to
					// Exited, then we probably encountered a startup
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
						if (this._runtimeState === RuntimeState.Exited && this._runtimeAttached) {
							this.detachRuntime();
						}
					}, 1000);
				} else if (this._runtimeAttached) {
					// We exited from a state other than Starting or Initializing, so this is a
					// "normal" exit, or at least not a startup failure. Detach the runtime.
					this.detachRuntime();
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
		this._runtimeDisposableStore.add(this._runtime.onDidCompleteStartup(languageRuntimeInfo => {
			this.setState(PositronConsoleState.Ready);

			// Add item trace.
			this.addRuntimeItemTrace(`onDidCompleteStartup`);

			// Add the item startup.
			this.addRuntimeItem(new RuntimeItemStartup(
				generateUuid(),
				languageRuntimeInfo.banner,
				languageRuntimeInfo.implementation_version,
				languageRuntimeInfo.language_version
			));
		}));

		// Add the onDidEncounterStartupFailure event handler. This can arrive before or after
		// the state change to Exited, so we need to handle it in both places.
		this._runtimeDisposableStore.add(this._runtime.onDidEncounterStartupFailure(startupFailure => {
			// Add item trace.
			this.addRuntimeItemTrace(`onDidEncounterStartupFailure`);

			// Add the item startup.
			this.addRuntimeItem(new RuntimeItemStartupFailure(
				generateUuid(),
				startupFailure.message,
				startupFailure.details,
			));

			// If we haven't already detached the runtime, do it now.
			if (this._runtimeState === RuntimeState.Exited && this._runtimeAttached) {
				this.detachRuntime();
			}
		}));

		// Add the onDidReceiveRuntimeMessageInput event handler.
		this._runtimeDisposableStore.add(this._runtime.onDidReceiveRuntimeMessageInput(languageRuntimeMessageInput => {
			// Add trace item.
			this.addRuntimeItemTrace(
				formatCallbackTrace('onDidReceiveRuntimeMessageInput', languageRuntimeMessageInput) +
				'\nCode:\n' +
				languageRuntimeMessageInput.code
			);

			// Add or update the runtime item activity.
			this.addOrUpdateUpdateRuntimeItemActivity(
				languageRuntimeMessageInput.parent_id,
				new ActivityItemInput(
					false,
					languageRuntimeMessageInput.id,
					languageRuntimeMessageInput.parent_id,
					new Date(languageRuntimeMessageInput.when),
					this._runtime.dynState.inputPrompt,
					this._runtime.dynState.continuationPrompt,
					languageRuntimeMessageInput.code
				)
			);
		}));

		// Add the onDidReceiveRuntimeMessagePrompt event handler.
		this._runtimeDisposableStore.add(this._runtime.onDidReceiveRuntimeMessagePrompt(languageRuntimeMessagePrompt => {
			// Add trace item.
			this.addRuntimeItemTrace(
				formatCallbackTrace('onDidReceiveRuntimeMessagePrompt', languageRuntimeMessagePrompt) +
				`\nPrompt: ${languageRuntimeMessagePrompt.prompt}` +
				`\nPassword: ${languageRuntimeMessagePrompt.password}`
			);

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
		this._runtimeDisposableStore.add(this._runtime.onDidReceiveRuntimeMessageOutput(languageRuntimeMessageOutput => {
			// Add trace item.
			this.addRuntimeItemTrace(
				formatCallbackTrace('onDidReceiveRuntimeMessageOutput', languageRuntimeMessageOutput) +
				formatOutputData(languageRuntimeMessageOutput.data)
			);

			// Check to see if the data contains an image by checking the record for the
			// "image/" mime type.
			const images = Object.keys(languageRuntimeMessageOutput.data).find(key => key.startsWith('image/'));

			// Check to see if the data contains any HTML
			let html = Object.hasOwnProperty.call(languageRuntimeMessageOutput.data, 'text/html');
			if (html) {
				const htmlContent = languageRuntimeMessageOutput.data['text/html'].toLowerCase();
				if (htmlContent.indexOf('<script') >= 0 ||
					htmlContent.indexOf('<body') >= 0 ||
					htmlContent.indexOf('<html') >= 0) {
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
						languageRuntimeMessageOutput.data
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
		}));

		// Add the onDidReceiveRuntimeMessageStream event handler.
		this._runtimeDisposableStore.add(this._runtime.onDidReceiveRuntimeMessageStream(languageRuntimeMessageStream => {
			// Sanitize the trace output.
			let traceOutput = languageRuntimeMessageStream.text;
			traceOutput = traceOutput.replaceAll('\t', '[HT]');
			traceOutput = traceOutput.replaceAll('\n', '[LF]');
			traceOutput = traceOutput.replaceAll('\r', '[CR]');
			traceOutput = traceOutput.replaceAll('\x9B', 'CSI');
			traceOutput = traceOutput.replaceAll('\x1b', 'ESC');
			traceOutput = traceOutput.replaceAll('\x9B', 'CSI');

			// Add trace item.
			this.addRuntimeItemTrace(
				formatCallbackTrace('onDidReceiveRuntimeMessageStream', languageRuntimeMessageStream) +
				formatOutputStream(languageRuntimeMessageStream.name, traceOutput)
			);

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
		this._runtimeDisposableStore.add(this._runtime.onDidReceiveRuntimeMessageError(languageRuntimeMessageError => {
			// Add trace item.
			this.addRuntimeItemTrace(
				formatCallbackTrace('onDidReceiveRuntimeMessageError', languageRuntimeMessageError) +
				`\nName: ${languageRuntimeMessageError.name}` +
				'\nMessage:\n' +
				languageRuntimeMessageError.message +
				formatTraceback(languageRuntimeMessageError.traceback)
			);

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
		this._runtimeDisposableStore.add(this._runtime.onDidReceiveRuntimeMessageState(languageRuntimeMessageState => {
			// Add trace event.
			this.addRuntimeItemTrace(
				formatCallbackTrace('onDidReceiveRuntimeMessageState', languageRuntimeMessageState) +
				`\nState: ${languageRuntimeMessageState.state}`);

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
	}

	/**
	 * Detaches from a runtime.
	 */
	private detachRuntime() {
		if (this._runtimeAttached) {
			// We are currently attached; detach.
			this._runtimeAttached = false;

			// Clear the executing state of all ActivityItemInputs inputs. When a runtime exits, it
			// may not send an Idle message corresponding to the command that caused it to exit (for
			// instance if the command causes the runtime to crash).
			for (const activity of this._runtimeItemActivities.values()) {
				for (const item of activity.activityItems) {
					if (item instanceof ActivityItemInput) {
						item.executing = false;
					}
				}
			}

			// Dispose of the runtime event handlers.
			this._runtimeDisposableStore.dispose();
			this._runtimeDisposableStore = new DisposableStore();

			this.addRuntimeItem(new RuntimeItemExited(
				generateUuid(),
				`${this._runtime.metadata.runtimeName} ${this._runtime.metadata.languageVersion} has exited.`
			));
		} else {
			// We are not currently attached; warn.
			console.warn(`Attempt to detach already detached runtime ${this._runtime.metadata.runtimeName}.`);
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
		// If there is an existing pending input runtime item, remove it.
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
			this._runtime.dynState.inputPrompt,
			code
		);

		// Add the pending input runtime item.
		this.addRuntimeItem(this._runtimeItemPendingInput);
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
			const codeFragmentStatus = await this.runtime.isCodeFragmentComplete(codeFragment);
			if (codeFragmentStatus === RuntimeCodeFragmentStatus.Complete) {
				// Create the ID for the code fragment that will be executed.
				const id = `fragment-${generateUuid()}`;

				// Add the provisional ActivityItemInput for the code fragment.
				const runtimeItemActivity = new RuntimeItemActivity(id, new ActivityItemInput(
					true,
					id,
					id,
					new Date(),
					this._runtime.dynState.inputPrompt,
					this._runtime.dynState.continuationPrompt,
					codeFragment
				));
				this._runtimeItems.push(runtimeItemActivity);
				this._runtimeItemActivities.set(id, runtimeItemActivity);

				// If there are remaining pending input lines, add them in a new pending input
				// runtime item so they are processed the next time the runtime becomes idle.
				if (i + 1 < pendingInputLines.length) {
					// Create the pending input runtime item.
					this._runtimeItemPendingInput = new RuntimeItemPendingInput(
						generateUuid(),
						this._runtime.dynState.inputPrompt,
						pendingInputLines.slice(i + 1).join('\n')
					);

					// Add the pending input runtime item.
					this._runtimeItems.push(this._runtimeItemPendingInput);
				}

				// Fire the runtime items changed event once, now, after everything is set up.
				this._onDidChangeRuntimeItemsEmitter.fire(this._runtimeItems);

				// Execute the code fragment.
				this.runtime.execute(
					codeFragment,
					id,
					RuntimeCodeExecutionMode.Interactive,
					RuntimeErrorBehavior.Continue);

				// Fire the onDidExecuteCode event.
				this._onDidExecuteCodeEmitter.fire();

				// Return.
				return;
			}
		}

		// Fire the onDidExecuteCode event because we removed the pending input runtime item.
		this._onDidChangeRuntimeItemsEmitter.fire(this._runtimeItems);

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
			true,
			id,
			id,
			new Date(),
			this._runtime.dynState.inputPrompt,
			this._runtime.dynState.continuationPrompt,
			code
		);

		// Add the provisional ActivityItemInput. This provisional ActivityItemInput will be
		// replaced with the real ActivityItemInput when the runtime sends it (which can take a
		// moment or two to happen).
		this.addOrUpdateUpdateRuntimeItemActivity(id, activityItemInput);

		// Execute the code.
		this.runtime.execute(
			code,
			id,
			RuntimeCodeExecutionMode.Interactive,
			RuntimeErrorBehavior.Continue);

		// Fire the onDidExecuteCode event.
		this._onDidExecuteCodeEmitter.fire();
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
		const runtimeItemActivity = this._runtimeItemActivities.get(parentId);
		if (runtimeItemActivity) {
			runtimeItemActivity.addActivityItem(activityItem);
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

		// Fire the runtime items changed event.
		this._onDidChangeRuntimeItemsEmitter.fire(this._runtimeItems);
	}

	//#endregion Private Methods
}

// Register the Positron console service.
registerSingleton(IPositronConsoleService, PositronConsoleService, InstantiationType.Delayed);
