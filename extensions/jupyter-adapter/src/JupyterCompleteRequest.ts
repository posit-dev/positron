/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { JupyterMessageSpec } from './JupyterMessageSpec';

/**
 * Represents a complete_request from the Jupyter frontend to the kernel.
 */
export interface JupyterCompleteRequest extends JupyterMessageSpec {
    /** The (incomplete) code */
    code: string;

    /** The position of the cursor in the incomplete code */
    cursor_pos: number;                // eslint-disable-line
}
