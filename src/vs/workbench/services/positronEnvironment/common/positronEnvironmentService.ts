/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { EnvironmentVariableItem } from 'vs/workbench/services/positronEnvironment/common/classes/environmentVariableItem';
import { EnvironmentVariableGroup } from 'vs/workbench/services/positronEnvironment/common/classes/environmentVariableGroup';
import { sortEnvironmentVariableItemsByName, sortEnvironmentVariableItemsBySize } from 'vs/workbench/services/positronEnvironment/common/helpers/utils';
import { formatLanguageRuntime, ILanguageRuntime, ILanguageRuntimeService, RuntimeOnlineState, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { EnvironmentClientInstance, EnvironmentClientList, EnvironmentClientUpdate, EnvironmentVariableValueKind, IEnvironmentClientMessageError } from 'vs/workbench/services/languageRuntime/common/languageRuntimeEnvironmentClient';
import { EnvironmentEntry, IPositronEnvironmentInstance, IPositronEnvironmentService, PositronEnvironmentGrouping, PositronEnvironmentSorting, PositronEnvironmentState } from 'vs/workbench/services/positronEnvironment/common/interfaces/positronEnvironmentService';

/**
 * Constants.
 */
const DATA_GROUP_ID = 'data';
const VALUES_GROUP_ID = 'values';
const FUNCTIONS_GROUP_ID = 'functions';
const SMALL_GROUP_ID = 'small';
const MEDIUM_GROUP_ID = 'medium';
const LARGE_GROUP_ID = 'large';
const VERY_LARGE_GROUP_ID = 'very-large';

/**
 * PositronEnvironmentService class.
 */
class PositronEnvironmentService extends Disposable implements IPositronEnvironmentService {
	//#region Private Properties

	/**
	 * A map of the Positron environment instances by language ID.
	 */
	private readonly _positronEnvironmentInstancesByLanguageId =
		new Map<string, PositronEnvironmentInstance>();

	/**
	 * A map of the Positron environment instances by runtime ID.
	 */
	private readonly _positronEnvironmentInstancesByRuntimeId =
		new Map<string, PositronEnvironmentInstance>();

	/**
	 * The active Positron environment instance.
	 */
	private _activePositronEnvironmentInstance?: IPositronEnvironmentInstance;

	/**
	 * The onDidStartPositronEnvironmentInstance event emitter.
	 */
	private readonly _onDidStartPositronEnvironmentInstanceEmitter =
		this._register(new Emitter<IPositronEnvironmentInstance>);

	/**
	 * The onDidChangeActivePositronEnvironmentInstance event emitter.
	 */
	private readonly _onDidChangeActivePositronEnvironmentInstanceEmitter =
		this._register(new Emitter<IPositronEnvironmentInstance | undefined>);

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

		// Start a Positron environment instance for each running runtime.
		this._languageRuntimeService.runningRuntimes.forEach(runtime => {
			this.startPositronEnvironmentInstance(runtime, false);
		});

		// Get the active runtime. If there is one, set the active Positron environment instance.
		if (this._languageRuntimeService.activeRuntime) {
			const positronEnvironmentInstance = this._positronEnvironmentInstancesByRuntimeId.get(
				this._languageRuntimeService.activeRuntime.metadata.runtimeId
			);
			if (positronEnvironmentInstance) {
				this.setActivePositronEnvironmentInstance(positronEnvironmentInstance);
			}
		}

		// Register the onWillStartRuntime event handler so we start a new Positron environment
		// instance before a runtime starts up.
		this._register(this._languageRuntimeService.onWillStartRuntime(runtime => {
			const positronEnvironmentInstance = this._positronEnvironmentInstancesByLanguageId.get(
				runtime.metadata.languageId
			);
			if (positronEnvironmentInstance &&
				positronEnvironmentInstance.state === PositronEnvironmentState.Exited
			) {
				positronEnvironmentInstance.setRuntime(runtime, true);
				this._positronEnvironmentInstancesByRuntimeId.delete(
					positronEnvironmentInstance.runtime.metadata.runtimeId
				);
				this._positronEnvironmentInstancesByRuntimeId.set(
					positronEnvironmentInstance.runtime.metadata.runtimeId,
					positronEnvironmentInstance
				);
			} else {
				this.startPositronEnvironmentInstance(runtime, true);
			}
		}));

		// Register the onDidStartRuntime event handler so we activate the new Positron environment
		// instance when the runtime starts up.
		this._register(this._languageRuntimeService.onDidStartRuntime(runtime => {
			const positronEnvironmentInstance = this._positronEnvironmentInstancesByRuntimeId.get(
				runtime.metadata.runtimeId
			);
			if (positronEnvironmentInstance) {
				positronEnvironmentInstance.setState(PositronEnvironmentState.Ready);
			}
		}));

		// Register the onDidFailStartRuntime event handler so we activate the new Positron
		// environment instance when the runtime starts up.
		this._register(this._languageRuntimeService.onDidFailStartRuntime(runtime => {
			const positronEnvironmentInstance = this._positronEnvironmentInstancesByRuntimeId.get(
				runtime.metadata.runtimeId
			);
			if (positronEnvironmentInstance) {
				positronEnvironmentInstance.setState(PositronEnvironmentState.Exited);
			}
		}));

		// Register the onDidReconnectRuntime event handler so we start a new Positron environment
		// instance when a runtime is reconnected.
		this._register(this._languageRuntimeService.onDidReconnectRuntime(runtime => {
			this.startPositronEnvironmentInstance(runtime, false);
		}));

		// Register the onDidChangeRuntimeState event handler so we can activate the REPL for the
		// active runtime.
		this._register(
			this._languageRuntimeService.onDidChangeRuntimeState(languageRuntimeStateEvent => {
				const positronEnvironmentInstance = this._positronEnvironmentInstancesByRuntimeId.get(
					languageRuntimeStateEvent.runtime_id
				);
				if (!positronEnvironmentInstance) {
					// TODO@softwarenerd... Handle this in some special way.
					return;
				}

				switch (languageRuntimeStateEvent.new_state) {
					case RuntimeState.Uninitialized:
					case RuntimeState.Initializing:
						break;

					case RuntimeState.Starting:
						positronEnvironmentInstance.setState(PositronEnvironmentState.Starting);
						break;

					case RuntimeState.Ready:
						positronEnvironmentInstance.setState(PositronEnvironmentState.Ready);
						break;

					case RuntimeState.Offline:
						positronEnvironmentInstance.setState(PositronEnvironmentState.Offline);
						break;

					case RuntimeState.Exiting:
						positronEnvironmentInstance.setState(PositronEnvironmentState.Exiting);
						break;

					case RuntimeState.Exited:
						positronEnvironmentInstance.setState(PositronEnvironmentState.Exited);
						break;
				}
			}));

		// Register the onDidChangeActiveRuntime event handler so we can activate the REPL for the
		// active runtime.
		this._register(this._languageRuntimeService.onDidChangeActiveRuntime(runtime => {
			if (!runtime) {
				this.setActivePositronEnvironmentInstance();
			} else {
				const positronEnvironmentInstance = this._positronEnvironmentInstancesByRuntimeId.get(
					runtime.metadata.runtimeId
				);
				if (positronEnvironmentInstance) {
					this.setActivePositronEnvironmentInstance(positronEnvironmentInstance);
				} else {
					this._logService.error(`Language runtime ${formatLanguageRuntime(runtime)} became active, but a REPL instance for it is not running.`);
				}
			}
		}));
	}

	//#endregion Constructor & Dispose

	//#region IPositronEnvironmentService Implementation

	// Needed for service branding in dependency injector.
	declare readonly _serviceBrand: undefined;

	// An event that is fired when a REPL instance is started.
	readonly onDidStartPositronEnvironmentInstance =
		this._onDidStartPositronEnvironmentInstanceEmitter.event;

	// An event that is fired when the active REPL instance changes.
	readonly onDidChangeActivePositronEnvironmentInstance =
		this._onDidChangeActivePositronEnvironmentInstanceEmitter.event;

	// Gets the repl instances.
	get positronEnvironmentInstances(): IPositronEnvironmentInstance[] {
		return Array.from(this._positronEnvironmentInstancesByRuntimeId.values());
	}

	// Gets the active REPL instance.
	get activePositronEnvironmentInstance(): IPositronEnvironmentInstance | undefined {
		return this._activePositronEnvironmentInstance;
	}

	/**
	 * Placeholder that gets called to "initialize" the PositronEnvironmentService.
	 */
	initialize() {
	}

	//#endregion IPositronEnvironmentService Implementation

	//#region Private Methods

	/**
	 * Starts a Positron environment instance for the specified runtime.
	 * @param runtime The runtime for the new Positron environment instance.
	 * @param starting A value which indicates whether the runtime is starting.
	 * @returns The new Positron environment instance.
	 */
	private startPositronEnvironmentInstance(
		runtime: ILanguageRuntime,
		starting: boolean
	): IPositronEnvironmentInstance {
		// Create the new Positron environment instance.
		const positronEnvironmentInstance = new PositronEnvironmentInstance(runtime, starting);

		// Add the Positron environment instance.
		this._positronEnvironmentInstancesByLanguageId.set(
			runtime.metadata.languageId,
			positronEnvironmentInstance
		);
		this._positronEnvironmentInstancesByRuntimeId.set(
			runtime.metadata.runtimeId,
			positronEnvironmentInstance
		);

		// Fire the onDidStartPositronEnvironmentInstance event.
		this._onDidStartPositronEnvironmentInstanceEmitter.fire(positronEnvironmentInstance);

		// Set the active positron environment instance.
		this._activePositronEnvironmentInstance = positronEnvironmentInstance;

		// Fire the onDidChangeActivePositronEnvironmentInstance event.
		this._onDidChangeActivePositronEnvironmentInstanceEmitter.fire(positronEnvironmentInstance);

		// Return the instance.
		return positronEnvironmentInstance;
	}

	/**
	 * Sets the active Positron environment instance.
	 * @param positronEnvironmentInstance
	 */
	private setActivePositronEnvironmentInstance(
		positronEnvironmentInstance?: IPositronEnvironmentInstance
	) {
		// Set the active instance and fire the onDidChangeActivePositronEnvironmentInstance event.
		this._activePositronEnvironmentInstance = positronEnvironmentInstance;
		this._onDidChangeActivePositronEnvironmentInstanceEmitter.fire(positronEnvironmentInstance);
	}

	//#endregion Private Methods
}

