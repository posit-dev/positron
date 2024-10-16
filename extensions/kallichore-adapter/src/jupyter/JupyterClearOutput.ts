/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents a clear_output message from the Jupyter kernel to the front end.
 *
 * @link https://jupyter-client.readthedocs.io/en/latest/messaging.html#clear-output
 */
export interface JupyterClearOutput {
	/** Wait to clear the output until new output is available. */
	wait: boolean;
}
