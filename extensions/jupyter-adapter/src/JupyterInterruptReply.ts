/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { JupyterMessageSpec } from './JupyterMessageSpec';

/**
 * Represents a interrupt_reply from the kernel
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#kernel-interrupt
 */
export interface JupyterInterruptReply extends JupyterMessageSpec {
	status: 'ok' | 'error';
}
