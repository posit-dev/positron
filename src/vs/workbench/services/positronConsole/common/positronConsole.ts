/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ILanguageRuntime } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

// Create the decorator for the Positron console service (used in dependency injection).
export const IPositronConsoleService = createDecorator<IPositronConsoleService>('positronConsoleService');

/**
 * IPositronConsoleInstance interface.
 */
export interface IPositronConsoleInstance {
	/**
	 * Gets the runtime for the Positron console instance.
	 */
	readonly runtime: ILanguageRuntime;

	/**
	 * The onDidClearConsole event.
	 */
	readonly onDidClearConsole: Event<void>;

	/**
	 * The onDidExecuteCode event.
	 */
	readonly onDidExecuteCode: Event<string>;

	/**
	 * Clears the Positron console instance.
	 */
	clear(): void;

	/**
	 * Executes code in the Positron console instance.
	 * @param code The code to execute.
	 */
	executeCode(code: string): void;
}

/**
 * IPositronConsoleService interface.
 */
export interface IPositronConsoleService {
	// Needed for service branding in dependency injector.
	readonly _serviceBrand: undefined;

	/**
	 * Gets the Positron console instances.
	 */
	readonly positronConsoleInstances: readonly IPositronConsoleInstance[];

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

	/**
	 * Executes code in a PositronConsoleInstance.
	 */

	/**
	 * Executes code in a PositronConsoleInstance.
	 * @param languageId The language ID.
	 * @param code The code.
	 * @returns A value which indicates whether the code could be executed.
	 */
	executeCode(languageId: string, code: string): boolean;
}
