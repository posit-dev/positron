/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';

/**
 * Represents a debug event message from the Jupyter kernel to the front end.
 *
 * @link https://jupyter-client.readthedocs.io/en/latest/messaging.html#debug-request
 */
export interface JupyterDebugEvent {
	content: positron.DebugProtocolEvent;
}
