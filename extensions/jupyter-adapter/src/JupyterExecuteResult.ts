/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { JupyterDisplayData } from './JupyterDisplayData';

/**
 * Represents an execute_result from the Jupyter kernel to the front end; this
 * is identical to the display_data message, with one additional field.
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#id6
 */
export interface JupyterExecuteResult extends JupyterDisplayData {

    /** Execution counter, monotonically increasing */
    execution_count: number;  // eslint-disable-line
}
