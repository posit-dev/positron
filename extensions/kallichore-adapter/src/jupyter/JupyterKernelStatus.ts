/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Sent from the kernel to the front end to represent the kernel's status
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#kernel-status
 */
export interface JupyterKernelStatus {
	execution_state: 'busy' | 'idle' | 'starting';  // eslint-disable-line
}
