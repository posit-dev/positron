/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { JupyterMessageSpec } from './JupyterMessageSpec';

/**
 * Represents a history_reply from the kernel
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#history
 */
export interface JupyterHistoryReply extends JupyterMessageSpec {
	/** The status of the request */
	status: 'ok' | 'error';

	/** The history entries */
	history: string[][];
}
