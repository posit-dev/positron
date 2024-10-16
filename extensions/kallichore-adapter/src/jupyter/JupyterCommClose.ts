/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents a request to tear down a comm (communications channel)
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#tearing-down-comms
 */
export interface JupyterCommClose {
	/** The ID of the comm to tear down (as a GUID) */
	comm_id: string;  // eslint-disable-line

	/** The message payload */
	data: object;
}
