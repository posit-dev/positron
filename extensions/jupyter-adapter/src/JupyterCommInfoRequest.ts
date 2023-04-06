/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

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