/**
 * PositronEnvironmentInstance class.
 */
class PositronEnvironmentInstance extends Disposable implements IPositronEnvironmentInstance {
	//#region Private Properties

	/**
	 * Gets or sets the runtime.
	 */
	private _runtime: ILanguageRuntime;

	/**
	 * Gets or sets the runtime disposable store. This contains things that are disposed when a
	 * runtime is detached.
	 */
	private _runtimeDisposableStore = new DisposableStore();

	/**
	 * Gets or sets the state.
	 */
	private _state = PositronEnvironmentState.Uninitialized;

	/**
	 * Gets or sets the environment variable items map.
	 */
	private _environmentVariableItems = new Map<string, EnvironmentVariableItem>();

	/**
	 * Gets or sets the grouping.
	 */
	private _grouping = PositronEnvironmentGrouping.Kind;

	/**
	 * Gets or sets the sorting.
	 */
	private _sorting = PositronEnvironmentSorting.Name;

	/**
	 * Gets the collapsed groups set, which is used to keep track of which groups the user has
	 * collapsed. This is keyed by group ID. By default, all groups are expanded.
	 */
	private readonly _collapsedGroupIds = new Set<string>();

	/**
	 * Gets the expanded paths set, which is used to keep track of which environment variables the
	 * user has expanded. This is keyed by environment variable path. By default, all environment
	 * variables are collapsed.
	 */
	private readonly _expandedPaths = new Set<string>();

