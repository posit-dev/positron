/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { JupyterChannel } from './JupyterChannel';
import { JupyterRequest } from './JupyterRequest';

export class IsCompleteRequest extends JupyterRequest<JupyterIsCompleteRequest, JupyterIsCompleteReply> {
	constructor(req: JupyterIsCompleteRequest) {
		super('is_complete_request', req, 'is_complete_reply', JupyterChannel.Shell);
	}
}

/**
 * Represents a is_complete_request from the Jupyter frontend to the kernel.
 * This requests tests a code fragment to see if it's complete.
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#code-completeness
 */
export interface JupyterIsCompleteRequest {
	/** The code to test for completeness */
	code: string;
}


/**
 * Represents a is_complete_reply from the kernel.
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#code-completeness
 */
export interface JupyterIsCompleteReply {
	/** The status of the code that was tested for completeness */
	status: 'complete' | 'incomplete' | 'invalid' | 'unknown';

	/** Characters to use to indent the next line (for 'incomplete' only) */
	indent: string;
}

