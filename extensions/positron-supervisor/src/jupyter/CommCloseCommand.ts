/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { JupyterChannel } from './JupyterChannel';
import { JupyterCommand } from './JupyterCommand';
import { JupyterCommClose } from './JupyterCommClose';
import { JupyterMessageType } from './JupyterMessageType.js';

export class CommCloseCommand extends JupyterCommand<JupyterCommClose> {
	/**
	 * Create a new command to tear down a comm
	 *
	 * @param id The ID of the comm to tear down
	 */
	constructor(id: string) {
		super(JupyterMessageType.CommClose, {
			comm_id: id,
			data: {}
		}, JupyterChannel.Shell);
	}
}
