/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../../base/common/lifecycle.js';
import * as nls from '../../../../nls.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationNode, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';

export const IExecutionHistoryService = createDecorator<IExecutionHistoryService>('executionHistoryService');

/// The prefix used for keys that store execution history
export const EXECUTION_HISTORY_STORAGE_PREFIX = 'positron.executionHistory';
export const INPUT_HISTORY_STORAGE_PREFIX = 'positron.inputHistory';

/**
 * Represents the execution (input and output) of a single code fragment in a
 * language runtime.
 */
export interface IExecutionHistoryEntry<T> {
	/** ID of the entry */
	id: string;

	/** Time that the execution occurred, in milliseconds since the Epoch */
	when: number;

	/** The input prompt at the time the code was executed. */
	prompt: string;

	/** The code that was executed, as a multi-line string */
	input: string;

	/** The debug state at the time the input was submitted, if any */
	debug?: string;

	/** The type of output that was returned when the code was executed */
	outputType: string;

	/** The output itself */
	output: T;

	/** The error that was returned when executing the code, if any */
	error?: IExecutionHistoryError;

	/** The total user time expended during the execution, in milliseconds */
	durationMs: number;
}

/**
 * The type of an execution history entry.
 */
export enum ExecutionEntryType {
	/** The entry represents the startup of a language runtime */
	Startup = 'startup',

	/** The entry represents the execution of a code fragment */
	Execution = 'execution',
}

export interface IExecutionHistoryError {
	/** The name of the error */
	name: string;

	/** The error message */
	message: string;

	/** The error stack trace */
	traceback: string[];
}

/**
 * A single console execution projected to the fields relevant to a model or an
 * extension: the code that ran, its output, and any error.
 */
export interface IConsoleHistoryEntry {
	/** The code that was executed. */
	input: string;
	/** The textual output produced by the execution. */
	output: string;
	/** The error produced by the execution, if any. */
	error?: IExecutionHistoryError;
	/** Time the execution occurred, in milliseconds since the Epoch. */
	when: number;
}

/** Default number of recent console entries returned when no count is requested. */
export const DEFAULT_CONSOLE_HISTORY_ENTRY_COUNT = 5;

/**
 * Setting that controls whether extensions may read console history through the
 * `positron.runtime.getConsoleHistory` API. Enabled by default; users can
 * disable it when they don't want console input/output exposed to extensions.
 */
export const CONSOLE_HISTORY_API_ENABLED_KEY = 'console.historyApiEnabled';

/**
 * Projects raw execution history entries down to the console history relevant
 * to a reader: only completed code executions (skipping the startup banner and
 * entries recorded without input, e.g. output produced outside an execution),
 * each mapped to its input, textual output, error, and timestamp, and limited
 * to the most recent `numberOfEntries` (oldest first, so a reader sees them in
 * chronological order).
 *
 * @param entries The raw execution history entries, in stored (oldest-first) order.
 * @param numberOfEntries The number of most recent entries to return. Defaults to
 *  {@link DEFAULT_CONSOLE_HISTORY_ENTRY_COUNT}; non-positive values fall back to it.
 */
export function projectExecutionEntriesToConsoleHistory(entries: IExecutionHistoryEntry<unknown>[], numberOfEntries?: number): IConsoleHistoryEntry[] {
	const projected = entries
		.filter(entry => entry.outputType === ExecutionEntryType.Execution && entry.input)
		.map(entry => ({
			input: entry.input,
			output: typeof entry.output === 'string' ? entry.output : String(entry.output ?? ''),
			error: entry.error,
			when: entry.when,
		}));

	const count = numberOfEntries && numberOfEntries > 0 ? numberOfEntries : DEFAULT_CONSOLE_HISTORY_ENTRY_COUNT;
	return projected.slice(-count);
}

/**
 * Represents an input code fragment sent to a language runtime.
 */
export interface IInputHistoryEntry {
	/** Time that the input was submitted, in milliseconds since the Epoch */
	when: number;

	/** The debug state at the time the input was submitted, if any */
	debug?: string;

	/** The code that was submitted, as a multi-line string */
	input: string;
}

/**
 * Service that provides access to the execution history for a given language
 * runtime. This service is independent from the language runtime itself; it
 * listens to execution inputs and outputs, and stores them in a durable history
 * for replay/retrieval.
 */
export interface IExecutionHistoryService extends IDisposable {
	// Needed for service branding in dependency injector.
	readonly _serviceBrand: undefined;

	/**
	 * Gets the input history for a given language. This is a long, searchable
	 * history of all the commands the user has executed in that language.
	 *
	 * @param languageId The ID of the language to get input history for
	 */
	getInputEntries(languageId: string): IInputHistoryEntry[];

	/**
	 * Gets the input history for a given session. This returns only the input
	 * history for the specific session.
	 *
	 * @param languageId The ID of the session to get input history for
	 */
	getSessionInputEntries(sessionId: string): IInputHistoryEntry[];

	/**
	 * Removes (clears) all the the input history entries for a given language.
	 *
	 * @param languageId The ID of the language to clear input history for
	 */
	clearInputEntries(languageId: string): void;

	/**
	 * Removes (clears) all the the input history entries for a given session.
	 *
	 * @param sessionId The ID of the session to clear input history for
	 */
	clearSessionInputEntries(sessionId: string): void;

	/**
	 * Removes a single input history entry for a given language.
	 *
	 * @param languageId The ID of the language to delete the input history entry from
	 * @param when The timestamp of the entry to delete
	 * @param input The input text of the entry to delete (used to uniquely identify the entry)
	 */
	deleteInputEntry(languageId: string, when: number, input: string): void;

	/**
	 * Gets the execution history for a given language runtime session. This is
	 * effectively the execution history for a specific console tab, so it is
	 * both workspace and machine scoped.
	 *
	 * @param sessionId The ID of the language runtime for which to retrieve
	 *   execution history
	 */
	getExecutionEntries(sessionId: string): IExecutionHistoryEntry<unknown>[];

	/**
	 * Removes (clears) all the the history entries for a given
	 * session
	 *
	 * @param sessionId The ID of the language runtime session for which to clear
	 *   history.
	 */
	clearExecutionEntries(sessionId: string): void;

	/**
	 * Gets the list of language IDs that have input history available.
	 *
	 * @returns An array of language IDs that have at least one input history entry.
	 */
	getAvailableLanguages(): string[];
}

export const replConfigurationBaseNode = Object.freeze<IConfigurationNode>({
	id: 'repl',
	order: 100,
	type: 'object',
	title: nls.localize('consoleConfigurationTitle', "Console"),
	scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
});

export const inputHistorySizeSettingId = 'console.inputHistorySize';

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);

const inputHistoryConfigurationNode: IConfigurationNode = {
	...replConfigurationBaseNode,
	properties: {
		'console.inputHistorySize': {
			type: 'number',
			markdownDescription: nls.localize('console.inputHistorySize', "The number of recent commands to store for each language. Set to 0 to disable history storage."),
			'default': 1000,
			'minimum': 0
		},
		[CONSOLE_HISTORY_API_ENABLED_KEY]: {
			type: 'boolean',
			markdownDescription: nls.localize('positron.console.historyApiEnabled', "Allow extensions to read recent console history (commands, output, and errors) through the console history API. Disable this if you don't want console content exposed to extensions."),
			'default': true,
			scope: ConfigurationScope.WINDOW
		}
	}
};

configurationRegistry.registerConfiguration(inputHistoryConfigurationNode);
