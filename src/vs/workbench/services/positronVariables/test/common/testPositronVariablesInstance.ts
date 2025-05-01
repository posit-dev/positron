/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ILanguageRuntimeSession } from '../../../runtimeSession/common/runtimeSessionService.js';
import { RuntimeClientState, RuntimeClientStatus } from '../../../languageRuntime/common/languageRuntimeClientInstance.js';
import { IPositronVariablesInstance, PositronVariablesGrouping, PositronVariablesSorting, VariableEntry } from '../../common/interfaces/positronVariablesInstance.js';

/**
 * TestPositronVariablesInstance class.
 */
export class TestPositronVariablesInstance extends Disposable implements IPositronVariablesInstance {
	//#region Private Properties

	/**
	 * The onDidChangeEntries event emitter.
	 */
	private readonly _onDidChangeEntriesEmitter = this._register(new Emitter<VariableEntry[]>());

	/**
	 * The onDidChangeState event emitter.
	 */
	private readonly _onDidChangeStateEmitter = this._register(new Emitter<RuntimeClientState>());

	/**
	 * The onDidChangeStatus event emitter.
	 */
	private readonly _onDidChangeStatusEmitter = this._register(new Emitter<RuntimeClientStatus>());

	/**
	 * The onFocusElement event emitter.
	 */
	private readonly _onFocusElementEmitter = this._register(new Emitter<void>());

	/**
	 * Current state.
	 */
	private _state: RuntimeClientState = RuntimeClientState.Connected;

	/**
	 * Current status.
	 */
	private _status: RuntimeClientStatus = RuntimeClientStatus.Idle;

	/**
	 * Filter text.
	 */
	private _filterText: string = '';

	/**
	 * Variable entries.
	 */
	private _entries: VariableEntry[] = [];

	//#endregion

	/**
	 * Constructor.
	 * @param session The language runtime session.
	 */
	constructor(
		readonly session: ILanguageRuntimeSession,
		private _grouping: PositronVariablesGrouping = PositronVariablesGrouping.None,
		private _sorting: PositronVariablesSorting = PositronVariablesSorting.Name,
		private _highlightRecent: boolean = false
	) {
		super();
	}

	//#region IPositronVariablesInstance Implementation

	/**
	 * Gets the state.
	 */
	get state(): RuntimeClientState {
		return this._state;
	}

	/**
	 * Gets or sets the grouping.
	 */
	get grouping(): PositronVariablesGrouping {
		return this._grouping;
	}

	set grouping(value: PositronVariablesGrouping) {
		this._grouping = value;
	}

	/**
	 * Gets or sets the sorting.
	 */
	get sorting(): PositronVariablesSorting {
		return this._sorting;
	}

	set sorting(value: PositronVariablesSorting) {
		this._sorting = value;
	}

	/**
	 * Gets or sets recent value highlight.
	 */
	get highlightRecent(): boolean {
		return this._highlightRecent;
	}

	set highlightRecent(value: boolean) {
		this._highlightRecent = value;
	}

	/**
	 * Gets the current status
	 */
	get status(): RuntimeClientStatus {
		return this._status;
	}

	/**
	 * The onDidChangeEntries event.
	 */
	readonly onDidChangeEntries = this._onDidChangeEntriesEmitter.event;

	/**
	 * Event that fires when the state of the underlying comm changes.
	 */
	readonly onDidChangeState = this._onDidChangeStateEmitter.event;

	/**
	 * Event that fires when the status of the underlying comm changes.
	 */
	readonly onDidChangeStatus = this._onDidChangeStatusEmitter.event;

	/**
	 * The onFocusElement event.
	 * Used by variable widgets to respond to focus requests.
	 */
	readonly onFocusElement = this._onFocusElementEmitter.event;

	/**
	 * Requests refresh.
	 */
	requestRefresh(): void {
		// No-op for test implementation
	}

	/**
	 * Requests clear.
	 * @param includeHiddenVariables A value which indicates whether to include hidden variables.
	 */
	requestClear(includeHiddenVariables: boolean): void {
		// No-op for test implementation
	}

	/**
	 * Requests the deletion of one or more variables.
	 * @param names The names of the variables to delete
	 */
	requestDelete(names: string[]): void {
		// No-op for test implementation
	}

	/**
	 * Expands a variable group.
	 * @param id The identifier of the variable group to expand.
	 */
	expandVariableGroup(id: string): void {
		// No-op for test implementation
	}

	/**
	 * Collapses a variable group.
	 * @param id The identifier of the variable group to collapse.
	 */
	collapseVariableGroup(id: string): void {
		// No-op for test implementation
	}

	/**
	 * Expands a variable item.
	 * @param path The path of the variable item to expand.
	 */
	expandVariableItem(path: string[]): Promise<void> {
		return Promise.resolve();
	}

	/**
	 * Collapses a variable item.
	 * @param path The path of the variable item to collapse.
	 */
	collapseVariableItem(path: string[]): void {
		// No-op for test implementation
	}

	/**
	 * Sets the filter text.
	 * @param filterText The filter text.
	 */
	setFilterText(filterText: string): void {
		this._filterText = filterText;
	}

	/**
	 * Has a filter text enabled
	 * @returns true if there's a filter string active for the instance
	 */
	hasFilterText(): boolean {
		return this._filterText !== '';
	}

	/**
	 * Gets the filter text.
	 * @returns The filter text.
	 */
	getFilterText(): string {
		return this._filterText;
	}

	/**
	 * Focuses element in the variable tree.
	 */
	focusElement(): void {
		this._onFocusElementEmitter.fire();
	}

	//#endregion

	//#region Test Helpers

	/**
	 * Updates the state of the instance.
	 * @param state The new state.
	 */
	setState(state: RuntimeClientState): void {
		this._state = state;
		this._onDidChangeStateEmitter.fire(state);
	}

	/**
	 * Updates the status of the instance.
	 * @param status The new status.
	 */
	setStatus(status: RuntimeClientStatus): void {
		this._status = status;
		this._onDidChangeStatusEmitter.fire(status);
	}

	/**
	 * Sets the entries for this instance.
	 * @param entries The variable entries.
	 */
	setEntries(entries: VariableEntry[]): void {
		this._entries = entries;
		this._onDidChangeEntriesEmitter.fire(entries);
	}

	/**
	 * Gets the current entries.
	 */
	getEntries(): VariableEntry[] {
		return this._entries;
	}

	//#endregion
}
