/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
export const IExecutionHistoryService = createDecorator<IExecutionHistoryService>('executionHistoryService');

/**
 * Represents the execution of a single code fragment in a language runtime.
 */
export interface IExecutionHistoryEntry {
	/** ID of the entry */
	id: string;

	/** Time that the execution occurred, in milliseconds since the Epoch */
	when: number;

	/** The code that was executed, as a multi-line string */
	input: string;

	/** The type of output that was returned when the code was executed */
	outputType: string;

	/** The output itself */
	output: any;

	/** The total user time expended during the execution, in milliseconds */
	durationMs: number;
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
	 * Gets the execution history for a given language runtime.
	 *
	 * @param runtimeId The ID of the language runtime for which to retrieve
	 *   execution history
	 */
	getEntries(runtimeId: string): IExecutionHistoryEntry[];

	/**
	 * Removes (clears) all the the history entries for a given language
	 * runtime.
	 *
	 * @param runtimeId The ID of the language runtime for which to clear
	 *   history.
	 */
	clearEntries(runtimeId: string): void;
}
