/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationNode, IConfigurationRegistry } from 'vs/platform/configuration/common/configurationRegistry';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Registry } from 'vs/platform/registry/common/platform';

export const IExecutionHistoryService = createDecorator<IExecutionHistoryService>('executionHistoryService');

/**
 * Represents the execution (input and output) of a single code fragment in a
 * language runtime.
 */
export interface IExecutionHistoryEntry<T> {
	/** ID of the entry */
	id: string;

	/** Time that the execution occurred, in milliseconds since the Epoch */
	when: number;

	/** The code that was executed, as a multi-line string */
	input: string;

	/** The type of output that was returned when the code was executed */
	outputType: string;

	/** The output itself */
	output: T;

	/** The total user time expended during the execution, in milliseconds */
	durationMs: number;
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
export interface IExecutionHistoryService {
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
	 * Removes (clears) all the the input history entries for a given language.
	 *
	 * @param languageId The ID of the language to clear input history for
	 */
	clearInputEntries(languageId: string): void;

	/**
	 * Gets the execution history for a given language runtime. This is
	 * effectively the execution history for a specific console tab, so it is
	 * both workspace and machine scoped.
	 *
	 * @param runtimeId The ID of the language runtime for which to retrieve
	 *   execution history
	 */
	getExecutionEntries(runtimeId: string): IExecutionHistoryEntry<any>[];

	/**
	 * Removes (clears) all the the history entries for a given language
	 * runtime.
	 *
	 * @param runtimeId The ID of the language runtime for which to clear
	 *   history.
	 */
	clearExecutionEntries(runtimeId: string): void;
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
