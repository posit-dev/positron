/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { JupyterMessageSpec } from './JupyterMessageSpec';

/**
 * Represents a input_reply from the kernel
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#messages-on-the-stdin-router-dealer-channel
 */
export interface JupyterInputReply extends JupyterMessageSpec {
	/** The value the user entered for the input request */
	value: string;
}
