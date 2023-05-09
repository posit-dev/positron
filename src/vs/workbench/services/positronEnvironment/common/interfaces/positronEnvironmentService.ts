/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IPositronEnvironmentInstance } from 'vs/workbench/services/positronEnvironment/common/interfaces/positronEnvironmentInstance';

// Create the decorator for the Positron environment service (used in dependency injection).
export const IPositronEnvironmentService = createDecorator<IPositronEnvironmentService>('positronEnvironmentService');

/**
 * IPositronEnvironmentService interface.
 */
export interface IPositronEnvironmentService {
	/**
	 * Needed for service branding in dependency injector.
	 */
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
