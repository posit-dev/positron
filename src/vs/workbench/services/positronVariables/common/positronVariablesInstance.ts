/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { VariableItem } from './classes/variableItem.js';
import { VariableGroup } from './classes/variableGroup.js';
import { VariableOverflow } from './classes/variableOverflow.js';
import { RuntimeState } from '../../languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, RuntimeClientType } from '../../runtimeSession/common/runtimeSessionService.js';
import { sortVariableItemsByName, sortVariableItemsByRecent, sortVariableItemsBySize } from './helpers/utils.js';
import { PositronVariablesList, PositronVariablesUpdate, VariablesClientInstance } from '../../languageRuntime/common/languageRuntimeVariablesClient.js';
import { VariableEntry, IPositronVariablesInstance, PositronVariablesGrouping, PositronVariablesSorting } from './interfaces/positronVariablesInstance.js';
import { VariableKind } from '../../languageRuntime/common/positronVariablesComm.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { PositronCommError } from '../../languageRuntime/common/positronBaseComm.js';
import { localize } from '../../../../nls.js';
import { RuntimeClientState } from '../../languageRuntime/common/languageRuntimeClientInstance.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';

/**
 * Constants.
 */
const DATA_GROUP_ID = 'group/data';
const VALUES_GROUP_ID = 'group/values';
const FUNCTIONS_GROUP_ID = 'group/functions';
const CLASSES_GROUP_ID = 'group/classes';
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
	 * Gets or sets the runtime session.
	 */
	private _session: ILanguageRuntimeSession;

	/**
	 * Gets or sets the runtime disposable store. This contains things that are disposed when a
	 * runtime is detached.
	 */
	private _runtimeDisposableStore = this._register(new DisposableStore());

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
	 * Gets or sets the "highlight recent values" behavior.
	 */
	private _highlightRecent = true;

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
	private _variablesClient?: VariablesClientInstance;

	/**
	 * The onDidChangeEntries event emitter.
	 */
	private readonly _onDidChangeEntriesEmitter = this._register(new Emitter<VariableEntry[]>);

	/**
	 * The onDidChangeState event emitter; tracks state changes to the
	 * underlying comm. We have a separate event emitter so we can attach to the
	 * event before the emitter for the underlying comm has been set up.
	 */
	private readonly _onDidChangeStateEmitter = this._register(new Emitter<RuntimeClientState>());

	/**
	 * The _onFocusInput event emitter.
	 */
	private readonly _onFocusElementEmitter = this._register(new Emitter<void>);

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param session The language runtime session.
	 * @param _logService The log service.
	 */
	constructor(
		session: ILanguageRuntimeSession,
		@ILogService private _logService: ILogService,
		@INotificationService private _notificationService: INotificationService,
		@IAccessibilityService private _accessibilityService: IAccessibilityService
	) {
		// Call the base class's constructor.
		super();

		// Set the runtime.
		this._session = session;

		// Set highlight recent value default based on accessibility service.
		this._highlightRecent = !this._accessibilityService.isMotionReduced();

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
	 * Gets the runtime session.
	 */
	get session(): ILanguageRuntimeSession {
		return this._session;
	}

	/**
	 * Gets the current state of the underlying comm.
	 */
	get state(): RuntimeClientState {
		return this._variablesClient ?
			this._variablesClient.clientState.get() : RuntimeClientState.Uninitialized;
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
	 * Gets the highlight recent setting.
	 */
	get highlightRecent(): boolean {
		return this._highlightRecent;
	}

	/**
	 * Sets the highlight recent setting.
	 */
	set highlightRecent(highlighRecent: boolean) {
		this._highlightRecent = highlighRecent;
	}

	/**
	 * onDidChangeEntries event.
	 */
	readonly onDidChangeEntries: Event<VariableEntry[]> = this._onDidChangeEntriesEmitter.event;

	/**
	 * onDidChangeState event.
	 */
	readonly onDidChangeState: Event<RuntimeClientState> = this._onDidChangeStateEmitter.event;

	/**
	 * onFocusElement event.
	 */
	readonly onFocusElement = this._onFocusElementEmitter.event;

	/**
	 * Requests refresh.
	 */
	async requestRefresh() {
		if (this._variablesClient) {
			this._expandedPaths.clear();
			try {
				const list = await this._variablesClient.requestRefresh();
				await this.processList(list);
			} catch (e) {
				const err = e as PositronCommError;
				const message = localize('positronVariables.requestRefreshError',
					'Error refreshing variables: {0}\n\n{1} ({2})', err.message, err.name, err.code);
				this._notificationService.error(message);
			}
		} else {
			this._logService.warn('Ignoring call to requestRefresh; client is not available.');
		}
	}

	/**
	 * Requests clear.
	 * @param includeHiddenVariables A value which indicates whether to include hidden variables.
	 */
	async requestClear(includeHiddenVariables: boolean) {
		if (this._variablesClient) {
			try {
				await this._variablesClient.requestClear(includeHiddenVariables);
			} catch (e) {
				const err = e as PositronCommError;
				const message = localize('positronVariables.requestClearError',
					'Error clearing variables: {0}\n\n{1} ({2})', err.message, err.name, err.code);
				this._notificationService.error(message);
			}
		} else {
			this._logService.warn('Ignoring call to requestClear; client is not available.');
		}
	}

	/**
	 * Requests the deletion of one or more variables.
	 * @param names The names of the variables to delete
	 */
	async requestDelete(names: string[]) {
		if (this._variablesClient) {
			try {
				const update = await this._variablesClient.requestDelete(names);
				await this.processUpdate(update);
			} catch (e) {
				const err = e as PositronCommError;
				const message = localize('positronVariables.requestDeleteError',
					'Error deleting variables: {0}\n\n{1} ({2})', err.message, err.name, err.code);
				this._notificationService.error(message);
			}
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
		try {
			if (!this._expandedPaths.has(pathString)) {
				// Locate the variable item. If it was found, expand it.
				const variableItem = this.locateVariableItem(path);
				if (variableItem) {
					this._expandedPaths.add(pathString);
					if (variableItem) {
						await variableItem.loadChildEntries(isExpanded);
					}
				}

				// The entries changed.
				this.entriesChanged();
			}
		} catch (e) {
			const err = e as PositronCommError;
			const message = localize('positronVariables.expandVariableItemError',
				'Error expanding variable item: {0}\n\n{1} ({2})', err.message, err.name, err.code);
			this._notificationService.error(message);
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

	/**
	 * Has filter text
	 */
	hasFilterText(): boolean {
		return this._filterText !== '';
	}

	//#endregion IPositronVariablesInstance Implementation

	//#region Public Methods

	/**
	 * Sets the runtime session.
	 *
	 * @param session The runtime session.
	 */
	setRuntimeSession(session: ILanguageRuntimeSession) {
		// Set the runtime.
		this._session = session;

		// Attach the runtime.
		this.attachRuntime();
	}

	/**
	 * Focuses current element in the variable tree.
	 *
	 */
	focusElement(): void {
		this._onFocusElementEmitter.fire();
	}

	//#endregion Public Methods

	//#region Private Methods

	/**
	 * Attaches to a runtime.
	 */
	private async attachRuntime() {
		// Add the onDidChangeRuntimeState event handler.
		this._runtimeDisposableStore.add(
			this._session.onDidChangeRuntimeState(async runtimeState => {
				switch (runtimeState) {
					case RuntimeState.Ready: {
						if (!this._variablesClient) {
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
		// Clear out our reference to the runtime client.
		this._variablesClient = undefined;

		// Remove all disposables associated with the attached runtime. This has
		// the side effect of disposing the client.
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
			const client = this._register(await this._session.createClient<any, any>(
				RuntimeClientType.Variables, {}));
			this._variablesClient = new VariablesClientInstance(client);

			// Add the onDidReceiveList event handler.
			this._runtimeDisposableStore.add(
				this._variablesClient.onDidReceiveList(environmentClientMessageList => {
					this.processList(environmentClientMessageList);
				})
			);

			// Add the onDidReceiveUpdate event handler.
			this._runtimeDisposableStore.add(
				this._variablesClient.onDidReceiveUpdate(async environmentClientMessageUpdate =>
					await this.processUpdate(environmentClientMessageUpdate)
				)
			);

			// Create an event handler for the client state.
			const event = Event.fromObservable(
				this._variablesClient.clientState, this._runtimeDisposableStore)

			this._runtimeDisposableStore.add(event(state => {
				// Clear all expanded paths if the client is closed.
				if (state === RuntimeClientState.Closed) {
					this._expandedPaths.clear();
				}

				// Fire the onDidChangeState event.
				this._onDidChangeStateEmitter.fire(state);
			}));

			// Add the runtime client to the runtime disposable store.
			this._runtimeDisposableStore.add(this._variablesClient);
		} catch (error) {
			this._logService.error(error);
		}
	}

	/**
	 * Processes an updated list of variables from the runtime.
	 *
	 * @param variablesList The updated list of variables.
	 */
	private async processList(variablesList: PositronVariablesList) {
		/**
		 * Returns a value which indicates whether the path is expanded.
		 * @param path The path.
		 * @returns true, if the path is expanded; otherwise, false.
		 */
		const isExpanded = (path: string[]) => this._expandedPaths.has(JSON.stringify(path));

		// Build the new variable items.
		const variableItems = new Map<string, VariableItem>();
		const promises: Promise<void>[] = [];
		for (const environmentVariable of variablesList.variables) {
			// Create the variable item.
			const variableItem = new VariableItem(environmentVariable, false);

			// Add the variable item.
			variableItems.set(variableItem.accessKey, variableItem);

			// If the variable item is expanded, load its child entries.
			if (isExpanded(variableItem.path)) {
				promises.push(variableItem.loadChildEntries(isExpanded));
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
	private async processUpdate(environmentClientUpdate: PositronVariablesUpdate) {
		/**
		 * Returns a value which indicates whether the path is expanded.
		 * @param path The path.
		 * @returns true, if the path is expanded; otherwise, false.
		 */
		const isExpanded = (path: string[]) => this._expandedPaths.has(JSON.stringify(path));

		// Clear the recency flag from all existing variables, so they don't get
		// re-highlighted as recent on the next update.
		this._variableItems.forEach(variableItem => variableItem.isRecent.set(false, undefined));

		// Add / replace assigned variable items.
		const promises: Promise<void>[] = [];
		for (let i = 0; i < environmentClientUpdate.assigned.length; i++) {
			// Get the environment variable.
			const environmentVariable = environmentClientUpdate.assigned[i];

			// Create the variable item. Mark it as recent if it was just
			// assigned and we're highlighting recent values.
			const variableItem = new VariableItem(environmentVariable,
				environmentVariable.evaluated && this._highlightRecent);

			// Add the variable item.
			this._variableItems.set(variableItem.accessKey, variableItem);

			// If the variable item is expanded, load its child entries.
			if (isExpanded(variableItem.path)) {
				promises.push(variableItem.loadChildEntries(isExpanded));
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

			// Sort the variable items by recency.
			case PositronVariablesSorting.Recent:
				sortVariableItemsByRecent(items);
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
		const classItems: VariableItem[] = [];
		items.forEach(item => {
			if (item.kind === VariableKind.Table) {
				dataItems.push(item);
			} else if (item.kind === VariableKind.Function) {
				functionItems.push(item);
			} else if (item.kind === VariableKind.Class) {
				classItems.push(item);
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

		// Add the class items group.
		if (classItems.length) {
			this._entries.push(new VariableGroup(
				CLASSES_GROUP_ID,
				'Classes',
				!this._collapsedGroupIds.has(CLASSES_GROUP_ID),
				this.sortItems(classItems)
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

			// Sort by recency.
			case PositronVariablesSorting.Recent:
				sortVariableItemsByRecent(items);
				break;
		}

		// Done.
		return items;
	}

	/**
	 * Locates a variable item by its path.
	 * @param path The path of the variable item to locate.
	 * @returns The variable item, if found; otherwise, undefined.
	 */
	private locateVariableItem(path: string[]): VariableItem | undefined {
		// Get the root variable item.
		const variableItem = this._variableItems.get(path[0]);
		if (!variableItem) {
			return undefined;
		}

		// Recursively locate the variable item.
		return variableItem.locateVariableItem(path.slice(1));
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
					return [entry, ...this.flatten(entry.variableItems)];
				} else {
					return [entry];
				}
			} else if (entry instanceof VariableItem) {
				return this.flatten([entry]);
			} else {
				return [];
			}
		});

		// Fire the onDidChangeEntries event.
		this._onDidChangeEntriesEmitter.fire(entries);
	}

	/**
	 * Flattens an array of variable items.
	 * @param variableItems The array of variable items.
	 * @returns The flattened child entries.
	 */
	private flatten(variableItems: VariableItem[]): (VariableItem | VariableOverflow)[] {
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