	/**
	 * Gets or sets the entries that are being displayed.
	 */
	private _entries: (EnvironmentVariableGroup | EnvironmentVariableItem)[] = [];

	/**
	 * Gets or sets the environment client that is used to communicate with the language runtime.
	 */
	private _environmentClient?: EnvironmentClientInstance;

	/**
	 * The onDidChangeState event emitter.
	 */
	private readonly _onDidChangeStateEmitter =
		this._register(new Emitter<PositronEnvironmentState>);

	/**
	 * The onDidChangeEnvironmentGrouping event emitter.
	 */
	private readonly _onDidChangeEnvironmentGroupingEmitter =
		this._register(new Emitter<PositronEnvironmentGrouping>);

	/**
	 * The onDidChangeEnvironmentGrouping event emitter.
	 */
	private readonly _onDidChangeEnvironmentSortingEmitter =
		this._register(new Emitter<PositronEnvironmentSorting>);

	/**
	 * The onDidChangeEntries event emitter.
	 */
	private readonly _onDidChangeEntriesEmitter = this._register(new Emitter<EnvironmentEntry[]>);

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param runtime The language runtime.
	 * @param starting A value which indicates whether the Positron environment instance is
	 * starting.
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
	 * Disposes of the PositronEnvironmentInstance.
	 */
	override dispose(): void {
		// Call Disposable's dispose.
		super.dispose();

		// Dispose of the runtime event handlers.
		this._runtimeDisposableStore.dispose();
	}

