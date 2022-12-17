/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents a request to tear down a comm (communications channel)
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#tearing-down-comms
 */
export interface JupyterCommClose {
	/** The ID of the comm to tear down (as a GUID) */
	comm_id: string;  // eslint-disable-line
}
