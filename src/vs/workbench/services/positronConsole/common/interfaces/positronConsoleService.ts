/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IPositronConsoleInstance } from 'vs/workbench/services/positronConsole/common/interfaces/positronConsoleInstance';

// Create the decorator for the Positron console service (used in dependency injection).
export const IPositronConsoleService = createDecorator<IPositronConsoleService>('positronConsoleService');

/**
 * IPositronConsoleService interface.
 */
export interface IPositronConsoleService {
	// Needed for service branding in dependency injector.
	readonly _serviceBrand: undefined;

	/**
	 * Gets the Positron console instances.
	 */
	readonly positronConsoleInstances: IPositronConsoleInstance[];

	/**
	 * Gets the active Positron console instance.
	 */
	readonly activePositronConsoleInstance?: IPositronConsoleInstance;

	/**
	 * The onDidStartPositronConsoleInstance event.
	 */
	readonly onDidStartPositronConsoleInstance: Event<IPositronConsoleInstance>;

	/**
	 * The onDidChangeActivePositronConsoleInstance event.
	 */
	readonly onDidChangeActivePositronConsoleInstance: Event<IPositronConsoleInstance | undefined>;

	initialize(): void;

	/**
	 * Executes code in a PositronConsoleInstance.
	 * @param languageId The language ID.
	 * @param code The code.
	 * @returns A value which indicates whether the code could be executed.
	 */
	executeCode(languageId: string, code: string): boolean;
}
