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
 * Represents an input code fragment sent to a language runtime.
 */
export interface IInputHistoryEntry {
	/** Time that the input was submitted, in milliseconds since the Epoch */
	when: number;

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
	 * Gets the execution history for a given language runtime session. This is
	 * effectively the execution history for a specific console tab, so it is
	 * both workspace and machine scoped.
	 *
	 * @param sessionId The ID of the language runtime for which to retrieve
	 *   execution history
	 */
	getExecutionEntries(sessionId: string): IExecutionHistoryEntry<any>[];

	/**
	 * Removes (clears) all the the history entries for a given
	 * session
	 *
	 * @param sessionId The ID of the language runtime session for which to clear
	 *   history.
	 */
	clearExecutionEntries(sessionId: string): void;
}

export const replConfigurationBaseNode = Object.freeze<IConfigurationNode>({
	id: 'repl',
	order: 100,
	type: 'object',
	title: nls.localize('replConfigurationTitle', "Console"),
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
		}
	}
};

configurationRegistry.registerConfiguration(inputHistoryConfigurationNode);
