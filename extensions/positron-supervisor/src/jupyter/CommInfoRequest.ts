/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { JupyterChannel } from './JupyterChannel';
import { JupyterRequest } from './JupyterRequest';

export class CommInfoRequest extends JupyterRequest<JupyterCommInfoRequest, JupyterCommInfoReply> {
	constructor(target: string) {
		super('comm_info_request', { target_name: target }, 'comm_info_reply', JupyterChannel.Shell);
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
	target_name: string;   // eslint-disable-line
}

/**
 * Represents a single comm and its associated target name, as returned by a
 * comm_info request.
 */
export interface JupyterCommTargetName {
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

	/** The list of comms, as a map of comm ID to target name */
	comms: Record<string, JupyterCommTargetName>;
}
