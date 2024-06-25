/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { JupyterMessageSpec } from './JupyterMessageSpec';

export interface JupyterDisplayDataTypes {
	'text/html'?: string;
	'text/markdown'?: string;
	'text/latex'?: string;
	'text/plain'?: string;
}

export interface JupyterDisplayData extends JupyterMessageSpec {
	data: JupyterDisplayDataTypes;
}
