/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { JupyterMessageSpec } from './JupyterMessageSpec';

/**
 * Represents an kernel_info_request to the kernel.
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#execute
 */
export interface JupyterKernelInfoRequest extends JupyterMessageSpec {

}
