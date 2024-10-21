/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents a request to open a new comm (communications channel)
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#opening-a-comm
 */
export interface JupyterCommOpen {
	/** The ID of the comm (as a GUID) */
	comm_id: string;  // eslint-disable-line

	/** The name of the comm to open */
	target_name: string;   // eslint-disable-line

	/** Additional data to use to initialize the comm */
	data: object;
}
