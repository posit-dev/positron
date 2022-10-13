/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { JupyterMessageSpec } from './JupyterMessageSpec';

/**
 * Represents a is_complete_reply from the kernel.
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#code-completeness
 */
export interface JupyterIsCompleteReply extends JupyterMessageSpec {
	/** The status of the code that was tested for completeness */
	status: 'complete' | 'incomplete' | 'invalid' | 'unknown';

	/** Characters to use to indent the next line (for 'incomplete' only) */
	indent: string;
}

