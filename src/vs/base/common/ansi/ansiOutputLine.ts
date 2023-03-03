/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * ANSIOutputLine interface.
 */
interface ANSIOutputLine {
	/**
	 * The identifier of the line/
	 */
	id: string;

	/**
	 * The output runs that make up the output line.
	 */
	outputRuns: ANSIOutputRun[];
}
