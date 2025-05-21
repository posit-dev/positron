/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { JupyterChannel } from './JupyterChannel';
import { JupyterMessageType } from './JupyterMessageType.js';
import { JupyterRequest } from './JupyterRequest';

export class CommInfoRequest extends JupyterRequest<JupyterCommInfoRequest, JupyterCommInfoReply> {
	constructor(target: string) {
		super(
			JupyterMessageType.CommInfoRequest,
			{ target_name: target },
			JupyterMessageType.CommInfoReply,
			JupyterChannel.Shell,
		);
	}
}

/**
 * Represents a request to list the available comms
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#comm-info
 */
export interface JupyterCommInfoRequest {
	/**
	 * Optional target name; if specified, only comms with the given target
	 * name will be returned.
	 */
	target_name: string;
}

/**
 * Represents a single comm, as returned by a comm_info request.
 */
export interface JupyterComm {
	target_name: string;
}

/**
 * Represents a list of available comms and their associated target names, as
 * returned by a comm_info request.
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#comm-info
 */
export interface JupyterCommInfoReply {
	/** The status of the request */
	status: 'ok' | 'error';

	/** A map of comms, keyed by comm ID */
	comms: Record<string, JupyterComm>;
}
