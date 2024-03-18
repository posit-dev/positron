/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


/**
 * Should the logs actually output?
 */
export const SHOW_POSITRON_NOTEBOOK_LOGS = true;

/**
 * Log a message tagged as a Positron-Notebook log message.
 * @param msg Log message
 * @param args Extra args passed to console.log
 */
export function pnLog(msg: string, ...args: any[]) {
	if (SHOW_POSITRON_NOTEBOOK_LOGS) {
		console.log(`%cPositron-Notebook | ${msg}`, `color:forestgreen;`, ...args);
	}
}
