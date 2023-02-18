/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { JupyterMessageSpec } from './JupyterMessageSpec';

/**
 * Represents a complete_request from the Jupyter frontend to the kernel.
 */
export interface JupyterCompleteReply extends JupyterMessageSpec {
	/** Status of the completion request ('ok' or 'error') */
	status: string;

	/** A list of matches */
	matches: Array<string>;

	/** Start position where text should be replaced with a match */
	cursor_start: number;   // eslint-disable-line

	/** End position where text should be replaced with a match */
	cursor_end: number;     // eslint-disable-line

	/** Additional information, if any */
	metadata: Map<string, any>;
}
