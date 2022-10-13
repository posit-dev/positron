/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { JupyterMessageSpec } from './JupyterMessageSpec';

export interface JupyterStreamOutput extends JupyterMessageSpec {
	/** The stream the output belongs to, i.e. stdout/stderr */
	name: string;

	/** The text emitted from the stream */
	text: string;
}
