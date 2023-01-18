/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { HistoryNavigator2 } from 'vs/base/common/history';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ILanguageRuntime } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

// Create the decorator for the REPL service (used in dependency injection)
export const IReplService = createDecorator<IReplService>('replService');

/**
 * The parameters needed to construct a new REPL instance
 */
export interface ICreateReplOptions {
	language?: string;
}

/**
 * An instance of a REPL bound to a language runtime.
 */
export interface IReplInstance {
	/** The identifier of the language used by the REPL */
	readonly languageId: string;

	/** The language runtime to which the instance is bound */
	readonly runtime: ILanguageRuntime;

	/** Clear the REPL's contents */
	clearRepl(): void;

	/** Clear the REPL's history buffer/navigator */
	clearHistory(): void;

	/** Execute code in the REPL */
	executeCode(code: string): void;

	/** Event fired to clear the REPL's contents */
	readonly onDidClearRepl: Event<void>;

	/** Event fired to execute code in the REPL */
	readonly onDidExecuteCode: Event<string>;

	/** History of REPL commands */
	readonly history: HistoryNavigator2<string>;
}

/**
 * A service that manages a set of REPL instances.
 */
export interface IReplService {
	// Needed for service branding in dependency injector.
	readonly _serviceBrand: undefined;

	// Gets the REPL instances.
	readonly instances: readonly IReplInstance[];

	// Gets the active REPL instance.
	readonly activeInstance: IReplInstance | undefined;

	// An event that is fired a REPL instance is started.
	readonly onDidStartRepl: Event<IReplInstance>;

	// An event that is fired when the active REPL instance changes.
	readonly onDidChangeActiveRepl: Event<IReplInstance | undefined>;

	/**
	 * Creates a new REPL instance and returns it.
	 *
	 * @param options The REPL's settings.
	 */
	createRepl(options?: ICreateReplOptions): Promise<IReplInstance>;

	/**
	 * Clears the currently active REPL instance.
	 */
	clearActiveRepl(): void;

	/**
	 * Clears the REPL input history for the given language.
	 *
	 * @param language The language of the REPL to clear.
	 */
	clearInputHistory(language: string): void;

	/**
	 * Sends a code line or fragment to the REPL from the currently open editor.
	 *
	 * @param languageId The ID of the langguage for which to execute code
	 * @param code The code to execute
	 */
	executeCode(languageId: string, code: string): void;
}