	//#endregion Constructor & Dispose

	//#region IPositronEnvironmentInstance Implementation

	/**
	 * Gets the runtime.
	 */
	get runtime(): ILanguageRuntime {
		return this._runtime;
	}

	/**
	 * Gets the state.
	 */
	get state(): PositronEnvironmentState {
		return this._state;
	}

	/**
	 * Gets the environment items.
	 */
	get environmentVariableItems(): EnvironmentVariableItem[] {
		return Array.from(this._environmentVariableItems.values());
	}

	/**
	 * Gets the grouping.
	 */
	get grouping(): PositronEnvironmentGrouping {
		return this._grouping;
	}

	/**
	 * Sets the grouping.
	 */
	set grouping(environmentGrouping: PositronEnvironmentGrouping) {
		// Set the environment grouping.
		this._grouping = environmentGrouping;
		this._onDidChangeEnvironmentGroupingEmitter.fire(this._grouping);

		// Update entries.
		this.updateEntries();
	}

	/**
	 * Gets the environment sorting.
	 */
	get sorting(): PositronEnvironmentSorting {
		return this._sorting;
	}

	/**
	 * Sets the environment sorting.
	 */
	set sorting(environmentSorting: PositronEnvironmentSorting) {
		// Set the environment sorting.
		this._sorting = environmentSorting;
		this._onDidChangeEnvironmentSortingEmitter.fire(this._sorting);

		// Update entries.
		this.updateEntries();
	}

	/**
	 * onDidChangeState event.
	 */
	readonly onDidChangeState: Event<PositronEnvironmentState> =
		this._onDidChangeStateEmitter.event;

	/**
	 * onDidChangeEnvironmentGrouping event.
	 */
	readonly onDidChangeEnvironmentGrouping: Event<PositronEnvironmentGrouping> =
		this._onDidChangeEnvironmentGroupingEmitter.event;

	/**
	 * onDidChangeEnvironmentSorting event.
	 */
	readonly onDidChangeEnvironmentSorting: Event<PositronEnvironmentSorting> =
		this._onDidChangeEnvironmentSortingEmitter.event;

	/**
	 * onDidChangeEntries event.
	 */
	readonly onDidChangeEntries: Event<EnvironmentEntry[]> = this._onDidChangeEntriesEmitter.event;

	/**
	 * Requests a refresh of the environment.
	 */
	async requestRefresh() {
		if (this._environmentClient) {
			this._expandedPaths.clear();
			const list = await this._environmentClient.requestRefresh();
			await this.processList(list);
		} else {
			console.error('Ignoring refresh request; environment client is not available.');
		}
	}

	/**
	 * Requests a clear of the environment.
	 * @param includeHiddenObjects A value which indicates whether to include hidden objects.
	 */
	async requestClear(includeHiddenObjects: boolean) {
		if (this._environmentClient) {
			const list = await this._environmentClient.requestClear(includeHiddenObjects);
			this.processList(list);
		} else {
			console.error('Ignoring clear request; environment client is not available.');
		}
	}

