/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { JupyterMessageSpec } from './JupyterMessageSpec';

/**
 * Represents a shutdown_reply from the kernel.
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#kernel-shutdown
 */
export interface JupyterShutdownReply extends JupyterMessageSpec {
	/** Shutdown status */
	status: 'ok' | 'error';

	/** Whether the shutdown precedes a restart */
	restart: boolean;
}
