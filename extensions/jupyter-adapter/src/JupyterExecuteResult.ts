/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
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
