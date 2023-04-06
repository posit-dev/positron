/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

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

/**
 * Represents a single comm and its associated target name, as returned by a
 * comm_info request.
 */
export interface JupyterCommTargetName {
	target_name: string;
}
