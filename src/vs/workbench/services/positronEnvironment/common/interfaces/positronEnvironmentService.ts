/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ILanguageRuntime } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { EnvironmentVariableItem } from 'vs/workbench/services/positronEnvironment/common/classes/environmentVariableItem';

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
	 * Gets the environment items.
	 */
	readonly environmentVariableItems: EnvironmentVariableItem[];

	/**
	 * Gets or sets the grouping.
	 */
	environmentGrouping: PositronEnvironmentGrouping;

	/**
	 * The onDidChangeState event.
	 */
	readonly onDidChangeState: Event<PositronEnvironmentState>;

	/**
	 * The onDidChangeEnvironmentItems event.
	 */
	readonly onDidChangeEnvironmentVariableItems: Event<void>;

	/**
	 * The onDidChangeEnvironmentGrouping event.
	 */
	readonly onDidChangeEnvironmentGrouping: Event<PositronEnvironmentGrouping>;

	/**
	 * Requests a refresh of the environment.
	 */
	requestRefresh(): void;

	/**
	 * Requests a clear of the environment.
	 * @param includeHiddenObjects A value which indicates whether to include hidden objects.
	 */
	requestClear(includeHiddenObjects: boolean): void;

	/**
	 * Requests the deletion of one or more environment variables.
	 * @param names The names of the variables to delete
	 */
	requestDelete(names: string[]): void;
}
