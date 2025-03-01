/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IPositronVariablesInstance } from './positronVariablesInstance.js';

// Create the decorator for the Positron variables service (used in dependency injection).
export const IPositronVariablesService = createDecorator<IPositronVariablesService>('positronVariablesService');

/**
 * IPositronVariablesService interface.
 */
export interface IPositronVariablesService {
	/**
	 * Needed for service branding in dependency injector.
	 */
	readonly _serviceBrand: undefined;

	/**
	 * Gets the Positron variables instances.
	 */
	readonly positronVariablesInstances: IPositronVariablesInstance[];

	/**
	 * Gets the active Positron variables instance.
	 */
	readonly activePositronVariablesInstance?: IPositronVariablesInstance;

	/**
	 * The onDidStartPositronVariablesInstance event.
	 */
	readonly onDidStartPositronVariablesInstance: Event<IPositronVariablesInstance>;

	/**
	 * The onDidStopPositronVariablesInstance event.
	 */
	readonly onDidStopPositronVariablesInstance: Event<IPositronVariablesInstance>;

	/**
	 * The onDidChangeActivePositronVariablesInstance event.
	 */
	readonly onDidChangeActivePositronVariablesInstance: Event<IPositronVariablesInstance | undefined>;

	/**
	 * Sets the active variables instance to the one with the given session ID.
	 *
	 * @param sessionId The session ID.
	 */
	setActivePositronVariablesSession(sessionId: string): void;

	/**
	 * Placeholder that gets called to "initialize" the PositronVariablesService.
	 */
	initialize(): void;
}
