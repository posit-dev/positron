/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { ILanguageRuntime } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IEnvironmentVariableItem } from 'vs/workbench/services/positronEnvironment/common/interfaces/environmentVariableItem';
import { IEnvironmentVariableGroup } from 'vs/workbench/services/positronEnvironment/common/interfaces/environmentVariableGroup';

/**
 * PositronEnvironmentInstanceState enumeration.
 */
export const enum PositronEnvironmentInstanceState {
	Uninitialized = 'Uninitialized',
	Starting = 'Starting',
	Busy = 'Busy',
	Ready = 'Ready',
	Offline = 'Offline',
	Exiting = 'Exiting',
	Exited = 'Exited'
}

/**
 * PositronEnvironmentGrouping enumeration.
 */
export const enum PositronEnvironmentGrouping {
	None,
	Kind,
	Size
}

/**
 * PositronEnvironmentSorting enumeration.
 */
export const enum PositronEnvironmentSorting {
	Name,
	Size
}

/**
 * The EnvironmentEntry type alias.
 */
export type EnvironmentEntry = IEnvironmentVariableGroup | IEnvironmentVariableItem;

/**
 * isEnvironmentVariableGroup user-defined type guard.
 * @param _ The entry.
 * @returns Whether the entry is IEnvironmentVariableGroup.
 */
export const isEnvironmentVariableGroup = (_: EnvironmentEntry): _ is IEnvironmentVariableGroup => {
	return 'title' in _;
};

/**
 * isEnvironmentVariableItem user-defined type guard.
 * @param _ The entry.
 * @returns Whether the entry is IEnvironmentVariableItem.
 */
export const isEnvironmentVariableItem = (_: EnvironmentEntry): _ is IEnvironmentVariableItem => {
	return 'path' in _;
};

/**
 * IPositronEnvironmentInstance interface.
 */
export interface IPositronEnvironmentInstance {
	/**
	 * Gets the runtime for the Positron environment instance.
	 */
	readonly runtime: ILanguageRuntime;

	/**
	 * Gets the state.
	 */
	readonly state: PositronEnvironmentInstanceState;

	/**
	 * Gets or sets the grouping.
	 */
	grouping: PositronEnvironmentGrouping;

	/**
	 * Gets or sets the sorting.
	 */
	sorting: PositronEnvironmentSorting;

	/**
	 * The onDidChangeState event.
	 */
	readonly onDidChangeState: Event<PositronEnvironmentInstanceState>;

	/**
	 * The onDidChangeEntries event.
	 */
	readonly onDidChangeEntries: Event<EnvironmentEntry[]>;

	/**
	 * Requests a refresh of the environment.
	 */
	requestRefresh(): void;

	/**
	 * Requests clearing the environment.
	 * @param includeHiddenObjects A value which indicates whether to include hidden objects.
	 */
	requestClear(includeHiddenObjects: boolean): void;

	/**
	 * Requests the deletion of one or more environment variables.
	 * @param names The names of the variables to delete
	 */
	requestDelete(names: string[]): void;

	/**
	 * Expands an environment variable group.
	 * @param id The identifier of the environment variable group to expand.
	 */
	expandEnvironmentVariableGroup(id: string): void;

	/**
	 * Collapses an environment variable group.
	 * @param id The identifier of the environment variable group to collapse.
	 */
	collapseEnvironmentVariableGroup(id: string): void;

	/**
	 * Expands an environment variable item.
	 * @param path The path of the environment variable item to expand.
	 */
	expandEnvironmentVariableItem(path: string[]): Promise<void>;

	/**
	 * Collapses an environment variable item.
	 * @param path The path of the environment variable item to collapse.
	 */
	collapseEnvironmentVariableItem(path: string[]): void;

	/**
	 * Sets the filter text.
	 * @param filterText The filter text.
	 */
	setFilterText(filterText: string): void;
}
