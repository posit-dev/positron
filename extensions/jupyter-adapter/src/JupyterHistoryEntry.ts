/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents a single Jupyter history entry
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#history
 */
export interface JupyterHistoryEntry {
	/** The session in which the input was executed */
	session: number;

	/** The line number on which the input was executed  */
	line_number: number;   // eslint-disable-line

	/** The input that was executed  */
	input: string;
}
