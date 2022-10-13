/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { JupyterMessageSpec } from './JupyterMessageSpec';

/**
 * Sent from the kernel to the front end to represent the kernel's status
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#kernel-status
 */
export interface JupyterKernelStatus extends JupyterMessageSpec {
	execution_state: 'busy' | 'idle' | 'starting';  // eslint-disable-line
}
