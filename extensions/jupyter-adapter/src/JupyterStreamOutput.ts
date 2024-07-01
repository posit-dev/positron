/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { JupyterMessageSpec } from './JupyterMessageSpec';

export interface JupyterStreamOutput extends JupyterMessageSpec {
	/** The stream the output belongs to, i.e. stdout/stderr */
	name: string;

	/** The text emitted from the stream */
	text: string;
}
