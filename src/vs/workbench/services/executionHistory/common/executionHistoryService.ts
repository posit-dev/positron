/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
export const IExecutionHistoryService = createDecorator<IExecutionHistoryService>('executionHistoryService');

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

export interface IExecutionHistoryService {
	// Needed for service branding in dependency injector.
	readonly _serviceBrand: undefined;

	getEntries(runtimeId: string): IExecutionHistoryEntry[];
}
