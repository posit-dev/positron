/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { JupyterMessageSpec } from './JupyterMessageSpec';

/**
 * Represents an execute_request from the Jupyter frontend to the kernel.
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#execute
 */
export interface JupyterExecuteRequest extends JupyterMessageSpec {
    /** The code to be executed */
    code: string;

    /** Whether the code should be executed silently */
    silent: boolean;

    /** Whether the code should be stored in history */
    store_history: boolean;                // eslint-disable-line

    /** A mapping of expressions to be evaluated after the code is executed (TODO: needs to be display_data) */
    user_expressions: Map<string, any>;    // eslint-disable-line

    /** Whether to allow the kernel to send stdin requests */
    allow_stdin: boolean;                  // eslint-disable-line

    /** Whether the kernel should stop the execution queue when an error occurs */
    stop_on_error: boolean;                // eslint-disable-line
}
