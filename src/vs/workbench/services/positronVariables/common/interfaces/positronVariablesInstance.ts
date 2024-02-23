/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { IVariableItem } from 'vs/workbench/services/positronVariables/common/interfaces/variableItem';
import { IVariableGroup } from 'vs/workbench/services/positronVariables/common/interfaces/variableGroup';
import { IVariableOverflow as IVariableOverflow } from 'vs/workbench/services/positronVariables/common/interfaces/variableOverflow';
import { ILanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';

/**
 * PositronVariablesInstanceState enumeration.
 */
export const enum PositronVariablesInstanceState {
	Uninitialized = 'Uninitialized',
	Starting = 'Starting',
	Busy = 'Busy',
	Ready = 'Ready',
	Offline = 'Offline',
	Exiting = 'Exiting',
	Exited = 'Exited'
}

/**
 * PositronVariablesGrouping enumeration.
 */
export const enum PositronVariablesGrouping {
	None,
	Kind,
	Size
}

/**
 * PositronVariablesSorting enumeration.
 */
export const enum PositronVariablesSorting {
	Name,
	Size
}

/**
 * The VariableEntry type alias.
 */
export type VariableEntry = IVariableGroup | IVariableItem | IVariableOverflow;

/**
 * isVariableGroup user-defined type guard.
 * @param _ The entry.
 * @returns A value which indicates whether the entry is an IVariableGroup.
 */
export const isVariableGroup = (_: VariableEntry): _ is IVariableGroup => {
	return 'title' in _;
};

/**
 * isVariableItem user-defined type guard.
 * @param _ The entry.
 * @returns A value which indicates whether the entry is an IVariableItem.
 */
export const isVariableItem = (_: VariableEntry): _ is IVariableItem => {
	return 'path' in _;
};

/**
 * isVariableOverflow user-defined type guard.
 * @param _ The entry.
 * @returns A value which indicates whether the entry is an IVariableOverflow.
 */
export const isVariableOverflow = (_: VariableEntry): _ is IVariableOverflow => {
	return 'overflowValues' in _;
};

/**
 * IPositronVariablesInstance interface.
 */
export interface IPositronVariablesInstance {
	/**
	 * Gets the runtime session.
	 */
	readonly session: ILanguageRuntimeSession;

	/**
	 * Gets the state.
	 */
	readonly state: PositronVariablesInstanceState;

	/**
	 * Gets or sets the grouping.
	 */
	grouping: PositronVariablesGrouping;

	/**
	 * Gets or sets the sorting.
	 */
	sorting: PositronVariablesSorting;

	/**
	 * The onDidChangeState event.
	 */
	readonly onDidChangeState: Event<PositronVariablesInstanceState>;

	/**
	 * The onDidChangeEntries event.
	 */
	readonly onDidChangeEntries: Event<VariableEntry[]>;

	/**
	 * Requests refresh.
	 */
	requestRefresh(): void;

	/**
	 * Requests clear.
	 * @param includeHiddenVariables A value which indicates whether to include hidden variables.
	 */
	requestClear(includeHiddenVariables: boolean): void;

	/**
	 * Requests the deletion of one or more variables.
	 * @param names The names of the variables to delete
	 */
	requestDelete(names: string[]): void;

	/**
	 * Expands a variable group.
	 * @param id The identifier of the variable group to expand.
	 */
	expandVariableGroup(id: string): void;

	/**
	 * Collapses a variable group.
	 * @param id The identifier of the variable group to collapse.
	 */
	collapseVariableGroup(id: string): void;

	/**
	 * Expands a variable item.
	 * @param path The path of the variable item to expand.
	 */
	expandVariableItem(path: string[]): Promise<void>;

	/**
	 * Collapses a variable item.
	 * @param path The path of the variable item to collapse.
	 */
	collapseVariableItem(path: string[]): void;

	/**
	 * Sets the filter text.
	 * @param filterText The filter text.
	 */
	setFilterText(filterText: string): void;
}
