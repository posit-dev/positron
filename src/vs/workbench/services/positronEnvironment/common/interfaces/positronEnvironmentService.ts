/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ILanguageRuntime } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IEnvironmentVariableItem } from 'vs/workbench/services/positronEnvironment/common/interfaces/environmentVariableItem';
import { IEnvironmentVariableGroup } from 'vs/workbench/services/positronEnvironment/common/interfaces/environmentVariableGroup';

// Create the decorator for the Positron environment service (used in dependency injection).
export const IPositronEnvironmentService = createDecorator<IPositronEnvironmentService>('positronEnvironmentService');

/**
 * PositronEnvironmentState enumeration.
 */
export const enum PositronEnvironmentState {
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
 * IPositronEnvironmentService interface.
 */
export interface IPositronEnvironmentService {
	// Needed for service branding in dependency injector.
	readonly _serviceBrand: undefined;

	/**
	 * Gets the Positron environment instances.
	 */
	readonly positronEnvironmentInstances: IPositronEnvironmentInstance[];

	/**
	 * Gets the active Positron environment instance.
	 */
	readonly activePositronEnvironmentInstance?: IPositronEnvironmentInstance;

	/**
	 * The onDidStartPositronEnvironmentInstance event.
	 */
	readonly onDidStartPositronEnvironmentInstance: Event<IPositronEnvironmentInstance>;

	/**
	 * The onDidChangeActivePositronEnvironmentInstance event.
	 */
	readonly onDidChangeActivePositronEnvironmentInstance: Event<IPositronEnvironmentInstance | undefined>;

	/**
	 * Placeholder that gets called to "initialize" the PositronEnvironmentService.
	 */
	initialize(): void;
}

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
	readonly state: PositronEnvironmentState;

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
	readonly onDidChangeState: Event<PositronEnvironmentState>;

	/**
	 * The onDidChangeEnvironmentGrouping event.
	 */
	readonly onDidChangeEnvironmentGrouping: Event<PositronEnvironmentGrouping>;

	/**
	 * The onDidChangeEnvironmentSorting event.
	 */
	readonly onDidChangeEnvironmentSorting: Event<PositronEnvironmentSorting>;

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
