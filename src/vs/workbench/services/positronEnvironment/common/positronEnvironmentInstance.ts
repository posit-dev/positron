/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { ILanguageRuntime, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { EnvironmentVariableItem } from 'vs/workbench/services/positronEnvironment/common/classes/environmentVariableItem';
import { EnvironmentVariableGroup } from 'vs/workbench/services/positronEnvironment/common/classes/environmentVariableGroup';
import { sortEnvironmentVariableItemsByName, sortEnvironmentVariableItemsBySize } from 'vs/workbench/services/positronEnvironment/common/helpers/utils';
import { EnvironmentClientInstance, EnvironmentClientList, EnvironmentClientUpdate, EnvironmentVariableValueKind, IEnvironmentClientMessageError } from 'vs/workbench/services/languageRuntime/common/languageRuntimeEnvironmentClient';
import { EnvironmentEntry, IPositronEnvironmentInstance, PositronEnvironmentGrouping, PositronEnvironmentSorting, PositronEnvironmentInstanceState } from 'vs/workbench/services/positronEnvironment/common/interfaces/positronEnvironmentInstance';

/**
 * Constants.
 */
const DATA_GROUP_ID = 'group/data';
const VALUES_GROUP_ID = 'group/values';
const FUNCTIONS_GROUP_ID = 'group/functions';
const SMALL_GROUP_ID = 'group/small';
const MEDIUM_GROUP_ID = 'group/medium';
const LARGE_GROUP_ID = 'group/large';
const VERY_LARGE_GROUP_ID = 'group/very-large';

/**
 * PositronEnvironmentInstance class.
 */
export class PositronEnvironmentInstance extends Disposable implements IPositronEnvironmentInstance {
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
	private _state = PositronEnvironmentInstanceState.Uninitialized;

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
	 * Gets or sets the filter text.
	 */
	private _filterText = '';

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
		this._register(new Emitter<PositronEnvironmentInstanceState>);

	/**
	 * The onDidChangeEntries event emitter.
	 */
	private readonly _onDidChangeEntriesEmitter = this._register(new Emitter<EnvironmentEntry[]>);

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param runtime The language runtime.
	 * @param _logService The log service.
	 */
	constructor(
		runtime: ILanguageRuntime,
		@ILogService private _logService: ILogService
	) {
		// Call the base class's constructor.
		super();

		// Set the runtime.
		this._runtime = runtime;

		// Attach to the runtime.
		this.attachRuntime();
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
	get state(): PositronEnvironmentInstanceState {
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

		// Update entries.
		this.updateEntries();
	}

	/**
	 * onDidChangeState event.
	 */
	readonly onDidChangeState: Event<PositronEnvironmentInstanceState> =
		this._onDidChangeStateEmitter.event;

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
			this._logService.warn('Ignoring call to requestRefresh; environment client is not available.');
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
			this._logService.warn('Ignoring call to requestClear; environment client is not available.');
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
			this._logService.warn('Ignoring call to requestDelete; environment client is not available.');
		}
	}

	/**
	 * Expands an environment variable group.
	 * @param id The identifier of the environment variable group to expand.
	 */
	expandEnvironmentVariableGroup(id: string) {
		// If the group is collapsed, expand it.
		if (this._collapsedGroupIds.has(id)) {
			// Expand the group.
			this._collapsedGroupIds.delete(id);

			// The entries changed.
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
			// Collapse the group.
			this._collapsedGroupIds.add(id);

			// The entries changed.
			this.entriesChanged();
		}
	}

	/**
	 * Expands an environment variable item.
	 * @param path The path of the environment variable to expand.
	 */
	async expandEnvironmentVariableItem(path: string[]) {
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
	 * Collapses an environment variable.
	 * @param path The path of the environment variable to collapse.
	 */
	collapseEnvironmentVariableItem(path: string[]) {
		// If the envirionment variable item is expanded, collapse it.
		const pathString = JSON.stringify(path);
		if (this._expandedPaths.has(pathString)) {
			// Collapse the environment variable.
			this._expandedPaths.delete(pathString);

			// The entries changed.
			this.entriesChanged();
		}
	}

	/**
	 * Sets the filter text.
	 * @param filterText The filter text.
	 */
	setFilterText(filterText: string) {
		// If the filter text has changed, set the filter text and update the entries.
		if (filterText !== this._filterText) {
			// Set the filter text.
			this._filterText = filterText;

			// Update entries.
			this.updateEntries();
		}
	}

	//#endregion IPositronEnvironmentInstance Implementation

	//#region Public Methods

	/**
	 * Sets the runtime.
	 * @param runtime The runtime.
	 */
	setRuntime(runtime: ILanguageRuntime) {
		// Set the runtime.
		this._runtime = runtime;

		// Attach the runtime.
		this.attachRuntime();
	}

	/**
	 * Sets the state.
	 * @param state The new state.
	 */
	setState(state: PositronEnvironmentInstanceState) {
		// Set the new state and raise the onDidChangeState event.
		this._state = state;
		this._onDidChangeStateEmitter.fire(this._state);
	}

	//#endregion Public Methods

	//#region Private Methods

	/**
	 * Attaches to a runtime.
	 */
	private async attachRuntime() {
		// Set the initial state.
		this.setState(PositronEnvironmentInstanceState.Starting);

		// Add the onDidChangeRuntimeState event handler.
		this._runtimeDisposableStore.add(
			this._runtime.onDidChangeRuntimeState(async runtimeState => {
				switch (runtimeState) {
					case RuntimeState.Ready: {
						if (!this._environmentClient) {
							await this.createRuntimeClient();
						}
						break;
					}

					case RuntimeState.Exited: {
						this.detachRuntime();
						break;
					}
				}
			})
		);
	}

	/**
	 * Detaches from a runtime.
	 */
	private detachRuntime() {
		this._environmentClient = undefined;
		this._runtimeDisposableStore.dispose();
		this._runtimeDisposableStore = new DisposableStore();
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
			this._logService.error(error);
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
		this._logService.error(`There was an error with the Environment client: ${environmentClientMessageError.message}`);
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

		// The entries changed.
		this.entriesChanged();
	}

	/**
	 * Updates entries grouped by none.
	 */
	private updateEntriesGroupedByNone() {
		// Get the filtered items.
		const items = this.filteredItems();

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
		// Get the filtered items.
		const items = this.filteredItems();

		// Break the environment variable items into groups.
		const dataItems: EnvironmentVariableItem[] = [];
		const valueItems: EnvironmentVariableItem[] = [];
		const functionItems: EnvironmentVariableItem[] = [];
		items.forEach(item => {
			if (item.kind === EnvironmentVariableValueKind.Table) {
				dataItems.push(item);
			} else if (item.kind === EnvironmentVariableValueKind.Function) {
				functionItems.push(item);
			} else {
				valueItems.push(item);
			}
		});

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
		// Get the filtered items.
		const items = this.filteredItems();

		// Break the environment variable items into groups.
		const smallItems: EnvironmentVariableItem[] = [];
		const mediumItems: EnvironmentVariableItem[] = [];
		const largeItems: EnvironmentVariableItem[] = [];
		const veryLargeItems: EnvironmentVariableItem[] = [];
		items.forEach(item => {
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
	 * Returns the filtered items.
	 * @returns The filtered items.
	 */
	private filteredItems() {
		// Get the environment variable items.
		let items = Array.from(this._environmentVariableItems.values());

		// If there is filtering set, filter the items.
		if (this._filterText !== '') {
			const regex = new RegExp(this._filterText, 'i');
			items = items.filter(item => item.displayName.search(regex) !== -1);
		}

		// Return the items.
		return items;
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
			environmentVariableItem.flatten(isExpanded)
		);
	}

	//#endregion Private Methods
}