	/**
	 * Requests the deletion of one or more environment variables.
	 * @param names The names of the variables to delete
	 */
	async requestDelete(names: string[]) {
		if (this._environmentClient) {
			const update = await this._environmentClient.requestDelete(names);
			await this.processUpdate(update);
		}
		else {
			console.error('Ignoring delete request; environment client is not available.');
		}
	}

	/**
	 * Expands an environment variable group.
	 * @param id The identifier of the environment variable group to expand.
	 */
	expandEnvironmentVariableGroup(id: string) {
		// If the group is collapsed, expand it.
		if (this._collapsedGroupIds.has(id)) {
			this._collapsedGroupIds.delete(id);
			this.entriesChanged();
		}
	}

	/**
	 * Collapses an environment variable group.
	 * @param id The identifier of the environment variable group to collapse.
	 */
	collapseEnvironmentVariableGroup(id: string) {
		// If the group is not collapsed, collapse it.
		if (!this._collapsedGroupIds.has(id)) {
			this._collapsedGroupIds.add(id);
			this.entriesChanged();
		}
	}

	/**
	 * Expands an environment variable.
	 * @param path The path of the environment variable to expand.
	 */
	async expandEnvironmentVariable(path: string[]) {
		/**
		 * Returns a value which indicates whether the path is expanded.
		 * @param path The path.
		 * @returns true, if the path is expanded; otherwise, false.
		 */
		const isExpanded = (path: string[]) => this._expandedPaths.has(JSON.stringify(path));

		// If the envirionment variable item is not expanded, expand it.
		const pathString = JSON.stringify(path);
		if (!this._expandedPaths.has(pathString)) {
			// Locate the environment variable item. If it was found, expand it.
			const environmentVariableItem = this.findEnvironmentVariableItem(path);
			if (environmentVariableItem) {
				this._expandedPaths.add(pathString);
				if (environmentVariableItem) {
					await environmentVariableItem.loadChildren(isExpanded);
				}
			}

			// The entries changed.
			this.entriesChanged();
		}
	}

	/**
	 * Finds an environment variable item by its path.
	 * @param path The path of the environment variable item.
	 * @returns The environment variable item, if found; otherwise, undefined.
	 */
	private findEnvironmentVariableItem(path: string[]): EnvironmentVariableItem | undefined {
		// Find the root environment variable item.
		const environmentVariableItem = this._environmentVariableItems.get(path[0]);
		if (!environmentVariableItem) {
			return undefined;
		}

		// Find the environment variable item.
		return environmentVariableItem.locateChildEntry(path.slice(1));
	}

	/**
	 * Collapses an environment variable.
	 * @param path The path of the environment variable to collapse.
	 */
	collapseEnvironmentVariable(path: string[]) {
		// If the envirionment variable item is expanded, collapse it.
		const pathString = JSON.stringify(path);
		if (this._expandedPaths.has(pathString)) {
			this._expandedPaths.delete(pathString);
			this.entriesChanged();
		}
	}

