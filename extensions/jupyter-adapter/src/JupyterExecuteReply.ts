/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { JupyterMessageSpec } from './JupyterMessageSpec';

/**
 * Represents an execute_reply from the Jupyter kernel to the front end.
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#request-reply
 */
export interface JupyterExecuteReply extends JupyterMessageSpec {
	/** The status of the execution */
	status: 'ok' | 'error';

	/** Execution counter, monotonically increasing */
	execution_count: number;  // eslint-disable-line

	/** Results for user expressions */
	user_expressions: Map<string, any>;  // eslint-disable-line

	/** Posit extension */
	posit_pbc?: JupyterExecuteReplyPositPbc;
}

export interface JupyterExecuteReplyPositPbc {
	/** String for next input prompt */
	input_prompt?: string;

	/** String for continuation lines of next incomplete prompts */
	continuation_prompt?: string;
}
