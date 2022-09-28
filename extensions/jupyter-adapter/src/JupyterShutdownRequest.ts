/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { JupyterMessageSpec } from './JupyterMessageSpec';

/**
 * Represents a shutdown_request to the kernel
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#kernel-shutdown
 */
export interface JupyterShutdownRequest extends JupyterMessageSpec {
	/** Whether the shutdown precedes a restart */
	restart: boolean;
}
