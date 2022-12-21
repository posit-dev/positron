/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { HistoryNavigator2 } from 'vs/base/common/history';
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
	/** The REPL's instance identifier */
	readonly instanceId: number;

	/** The identifier of the language used by the REPL */
	readonly languageId: string;

	/** The language runtime kernel to which the instance is bound */
	readonly kernel: ILanguageRuntime;

	/** Clear the REPL's contents */
	clear(): void;

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
	/** Necessary to label as branded service for dependency injector */
	readonly _serviceBrand: undefined;

	/** An accessor returning the set of open REPLs */
	readonly instances: readonly IReplInstance[];

	/** Event fired when a REPL instance is created */
	readonly onDidStartRepl: Event<IReplInstance>;

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
	 * Sends a code line or fragment to the REPL from the currently open editor.
	 *
	 * @param languageId The ID of the langguage for which to execute code
	 * @param code The code to execute
	 */
	executeCode(languageId: string, code: string): void;
}
