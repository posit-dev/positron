/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IPositronVariablesInstance } from 'vs/workbench/services/positronVariables/common/interfaces/positronVariablesInstance';

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
