/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { HistoryNavigator2 } from 'vs/base/common/history';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ILanguageRuntime } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

// Create the decorator for the Positron REPL service (used in dependency injection).
export const IPositronReplService = createDecorator<IPositronReplService>('positronReplService');

export interface IPositronReplOptions {
	language?: string;
}

/**
 * IPositronReplInstance interface.
 */
export interface IPositronReplInstance {
	readonly languageId: string;

	readonly runtime: ILanguageRuntime;

	clear(): void;

	executeCode(code: string): void;

	readonly onDidClearRepl: Event<void>;

	readonly onDidExecuteCode: Event<string>;

	readonly history: HistoryNavigator2<string>;
}

/**
 * IPositronReplService interface.
 */
export interface IPositronReplService {
	// Needed for service branding in dependency injector.
	readonly _serviceBrand: undefined;

	// Gets the REPL instances.
	readonly instances: readonly IPositronReplInstance[];

	// Gets the active REPL instance.
	readonly activeInstance: IPositronReplInstance | undefined;

	// An event that is fired a REPL instance is started.
	readonly onDidStartRepl: Event<IPositronReplInstance>;

	// An event that is fired when the active REPL instance changes.
	readonly onDidChangeActiveRepl: Event<IPositronReplInstance | undefined>;

	/**
	 * Creates a new REPL instance and returns it.
	 *
	 * @param options The REPL's settings.
	 */
	createRepl(options?: IPositronReplOptions): Promise<IPositronReplInstance>;

	/**
	 * Clears the currently active REPL instance.
	 */
	clearActiveRepl(): void;

	/**
	 * Sends a code line or fragment to the REPL from the currently open editor.
	 *
	 * @param languageId The ID of the langguage for which to execute code
	 * @param code The code to execute
	 */
	executeCode(languageId: string, code: string): void;
}
