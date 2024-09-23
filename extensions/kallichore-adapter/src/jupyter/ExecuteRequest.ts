/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { JupyterChannel } from './JupyterChannel';
import { JupyterDisplayData } from './JupyterDisplayData';
import { JupyterRequest } from './JupyterRequest';


export class ExecuteRequest extends JupyterRequest<JupyterExecuteRequest, JupyterExecuteResult> {
	constructor(req: JupyterExecuteRequest) {
		super('execute_request', req, 'execute_result', JupyterChannel.Shell);
	}
}

/**
 * Represents an execute_request from the Jupyter frontend to the kernel.
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#execute
 */
export interface JupyterExecuteRequest {
	/** The code to be executed */
	code: string;

	/** Whether the code should be executed silently */
	silent: boolean;

	/** Whether the code should be stored in history */
	store_history: boolean;                // eslint-disable-line

	/** A mapping of expressions to be evaluated after the code is executed (TODO: needs to be display_data) */
	user_expressions: Map<string, any>;    // eslint-disable-line

	/** Whether to allow the kernel to send stdin requests */
	allow_stdin: boolean;                  // eslint-disable-line

	/** Whether the kernel should stop the execution queue when an error occurs */
	stop_on_error: boolean;                // eslint-disable-line
}

/**
 * Represents an execute_result from the Jupyter kernel to the front end; this
 * is identical to the display_data message, with one additional field.
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#id6
 */
export interface JupyterExecuteResult extends JupyterDisplayData {

	/** Execution counter, monotonically increasing */
	execution_count: number;  // eslint-disable-line
}
