/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export enum JupyterSockets {
	shell = 'shell',
	iopub = 'iopub',
	heartbeat = 'heartbeat',
	stdin = 'stdin',
	control = 'control'
}
