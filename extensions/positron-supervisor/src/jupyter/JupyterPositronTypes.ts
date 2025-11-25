/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export interface JupyterPositronLocation {
	uri: string;
	range: JupyterPositronRange;
}

export interface JupyterPositronRange {
	start: JupyterPositronPosition;
	end: JupyterPositronPosition;
}

// See https://jupyter-client.readthedocs.io/en/stable/messaging.html#cursor-pos-unicode-note
// regarding choice of offset in unicode points
export interface JupyterPositronPosition {
	line: number;
	/** Column offset in unicode points */
	character: number;
}
