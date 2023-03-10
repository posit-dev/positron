/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from 'vs/base/common/uuid';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { RuntimeItem } from 'vs/workbench/services/positronConsole/common/classes/runtimeItem';
import { ActivityItem } from 'vs/workbench/services/positronConsole/common/classes/activityItem';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { RuntimeItemTrace } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemTrace';
import { ActivityItemError } from 'vs/workbench/services/positronConsole/common/classes/ativityItemError';
import { ActivityItemInput } from 'vs/workbench/services/positronConsole/common/classes/activityItemInput';
import { RuntimeItemExited } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemExited';
import { ActivityItemOutput } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutput';
import { RuntimeItemStarted } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemStarted';
import { RuntimeItemStartup } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemStartup';
import { RuntimeItemOffline } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemOffline';
import { RuntimeItemActivity } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemActivity';
import { RuntimeItemStarting } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemStarting';
import { RuntimeItemReconnected } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemReconnected';
import { IPositronConsoleInstance, IPositronConsoleService, PositronConsoleState } from 'vs/workbench/services/positronConsole/common/interfaces/positronConsoleService';
import { formatLanguageRuntime, ILanguageRuntime, ILanguageRuntimeMessage, ILanguageRuntimeService, RuntimeOnlineState, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

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
			this.startPositronConsoleInstance(runtime, false);
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
	 * @returns A value which indicates whether the code could be executed.
	 */
	executeCode(languageId: string, code: string): boolean {
		const positronConsoleInstance = this._positronConsoleInstancesByLanguageId.get(languageId);
		if (!positronConsoleInstance) {
			// TODO@softwarenerd - See if we can start a new runtime for the language.
			return false;
		} else {
			positronConsoleInstance.executeCode(code);
			return true;
		}
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
	 * Gets or sets the runtime event handlers disposable store.
	 */
	private _runtimeEventHandlersDisposableStore = new DisposableStore();

	/**
	 * Gets or sets the state.
	 */
	private _state = PositronConsoleState.Uninitialized;

	/**
	 * Gets or sets a value which indicates whether trace is enabled.
	 */
	private _trace = false;

	/**
	 * Gets or sets the runtime items.
	 */
	private _runtimeItems: RuntimeItem[] = [];

	/**
	 * The runtime item activities.
	 */
	private _runtimeItemActivities = new Map<string, RuntimeItemActivity>();

	/**
	 * The onDidChangeState event emitter.
	 */
	private readonly _onDidChangeStateEmitter = this._register(new Emitter<PositronConsoleState>);

	/**
	 * The onDidChangeTrace event emitter.
	 */
	private readonly _onDidChangeTraceEmitter = this._register(new Emitter<boolean>);

	/**
	 * The onDidChangeRuntimeItems event emitter.
	 */
	private readonly _onDidChangeRuntimeItemsEmitter = this._register(new Emitter<RuntimeItem[]>);

	/**
	 * The onDidClearConsole event emitter.
	 */
	private readonly _onDidClearConsoleEmitter = this._register(new Emitter<void>);

	/**
	 * The onDidClearInputHistory event emitter.
	 */
	private readonly _onDidClearInputHistoryEmitter = this._register(new Emitter<void>);

	/**
	 * The onDidExecuteCode event emitter.
	 */
	private readonly _onDidExecuteCodeEmitter = this._register(new Emitter<string>);

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

	override dispose(): void {
		super.dispose();
		this._runtimeEventHandlersDisposableStore.dispose();
	}

	//#endregion Constructor & Dispose

	//#region IPositronConsoleInstance Implementation

	/**
	 * Gets the state.
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
	 * Gets the runtime items.
	 */
	get runtimeItems(): RuntimeItem[] {
		return this._runtimeItems;
	}

	/**
	 * onDidChangeState event.
	 */
	readonly onDidChangeState: Event<PositronConsoleState> = this._onDidChangeStateEmitter.event;

	/**
	 * onDidChangeTrace event.
	 */
	readonly onDidChangeTrace: Event<boolean> = this._onDidChangeTraceEmitter.event;

	/**
	 * onDidChangeRuntimeItems event.
	 */
	readonly onDidChangeRuntimeItems: Event<RuntimeItem[]> = this._onDidChangeRuntimeItemsEmitter.event;

	/**
	 * onDidClearConsole event.
	 */
	readonly onDidClearConsole: Event<void> = this._onDidClearConsoleEmitter.event;

	/**
	 * onDidClearInputHistory event.
	 */
	readonly onDidClearInputHistory: Event<void> = this._onDidClearInputHistoryEmitter.event;

	/**
	 * onDidExecuteCode event.
	 */
	readonly onDidExecuteCode: Event<string> = this._onDidExecuteCodeEmitter.event;

	/**
	 * Toggles trace.
	 */
	toggleTrace(): void {
		this._trace = !this._trace;
		this._onDidChangeTraceEmitter.fire(this._trace);
	}

	/**
	 * Clears the console.
	 */
	clearConsole(): void {
		this._runtimeItems = [];
		this._runtimeItemActivities.clear();
		this._onDidChangeRuntimeItemsEmitter.fire(this._runtimeItems);
		this._onDidClearConsoleEmitter.fire();
	}

	/**
	 * Clears the input history.
	 */
	clearInputHistory(): void {
		this._onDidClearInputHistoryEmitter.fire();
	}

	/**
	 * Executes code.
	 * @param codeFragment The code fragment to execute.
	 */
	executeCode(codeFragment: string): void {
		this._onDidExecuteCodeEmitter.fire(codeFragment);
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
								this._runtimeItems[i] = new RuntimeItemStarted(
									generateUuid(),
									`${this._runtime.metadata.runtimeName} ${this._runtime.metadata.languageVersion} started.`
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
		// Add the appropriate runtime item to indicate whether the Positron console instance is
		// is starting or is reconnected.
		if (starting) {
			this.setState(PositronConsoleState.Starting);
			this.addRuntimeItem(new RuntimeItemStarting(
				generateUuid(),
				`${this._runtime.metadata.runtimeName} ${this._runtime.metadata.languageVersion} starting.`
			));
		} else {
			this.setState(PositronConsoleState.Ready);
			this.addRuntimeItem(new RuntimeItemReconnected(
				generateUuid(),
				`${this._runtime.metadata.runtimeName} ${this._runtime.metadata.languageVersion} reconnected.`
			));
		}

		// Add the onDidChangeRuntimeState event handler.
		this._runtimeEventHandlersDisposableStore.add(this._runtime.onDidChangeRuntimeState(runtimeState => {
			this.addRuntimeItemTrace(`onDidChangeRuntimeState (${runtimeState})`);
			if (runtimeState === RuntimeState.Exited) {
				this.detachRuntime();
			}
		}));

		// Add the onDidCompleteStartup event handler.
		this._runtimeEventHandlersDisposableStore.add(this._runtime.onDidCompleteStartup(languageRuntimeInfo => {
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

		// Add the onDidReceiveRuntimeMessageOutput event handler.
		this._runtimeEventHandlersDisposableStore.add(this._runtime.onDidReceiveRuntimeMessageOutput(languageRuntimeMessageOutput => {
			// Add trace item.
			this.addRuntimeItemTrace(
				formatCallbackTrace('onDidReceiveRuntimeMessageOutput', languageRuntimeMessageOutput) +
				formatOutputData(languageRuntimeMessageOutput.data)
			);

			// Add or update the activity event.
			this.addOrUpdateUpdateRuntimeItemActivity(languageRuntimeMessageOutput.parent_id, new ActivityItemOutput(
				languageRuntimeMessageOutput.id,
				languageRuntimeMessageOutput.parent_id,
				new Date(languageRuntimeMessageOutput.when),
				languageRuntimeMessageOutput.data
			));
		}));

		// Add the onDidReceiveRuntimeMessageInput event handler.
		this._runtimeEventHandlersDisposableStore.add(this._runtime.onDidReceiveRuntimeMessageInput(languageRuntimeMessageInput => {
			// Add trace item.
			this.addRuntimeItemTrace(
				formatCallbackTrace('onDidReceiveRuntimeMessageInput', languageRuntimeMessageInput) +
				'\nCode:\n' +
				languageRuntimeMessageInput.code
			);

			// Add or update the activity event.
			this.addOrUpdateUpdateRuntimeItemActivity(languageRuntimeMessageInput.parent_id, new ActivityItemInput(
				languageRuntimeMessageInput.id,
				languageRuntimeMessageInput.parent_id,
				new Date(languageRuntimeMessageInput.when),
				languageRuntimeMessageInput.code
			));
		}));

		// Add the onDidReceiveRuntimeMessageError event handler.
		this._runtimeEventHandlersDisposableStore.add(this._runtime.onDidReceiveRuntimeMessageError(languageRuntimeMessageError => {
			// Add trace item.
			this.addRuntimeItemTrace(
				formatCallbackTrace('onDidReceiveRuntimeMessageError', languageRuntimeMessageError) +
				`\nName: ${languageRuntimeMessageError.name}` +
				'\nMessage:\n' +
				languageRuntimeMessageError.message +
				formatTraceback(languageRuntimeMessageError.traceback)
			);

			// Add or update the activity event.
			this.addOrUpdateUpdateRuntimeItemActivity(languageRuntimeMessageError.parent_id, new ActivityItemError(
				languageRuntimeMessageError.id,
				languageRuntimeMessageError.parent_id,
				new Date(languageRuntimeMessageError.when),
				languageRuntimeMessageError.name,
				languageRuntimeMessageError.message,
				languageRuntimeMessageError.traceback
			));
		}));

		// Add the onDidReceiveRuntimeMessagePrompt event handler.
		this._runtimeEventHandlersDisposableStore.add(this._runtime.onDidReceiveRuntimeMessagePrompt(languageRuntimeMessagePrompt => {
			// Add trace event.
			this.addRuntimeItemTrace(`onDidReceiveRuntimeMessagePrompt: ID: ${languageRuntimeMessagePrompt.id} Parent ID: ${languageRuntimeMessagePrompt.parent_id}\nPassword: ${languageRuntimeMessagePrompt.password}\Prompt: ${languageRuntimeMessagePrompt.prompt}`);
		}));

		// Add the onDidReceiveRuntimeMessageState event handler.
		this._runtimeEventHandlersDisposableStore.add(this._runtime.onDidReceiveRuntimeMessageState(languageRuntimeMessageState => {
			// Add trace event.
			this.addRuntimeItemTrace(
				formatCallbackTrace('onDidReceiveRuntimeMessageState', languageRuntimeMessageState) +
				`\nState: ${languageRuntimeMessageState.state}`);

			switch (languageRuntimeMessageState.state) {
				case RuntimeOnlineState.Starting: {
					break;
				}

				case RuntimeOnlineState.Busy: {
					if (languageRuntimeMessageState.parent_id.startsWith('fragment-')) {
						break;
					}
				}

				case RuntimeOnlineState.Idle: {
					if (languageRuntimeMessageState.parent_id.startsWith('fragment-')) {
						break;
					}
				}
			}
		}));

		// Add the onDidReceiveRuntimeMessageEvent event handler.
		this._runtimeEventHandlersDisposableStore.add(this._runtime.onDidReceiveRuntimeMessageEvent(languageRuntimeMessageEvent => {
		}));
	}

	/**
	 * Detaches from a runtime.
	 */
	private detachRuntime() {
		this._runtimeEventHandlersDisposableStore.dispose();
		this._runtimeEventHandlersDisposableStore = new DisposableStore();

		this.addRuntimeItem(new RuntimeItemExited(
			generateUuid(),
			`${this._runtime.metadata.runtimeName} ${this._runtime.metadata.languageVersion} has exited.`
		));
	}

	/**
	 * Adds a trace runtime item.
	 * @param trace The text.
	 */
	private addRuntimeItemTrace(trace: string) {
		return;
		//this.addRuntimeItem(new RuntimeItemTrace(generateUuid(), trace));
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