	//#endregion IPositronEnvironmentInstance Implementation

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
	setState(state: PositronEnvironmentState) {
		switch (state) {
			case PositronEnvironmentState.Uninitialized:
			case PositronEnvironmentState.Starting:
				break;

			case PositronEnvironmentState.Ready:
				break;

			case PositronEnvironmentState.Offline:
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
	private async attachRuntime(starting: boolean) {
		// Add the appropriate runtime item to indicate whether the Positron environment instance is
		// is starting or is reconnected.
		if (starting) {
			this.setState(PositronEnvironmentState.Starting);
		} else {
			this.setState(PositronEnvironmentState.Ready);
		}

		// Add the onDidChangeRuntimeState event handler.
		this._runtimeDisposableStore.add(
			this._runtime.onDidChangeRuntimeState(runtimeState => {
				if (runtimeState === RuntimeState.Exited) {
					this.detachRuntime();
				}
			})
		);

		// Add the onDidCompleteStartup event handler.
		this._runtimeDisposableStore.add(
			this._runtime.onDidCompleteStartup(async languageRuntimeInfo => {
				await this.createRuntimeClient();
			})
		);

		// Add the onDidReceiveRuntimeMessageState event handler.
		this._runtimeDisposableStore.add(
			this._runtime.onDidReceiveRuntimeMessageState(languageRuntimeMessageState => {
				switch (languageRuntimeMessageState.state) {
					case RuntimeOnlineState.Starting: {
						break;
					}

					case RuntimeOnlineState.Busy: {
						this.setState(PositronEnvironmentState.Busy);
						break;
					}

					case RuntimeOnlineState.Idle: {
						this.setState(PositronEnvironmentState.Ready);
						break;
					}
				}
			})
		);

		// Add the onDidReceiveRuntimeMessageEvent event handler.
		this._runtimeDisposableStore.add(
			this._runtime.onDidReceiveRuntimeMessageEvent(languageRuntimeMessageEvent => {
			})
		);
	}

	/**
	 * Detaches from a runtime.
	 */
	private detachRuntime() {
		this._runtimeDisposableStore.dispose();
		this._runtimeDisposableStore = new DisposableStore();
		this._environmentClient = undefined;
	}

	/**
	 * Creates the runtime client.
	 */
	private async createRuntimeClient() {
		// Try to create the runtime client.
		try {
			// Create the runtime client.
			this._environmentClient = new EnvironmentClientInstance(this._runtime);

			// Add the onDidReceiveList event handler.
			this._runtimeDisposableStore.add(
				this._environmentClient.onDidReceiveList(environmentClientMessageList => {
					this.processList(environmentClientMessageList);
				})
			);

			// Add the onDidReceiveUpdate event handler.
			this._runtimeDisposableStore.add(
				this._environmentClient.onDidReceiveUpdate(async environmentClientMessageUpdate =>
					await this.processUpdate(environmentClientMessageUpdate)
				)
			);

			// Add the onDidReceiveError event handler.
			this._runtimeDisposableStore.add(
				this._environmentClient.onDidReceiveError(environmentClientMessageError => {
					this.processError(environmentClientMessageError);
				})
			);

			// Add the runtime client to the runtime disposable store.
			this._runtimeDisposableStore.add(this._environmentClient);
		} catch (error) {
			console.log('FAILURE');
			console.log(error);
		}
	}

	/**
	 * Processes an IEnvironmentClientMessageList.
	 * @param environmentClientMessageList The IEnvironmentClientMessageList.
	 */
	private async processList(environmentClientMessageList: EnvironmentClientList) {
		/**
		 * Returns a value which indicates whether the path is expanded.
		 * @param path The path.
		 * @returns true, if the path is expanded; otherwise, false.
		 */
		const isExpanded = (path: string[]) => this._expandedPaths.has(JSON.stringify(path));

		// Build the new environment variable items.
		const environmentVariableItems = new Map<string, EnvironmentVariableItem>();
		const promises: Promise<void>[] = [];
		for (const environmentVariable of environmentClientMessageList.variables) {
			// Create the environment variable item.
			const environmentVariableItem = new EnvironmentVariableItem(environmentVariable);

			// Add the environment variable item.
			environmentVariableItems.set(environmentVariableItem.accessKey, environmentVariableItem);

			// If the environment variable item is expanded, load its children.
			if (isExpanded(environmentVariableItem.path)) {
				promises.push(environmentVariableItem.loadChildren(isExpanded));
			}
		}

		// Set the environment variable items.
		this._environmentVariableItems = environmentVariableItems;

		// Await loading.
		await Promise.all(promises);

		// Update entries.
		this.updateEntries();
	}

	/**
	 * Processes an IEnvironmentClientMessageError.
	 * @param environmentClientMessageError The IEnvironmentClientMessageError.
	 */
	private async processUpdate(environmentClientMessageUpdate: EnvironmentClientUpdate) {
		/**
		 * Returns a value which indicates whether the path is expanded.
		 * @param path The path.
		 * @returns true, if the path is expanded; otherwise, false.
		 */
		const isExpanded = (path: string[]) => this._expandedPaths.has(JSON.stringify(path));

		// Add / replace assigned environment variable items.
		const promises: Promise<void>[] = [];
		for (let i = 0; i < environmentClientMessageUpdate.assigned.length; i++) {
			// Get the environment variable.
			const environmentVariable = environmentClientMessageUpdate.assigned[i];

			// Create the environment variable item.
			const environmentVariableItem = new EnvironmentVariableItem(environmentVariable);

			// Add the environment variable item.
			this._environmentVariableItems.set(
				environmentVariableItem.accessKey,
				environmentVariableItem
			);

			// If the environment variable item is expanded, load its children.
			if (isExpanded(environmentVariableItem.path)) {
				promises.push(environmentVariableItem.loadChildren(isExpanded));
			}
		}

		// Remove removed environment variable items.
		for (let i = 0; i < environmentClientMessageUpdate.removed.length; i++) {
			// Add the environment variable item.
			this._environmentVariableItems.delete(environmentClientMessageUpdate.removed[i]);
		}

		// Await loading.
		await Promise.all(promises);

		// Update entries.
		this.updateEntries();
	}

	/**
	 * Processes an IEnvironmentClientMessageError.
	 * @param environmentClientMessageError The IEnvironmentClientMessageError.
	 */
	private processError(environmentClientMessageError: IEnvironmentClientMessageError) {
		// TODO@softwarenerd - Write more code.
		console.error(environmentClientMessageError);
	}

	/**
	 * Updates entries.
	 */
	private updateEntries() {
		// Clear the entries.
		this._entries = [];

		// Update the entries by grouping.
		switch (this._grouping) {
			// None.
			case PositronEnvironmentGrouping.None:
				this.updateEntriesGroupedByNone();
				break;

			// Kind.
			case PositronEnvironmentGrouping.Kind:
				this.updateEntriesGroupedByKind();
				break;

			// Size.
			case PositronEnvironmentGrouping.Size:
				this.updateEntriesGroupedBySize();
				break;
		}

		//
		this.entriesChanged();
	}

	/**
	 * Updates entries grouped by none.
	 */
	private updateEntriesGroupedByNone() {
		// Get the environment variable items.
		const items = Array.from(this._environmentVariableItems.values());

		// Sort the environment variable items.
		switch (this._sorting) {
			// Sort the environment variable items by name.
			case PositronEnvironmentSorting.Name:
				sortEnvironmentVariableItemsByName(items);
				break;

			// Sort the environment variable items by size.
			case PositronEnvironmentSorting.Size:
				sortEnvironmentVariableItemsBySize(items);
				break;
		}

		// Update the entries.
		this._entries = items;
	}

	/**
	 * Updates entries grouped by kind.
	 */
	private updateEntriesGroupedByKind() {
		// Break the environment variable items into groups.
		const dataItems: EnvironmentVariableItem[] = [];
		const valueItems: EnvironmentVariableItem[] = [];
		const functionItems: EnvironmentVariableItem[] = [];
		for (const environmentVariableItem of this._environmentVariableItems.values()) {
			if (environmentVariableItem.kind === EnvironmentVariableValueKind.Table) {
				dataItems.push(environmentVariableItem);
			} else if (environmentVariableItem.kind === EnvironmentVariableValueKind.Function) {
				functionItems.push(environmentVariableItem);
			} else {
				valueItems.push(environmentVariableItem);
			}
		}

		// Clear the entries.
		this._entries = [];

		// Add the data items group.
		if (dataItems.length) {
			this._entries.push(new EnvironmentVariableGroup(
				DATA_GROUP_ID,
				'Data',
				!this._collapsedGroupIds.has(DATA_GROUP_ID),
				this.sortItems(dataItems)
			));
		}

		// Add the value items group.
		if (valueItems.length) {
			this._entries.push(new EnvironmentVariableGroup(
				VALUES_GROUP_ID,
				'Values',
				!this._collapsedGroupIds.has(VALUES_GROUP_ID),
				this.sortItems(valueItems)
			));
		}

		// Add the function items group.
		if (functionItems.length) {
			this._entries.push(new EnvironmentVariableGroup(
				FUNCTIONS_GROUP_ID,
				'Functions',
				!this._collapsedGroupIds.has(FUNCTIONS_GROUP_ID),
				this.sortItems(functionItems)
			));
		}
	}

	/**
	 * Updates entries grouped by size.
	 */
	private updateEntriesGroupedBySize() {
		// Break the environment variable items into groups.
		const smallItems: EnvironmentVariableItem[] = [];
		const mediumItems: EnvironmentVariableItem[] = [];
		const largeItems: EnvironmentVariableItem[] = [];
		const veryLargeItems: EnvironmentVariableItem[] = [];
		Array.from(this._environmentVariableItems.values()).forEach(item => {
			if (item.size < 1000) {
				smallItems.push(item);
			} else if (item.size < 10 * 1000) {
				mediumItems.push(item);
			} else if (item.size < 1000 * 1000) {
				largeItems.push(item);
			} else {
				veryLargeItems.push(item);
			}
		});

		// Add the small items group.
		if (smallItems.length) {
			this._entries.push(new EnvironmentVariableGroup(
				SMALL_GROUP_ID,
				'Small',
				!this._collapsedGroupIds.has(SMALL_GROUP_ID),
				this.sortItems(smallItems)
			));
		}

		// Add the medium items group.
		if (mediumItems.length) {
			this._entries.push(new EnvironmentVariableGroup(
				MEDIUM_GROUP_ID,
				'Medium',
				!this._collapsedGroupIds.has(MEDIUM_GROUP_ID),
				this.sortItems(mediumItems)
			));
		}

		// Add the large items group.
		if (largeItems.length) {
			this._entries.push(new EnvironmentVariableGroup(
				LARGE_GROUP_ID,
				'Large',
				!this._collapsedGroupIds.has(LARGE_GROUP_ID),
				this.sortItems(largeItems)
			));
		}

		// Add the very large items group.
		if (veryLargeItems.length) {
			this._entries.push(new EnvironmentVariableGroup(
				VERY_LARGE_GROUP_ID,
				'Very Large',
				!this._collapsedGroupIds.has(VERY_LARGE_GROUP_ID),
				this.sortItems(veryLargeItems)
			));
		}
	}

	/**
	 * Sorts an array of environment variable items.
	 * @param items The array of environment variable items.
	 * @returns The array of environment variable items
	 */
	private sortItems(items: EnvironmentVariableItem[]): EnvironmentVariableItem[] {
		// Sort the array of environment variable items.
		switch (this._sorting) {
			// Sort by name.
			case PositronEnvironmentSorting.Name:
				sortEnvironmentVariableItemsByName(items);
				break;

			// Sort by size.
			case PositronEnvironmentSorting.Size:
				sortEnvironmentVariableItemsBySize(items);
				break;
		}

		// Done.
		return items;
	}

	/**
	 * Handles a change in entries.
	 */
	private entriesChanged() {
		// Flatten the entries.
		const entries = this._entries.flatMap(entry => {
			if (entry instanceof EnvironmentVariableGroup) {
				entry.expanded = !this._collapsedGroupIds.has(entry.id);
				if (entry.expanded) {
					return [entry, ...this.flattenEnvironmentVariableItems(entry.environmentVariableItems)];
				} else {
					return [entry];
				}
			} else if (entry instanceof EnvironmentVariableItem) {
				return this.flattenEnvironmentVariableItems([entry]);
			} else {
				return [];
			}
		});

		// Fire the onDidChangeEntries event.
		this._onDidChangeEntriesEmitter.fire(entries);
	}

	/**
	 * Flattens an array of environment variable items.
	 * @param environmentVariableItems The array of environment variable items to flatten.
	 * @returns The flattened array of environment variable items.
	 */
	private flattenEnvironmentVariableItems(
		environmentVariableItems: EnvironmentVariableItem[]
	): EnvironmentVariableItem[] {
		/**
		 * Returns a value which indicates whether the path is expanded.
		 * @param path The path.
		 * @returns true, if the path is expanded; otherwise, false.
		 */
		const isExpanded = (path: string[]) => this._expandedPaths.has(JSON.stringify(path));

		// Flatten the array of environment variable items.
		return environmentVariableItems.flatMap(environmentVariableItem =>
			environmentVariableItem.flatten(isExpanded, this._sorting)
		);
	}

	//#endregion Private Methods
}

// Register the Positron environment service.
registerSingleton(
	IPositronEnvironmentService,
	PositronEnvironmentService,
	InstantiationType.Delayed
);
