/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { VariableItem } from 'vs/workbench/services/positronVariables/common/classes/variableItem';
import { VariableGroup } from 'vs/workbench/services/positronVariables/common/classes/variableGroup';
import { ILanguageRuntime, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { sortVariableItemsByName, sortVariableItemsBySize } from 'vs/workbench/services/positronVariables/common/helpers/utils';
import { VariablesClientInstance, VariablesClientList, VariablesClientUpdate, VariableValueKind, IVariablesClientMessageError } from 'vs/workbench/services/languageRuntime/common/languageRuntimeVariablesClient';
import { VariableEntry, IPositronVariablesInstance, PositronVariablesGrouping, PositronVariablesSorting, PositronVariablesInstanceState } from 'vs/workbench/services/positronVariables/common/interfaces/positronVariablesInstance';

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
 * PositronVariablesInstance class.
 */
export class PositronVariablesInstance extends Disposable implements IPositronVariablesInstance {
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
	private _state = PositronVariablesInstanceState.Uninitialized;

	/**
	 * Gets or sets the variable items map.
	 */
	private _variableItems = new Map<string, VariableItem>();

	/**
	 * Gets or sets the grouping.
	 */
	private _grouping = PositronVariablesGrouping.Kind;

	/**
	 * Gets or sets the sorting.
	 */
	private _sorting = PositronVariablesSorting.Name;

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
	 * Gets the expanded paths set, which is used to keep track of which variables the user has
	 * expanded. This is keyed by variable path. By default, all variables are collapsed.
	 */
	private readonly _expandedPaths = new Set<string>();

	/**
	 * Gets or sets the entries that are being displayed.
	 */
	private _entries: (VariableGroup | VariableItem)[] = [];

	/**
	 * Gets or sets the environment client that is used to communicate with the language runtime.
	 */
	private _environmentClient?: VariablesClientInstance;

	/**
	 * The onDidChangeState event emitter.
	 */
	private readonly _onDidChangeStateEmitter =
		this._register(new Emitter<PositronVariablesInstanceState>);

	/**
	 * The onDidChangeEntries event emitter.
	 */
	private readonly _onDidChangeEntriesEmitter = this._register(new Emitter<VariableEntry[]>);

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
	 * Disposes of the PositronVariablesInstance.
	 */
	override dispose(): void {
		// Call Disposable's dispose.
		super.dispose();

		// Dispose of the runtime event handlers.
		this._runtimeDisposableStore.dispose();
	}

	//#endregion Constructor & Dispose

	//#region IPositronVariablesInstance Implementation

	/**
	 * Gets the runtime.
	 */
	get runtime(): ILanguageRuntime {
		return this._runtime;
	}

	/**
	 * Gets the state.
	 */
	get state(): PositronVariablesInstanceState {
		return this._state;
	}

	/**
	 * Gets the variable items.
	 */
	get variableItems(): VariableItem[] {
		return Array.from(this._variableItems.values());
	}

	/**
	 * Gets the grouping.
	 */
	get grouping(): PositronVariablesGrouping {
		return this._grouping;
	}

	/**
	 * Sets the grouping.
	 */
	set grouping(grouping: PositronVariablesGrouping) {
		// Set the grouping.
		this._grouping = grouping;

		// Update entries.
		this.updateEntries();
	}

	/**
	 * Gets the sorting.
	 */
	get sorting(): PositronVariablesSorting {
		return this._sorting;
	}

	/**
	 * Sets the sorting.
	 */
	set sorting(sorting: PositronVariablesSorting) {
		// Set the sorting.
		this._sorting = sorting;

		// Update entries.
		this.updateEntries();
	}

	/**
	 * onDidChangeState event.
	 */
	readonly onDidChangeState: Event<PositronVariablesInstanceState> =
		this._onDidChangeStateEmitter.event;

	/**
	 * onDidChangeEntries event.
	 */
	readonly onDidChangeEntries: Event<VariableEntry[]> = this._onDidChangeEntriesEmitter.event;

	/**
	 * Requests refresh.
	 */
	async requestRefresh() {
		if (this._environmentClient) {
			this._expandedPaths.clear();
			const list = await this._environmentClient.requestRefresh();
			await this.processList(list);
		} else {
			this._logService.warn('Ignoring call to requestRefresh; client is not available.');
		}
	}

	/**
	 * Requests clear.
	 * @param includeHiddenVariables A value which indicates whether to include hidden variables.
	 */
	async requestClear(includeHiddenVariables: boolean) {
		if (this._environmentClient) {
			const list = await this._environmentClient.requestClear(includeHiddenVariables);
			this.processList(list);
		} else {
			this._logService.warn('Ignoring call to requestClear; client is not available.');
		}
	}

	/**
	 * Requests the deletion of one or more variables.
	 * @param names The names of the variables to delete
	 */
	async requestDelete(names: string[]) {
		if (this._environmentClient) {
			const update = await this._environmentClient.requestDelete(names);
			await this.processUpdate(update);
		}
		else {
			this._logService.warn('Ignoring call to requestDelete; client is not available.');
		}
	}

	/**
	 * Expands a variable group.
	 * @param id The identifier of the variable group to expand.
	 */
	expandVariableGroup(id: string) {
		// If the group is collapsed, expand it.
		if (this._collapsedGroupIds.has(id)) {
			// Expand the group.
			this._collapsedGroupIds.delete(id);

			// The entries changed.
			this.entriesChanged();
		}
	}

	/**
	 * Collapses a variable group.
	 * @param id The identifier of the variable group to collapse.
	 */
	collapseVariableGroup(id: string) {
		// If the group is not collapsed, collapse it.
		if (!this._collapsedGroupIds.has(id)) {
			// Collapse the group.
			this._collapsedGroupIds.add(id);

			// The entries changed.
			this.entriesChanged();
		}
	}

	/**
	 * Expands a variable item.
	 * @param path The path of the variable item to expand.
	 */
	async expandVariableItem(path: string[]) {
		/**
		 * Returns a value which indicates whether the path is expanded.
		 * @param path The path.
		 * @returns true, if the path is expanded; otherwise, false.
		 */
		const isExpanded = (path: string[]) => this._expandedPaths.has(JSON.stringify(path));

		// If the variable item is not expanded, expand it.
		const pathString = JSON.stringify(path);
		if (!this._expandedPaths.has(pathString)) {
			// Locate the variable item. If it was found, expand it.
			const variableItem = this.findVariableItem(path);
			if (variableItem) {
				this._expandedPaths.add(pathString);
				if (variableItem) {
					await variableItem.loadChildren(isExpanded);
				}
			}

			// The entries changed.
			this.entriesChanged();
		}
	}

	/**
	 * Collapses a variable item.
	 * @param path The path of the variable item to collapse.
	 */
	collapseVariableItem(path: string[]) {
		// If the envirionment variable item is expanded, collapse it.
		const pathString = JSON.stringify(path);
		if (this._expandedPaths.has(pathString)) {
			// Collapse the variable item.
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

	//#endregion IPositronVariablesInstance Implementation

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
	setState(state: PositronVariablesInstanceState) {
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
		this.setState(PositronVariablesInstanceState.Starting);

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
			this._environmentClient = new VariablesClientInstance(this._runtime);

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
	private async processList(environmentClientMessageList: VariablesClientList) {
		/**
		 * Returns a value which indicates whether the path is expanded.
		 * @param path The path.
		 * @returns true, if the path is expanded; otherwise, false.
		 */
		const isExpanded = (path: string[]) => this._expandedPaths.has(JSON.stringify(path));

		// Build the new variable items.
		const variableItems = new Map<string, VariableItem>();
		const promises: Promise<void>[] = [];
		for (const environmentVariable of environmentClientMessageList.variables) {
			// Create the variable item.
			const variableItem = new VariableItem(environmentVariable);

			// Add the variable item.
			variableItems.set(variableItem.accessKey, variableItem);

			// If the variable item is expanded, load its children.
			if (isExpanded(variableItem.path)) {
				promises.push(variableItem.loadChildren(isExpanded));
			}
		}

		// Set the variable items.
		this._variableItems = variableItems;

		// Await loading.
		await Promise.all(promises);

		// Update entries.
		this.updateEntries();
	}

	/**
	 * Processes an IEnvironmentClientMessageError.
	 * @param environmentClientMessageError The IEnvironmentClientMessageError.
	 */
	private async processUpdate(environmentClientUpdate: VariablesClientUpdate) {
		/**
		 * Returns a value which indicates whether the path is expanded.
		 * @param path The path.
		 * @returns true, if the path is expanded; otherwise, false.
		 */
		const isExpanded = (path: string[]) => this._expandedPaths.has(JSON.stringify(path));

		// Add / replace assigned variable items.
		const promises: Promise<void>[] = [];
		for (let i = 0; i < environmentClientUpdate.assigned.length; i++) {
			// Get the environment variable.
			const environmentVariable = environmentClientUpdate.assigned[i];

			// Create the variable item.
			const variableItem = new VariableItem(environmentVariable);

			// Add the variable item.
			this._variableItems.set(variableItem.accessKey, variableItem);

			// If the variable item is expanded, load its children.
			if (isExpanded(variableItem.path)) {
				promises.push(variableItem.loadChildren(isExpanded));
			}
		}

		// Remove removed variable items.
		for (let i = 0; i < environmentClientUpdate.removed.length; i++) {
			// Delete the variable item.
			this._variableItems.delete(environmentClientUpdate.removed[i]);
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
	private processError(environmentClientMessageError: IVariablesClientMessageError) {
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
			case PositronVariablesGrouping.None:
				this.updateEntriesGroupedByNone();
				break;

			// Kind.
			case PositronVariablesGrouping.Kind:
				this.updateEntriesGroupedByKind();
				break;

			// Size.
			case PositronVariablesGrouping.Size:
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

		// Sort the variable items.
		switch (this._sorting) {
			// Sort the variable items by name.
			case PositronVariablesSorting.Name:
				sortVariableItemsByName(items);
				break;

			// Sort the variable items by size.
			case PositronVariablesSorting.Size:
				sortVariableItemsBySize(items);
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

		// Break the variable items into groups.
		const dataItems: VariableItem[] = [];
		const valueItems: VariableItem[] = [];
		const functionItems: VariableItem[] = [];
		items.forEach(item => {
			if (item.kind === VariableValueKind.Table) {
				dataItems.push(item);
			} else if (item.kind === VariableValueKind.Function) {
				functionItems.push(item);
			} else {
				valueItems.push(item);
			}
		});

		// Clear the entries.
		this._entries = [];

		// Add the data items group.
		if (dataItems.length) {
			this._entries.push(new VariableGroup(
				DATA_GROUP_ID,
				'Data',
				!this._collapsedGroupIds.has(DATA_GROUP_ID),
				this.sortItems(dataItems)
			));
		}

		// Add the value items group.
		if (valueItems.length) {
			this._entries.push(new VariableGroup(
				VALUES_GROUP_ID,
				'Values',
				!this._collapsedGroupIds.has(VALUES_GROUP_ID),
				this.sortItems(valueItems)
			));
		}

		// Add the function items group.
		if (functionItems.length) {
			this._entries.push(new VariableGroup(
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

		// Break the variable items into groups.
		const smallItems: VariableItem[] = [];
		const mediumItems: VariableItem[] = [];
		const largeItems: VariableItem[] = [];
		const veryLargeItems: VariableItem[] = [];
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
			this._entries.push(new VariableGroup(
				SMALL_GROUP_ID,
				'Small',
				!this._collapsedGroupIds.has(SMALL_GROUP_ID),
				this.sortItems(smallItems)
			));
		}

		// Add the medium items group.
		if (mediumItems.length) {
			this._entries.push(new VariableGroup(
				MEDIUM_GROUP_ID,
				'Medium',
				!this._collapsedGroupIds.has(MEDIUM_GROUP_ID),
				this.sortItems(mediumItems)
			));
		}

		// Add the large items group.
		if (largeItems.length) {
			this._entries.push(new VariableGroup(
				LARGE_GROUP_ID,
				'Large',
				!this._collapsedGroupIds.has(LARGE_GROUP_ID),
				this.sortItems(largeItems)
			));
		}

		// Add the very large items group.
		if (veryLargeItems.length) {
			this._entries.push(new VariableGroup(
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
		// Get the variable items.
		let items = Array.from(this._variableItems.values());

		// If there is filtering set, filter the items.
		if (this._filterText !== '') {
			const regex = new RegExp(this._filterText, 'i');
			items = items.filter(item => item.displayName.search(regex) !== -1);
		}

		// Return the items.
		return items;
	}

	/**
	 * Sorts an array of variable items.
	 * @param items The array of variable items.
	 * @returns The sorted array of variable items
	 */
	private sortItems(items: VariableItem[]): VariableItem[] {
		// Sort the array of variable items.
		switch (this._sorting) {
			// Sort by name.
			case PositronVariablesSorting.Name:
				sortVariableItemsByName(items);
				break;

			// Sort by size.
			case PositronVariablesSorting.Size:
				sortVariableItemsBySize(items);
				break;
		}

		// Done.
		return items;
	}

	/**
	 * Finds a variable item by its path.
	 * @param path The path of the variable item.
	 * @returns The variable item, if found; otherwise, undefined.
	 */
	private findVariableItem(path: string[]): VariableItem | undefined {
		// Find the root variable item.
		const variableItem = this._variableItems.get(path[0]);
		if (!variableItem) {
			return undefined;
		}

		// Find the variable item.
		return variableItem.locateChildEntry(path.slice(1));
	}

	/**
	 * Handles a change in entries.
	 */
	private entriesChanged() {
		// Flatten the entries.
		const entries = this._entries.flatMap(entry => {
			if (entry instanceof VariableGroup) {
				entry.expanded = !this._collapsedGroupIds.has(entry.id);
				if (entry.expanded) {
					return [entry, ...this.flattenVariableItems(entry.variableItems)];
				} else {
					return [entry];
				}
			} else if (entry instanceof VariableItem) {
				return this.flattenVariableItems([entry]);
			} else {
				return [];
			}
		});

		// Fire the onDidChangeEntries event.
		this._onDidChangeEntriesEmitter.fire(entries);
	}

	/**
	 * Flattens an array of variable items.
	 * @param variableItems The array of variable items to flatten.
	 * @returns The flattened array of variable items.
	 */
	private flattenVariableItems(variableItems: VariableItem[]): VariableItem[] {
		/**
		 * Returns a value which indicates whether the path is expanded.
		 * @param path The path.
		 * @returns true, if the path is expanded; otherwise, false.
		 */
		const isExpanded = (path: string[]) => this._expandedPaths.has(JSON.stringify(path));

		// Flatten the array of variable items.
		return variableItems.flatMap(variableItem => variableItem.flatten(isExpanded));
	}

	//#endregion Private Methods
}
