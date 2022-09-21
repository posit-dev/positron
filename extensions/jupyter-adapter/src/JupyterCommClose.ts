/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents a request to tear down a comm (communications channel)
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#tearing-down-comms
 */
export interface JupyterCommMsg {
	/** The ID of the comm to tear down (as a GUID) */
	comm_id: string;  // eslint-disable-line

	/** Additional data, if any */
	data: object;
}
