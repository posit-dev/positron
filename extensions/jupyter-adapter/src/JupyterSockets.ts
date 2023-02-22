/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export enum JupyterSockets {
	shell = 'shell',
	iopub = 'iopub',
	heartbeat = 'heartbeat',
	stdin = 'stdin',
	control = 'control'
}
